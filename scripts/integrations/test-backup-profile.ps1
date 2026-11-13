#requires -Version 7.2
<#
Offline guard tests only. Never invokes the backup entrypoint, Docker, git, a DB
client, Credential Manager, a credential prompt, or any output-directory writer.
Actual helper functions/parameter guards are parsed and exercised in isolation.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helperPath = Join-Path $PSScriptRoot 'backup-shared-db.ps1'
$source = [IO.File]::ReadAllText($helperPath)
$parseTokens = $null
$parseErrors = $null
$helperAst = [Management.Automation.Language.Parser]::ParseFile($helperPath, [ref] $parseTokens, [ref] $parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Backup helper must parse without errors.' }
$passed = [Collections.Generic.List[string]]::new()

function Assert-True([bool] $Condition, [string] $Reason) {
    if (-not $Condition) { throw "Assertion failed: $Reason" }
}
function Assert-Equal($Actual, $Expected, [string] $Reason) {
    if ($Actual -cne $Expected) { throw "Assertion failed: $Reason" }
}
function Assert-Rejected([scriptblock] $Body, [string] $MessagePattern) {
    $failure = $null
    try { & $Body | Out-Null } catch { $failure = $_ }
    Assert-True ($null -ne $failure) 'expected rejection'
    Assert-True ($failure.Exception.Message -match $MessagePattern) 'expected guarded failure reason'
}
function Test-Case([string] $Name, [scriptblock] $Body) {
    & $Body
    $passed.Add($Name)
}
function Get-HelperFunction([string] $Name) {
    $matches = @($helperAst.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -ceq $Name
    }.GetNewClosure(), $true))
    Assert-Equal $matches.Count 1 "one actual helper function $Name"
    return $matches[0].Extent.Text
}
function Get-HelperCommand([string] $Phase) {
    $matches = @($helperAst.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.CommandAst] -and
        $Node.GetCommandName() -ceq 'Invoke-PgTool' -and
        $Node.Extent.Text.Contains("-Phase '$Phase'")
    }.GetNewClosure(), $true))
    Assert-Equal $matches.Count 1 "one actual tool invocation $Phase"
    return [scriptblock]::Create($matches[0].Extent.Text)
}
function Get-HelperIf([string] $FailureCode) {
    $matches = @($helperAst.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.IfStatementAst] -and
        $Node.Extent.Text.Contains("'$FailureCode'")
    }.GetNewClosure(), $true))
    Assert-Equal $matches.Count 1 "one metadata guard $FailureCode"
    return [scriptblock]::Create($matches[0].Extent.Text)
}

# Only the parameter block, fixed-profile setup, and pure target/branch guards.
# None of the main entrypoint or native process/credential functions is executed.
$parameterStart = $source.IndexOf('[CmdletBinding()]', [StringComparison]::Ordinal)
$parameters = $source.Substring($parameterStart, $helperAst.ParamBlock.Extent.EndOffset - $parameterStart)
$setup = @($helperAst.EndBlock.Statements | Where-Object {
    ($_ -is [Management.Automation.Language.AssignmentStatementAst] -and
        $_.Left -is [Management.Automation.Language.VariableExpressionAst] -and
        $_.Left.VariablePath.UserPath -cin @('projectRef', 'profileSettings', 'approvedImage', 'approvedBranch')) -or
    ($_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.Contains("PSBoundParameters.ContainsKey('PostgresImage')"))
})
Assert-Equal $setup.Count 5 'exact fixed-profile setup selection'
$bindingScript = [scriptblock]::Create(($parameters + "`n" +
    (Get-HelperFunction 'Get-ReviewedBackupProfile') + "`n" +
    (Get-HelperFunction 'Assert-Target') + "`n" +
    (Get-HelperFunction 'Assert-BackupBranch') + "`n" +
    (($setup | ForEach-Object { $_.Extent.Text }) -join "`n") + @'

Assert-Target
Assert-BackupBranch -Branch $testBranch -GitExitCode $testGitExitCode
[pscustomobject]@{ Profile = $profileSettings.Name; Branch = $approvedBranch; Image = $PostgresImage;
    Project = $projectRef; Host = $DbHost; Port = $DbPort; User = $DbUser; Database = $Database }
'@))
function Invoke-ProfileBinding([hashtable] $Parameters, [string] $ActualBranch = 'codex/kocmax-studio-stages-1-2', [int] $GitExitCode = 0) {
    $testBranch = $ActualBranch
    $testGitExitCode = $GitExitCode
    return & $bindingScript @Parameters
}
$originalImage = 'postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232'
$phase3Image = 'public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108'
$phase3Branch = 'codex/phase3-delta-rehearsal'

Test-Case 'Original default preserves fixed target, branch and image' {
    $result = Invoke-ProfileBinding @{}
    Assert-Equal $result.Profile 'SharedDatabaseReview' 'original default profile'
    Assert-Equal $result.Image $originalImage 'original image unchanged'
    Assert-Equal $result.Branch 'codex/kocmax-studio-stages-1-2' 'original branch unchanged'
    Assert-Equal $result.Project 'mhkoayftiuojxlrkollf' 'fixed project'
    Assert-Equal $result.Host 'aws-1-ap-northeast-1.pooler.supabase.com' 'fixed session pooler'
    Assert-Equal $result.User 'postgres.mhkoayftiuojxlrkollf' 'fixed project role'
    Assert-Equal $result.Port 5432 'fixed session port'
    Assert-Equal $result.Database 'postgres' 'fixed database'
}
Test-Case 'Phase3 profile selects its exact reviewed image and branch' {
    $result = Invoke-ProfileBinding @{ Profile = 'Phase3Preparation' } $phase3Branch
    Assert-Equal $result.Image $phase3Image 'Phase3 image pin'
    Assert-Equal $result.Branch $phase3Branch 'Phase3 branch pin'
    Assert-Equal $result.Project 'mhkoayftiuojxlrkollf' 'Phase3 target unchanged'
    Assert-Equal (Invoke-ProfileBinding @{ Profile = 'Phase3Preparation'; PostgresImage = $phase3Image } $phase3Branch).Image $phase3Image 'explicit same pin accepted'
}
Test-Case 'Profiles cannot borrow each other branch or image' {
    Assert-Rejected { Invoke-ProfileBinding @{} $phase3Branch } 'Unexpected branch'
    Assert-Rejected { Invoke-ProfileBinding @{ Profile = 'Phase3Preparation' } } 'Unexpected branch'
    Assert-Rejected { Invoke-ProfileBinding @{ Profile = 'Phase3Preparation'; PostgresImage = $originalImage } $phase3Branch } 'Target/image mismatch'
    Assert-Rejected { Invoke-ProfileBinding @{ PostgresImage = $phase3Image } } 'Target/image mismatch'
}
Test-Case 'Unknown profile, case mismatch, image tags and failed git checks reject' {
    foreach ($profileName in @('Other', 'phase3preparation', '')) {
        Assert-Rejected { Invoke-ProfileBinding @{ Profile = $profileName } $phase3Branch } 'ValidateSet|does not belong|not match|empty string'
    }
    Assert-Rejected { Invoke-ProfileBinding @{ Profile = 'Phase3Preparation'; PostgresImage = 'postgres:17' } $phase3Branch } 'Target/image mismatch'
    Assert-Rejected { Invoke-ProfileBinding @{ Profile = 'Phase3Preparation' } $phase3Branch 1 } 'Unexpected branch'
    Assert-Rejected { Invoke-ProfileBinding @{ Profile = 'Phase3Preparation' } 'main' } 'Unexpected branch'
    Assert-Rejected { Invoke-ProfileBinding @{ Profile = 'Phase3Preparation'; AllowedBranch = 'main' } $phase3Branch } 'parameter.*AllowedBranch'
}
Test-Case 'Phase3 cannot override any fixed connection target field' {
    foreach ($override in @(@{ DbHost = 'example.invalid' }, @{ DbPort = 6543 }, @{ DbUser = 'postgres.other' }, @{ Database = 'other' })) {
        $supplied = @{ Profile = 'Phase3Preparation' }
        foreach ($key in $override.Keys) { $supplied[$key] = $override[$key] }
        Assert-Rejected { Invoke-ProfileBinding $supplied $phase3Branch } 'Target/image mismatch'
    }
}

foreach ($name in @('Assert-BackupInputMode', 'Assert-NoReparsePoint', 'Assert-PinnedCa', 'Assert-OutsideServedRoots', 'Get-PrivateAcl', 'Assert-CommandResult', 'Assert-TlsPreflightResult', 'Invoke-PgTool')) {
    . ([scriptblock]::Create((Get-HelperFunction $name)))
}
Test-Case 'Working-copy CA retains original bytes, digest and actual pinned-file guard' {
    $caFile = Join-Path $PSScriptRoot 'certs/supabase-prod-ca-2021.crt'
    $caFileSha256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
    Assert-Equal (Get-Item -LiteralPath $caFile).Length 1367 'original CA bytes'
    Assert-Equal (Get-FileHash -LiteralPath $caFile -Algorithm SHA256).Hash.ToLowerInvariant() $caFileSha256 'original CA digest'
    Assert-PinnedCa
}
Test-Case 'Stored-only credentials permit redirected MTA input without a prompt' {
    $UseStoredCredential = $true
    foreach ($GuiPrompt in @($false, $true)) {
        Assert-BackupInputMode -InputRedirected $true -ApartmentState MTA
        Assert-BackupInputMode -InputRedirected $false -ApartmentState STA
    }
}
Test-Case 'Console input still requires a visible nonredirected console' {
    $UseStoredCredential = $false
    $GuiPrompt = $false
    Assert-Rejected { Assert-BackupInputMode -InputRedirected $true -ApartmentState MTA } 'visible interactive console'
    Assert-BackupInputMode -InputRedirected $false -ApartmentState MTA
}
Test-Case 'GUI input still requires STA' {
    $UseStoredCredential = $false
    $GuiPrompt = $true
    Assert-Rejected { Assert-BackupInputMode -InputRedirected $false -ApartmentState MTA } 'pwsh -STA'
    Assert-BackupInputMode -InputRedirected $true -ApartmentState STA
}
Test-Case 'Main entrypoint binds input facts and profile branch before Docker' {
    $branchGuard = $source.IndexOf('Assert-BackupBranch -Branch $branch -GitExitCode $LASTEXITCODE', [StringComparison]::Ordinal)
    $inputGuard = $source.IndexOf('Assert-BackupInputMode -InputRedirected ([Console]::IsInputRedirected) -ApartmentState ([Threading.Thread]::CurrentThread.GetApartmentState())', [StringComparison]::Ordinal)
    $dockerStart = $source.IndexOf('$script:dockerExe = (Get-Command docker.exe', [StringComparison]::Ordinal)
    Assert-True ($branchGuard -gt 0 -and $inputGuard -gt $branchGuard -and $dockerStart -gt $inputGuard) 'actual host facts checked before native access'
    $storedValidation = @($helperAst.EndBlock.Statements | Where-Object {
        $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.StartsWith('if ($ValidateStoredCredentialOnly)')
    })
    Assert-Equal $storedValidation.Count 1 'stored validation path retained'
    Assert-True ($storedValidation[0].Extent.Text.Contains("if (-not `$UseStoredCredential)")) 'stored validation requires stored mode'
    Assert-True ($storedValidation[0].Extent.Text.Contains("CurrentThread.GetApartmentState() -ne 'STA'")) 'stored-validation STA guard retained'
}

# Replace only the native credential API with a synthetic in-process class. The
# helper's exact target and username checks then execute without reading a store.
Add-Type -TypeDefinition @'
using System.Security;
public static class KocmaxBackupCredentialReader {
    public static string User = "postgres.mhkoayftiuojxlrkollf";
    public static string Value = "synthetic";
    public static int Reads = 0;
    public static SecureString Read(string target, out string userName) {
        Reads++; userName = User;
        var value = new SecureString();
        foreach (char c in Value) value.AppendChar(c);
        value.MakeReadOnly(); return value;
    }
}
'@
function Add-Type { param([string] $TypeDefinition) } # Never compile the helper's native P/Invoke class.
. ([scriptblock]::Create((Get-HelperFunction 'Read-StoredBackupSecret')))
Test-Case 'Stored secret accepts only exact target, matching user and nonempty value' {
    $DbUser = 'postgres.mhkoayftiuojxlrkollf'
    $StoredCredentialTarget = 'KOCmax/Remix-Adfocate/database'
    $secret = Read-StoredBackupSecret
    try { Assert-Equal $secret.Length 9 'synthetic stored secret returned' } finally { $secret.Dispose() }
    $before = [KocmaxBackupCredentialReader]::Reads
    $StoredCredentialTarget = 'KOCmax/Other/database'
    Assert-Rejected { Read-StoredBackupSecret } 'Unexpected local credential target'
    Assert-Equal ([KocmaxBackupCredentialReader]::Reads) $before 'wrong target stopped before even synthetic read'
    $StoredCredentialTarget = 'KOCmax/Remix-Adfocate/database'
    [KocmaxBackupCredentialReader]::User = 'postgres.other'
    Assert-Rejected { Read-StoredBackupSecret } 'stored credential user does not match'
    [KocmaxBackupCredentialReader]::User = $DbUser
    [KocmaxBackupCredentialReader]::Value = ''
    Assert-Rejected { Read-StoredBackupSecret } 'No usable stored credential'
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$servedRoots = @($repoRoot, (Join-Path ([IO.Path]::GetTempPath()) 'synthetic-served-root'))
Test-Case 'Private output must stay outside repository and visualization roots' {
    foreach ($root in $servedRoots) {
        Assert-Rejected { Assert-OutsideServedRoots $root } 'outside the repository'
        Assert-Rejected { Assert-OutsideServedRoots (Join-Path $root 'child') } 'outside the repository'
    }
    Assert-OutsideServedRoots (Join-Path ([IO.Path]::GetTempPath()) 'synthetic-private-root')
}
Test-Case 'Private ACL construction permits only current user and SYSTEM with protected inheritance' {
    Assert-True $IsWindows 'Windows ACL contract must actually execute on Windows'
    $acl = Get-PrivateAcl
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    Assert-True $acl.AreAccessRulesProtected 'inheritance protected'
    Assert-Equal ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) $owner 'current user owns ACL'
    Assert-Equal $rules.Count 2 'exactly two grants'
    foreach ($sid in @($owner, 'S-1-5-18')) {
        $rule = @($rules | Where-Object { $_.IdentityReference.Value -ceq $sid })
        Assert-Equal $rule.Count 1 'one grant per approved SID'
        Assert-Equal ($rule[0].FileSystemRights.ToString()) 'FullControl' 'full control only for owner/SYSTEM'
        Assert-Equal ($rule[0].InheritanceFlags.ToString()) 'ContainerInherit, ObjectInherit' 'directory/file inheritance'
        Assert-Equal ($rule[0].AccessControlType.ToString()) 'Allow' 'allow rule'
    }
}
Test-Case 'Native warnings remain failures and raw diagnostics are never echoed' {
    Assert-CommandResult ([pscustomobject]@{ Code = 0; Error = '' }) 'synthetic tool'
    Assert-Rejected { Assert-CommandResult ([pscustomobject]@{ Code = 0; Error = 'synthetic-sensitive-warning' }) 'synthetic tool' } 'WARNING_REQUIRES_REVIEW'
    Assert-Equal $script:failureCode 'WARNING_REQUIRES_REVIEW' 'warning classified'
    Assert-Rejected { Assert-CommandResult ([pscustomobject]@{ Code = 1; Error = 'permission denied synthetic-sensitive-value' }) 'synthetic tool' } 'PRIVILEGE_OR_RLS_INCOMPLETE'
    Assert-Rejected { Assert-TlsPreflightResult ([pscustomobject]@{ Code = 0; Output = 'CONNECTION ESTABLISHED'; Error = '' }) } 'TLS_PREFLIGHT_VERIFICATION_FAILED|pinned CA chain'
}

# Execute the actual container-argument construction with only local recorders.
# Neither recorder invokes a process, writes files, reads credentials or connects.
$script:toolCalls = [Collections.Generic.List[object]]::new()
$script:caChecks = 0
$script:failCa = $false
function Write-Manifest { }
function Assert-PinnedCa {
    $script:caChecks++
    if ($script:failCa) { throw 'synthetic pinned CA rejection' }
}
function Invoke-DockerCapture {
    param([string[]] $DockerArguments, [Security.SecureString] $Secret = $null, [int] $TimeoutSeconds = 60)
    $script:toolCalls.Add([pscustomobject]@{ Arguments = $DockerArguments; Secret = $Secret; Timeout = $TimeoutSeconds })
    return [pscustomobject]@{ Code = 0; Output = ''; Error = '' }
}
$PostgresImage = $phase3Image
$DbHost = 'aws-1-ap-northeast-1.pooler.supabase.com'
$DbPort = 5432
$DbUser = 'postgres.mhkoayftiuojxlrkollf'
$Database = 'postgres'
$CommandTimeoutSeconds = 1800
$caFile = Join-Path $PSScriptRoot 'certs/supabase-prod-ca-2021.crt'
$script:runDir = Join-Path ([IO.Path]::GetTempPath()) 'synthetic-private-root'
$script:manifest = [ordered]@{ activeContainer = $null; phase = '' }
$script:dbSecret = [Security.SecureString]::new()
$script:dbSecret.AppendChar('x')
$script:dbSecret.MakeReadOnly()
function Get-RunCall {
    $calls = @($script:toolCalls | Where-Object { $_.Arguments[0] -ceq 'run' })
    Assert-Equal $calls.Count 1 'exactly one synthetic tool run'
    return $calls[0]
}
try {
    Test-Case 'Remote dump retains fixed image, TLS, read-only options, stdin secret and no logging' {
        $script:toolCalls.Clear()
        & (Get-HelperCommand 'database_snapshot') | Out-Null
        $call = Get-RunCall
        foreach ($required in @('--pull=never', '--log-driver=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            $phase3Image, 'PGSSLMODE=verify-full', 'PGSSLROOTCERT=/tls/supabase-root.crt', 'PGPASSFILE=/dev/null', 'PGSERVICEFILE=/dev/null',
            'PGOPTIONS=-c default_transaction_read_only=on -c transaction_read_only=on -c row_security=off -c lock_timeout=5000',
            'set +x; IFS= read -r PGPASSWORD || exit 90; export PGPASSWORD; exec "$@" </dev/null',
            'pg_dump', '-w', '--format=custom', '--create', '--lock-wait-timeout=5s', '--file=/backup/database.dump.partial')) {
            Assert-True ($required -cin $call.Arguments) 'remote security/full-dump argument retained'
        }
        Assert-True ([object]::ReferenceEquals($call.Secret, $script:dbSecret)) 'secret uses separate stdin transport'
        Assert-True (-not ($call.Arguments | Where-Object { $_ -match '^PGPASSWORD=|^--(?:exclude|table|schema|section|data-only|schema-only|no-owner|no-acl)' })) 'no secret argument or partial-dump fallback'
        Assert-Equal $call.Arguments[([array]::IndexOf($call.Arguments, '--network') + 1)] 'bridge' 'remote network intentional'
        Assert-True ($call.Arguments -ccontains "type=bind,source=$caFile,target=/tls/supabase-root.crt,readonly") 'CA mounted read-only'
    }
    Test-Case 'Roles dump remains catalog-only with no role passwords' {
        $script:toolCalls.Clear()
        & (Get-HelperCommand 'roles_snapshot') | Out-Null
        $call = Get-RunCall
        foreach ($required in @('pg_dumpall', '--database=postgres', '--roles-only', '--no-role-passwords', '--file=/backup/roles.sql.partial')) {
            Assert-True ($required -cin $call.Arguments) 'reviewed roles export retained'
        }
    }
    Test-Case 'Offline inventory stays network none and carries no secret or CA mount' {
        $script:toolCalls.Clear()
        & (Get-HelperCommand 'offline_inventory') | Out-Null
        $call = Get-RunCall
        Assert-Equal $call.Arguments[([array]::IndexOf($call.Arguments, '--network') + 1)] 'none' 'inventory has no network'
        Assert-True ($null -eq $call.Secret) 'inventory has no credential'
        Assert-True (-not ($call.Arguments | Where-Object { $_ -match 'PGHOST=|/tls/' })) 'inventory has no remote configuration'
        foreach ($required in @('pg_restore', '--list', '--file=/backup/toc.list.partial', '/backup/database.dump.partial')) {
            Assert-True ($required -cin $call.Arguments) 'inventory lists archive only'
        }
    }
    Test-Case 'TLS preflight remains credential-free with strict chain and hostname verification' {
        $script:toolCalls.Clear()
        # The tool's TLS checker gets separate positive diagnostics, still synthetic.
        function Invoke-DockerCapture {
            param([string[]] $DockerArguments, [Security.SecureString] $Secret = $null, [int] $TimeoutSeconds = 60)
            $script:toolCalls.Add([pscustomobject]@{ Arguments = $DockerArguments; Secret = $Secret; Timeout = $TimeoutSeconds })
            return [pscustomobject]@{ Code = 0; Output = "CONNECTION ESTABLISHED`nVerification: OK"; Error = '' }
        }
        & (Get-HelperCommand 'tls_preflight') | Out-Null
        $call = Get-RunCall
        Assert-True ($null -eq $call.Secret) 'TLS preflight has no credential'
        Assert-True (-not ($call.Arguments | Where-Object { $_ -match 'PGHOST=|target=/backup' })) 'TLS preflight has no backup mount or DB session options'
        foreach ($required in @('openssl', '-verify_hostname', $DbHost, '-verify_return_error', '-CAfile', '/tls/supabase-root.crt', '-no-CApath', '-no-CAstore')) {
            Assert-True ($required -cin $call.Arguments) 'strict credential-free TLS argument retained'
        }
        Assert-Rejected { Invoke-PgTool -Remote -TlsPreflight -Tool openssl -Phase 'bad' } 'cannot use the credential-bearing'
        Assert-Rejected { Invoke-PgTool -TlsPreflight -Tool psql -Phase 'bad' } 'fixed OpenSSL'
    }
    Test-Case 'Pinned CA rejection stops before any container invocation' {
        $script:toolCalls.Clear()
        $script:failCa = $true
        Assert-Rejected { & (Get-HelperCommand 'database_snapshot') } 'synthetic pinned CA rejection'
        Assert-Equal $script:toolCalls.Count 0 'CA checked before tool run'
        $script:failCa = $false
    }
} finally {
    $script:dbSecret.Dispose()
    $script:dbSecret = $null
}

Test-Case 'Metadata checks require explicit read-only PG17 identity and complete coverage' {
    $metadata = [pscustomobject]@{ database = 'postgres'; user = 'postgres'; session_user = 'postgres'; default_read_only = 'off';
        transaction_read_only = 'on'; row_security = 'off'; server_version_num = 170011 }
    $identityGuard = Get-HelperIf 'REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH'
    & $identityGuard
    $metadata.transaction_read_only = 'off'
    Assert-Rejected { & $identityGuard } 'read-only target'
    $metadata.transaction_read_only = 'on'
    $metadata.server_version_num = 160000
    Assert-Rejected { & $identityGuard } 'read-only target'
    $metadata.server_version_num = 170011
    $metadata | Add-Member -NotePropertyMembers @{ schemas = @('public', 'auth', 'storage'); unreadable_tables = 0; missing_schema_usage = 0; foreign_tables = 0; extra_tablespaces = 0 }
    $coverageGuard = Get-HelperIf 'PRIVILEGE_OR_COVERAGE_INCOMPLETE'
    & $coverageGuard
    $metadata.unreadable_tables = 1
    Assert-Rejected { & $coverageGuard } 'no partial fallback'
    Assert-True ($source.Replace("`r`n", "`n").Contains("BEGIN READ ONLY;`nSET LOCAL row_security = off;")) 'metadata transaction remains explicit read-only'
}
Test-Case 'Receipts identify the fixed profile and new helper version without claiming restore validation' {
    Assert-True ($source.Contains("helperVersion = '4-reviewed-profiles-20261113'")) 'helper version updated'
    Assert-True ($source.Contains('profile = $profileSettings.Name; profileBranch = $approvedBranch')) 'profile and branch receipt fields'
    Assert-True ($source.Contains("restoreRehearsal = 'NOT_RUN'; migrationAuthorization = 'NOT_ASSESSED_BY_BACKUP'")) 'capture does not authorize migration or attest restore'
}

[pscustomobject]@{ status = 'PASS'; tests = $passed.Count; hostVersion = $PSVersionTable.PSVersion.ToString(); checks = $passed.ToArray(); databaseQueries = 0; nativeProcesses = 0; credentialStoreReads = 0; backupFilesWritten = 0 } | ConvertTo-Json -Depth 4

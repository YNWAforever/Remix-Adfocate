#requires -Version 7.2
<#
Offline AST guard tests only. Never runs either verification entrypoint, Docker,
git, a database client, credential access, or a backup/evidence writer. Only
reviewed source files are read; all manifest/container records are synthetic.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$passed = [Collections.Generic.List[string]]::new()
$script:failureCode = 'UNSET'
$script:failure = 'UNSET'
$asts = @{}
foreach ($name in @('verify-local-backup.ps1', 'verify-auth-pilot-restore.ps1')) {
    $tokens = $null
    $errors = $null
    $asts[$name] = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref] $tokens, [ref] $errors)
    if ($errors.Count -ne 0) { throw 'Both verification scripts must parse without errors.' }
}
$archiveAst = $asts['verify-local-backup.ps1']
$wrapperAst = $asts['verify-auth-pilot-restore.ps1']

function Assert-True([bool] $Condition, [string] $Reason) {
    if (-not $Condition) { throw "Assertion failed: $Reason" }
}
function Assert-Equal($Actual, $Expected, [string] $Reason) {
    Assert-True ($Actual -ceq $Expected) $Reason
}
function Test-Case([string] $Name, [scriptblock] $Body) {
    try { & $Body }
    catch { throw "Offline test failed: $Name; guard codes $script:failureCode/$script:failure. $($_.ScriptStackTrace)" }
    $passed.Add($Name)
}
function Assert-Rejected([scriptblock] $Body, [string] $Code = '') {
    $caught = $null
    $script:failureCode = 'UNSET'
    $script:failure = 'UNSET'
    try { & $Body | Out-Null } catch { $caught = $_ }
    Assert-True ($null -ne $caught) 'expected rejection'
    if ($Code) { Assert-True ($script:failureCode -ceq $Code -or $script:failure -ceq $Code) 'expected fixed failure code' }
}
function Actual-Function($Ast, [string] $Name) {
    $matches = @($Ast.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -ceq $Name
    }.GetNewClosure(), $true))
    Assert-Equal $matches.Count 1 "one actual function $Name"
    return $matches[0].Extent.Text
}
function Actual-FunctionScript($Ast, [string] $Name) {
    # Preserve the source filename so automatic PSScriptRoot resolves exactly as
    # it does in the entrypoint; only this function definition is loaded.
    $tokens = $null
    $errors = $null
    $definition = [Management.Automation.Language.Parser]::ParseInput((Actual-Function $Ast $Name), $Ast.Extent.File, [ref] $tokens, [ref] $errors)
    Assert-Equal $errors.Count 0 'isolated actual function parses'
    return $definition.GetScriptBlock()
}
function Actual-Assignment($Ast, [string] $Name) {
    $matches = @($Ast.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.AssignmentStatementAst] -and
        $Node.Left -is [Management.Automation.Language.VariableExpressionAst] -and $Node.Left.VariablePath.UserPath -ceq $Name
    }.GetNewClosure(), $true))
    Assert-Equal $matches.Count 1 "one actual assignment $Name"
    return $matches[0].Extent.Text
}
function Actual-Guard($Ast, [string] $Code) {
    $matches = @($Ast.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.IfStatementAst] -and $Node.Extent.Text.Contains("'$Code'")
    }.GetNewClosure(), $true))
    # Select the smallest guard, rather than any containing parent if statement.
    $guard = $matches | Sort-Object { $_.Extent.Text.Length } | Select-Object -First 1
    Assert-True ($null -ne $guard) "actual guard $Code exists"
    return [scriptblock]::Create($guard.Extent.Text)
}
function Actual-Command($Ast, [string] $Name, [string] $Marker) {
    $matches = @($Ast.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.CommandAst] -and $Node.GetCommandName() -ceq $Name -and
        $Node.Extent.Text.Contains($Marker)
    }.GetNewClosure(), $true))
    Assert-Equal $matches.Count 1 "one actual command $Marker"
    return [scriptblock]::Create($matches[0].Extent.Text)
}
function Copy-Record($Record) {
    return ConvertFrom-Json -InputObject (ConvertTo-Json -InputObject $Record -Depth 32 -Compress) -AsHashtable -Depth 32
}
function Profile-Binding($Ast, [string] $Function, [string[]] $Assignments) {
    $text = $Ast.Extent.Text
    $start = $text.IndexOf('[CmdletBinding()]', [StringComparison]::Ordinal)
    $parameters = $text.Substring($start, $Ast.ParamBlock.Extent.EndOffset - $start)
    return [scriptblock]::Create($parameters + "`n" + (Actual-Function $Ast $Function) + "`n" +
        (($Assignments | ForEach-Object { Actual-Assignment $Ast $_ }) -join "`n") + "`n`$profileSettings")
}
$archiveBinding = Profile-Binding $archiveAst 'Get-ReviewedVerificationProfile' @('profileSettings', 'expectedBranch', 'toolImage')
$wrapperBinding = Profile-Binding $wrapperAst 'Get-ReviewedRestoreProfile' @('profileSettings', 'restoreImage')
function Bind-Archive([hashtable] $Parameters = @{}) {
    return & $archiveBinding -AttemptDirectory 'C:\synthetic-private\attempt' @Parameters
}
function Bind-Wrapper([hashtable] $Parameters = @{}) {
    return & $wrapperBinding -AttemptDirectory 'C:\synthetic-private\attempt' -SourceFingerprintPath 'C:\synthetic-source.json' -CheckpointNotBeforeUtc ([DateTimeOffset]'2026-11-13T00:00:00Z') @Parameters
}
$legacyBranch = 'codex/kocmax-studio-stages-1-2'
$phase3Branch = 'codex/phase3-delta-rehearsal'
$legacyCaptureImage = 'postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232'
$phase3CaptureImage = 'public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108'
$phase3TlsImage = 'node@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496'
$legacyRestoreImage = 'public.ecr.aws/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9'
$phase3RestoreImage = 'public.ecr.aws/supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'

Test-Case 'Default profiles preserve historic branch, images, helper and statuses' {
    $a = Bind-Archive
    $w = Bind-Wrapper
    Assert-Equal $a.Name 'SharedDatabaseReview' 'archive default'
    Assert-Equal $a.Branch $legacyBranch 'legacy branch'
    Assert-Equal $a.Image $legacyCaptureImage 'legacy capture image'
    Assert-Equal $a.HelperVersion '3-native-readonly-20261101' 'historic manifest helper'
    Assert-Equal $a.SuccessStatus 'ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED' 'legacy archive status'
    Assert-Equal $w.Name $a.Name 'wrapper default'
    Assert-Equal $w.Branch $legacyBranch 'wrapper legacy branch'
    Assert-Equal $w.Image $legacyRestoreImage 'legacy restore image'
    Assert-Equal $w.ArchiveImage $a.Image 'legacy archive image receipt'
    Assert-Equal $w.SuccessStatus 'AUTH_PILOT_CURRENT_RESTORE_VERIFIED' 'legacy restore status'
    Assert-Equal $w.ApplicationTables 94 'legacy application count'
    Assert-Equal $w.PublicTables 80 'legacy public count'
    Assert-Equal $w.PrivateTables 14 'legacy private count'
    Assert-Equal $w.MigrationRows 15 'legacy migration count'
}
Test-Case 'Phase3 profiles select only reviewed pins and preparation statuses' {
    $a = Bind-Archive @{ Profile = 'Phase3Preparation' }
    $w = Bind-Wrapper @{ Profile = 'Phase3Preparation' }
    Assert-Equal $a.Branch $phase3Branch 'phase3 branch'
    Assert-Equal $a.Image $phase3CaptureImage 'phase3 capture pin'
    Assert-Equal $a.TlsImage $phase3TlsImage 'phase3 credential-free TLS pin'
    Assert-Equal $a.HelperVersion '5-separated-tls-tools-20261113' 'phase3 helper pin'
    Assert-Equal $w.Image $phase3RestoreImage 'phase3 restore pin'
    Assert-Equal $w.ArchiveImage $a.Image 'phase3 archive receipt image'
    Assert-Equal $w.ArchiveStatus $a.SuccessStatus 'phase3 archive status agreement'
    Assert-Equal $a.SuccessStatus 'PHASE3_ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED' 'phase3 archive scope'
    Assert-Equal $w.SuccessStatus 'PHASE3_PREPARATION_RESTORE_VERIFIED_AUTH_NOT_TESTED' 'phase3 restore scope'
    Assert-Equal $w.FailureStatus 'PHASE3_PREPARATION_RESTORE_NOT_VERIFIED' 'phase3 failure scope'
    Assert-Equal $w.ApplicationTables 104 'phase3 application count'
    Assert-Equal $w.PublicTables 90 'phase3 public count'
    Assert-Equal $w.PrivateTables 14 'phase3 private count'
    Assert-Equal $w.MigrationRows 17 'phase3 migration count'
}
Test-Case 'Unknown or differently cased profiles and all broadening parameters reject' {
    foreach ($bind in @($archiveBinding, $wrapperBinding)) {
        $mandatory = @{ AttemptDirectory = 'C:\synthetic-private\attempt' }
        if ($bind -eq $wrapperBinding) {
            $mandatory.SourceFingerprintPath = 'C:\synthetic-source.json'
            $mandatory.CheckpointNotBeforeUtc = [DateTimeOffset]'2026-11-13T00:00:00Z'
        }
        foreach ($name in @('Other', 'phase3preparation', '')) {
            Assert-Rejected { & $bind @mandatory -Profile $name }
        }
        foreach ($name in @('AllowedBranch', 'PostgresImage', 'RestoreImage', 'Network', 'Publish', 'DbHost', 'DbPort', 'ProjectRef', 'Credential', 'Password', 'ConnectionString', 'SkipHashCheck', 'AllowUnreviewedImage')) {
            $extra = @{ Profile = 'Phase3Preparation' }
            $extra[$name] = 'synthetic-override'
            Assert-Rejected { & $bind @mandatory @extra }
        }
        Assert-Rejected { & $bind @mandatory -TimeoutSeconds 59 }
        Assert-Rejected { & $bind @mandatory -TimeoutSeconds 7201 }
    }
}

foreach ($name in @('Get-ReviewedVerificationProfile', 'Stop-Verification', 'Normalize-LocalPath', 'Assert-Manifest', 'Assert-VerificationBranch', 'Get-ArchiveReadArguments')) {
    . (Actual-FunctionScript $archiveAst $name)
}
foreach ($name in @('Get-ReviewedRestoreProfile', 'Stop-Check', 'Local-Path', 'File-Hash', 'Assert-NoLink', 'Assert-CodePins', 'Normalize-Fingerprint', 'Nonnegative-Integer', 'Parse-Object', 'Capture-Time', 'Canonical-Value', 'Canonical-Json')) {
    . (Actual-FunctionScript $wrapperAst $name)
}
$projectRef = 'mhkoayftiuojxlrkollf'
$backupRoot = 'C:\synthetic-private\mhkoayftiuojxlrkollf'
$artifactNames = @('database.dump', 'roles.sql', 'toc.list')
function New-Manifest([string] $Name = 'Phase3Preparation') {
    $settings = Get-ReviewedVerificationProfile $Name
    $manifest = @{
        projectRef = $projectRef; host = 'aws-1-ap-northeast-1.pooler.supabase.com'; port = 5432
        user = 'postgres.mhkoayftiuojxlrkollf'; database = 'postgres'; image = $settings.Image
        branch = $settings.Branch; status = 'CAPTURED_INVENTORIED_RESTORE_NOT_TESTED'; phase = 'finished'
        helperVersion = $settings.HelperVersion; tls = 'verify-full'; restoreRehearsal = 'NOT_RUN'
        failureCode = $null; activeContainer = $null; remoteReadOnly = $true
        imageId = 'sha256:' + ('1' * 64); head = '2' * 40; scriptSha256 = '3' * 64; backupRoot = $backupRoot
        ca = @{ fileSha256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7' }
        tlsPreflight = @{ status = 'VERIFIED_CHAIN_AND_HOSTNAME_NO_AUTH'; hostname = 'aws-1-ap-northeast-1.pooler.supabase.com' }
        readOnlyStrategy = @{ metadata = 'explicit_read_only_transaction'; databaseDump = 'pg_dump_17_11_native_read_only_transaction'; rolesDump = 'pg_dumpall_17_11_catalog_select_only'; startupOptions = 'requested_not_relied_on' }
        databaseMetadata = @{ transaction_read_only = 'on'; row_security = 'off'; default_read_only = 'off' }
        artifacts = @(foreach ($artifactName in $artifactNames) { @{ name = $artifactName; bytes = 1; sha256 = '4' * 64 } })
    }
    if ($Name -ceq 'Phase3Preparation') {
        $manifest.profile = $Name
        $manifest.profileBranch = $settings.Branch
        $manifest.tlsPreflightImage = $settings.TlsImage
        $manifest.pgDumpVersion = 'pg_dump (PostgreSQL) 17.11'
        foreach ($key in @('database', 'user', 'session_user')) { $manifest.databaseMetadata[$key] = 'postgres' }
        $manifest.databaseMetadata.server_version_num = 170006
        $manifest.databaseMetadata.schemas = @('public', 'auth', 'storage')
        foreach ($key in @('unreadable_tables', 'missing_schema_usage', 'foreign_tables', 'extra_tablespaces')) { $manifest.databaseMetadata[$key] = 0 }
    }
    return $manifest
}
Test-Case 'Actual manifest and branch guards accept both exact fixed profiles' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $profileSettings = Get-ReviewedVerificationProfile $name
        $expectedBranch = $profileSettings.Branch
        $toolImage = $profileSettings.Image
        Assert-Manifest (New-Manifest $name)
        Assert-VerificationBranch @($expectedBranch) 0
        Assert-Rejected { Assert-VerificationBranch @('main') 0 } 'WORKTREE_BRANCH_MISMATCH'
        Assert-Rejected { Assert-VerificationBranch @($expectedBranch) 1 } 'WORKTREE_BRANCH_MISMATCH'
        Assert-Rejected { Assert-VerificationBranch @($expectedBranch, $expectedBranch) 0 } 'WORKTREE_BRANCH_MISMATCH'
        $otherBranch = if ($name -ceq 'Phase3Preparation') { $legacyBranch } else { $phase3Branch }
        Assert-Rejected { Assert-VerificationBranch @($otherBranch) 0 } 'WORKTREE_BRANCH_MISMATCH'
    }
}
$profileSettings = Get-ReviewedVerificationProfile 'Phase3Preparation'
$expectedBranch = $profileSettings.Branch
$toolImage = $profileSettings.Image
Test-Case 'Phase3 rejects borrowed profile, image, branch, helper and TLS pins' {
    foreach ($change in @(@{ profile = 'SharedDatabaseReview' }, @{ profileBranch = $legacyBranch }, @{ branch = $legacyBranch },
        @{ image = $legacyCaptureImage }, @{ image = 'postgres:17' }, @{ helperVersion = '3-native-readonly-20261101' }, @{ tlsPreflightImage = $phase3CaptureImage })) {
        $manifest = New-Manifest
        foreach ($key in $change.Keys) { $manifest[$key] = $change[$key] }
        Assert-Rejected { Assert-Manifest $manifest } 'MANIFEST_IDENTITY_OR_STATUS_MISMATCH'
    }
    foreach ($key in @('profile', 'profileBranch', 'tlsPreflightImage')) {
        $manifest = New-Manifest
        $manifest.Remove($key)
        Assert-Rejected { Assert-Manifest $manifest } 'MANIFEST_IDENTITY_OR_STATUS_MISMATCH'
    }
    Assert-Rejected { Assert-Manifest (New-Manifest 'SharedDatabaseReview') } 'MANIFEST_IDENTITY_OR_STATUS_MISMATCH'
}
Test-Case 'Phase3 requires actual source version and pg_dump 17.11 with complete read-only metadata' {
    foreach ($version in @(170011, 160000, '170006')) {
        $manifest = New-Manifest
        $manifest.databaseMetadata.server_version_num = $version
        Assert-Rejected { Assert-Manifest $manifest } 'PHASE3_CAPTURE_VERSION_OR_IDENTITY_MISMATCH'
    }
    foreach ($version in @('pg_dump (PostgreSQL) 17.6', 'pg_dump (PostgreSQL) 17.110', '')) {
        $manifest = New-Manifest
        $manifest.pgDumpVersion = $version
        Assert-Rejected { Assert-Manifest $manifest } 'PHASE3_CAPTURE_VERSION_OR_IDENTITY_MISMATCH'
    }
    foreach ($key in @('database', 'user', 'session_user')) {
        $manifest = New-Manifest
        $manifest.databaseMetadata[$key] = 'other'
        Assert-Rejected { Assert-Manifest $manifest } 'PHASE3_CAPTURE_VERSION_OR_IDENTITY_MISMATCH'
    }
    foreach ($key in @('unreadable_tables', 'missing_schema_usage', 'foreign_tables', 'extra_tablespaces')) {
        $manifest = New-Manifest
        $manifest.databaseMetadata[$key] = 1
        Assert-Rejected { Assert-Manifest $manifest } 'PHASE3_CAPTURE_COVERAGE_MISMATCH'
    }
    $manifest = New-Manifest
    $manifest.databaseMetadata.schemas = @('public', 'auth')
    Assert-Rejected { Assert-Manifest $manifest } 'PHASE3_CAPTURE_COVERAGE_MISMATCH'
}
Test-Case 'Original target, TLS, read-only, full-artifact and failed-capture guards remain enforced' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $profileSettings = Get-ReviewedVerificationProfile $name
        $expectedBranch = $profileSettings.Branch
        $toolImage = $profileSettings.Image
        foreach ($change in @(@{ projectRef = 'other' }, @{ host = 'example.invalid' }, @{ user = 'postgres.other' }, @{ database = 'other' },
            @{ port = 6543 }, @{ port = '5432' }, @{ tls = 'require' }, @{ remoteReadOnly = $false }, @{ restoreRehearsal = 'PASSED' },
            @{ status = 'IN_PROGRESS' }, @{ failureCode = 'FAILED' }, @{ activeContainer = 'synthetic' })) {
            $manifest = New-Manifest $name
            foreach ($key in $change.Keys) { $manifest[$key] = $change[$key] }
            Assert-Rejected { Assert-Manifest $manifest }
        }
        foreach ($mutation in @(
            { param($m) $m.databaseMetadata.transaction_read_only = 'off' },
            { param($m) $m.databaseMetadata.row_security = 'on' },
            { param($m) $m.readOnlyStrategy.startupOptions = 'relied_on' },
            { param($m) $m.ca.fileSha256 = '0' * 64 },
            { param($m) $m.tlsPreflight.status = 'FAILED' },
            { param($m) $m.artifacts = $m.artifacts[0..1] },
            { param($m) $m.artifacts[2].name = 'database.dump' },
            { param($m) $m.artifacts[0].bytes = 0 },
            { param($m) $m.artifacts[0].sha256 = 'invalid' })) {
            $manifest = New-Manifest $name
            & $mutation $manifest
            Assert-Rejected { Assert-Manifest $manifest }
        }
    }
}
Test-Case 'Actual archive arguments remain an unfiltered offline read with a read-only mount' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $toolImage = (Get-ReviewedVerificationProfile $name).Image
        $arguments = Get-ArchiveReadArguments 'C:\synthetic-private\attempt' 'synthetic-read-container'
        foreach ($value in @('--pull=never', '--network=none', '--read-only', '--log-driver=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            $toolImage, 'pg_restore', '--no-password', '--format=custom', '--file=/dev/null', '/backup/database.dump',
            'type=bind,source=C:\synthetic-private\attempt,target=/backup,readonly')) { Assert-True ($value -cin $arguments) 'archive safety argument' }
        Assert-Equal @($arguments | Where-Object { $_ -ceq '--mount' }).Count 1 'one read-only backup mount'
        Assert-True (-not ($arguments | Where-Object { $_ -match '^--(?:host|dbname|table|schema|section|exclude|data-only|schema-only|publish|env)|PGPASSWORD=|docker.sock|pipe/docker' })) 'no connection, filter, credential, port or socket arguments'
    }
}

# Native invocation is replaced by a recorder; the actual call expression builds
# the exact child arguments. No child process or evidence writer is executed.
$script:recordedCall = $null
function Invoke-Captured {
    param([string] $Program, [string[]] $Arguments, [string] $Label, [int] $Seconds)
    $script:recordedCall = @{ Program = $Program; Arguments = $Arguments; Label = $Label; Seconds = $Seconds }
}
$verifierCommand = Actual-Command $wrapperAst 'Invoke-Captured' "-Label 'archive-verifier'"
Test-Case 'Actual wrapper invocation forwards each fixed profile without policy overrides' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $profileSettings = Get-ReviewedRestoreProfile $name
        $shellPath = Join-Path $PSHOME 'pwsh.exe'
        $verifierPath = Join-Path $PSScriptRoot 'verify-local-backup.ps1'
        $attempt = 'C:\synthetic-private\attempt'
        $TimeoutSeconds = 1800
        & $verifierCommand
        Assert-Equal $script:recordedCall.Program $shellPath 'same host PowerShell executable'
        Assert-Equal ($script:recordedCall.Arguments -join '|') "-NoProfile|-File|$verifierPath|-AttemptDirectory|$attempt|-TimeoutSeconds|1800|-Profile|$name" 'actual reviewed child arguments'
        Assert-Equal $script:recordedCall.Seconds 0 'child cleanup timeout behavior unchanged'
    }
}
$receiptGuard = Actual-Guard $wrapperAst 'ARCHIVE_VERIFIER_DID_NOT_PASS'
Test-Case 'Actual receipt guard rejects cross-profile, image, version, branch and incomplete reads' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $profileSettings = Get-ReviewedRestoreProfile $name
        $result = @{ attempt = 'synthetic-attempt' }
        $receipt = @{ verifierVersion = '2-fixed-profiles-20261113'; profile = $name; profileBranch = $profileSettings.Branch; image = $profileSettings.ArchiveImage
            status = $profileSettings.ArchiveStatus; projectRef = $projectRef; attempt = $result.attempt; fullArchiveRead = 'PASSED'; hashesAfter = 'UNCHANGED'; containerCleanup = 'CONFIRMED' }
        $full = Copy-Record $receipt
        & $receiptGuard
        foreach ($key in $receipt.Keys) {
            $full = Copy-Record $receipt
            $full[$key] = 'wrong'
            Assert-Rejected { & $receiptGuard } 'ARCHIVE_VERIFIER_DID_NOT_PASS'
        }
    }
}

$profileSettings = Get-ReviewedRestoreProfile 'Phase3Preparation'
$restoreImage = $profileSettings.Image
$attempt = 'C:\synthetic-private\attempt'
$script:evidence = 'C:\synthetic-private\evidence'
$script:runtimeOutput = 'C:\synthetic-private\evidence\container-output'
$script:ownerToken = '0123456789abcdef0123456789abcdef'
$script:containerName = 'kocmax-auth-restore-' + $script:ownerToken
$volumeArguments = @('--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=16m,mode=1777')
$createScript = [scriptblock]::Create((Actual-Assignment $wrapperAst 'createArguments'))
Test-Case 'Actual restore construction retains fixed image, nonce, six mounts, tmpfs and no source credentials' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $restoreImage = (Get-ReviewedRestoreProfile $name).Image
        . $createScript
        foreach ($value in @('--pull=never', '--network=none', '--log-driver=none', '--read-only', '--user=postgres', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--pids-limit=256', '--memory=1g', '--cpus=1', 'HOME=/tmp', '/tmp:rw,nosuid,nodev,noexec,size=2g,mode=1777',
            ('kocmax.auth-pilot-restore=' + $script:ownerToken), $restoreImage, '/bin/sh', '/review/entrypoint.sh')) { Assert-True ($value -cin $createArguments) 'restore security argument retained' }
        Assert-Equal @($createArguments | Where-Object { $_ -ceq '--mount' }).Count 6 'exact six reviewed bind mounts'
        Assert-Equal @($createArguments | Where-Object { $_ -match '^type=bind,.*?,readonly$' }).Count 5 'all five restore inputs read-only'
        Assert-True (-not ($createArguments | Where-Object { $_ -match '^--publish|^--network=(?!none)|PGPASSWORD=|PGHOST=|docker.sock|source=.*(?:credentials|\.pgpass|source\.json)' })) 'no network, ports, socket or credentials'
    }
}
$isolationGuard = Actual-Guard $wrapperAst 'LOCAL_RESTORE_ISOLATION_MISMATCH'
$mountCountGuards = @($wrapperAst.FindAll({ param($Node)
    $Node -is [Management.Automation.Language.IfStatementAst] -and $Node.Extent.Text.StartsWith('if ($binds.Count -ne 6')
}, $true))
Assert-Equal $mountCountGuards.Count 1 'one actual exact mount count guard'
$mountGuard = [scriptblock]::Create($mountCountGuards[0].Extent.Text)
$mountLoop = @($wrapperAst.FindAll({ param($Node)
    $Node -is [Management.Automation.Language.ForEachStatementAst] -and $Node.Variable.VariablePath.UserPath -ceq 'mount'
}, $true))
Assert-Equal $mountLoop.Count 1 'one actual mount allowlist loop'
$mountLoopScript = [scriptblock]::Create($mountLoop[0].Extent.Text)
$mountSetup = [scriptblock]::Create((Actual-Assignment $wrapperAst 'expectedMounts') + "`n" + (Actual-Assignment $wrapperAst 'binds'))
$created = @{ Output = '5' * 64 }
$cleanContainer = @{ Id = $created.Output; Config = @{ Labels = @{ 'kocmax.auth-pilot-restore' = $script:ownerToken }; User = 'postgres' }
    HostConfig = @{ NetworkMode = 'none'; LogConfig = @{ Type = 'none' }; ReadonlyRootfs = $true; Privileged = $false; PublishAllPorts = $false; PortBindings = @{} }
    Mounts = @(foreach ($destination in @('/backup', '/checks.sql', '/current-fingerprint.sql', '/review/restore.sh', '/review/entrypoint.sh', '/evidence')) {
        @{ Type = 'bind'; Destination = $destination; RW = ($destination -ceq '/evidence') }
    }) }
Test-Case 'Actual inspect guard rejects broad network, ports, privilege, user, owner and container identity drift' {
    $container = Copy-Record $cleanContainer
    $containers = @($container)
    & $isolationGuard
    foreach ($mutation in @(
        { param($c) $c.HostConfig.NetworkMode = 'bridge' },
        { param($c) $c.HostConfig.PublishAllPorts = $true },
        { param($c) $c.HostConfig.PortBindings = @{ '5432/tcp' = @(@{ HostPort = '5432' }) } },
        { param($c) $c.HostConfig.Privileged = $true },
        { param($c) $c.HostConfig.ReadonlyRootfs = $false },
        { param($c) $c.HostConfig.LogConfig.Type = 'json-file' },
        { param($c) $c.Config.User = 'root' },
        { param($c) $c.Config.Labels['kocmax.auth-pilot-restore'] = 'wrong-owner' },
        { param($c) $c.Id = '6' * 64 })) {
        $container = Copy-Record $cleanContainer
        $containers = @($container)
        & $mutation $container
        Assert-Rejected { & $isolationGuard } 'LOCAL_RESTORE_ISOLATION_MISMATCH'
    }
}
Test-Case 'Actual mount allowlist rejects writable inputs, socket, credentials and extra binds' {
    $container = Copy-Record $cleanContainer
    . $mountSetup
    & $mountGuard
    & $mountLoopScript
    foreach ($mutation in @(
        { param($c) $c.Mounts[0].RW = $true },
        { param($c) $c.Mounts[1].Destination = '/var/run/docker.sock' },
        { param($c) $c.Mounts[2].Destination = '/root/.pgpass' },
        { param($c) $c.Mounts += @{ Type = 'bind'; Destination = '/credentials'; RW = $false } },
        { param($c) $c.Mounts += @{ Type = 'volume'; Destination = '/unexpected'; RW = $true } })) {
        $container = Copy-Record $cleanContainer
        & $mutation $container
        Assert-Rejected { . $mountSetup; & $mountGuard; & $mountLoopScript } 'LOCAL_RESTORE_MOUNT_MISMATCH'
    }
}
Test-Case 'Actual warning and capture-time guards still fail closed' {
    . ([scriptblock]::Create((Actual-Function $wrapperAst 'Require-NativeSuccess')))
    Require-NativeSuccess @{ Code = 0; Error = '' } 'SYNTHETIC_NATIVE_FAILURE'
    Assert-Rejected { Require-NativeSuccess @{ Code = 0; Error = 'synthetic-warning' } 'SYNTHETIC_NATIVE_FAILURE' } 'SYNTHETIC_NATIVE_FAILURE'
    Assert-Rejected { Capture-Time '2026-11-13T00:00:00' } 'INVALID_CAPTURE_TIME'
    $manifest = @{ startedUtc = '2026-11-13T01:00:00Z'; updatedUtc = '2026-11-13T02:00:00Z' }
    $CheckpointNotBeforeUtc = [DateTimeOffset]'2026-11-13T00:00:00Z'
    $started = Capture-Time $manifest.startedUtc
    $finished = Capture-Time $manifest.updatedUtc
    $timeGuard = Actual-Guard $wrapperAst 'FRESH_CHECKPOINT_REQUIRED'
    & $timeGuard
    $started = $CheckpointNotBeforeUtc.AddSeconds(-1)
    Assert-Rejected { & $timeGuard } 'FRESH_CHECKPOINT_REQUIRED'
    $started = $CheckpointNotBeforeUtc.AddHours(2)
    $finished = $started.AddSeconds(-1)
    Assert-Rejected { & $timeGuard } 'FRESH_CHECKPOINT_REQUIRED'
    $finished = [DateTimeOffset]::UtcNow.AddHours(1)
    Assert-Rejected { & $timeGuard } 'FRESH_CHECKPOINT_REQUIRED'
}
Test-Case 'Fingerprint keeps five sanitized fields with fixed legacy and Phase3 scope counts' {
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $profileSettings = Get-ReviewedRestoreProfile $name
        $row = @{ application_data = @{ table_count = $profileSettings.ApplicationTables; row_count = 123; data_digest = '7' * 32 };
            migration_count = $profileSettings.MigrationRows; policy_count = 100; auth_table_count = 21; storage_table_count = 9 }
        $normalized = Normalize-Fingerprint $row
        Assert-Equal $normalized.Count 5 'only five query fields'
        Assert-Equal (Canonical-Json $normalized) (Canonical-Json (Normalize-Fingerprint (Copy-Record $row))) 'canonical equality'
        $row.extra = 'not-allowed'
        Assert-Rejected { Normalize-Fingerprint $row } 'INVALID_FINGERPRINT_COLUMNS'
        $row.Remove('extra')
        $row.application_data.table_count = $profileSettings.ApplicationTables - 1
        Assert-Rejected { Normalize-Fingerprint $row } $profileSettings.ScopeFailure
        $row.application_data.table_count = $profileSettings.ApplicationTables
        $row.migration_count = $profileSettings.MigrationRows - 1
        Assert-Rejected { Normalize-Fingerprint $row } $profileSettings.ScopeFailure
        $row.migration_count = $profileSettings.MigrationRows
        $row.auth_table_count = 0
        Assert-Rejected { Normalize-Fingerprint $row } $profileSettings.ScopeFailure
    }
    $profileSettings = Get-ReviewedRestoreProfile 'Phase3Preparation'
    $legacyRow = @{ application_data = @{ table_count = 94; row_count = 123; data_digest = '7' * 32 }; migration_count = 15;
        policy_count = 100; auth_table_count = 21; storage_table_count = 9 }
    Assert-Rejected { Normalize-Fingerprint $legacyRow } 'PHASE3_104_TABLE_17_MIGRATION_SCOPE_REQUIRED'
    $profileSettings = Get-ReviewedRestoreProfile 'SharedDatabaseReview'
    $legacyRow.application_data.table_count = 104
    $legacyRow.migration_count = 17
    Assert-Rejected { Normalize-Fingerprint $legacyRow } 'CURRENT_94_TABLE_15_MIGRATION_SCOPE_REQUIRED'
}
Test-Case 'Actual metadata guard and receipt counts follow each fixed fingerprint scope' {
    $metadataGuard = Actual-Guard $wrapperAst 'RESTORED_METADATA_MISMATCH'
    $countAssignments = @($wrapperAst.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.AssignmentStatementAst] -and $Node.Left.Extent.Text -ceq '$result.matchedCounts'
    }, $true))
    Assert-Equal $countAssignments.Count 1 'one actual matched counts assignment'
    $countScript = [scriptblock]::Create($countAssignments[0].Extent.Text)
    foreach ($name in @('SharedDatabaseReview', 'Phase3Preparation')) {
        $profileSettings = Get-ReviewedRestoreProfile $name
        Assert-Equal ($profileSettings.PublicTables + $profileSettings.PrivateTables) $profileSettings.ApplicationTables 'fixed public/private count sum'
        $actual = @{ application_data = @{ table_count = $profileSettings.ApplicationTables; row_count = 123 }; migration_count = $profileSettings.MigrationRows;
            auth_table_count = 21; storage_table_count = 9; policy_count = 100 }
        $metadata = @{ database = 'postgres'; server_version_num = 170006; public_tables = $profileSettings.PublicTables; migration_rows = $profileSettings.MigrationRows;
            auth_tables = $actual.auth_table_count; storage_tables = $actual.storage_table_count; event_triggers = 4 }
        $restored = @{ metadata = Copy-Record $metadata }
        & $metadataGuard
        $result = @{}
        . $countScript
        Assert-Equal $result.matchedCounts.applicationTables $profileSettings.ApplicationTables 'receipt application count'
        Assert-Equal $result.matchedCounts.publicTables $profileSettings.PublicTables 'receipt public count'
        Assert-Equal $result.matchedCounts.privateTables $profileSettings.PrivateTables 'receipt private count'
        Assert-Equal $result.matchedCounts.migrationRows $profileSettings.MigrationRows 'receipt migration count'
        foreach ($key in @('server_version_num', 'public_tables', 'migration_rows', 'auth_tables', 'storage_tables')) {
            $restored = @{ metadata = Copy-Record $metadata }
            $restored.metadata[$key]--
            Assert-Rejected { & $metadataGuard } 'RESTORED_METADATA_MISMATCH'
        }
        $restored = @{ metadata = Copy-Record $metadata }
        $restored.metadata.database = 'other'
        Assert-Rejected { & $metadataGuard } 'RESTORED_METADATA_MISMATCH'
    }
}
Test-Case 'Reviewed code pins match actual final source bytes and unchanged SQL and shell pins' {
    . ([scriptblock]::Create((Actual-Assignment $wrapperAst 'pins')))
    . ([scriptblock]::Create((Actual-Assignment $wrapperAst 'baselineQueryHash')))
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    . ([scriptblock]::Create((Actual-Assignment $wrapperAst 'baselineQueryPath')))
    Assert-Equal $pins['verify-backup-disposable-restore.sh'] 'f94b0c9981f32219bcb269db4aa76251bb6d54483c7a33655b470605eab7edb3' 'unchanged restore shell pin'
    Assert-Equal $pins['auth-pilot-fingerprint.sql'] 'a1f11eb1db5dc83cd4c4a04321d191d1943fd1866a1981354e583a32f7861383' 'unchanged current query pin'
    Assert-Equal $baselineQueryHash 'f021185484b84b07030a1d81a2f2a8a7ba0b37282f4011b73d7432659725b009' 'unchanged baseline query pin'
    Assert-CodePins
    $pins['verify-local-backup.ps1'] = '0' * 64
    Assert-Rejected { Assert-CodePins } 'REVIEWED_SCRIPT_HASH_CHANGED'
    foreach ($name in @('verify-local-backup.ps1', 'verify-auth-pilot-restore.ps1', 'test-restore-profile.ps1')) {
        $bytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))
        Assert-True ($bytes -cnotcontains [byte]13) 'canonical LF source bytes'
        Assert-True (-not ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)) 'UTF-8 without BOM'
    }
}

[pscustomobject]@{ status = 'PASS'; tests = $passed.Count; hostVersion = $PSVersionTable.PSVersion.ToString(); checks = $passed.ToArray();
    databaseQueries = 0; nativeProcesses = 0; credentialStoreReads = 0; backupFilesRead = 0; filesWritten = 0 } | ConvertTo-Json -Depth 4

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
foreach ($name in @('Get-ReviewedRestoreProfile', 'Stop-Check', 'Local-Path', 'File-Hash', 'Assert-NoLink', 'Assert-CodePins', 'Normalize-FingerprintFields', 'Normalize-Fingerprint', 'Nonnegative-Integer', 'Parse-Object', 'Capture-Time', 'Canonical-Value', 'Canonical-Json',
    'Assert-DeltaMode', 'Assert-ExactKeys', 'Assert-StringFields', 'Assert-DeltaPreparation', 'Assert-DeltaDirectoryPath', 'Normalize-DeltaFingerprint', 'Assert-DeltaState', 'Assert-DeltaRehearsal',
    'Get-DeltaRehearsalScript', 'Get-DeltaMountArguments', 'Get-ExpectedRestoreMounts', 'Require-NativeSuccess')) {
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
$deltaEnabled = $false
$deltaMountArguments = @()
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
    $Node -is [Management.Automation.Language.IfStatementAst] -and $Node.Extent.Text.StartsWith('if ($binds.Count -ne $expectedMounts.Count')
}, $true))
Assert-Equal $mountCountGuards.Count 1 'one actual exact mount count guard'
$mountGuard = [scriptblock]::Create($mountCountGuards[0].Extent.Text)
$mountLoop = @($wrapperAst.FindAll({ param($Node)
    $Node -is [Management.Automation.Language.ForEachStatementAst] -and $Node.Variable.VariablePath.UserPath -ceq 'mount'
}, $true))
Assert-Equal $mountLoop.Count 1 'one actual mount allowlist loop'
$mountLoopScript = [scriptblock]::Create($mountLoop[0].Extent.Text)
$mountSetup = [scriptblock]::Create((Actual-Assignment $wrapperAst 'expectedMounts') + "`n" +
    (Actual-Assignment $wrapperAst 'binds') + "`n" + (Actual-Assignment $wrapperAst 'seenMounts'))
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
. ([scriptblock]::Create((Actual-Assignment $wrapperAst 'deltaSettings')))
function New-PreparationReport {
    return @{
        kind = 'phase3-combined-baseline-delta-preparation'; schemaVersion = 1; decision = 'HOLD'; validReleaseEvidence = $false
        targetProjectRef = $projectRef; createdAt = '2026-11-13T09:48:45Z'; observedAt = '2026-11-13T09:42:57Z'; catalogExpiresAt = '2026-11-13T10:42:57Z'
        manifestDigest = 'a' * 64; baselineHistorySha256 = $deltaSettings.BaselineHistorySha256
        baseline = @{ recordedRows = 17; combinedVersion = '20261031201901'; sourceEnvelopeCount = 62;
            appliedSqlSha256 = '9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5' }
        delta = @{ version = $deltaSettings.Version; name = $deltaSettings.Name; path = 'supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql';
            sourceSha256 = $deltaSettings.SourceSha256; packetSha256 = $deltaSettings.PacketSha256; productionApplied = $false }
        excludedVersions = @('20261103215321','20261104134202')
        retiredConstraint = @{ name = 'constraint-removed:public.mission_submissions.mission_submissions_creator_workspace_fk'; removalVersion = '20260720193637'; treatment = 'Synthetic scope text' }
        currentScopedCapabilityCount = 886; catalogSha256 = 'b' * 64; automaticWrites = @(); scopeLimits = @('Preparation only')
    }
}
function New-DeltaFingerprint([int] $MigrationRows = 17) {
    return @{ application_data = @{ table_count = 104; row_count = 487; data_digest = '7' * 32 };
        migration_count = $MigrationRows; policy_count = 90; auth_table_count = 27; storage_table_count = 10 }
}
function New-DeltaFixture {
    $history = @(foreach ($index in 0..16) { @{ version = ('202610010000{0:D2}' -f $index); name = 'synthetic_' + $index;
        statementCount = 1; statementsSha256 = '3' * 64; xmin = [string](100 + $index) } })
    $before = @{ database = 'postgres'; currentRole = 'postgres'; sessionRole = 'postgres'; serverVersionNum = 170006; transactionReadOnly = $true;
        migrationRows = 17; history = $history; otherCatalogDigest = 'a' * 64; storageBucketsDigest = 'b' * 64
        functions = @(@{ signature = 'private.join_mission(uuid)'; oid = '200'; xmin = '10'; bodySha256 = '1' * 64; attributesAclDigest = 'c' * 64 },
            @{ signature = 'public.accept_application(uuid)'; oid = '201'; xmin = '10'; bodySha256 = '1' * 64; attributesAclDigest = 'd' * 64 }) }
    $first = Copy-Record $before
    $first.migrationRows = 18
    $first.history += @{ version = $deltaSettings.Version; name = $deltaSettings.Name; statementCount = 1; statementsSha256 = $deltaSettings.SourceSha256; xmin = '300' }
    foreach ($fn in $first.functions) { $fn.xmin = '300'; $fn.bodySha256 = '2' * 64 }
    return @{ Baseline = New-DeltaFingerprint 17; FirstFingerprint = New-DeltaFingerprint 18; ReplayFingerprint = New-DeltaFingerprint 18;
        Before = $before; First = $first; Replay = Copy-Record $first }
}
function Check-DeltaFixture($Fixture) {
    return Assert-DeltaRehearsal $Fixture.Baseline $Fixture.FirstFingerprint $Fixture.ReplayFingerprint $Fixture.Before $Fixture.First $Fixture.Replay
}
Test-Case 'Delta is opt-in and rejected for the historic profile before native access' {
    Assert-DeltaMode $false 'SharedDatabaseReview'
    Assert-DeltaMode $false 'Phase3Preparation'
    Assert-DeltaMode $true 'Phase3Preparation'
    Assert-Rejected { Assert-DeltaMode $true 'SharedDatabaseReview' } 'DELTA_REQUIRES_PHASE3_PROFILE'
    Assert-Rejected { Bind-Wrapper @{ Profile = 'Phase3Preparation'; DeltaPreparationDirectory = '' } }
    $source = $wrapperAst.Extent.Text
    $start = $source.IndexOf('[CmdletBinding()]', [StringComparison]::Ordinal)
    $parameters = $source.Substring($start, $wrapperAst.ParamBlock.Extent.EndOffset - $start)
    $modeBinding = [scriptblock]::Create($parameters + "`n" + (Actual-Assignment $wrapperAst 'deltaEnabled') + "`n`$deltaEnabled")
    $mandatory = @{ AttemptDirectory = 'C:\synthetic-private\attempt'; SourceFingerprintPath = 'C:\synthetic-source.json'; CheckpointNotBeforeUtc = [DateTimeOffset]'2026-11-13T00:00:00Z' }
    Assert-True (-not (& $modeBinding @mandatory)) 'absent option disables mode'
    Assert-True (& $modeBinding @mandatory -DeltaPreparationDirectory 'C:\synthetic-prepared') 'explicit preparation directory enables mode'
    Assert-True ($source.IndexOf('Assert-DeltaMode $deltaEnabled $profileSettings.Name') -lt $source.IndexOf('$localData = Local-Path')) 'actual mode guard before host filesystem/native entrypoint'
}
Test-Case 'Preparation accepts only fixed reviewed packet bytes and exact non-release metadata' {
    $profileSettings = Get-ReviewedRestoreProfile 'Phase3Preparation'
    Assert-Equal $deltaSettings.PacketSha256 'e7ce6a847f57d05d9efde376a2a774e9f6b7310b3cb362fd979936a4891be9da' 'reviewed deterministic packet pin'
    Assert-Equal $deltaSettings.SourceSha256 '846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2' 'reviewed source pin'
    Assert-DeltaPreparation (New-PreparationReport) $deltaSettings.PacketSha256
    Assert-DeltaPreparation (Copy-Record (New-PreparationReport)) $deltaSettings.PacketSha256
    foreach ($mutation in @(
        { param($r) $r.kind = 'live-executor' }, { param($r) $r.targetProjectRef = 'other' },
        { param($r) $r.decision = 'GO' }, { param($r) $r.validReleaseEvidence = $true },
        { param($r) $r.validReleaseEvidence = 'false' }, { param($r) $r.schemaVersion = '1' },
        { param($r) $r.decision = @('HOLD') }, { param($r) $r.baseline.sourceEnvelopeCount = '62' },
        { param($r) $r.currentScopedCapabilityCount = '886' }, { param($r) $r.scopeLimits = @(1) },
        { param($r) $r.delta.productionApplied = $true }, { param($r) $r.delta.version = '20261113090002' },
        { param($r) $r.delta.name = 'other' }, { param($r) $r.delta.path = 'other.sql' },
        { param($r) $r.delta.sourceSha256 = '0' * 64 }, { param($r) $r.delta.packetSha256 = '0' * 64 },
        { param($r) $r.baseline.recordedRows = 18 }, { param($r) $r.baseline.recordedRows = '17' },
        { param($r) $r.baselineHistorySha256 = '0' * 64 }, { param($r) $r.baseline.appliedSqlSha256 = '0' * 64 },
        { param($r) $r.automaticWrites = @('apply') }, { param($r) $r.extra = 'unknown' },
        { param($r) $r.delta.extra = 'unknown' }, { param($r) $r.excludedVersions = @() })) {
        $report = New-PreparationReport
        & $mutation $report
        Assert-Rejected { Assert-DeltaPreparation $report $deltaSettings.PacketSha256 }
    }
    Assert-Rejected { Assert-DeltaPreparation (New-PreparationReport) ('0' * 64) } 'DELTA_PREPARATION_PIN_OR_SCOPE_MISMATCH'
    $report = New-PreparationReport
    $report.delta.packetSha256 = '0' * 64
    Assert-Rejected { Assert-DeltaPreparation $report ('0' * 64) } 'DELTA_PREPARATION_PIN_OR_SCOPE_MISMATCH'
    $report = New-PreparationReport
    $report.createdAt = '2026-11-13T11:00:00Z'
    Assert-Rejected { Assert-DeltaPreparation $report $deltaSettings.PacketSha256 } 'INVALID_DELTA_PREPARATION_TIMES'
}
Test-Case 'Delta directory must be absolute, local, outside backup inputs and free of links' {
    Assert-Equal (Assert-DeltaDirectoryPath 'C:\synthetic-prepared' $backupRoot) 'C:\synthetic-prepared' 'public source directory permitted'
    foreach ($path in @('relative', 'C:relative', '\\server\share', "C:\bad`npath", 'C:\comma,path')) {
        Assert-Rejected { Assert-DeltaDirectoryPath $path $backupRoot } 'INVALID_LOCAL_PATH'
    }
    Assert-Rejected { Assert-DeltaDirectoryPath $backupRoot $backupRoot } 'DELTA_INPUT_INSIDE_BACKUP_ROOT'
    Assert-Rejected { Assert-DeltaDirectoryPath ($backupRoot + '\attempt\prepared') $backupRoot } 'DELTA_INPUT_INSIDE_BACKUP_ROOT'
    function Get-Item { param($LiteralPath, [switch] $Force) return [pscustomobject]@{ Attributes = [IO.FileAttributes]::ReparsePoint } }
    Assert-Rejected { Assert-NoLink 'C:\synthetic-link' } 'REPARSE_POINT_REJECTED'
    $fileCountGuard = Actual-Guard $wrapperAst 'EXACT_DELTA_PREPARATION_FILES_REQUIRED'
    $items = @()
    Assert-Rejected { & $fileCountGuard } 'EXACT_DELTA_PREPARATION_FILES_REQUIRED'
    $sizeGuard = Actual-Guard $wrapperAst 'DELTA_PREPARATION_FILE_TYPE_OR_SIZE'
    $item = [pscustomobject]@{ Length = 1 }
    $limit = 1MB
    Assert-Rejected { & $sizeGuard } 'DELTA_PREPARATION_FILE_TYPE_OR_SIZE'
    $reader = Actual-Function $wrapperAst 'Read-DeltaPreparation'
    Assert-True ($reader.Contains('1MB') -and $reader.Contains('256KB') -and $reader.Contains('$script:verifiedFiles += $record')) 'bounded files enter actual unchanged-input checks'
}
Test-Case 'Actual mode construction adds exactly one read-only SQL mount and preserves default six mounts' {
    foreach ($enabled in @($false, $true)) {
        $deltaEnabled = $enabled
        $deltaMountArguments = @(Get-DeltaMountArguments $deltaEnabled)
        . $createScript
        Assert-Equal @($createArguments | Where-Object { $_ -ceq '--mount' }).Count $(if ($enabled) { 7 } else { 6 }) 'exact conditional mount count'
        Assert-Equal @($createArguments | Where-Object { $_ -match 'target=/guarded-delta.sql,readonly$' }).Count $(if ($enabled) { 1 } else { 0 }) 'delta is read-only when present'
        Assert-True (-not ($createArguments | Where-Object { $_ -match 'source=.*preparation.json|source=.*source.json|docker.sock|^--publish|^--network=(?!none)' })) 'no sidecar/source/credential/socket/network broadening'
        $container = Copy-Record $cleanContainer
        if ($enabled) { $container.Mounts += @{ Type = 'bind'; Destination = '/guarded-delta.sql'; RW = $false } }
        . $mountSetup
        & $mountGuard
        & $mountLoopScript
        if ($enabled) {
            $container.Mounts[6].RW = $true
            Assert-Rejected { . $mountSetup; & $mountGuard; & $mountLoopScript } 'LOCAL_RESTORE_MOUNT_MISMATCH'
            $container = Copy-Record $cleanContainer
            Assert-Rejected { . $mountSetup; & $mountGuard; & $mountLoopScript } 'LOCAL_RESTORE_MOUNT_MISMATCH'
        } else {
            $container.Mounts += @{ Type = 'bind'; Destination = '/guarded-delta.sql'; RW = $false }
            Assert-Rejected { . $mountSetup; & $mountGuard; & $mountLoopScript } 'LOCAL_RESTORE_MOUNT_MISMATCH'
        }
    }
    $deltaEnabled = $true
    $container = Copy-Record $cleanContainer
    $container.Mounts += @{ Type = 'bind'; Destination = '/backup'; RW = $false }
    Assert-Rejected { . $mountSetup; & $mountGuard; & $mountLoopScript } 'LOCAL_RESTORE_MOUNT_MISMATCH'
}
Test-Case 'Actual entrypoint runs fixed packet twice in same local cluster with hashed catalog snapshots' {
    $commands = Get-DeltaRehearsalScript
    Assert-Equal ([regex]::Matches($commands, '--file=/guarded-delta.sql').Count) 2 'identical fixed SQL path for apply/replay'
    foreach ($required in @('PGHOST=/tmp PGPORT=5432 PGUSER=postgres PGDATABASE=postgres', 'BEGIN READ ONLY;', 'SET LOCAL search_path = pg_catalog;',
        'delta-before.json', 'delta-first.json', 'delta-replay.json', 'delta-first-fingerprint.csv', 'delta-replay-fingerprint.csv',
        "'otherCatalogDigest'", "'storageBucketsDigest'", "'xmin',h.xmin::text", "'xmin',p.xmin::text", 'p.proacl::text', 'p.proconfig', 'pg_get_functiondef',
        'pg_get_constraintdef', 'pg_get_indexdef', 'pg_get_triggerdef', 'pg_policies', 'pg_auth_members', 'storage.buckets', 'relrowsecurity', 'attcompression')) {
        Assert-True ($commands.Contains($required)) 'fixed local snapshot/metadata protection exists'
    }
    Assert-True (-not ($commands -match 'pg_authid|rolpassword|relpages|reltuples|\bVACUUM\b|\bANALYZE\b')) 'no credential catalog or volatile physical statistics'
    $attributeDigest = [regex]::Match($commands, "'attributesAclDigest',encode\(sha256\(convert_to\(([\s\S]+?)::text,'UTF8'\)\),'hex'\)")
    Assert-True $attributeDigest.Success 'target attributes/ACL hash is generated inside fixed SQL'
    foreach ($required in @('p.proowner','p.proacl::text','p.prosecdef','p.proconfig','p.prolang','p.provolatile','p.proisstrict','p.proleakproof','p.proparallel','pg_get_function_result')) {
        Assert-True ($attributeDigest.Groups[1].Value.Contains($required)) 'raw ACL/owner/config/ordinary attributes covered'
    }
    Assert-True (-not ($attributeDigest.Groups[1].Value -match 'prosrc|xmin')) 'changing body and tuple version excluded from attribute invariance'
    $entrypoint = $null
    . ([scriptblock]::Create((Actual-Assignment $wrapperAst 'entrypoint')))
    $writerCommand = Actual-Command $wrapperAst 'Write-PrivateText' "'entrypoint.sh'"
    $script:entrypointText = $null
    function Write-PrivateText { param([string] $Name, [string] $Text) $script:entrypointText = $Text }
    $deltaCommands = ''
    & $writerCommand
    Assert-True (-not $script:entrypointText.Contains('--file=/guarded-delta.sql')) 'default shell omits all delta SQL'
    $deltaCommands = $commands
    & $writerCommand
    $assembled = $script:entrypointText
    $before = $assembled.IndexOf('/evidence/current-fingerprint.csv')
    $firstApply = $assembled.IndexOf('--file=/guarded-delta.sql')
    $replayApply = $assembled.LastIndexOf('--file=/guarded-delta.sql')
    $stop = $assembled.IndexOf('pg_ctl -D /tmp/koc-restore-data -m fast -w stop')
    Assert-True ($before -ge 0 -and $firstApply -gt $before -and $replayApply -gt $firstApply -and $stop -gt $replayApply) 'original fingerprint, apply, replay, then same cluster shutdown'
    Assert-Equal ([regex]::Matches($assembled, 'pg_ctl .* -w start').Count) 1 'no second restored cluster'
    $source = $wrapperAst.Extent.Text
    Assert-True ($source.IndexOf("Stop-Check 'SOURCE_RESTORE_FINGERPRINT_MISMATCH'") -lt $source.IndexOf('$result.deltaRehearsal = Assert-DeltaRehearsal')) 'normal source equality remains required before accepting delta proof'
}
Test-Case 'Actual failed native run remains attempted and cannot produce a verified delta receipt' {
    $attemptGuards = @($wrapperAst.FindAll({ param($Node)
        $Node -is [Management.Automation.Language.IfStatementAst] -and $Node.Extent.Text.Contains("'ATTEMPTED_NOT_VERIFIED'")
    }, $true))
    Assert-Equal $attemptGuards.Count 1 'one actual attempted-status guard'
    $deltaEnabled = $true
    $result = @{ deltaRehearsal = @{ status = 'NOT_RUN' } }
    & ([scriptblock]::Create($attemptGuards[0].Extent.Text))
    Assert-Equal $result.deltaRehearsal.status 'ATTEMPTED_NOT_VERIFIED' 'attempt does not claim NOT_RUN or verified'
    function Invoke-Docker { param([string[]] $Arguments, [string] $Label, [int] $Seconds) return @{ Code = 1; Error = 'synthetic-native-error'; Output = '' } }
    $container = @{ Id = '5' * 64 }
    $TimeoutSeconds = 1800
    $nativeStart = Actual-Command $wrapperAst 'Invoke-Docker' "'restore-run'"
    $run = & $nativeStart
    Assert-Rejected { Require-NativeSuccess $run 'DISPOSABLE_RESTORE_FAILED' } 'DISPOSABLE_RESTORE_FAILED'
    Assert-Equal $result.deltaRehearsal.status 'ATTEMPTED_NOT_VERIFIED' 'failure leaves proof unverified'
}
Test-Case 'Delta receipt proves fixed 17 to 18 to 18, preserved data/catalog and true replay no-op' {
    $profileSettings = Get-ReviewedRestoreProfile 'Phase3Preparation'
    $receipt = Check-DeltaFixture (New-DeltaFixture)
    Assert-Equal $receipt.status 'DISPOSABLE_DELTA_AND_IDENTICAL_REPLAY_VERIFIED' 'disposable proof status'
    Assert-True (-not $receipt.productionApplied -and -not $receipt.validReleaseEvidence) 'no production or release claim'
    Assert-Equal $receipt.baselineRows 17 'baseline17'
    Assert-Equal $receipt.afterFirst 18 'first18'
    Assert-Equal $receipt.afterReplay 18 'replay18'
    foreach ($key in @('applicationDataUnchanged','policyAuthStorageCountsUnchanged','replayTupleVersionsUnchanged','baselineHistoryPreserved','targetFunctionAttributesAclUnchanged','otherCatalogUnchanged','storageBucketsUnchanged')) { Assert-True $receipt[$key] 'positive proof only after actual guards' }
    Assert-Rejected { Normalize-Fingerprint (New-DeltaFingerprint 18) } 'PHASE3_104_TABLE_17_MIGRATION_SCOPE_REQUIRED'
    Assert-Rejected { Normalize-DeltaFingerprint (New-DeltaFingerprint 17) } 'PHASE3_DELTA_104_TABLE_18_MIGRATION_SCOPE_REQUIRED'
    $profileSettings = Get-ReviewedRestoreProfile 'SharedDatabaseReview'
    Assert-Rejected { Normalize-DeltaFingerprint (New-DeltaFingerprint 18) } 'DELTA_REQUIRES_PHASE3_PROFILE'
}
Test-Case 'Delta proof rejects changed data, counts, metadata and archived source' {
    $profileSettings = Get-ReviewedRestoreProfile 'Phase3Preparation'
    foreach ($mutation in @(
        { param($f) $f.Baseline.migration_count = 18 },
        { param($f) $f.FirstFingerprint.migration_count = 19 },
        { param($f) $f.ReplayFingerprint.migration_count = 17 },
        { param($f) $f.FirstFingerprint.application_data.row_count++ },
        { param($f) $f.ReplayFingerprint.application_data.data_digest = '0' * 32 },
        { param($f) $f.FirstFingerprint.policy_count++ },
        { param($f) $f.ReplayFingerprint.auth_table_count++ },
        { param($f) $f.FirstFingerprint.storage_table_count++ },
        { param($f) $f.Before.currentRole = 'supabase_admin' },
        { param($f) $f.Before.currentRole = @('postgres') },
        { param($f) $f.First.migrationRows = '18' },
        { param($f) $f.First.serverVersionNum = '170006' },
        { param($f) $f.First.sessionRole = 'other' },
        { param($f) $f.Replay.transactionReadOnly = $false },
        { param($f) $f.First.history[17].statementsSha256 = '0' * 64 },
        { param($f) $f.First.history[17].statementCount = 2 },
        { param($f) $f.First.history[17].name = 'other' },
        { param($f) $f.First.history[0].name = 'changed-baseline' },
        { param($f) $f.Replay.functions[0].signature = 'public.other(uuid)' })) {
        $fixture = New-DeltaFixture
        & $mutation $fixture
        Assert-Rejected { Check-DeltaFixture $fixture }
    }
}
Test-Case 'Delta proof rejects replay writes, hidden catalog drift, bucket drift and unproven first changes' {
    $profileSettings = Get-ReviewedRestoreProfile 'Phase3Preparation'
    foreach ($mutation in @(
        { param($f) $f.Replay.functions[0].xmin = '301' },
        { param($f) $f.Replay.functions[1].oid = '999' },
        { param($f) $f.Replay.functions[0].bodySha256 = 'f' * 64 },
        { param($f) $f.Replay.history[17].xmin = '301' },
        { param($f) $f.Replay.history[0].xmin = '301' })) {
        $fixture = New-DeltaFixture
        & $mutation $fixture
        Assert-Rejected { Check-DeltaFixture $fixture } 'DELTA_REPLAY_TUPLE_VERSIONS_CHANGED'
    }
    foreach ($phase in @('First','Replay')) {
        foreach ($key in @('otherCatalogDigest','storageBucketsDigest')) {
            $fixture = New-DeltaFixture
            $fixture[$phase][$key] = 'c' * 64
            Assert-Rejected { Check-DeltaFixture $fixture } 'DELTA_OTHER_CATALOG_OR_BUCKETS_CHANGED'
        }
    }
    foreach ($phase in @('First','Replay')) {
        foreach ($index in @(0,1)) {
            $fixture = New-DeltaFixture
            $fixture[$phase].functions[$index].attributesAclDigest = 'f' * 64
            Assert-Rejected { Check-DeltaFixture $fixture } 'DELTA_TARGET_FUNCTION_ATTRIBUTES_OR_ACL_CHANGED'
        }
    }
    $fixture = New-DeltaFixture
    $fixture.First.functions[0].xmin = $fixture.Before.functions[0].xmin
    $fixture.Replay = Copy-Record $fixture.First
    Assert-Rejected { Check-DeltaFixture $fixture } 'DELTA_FIRST_FUNCTION_CHANGE_NOT_PROVEN'
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

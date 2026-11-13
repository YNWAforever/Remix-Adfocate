#requires -Version 7.2
<#
.SYNOPSIS
Offline host wrapper for one explicit fresh restore checkpoint and fixed profile.
.DESCRIPTION
Runs the existing full-read verifier first, then the unchanged disposable restore
script in the installed pinned Supabase image. No remote connections, credentials,
ports, image pulls or Auth tests. Optional Phase3-only delta/replay SQL runs only
inside that same owned disposable cluster. Prints one sanitized JSON receipt.
See verify-auth-pilot-restore.md for the source-fingerprint input contract.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string] $AttemptDirectory,
    [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string] $SourceFingerprintPath,
    [Parameter(Mandatory)] [DateTimeOffset] $CheckpointNotBeforeUtc,
    [Nullable[DateTimeOffset]] $SourceCapturedUtc = $null,
    [ValidateRange(60, 7200)] [int] $TimeoutSeconds = 1800,
    [ValidateSet('SharedDatabaseReview', 'Phase3Preparation', IgnoreCase = $false)]
    [string] $Profile = 'SharedDatabaseReview',
    [ValidateNotNullOrEmpty()] [string] $DeltaPreparationDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Get-ReviewedRestoreProfile([string] $Name) {
    switch -CaseSensitive ($Name) {
        'SharedDatabaseReview' {
            return [pscustomobject]@{
                Name = 'SharedDatabaseReview'; Branch = 'codex/kocmax-studio-stages-1-2'
                Image = 'public.ecr.aws/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9'
                ArchiveImage = 'postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232'
                ArchiveStatus = 'ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED'
                FailureStatus = 'AUTH_PILOT_RESTORE_NOT_VERIFIED'
                SuccessStatus = 'AUTH_PILOT_CURRENT_RESTORE_VERIFIED'
                ApplicationTables = 94; PublicTables = 80; PrivateTables = 14; MigrationRows = 15
                ScopeFailure = 'CURRENT_94_TABLE_15_MIGRATION_SCOPE_REQUIRED'
            }
        }
        'Phase3Preparation' {
            return [pscustomobject]@{
                Name = 'Phase3Preparation'; Branch = 'codex/phase3-delta-rehearsal'
                Image = 'public.ecr.aws/supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
                ArchiveImage = 'public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108'
                ArchiveStatus = 'PHASE3_ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED'
                FailureStatus = 'PHASE3_PREPARATION_RESTORE_NOT_VERIFIED'
                SuccessStatus = 'PHASE3_PREPARATION_RESTORE_VERIFIED_AUTH_NOT_TESTED'
                ApplicationTables = 104; PublicTables = 90; PrivateTables = 14; MigrationRows = 17
                ScopeFailure = 'PHASE3_104_TABLE_17_MIGRATION_SCOPE_REQUIRED'
            }
        }
        default { throw 'Unknown reviewed restore profile; stop.' }
    }
}

$projectRef = 'mhkoayftiuojxlrkollf'
$profileSettings = Get-ReviewedRestoreProfile $Profile
$dockerPipe = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$restoreImage = $profileSettings.Image
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$verifierPath = Join-Path $PSScriptRoot 'verify-local-backup.ps1'
$restorePath = Join-Path $PSScriptRoot 'verify-backup-disposable-restore.sh'
$queryPath = Join-Path $PSScriptRoot 'auth-pilot-fingerprint.sql'
$baselineQueryPath = Join-Path $repoRoot 'docs/review/kocmax-stage-4d/d1/shared-database/execution/existing-data-fingerprint.sql'
$baselineQueryHash = 'f021185484b84b07030a1d81a2f2a8a7ba0b37282f4011b73d7432659725b009'
$pins = @{
    'verify-local-backup.ps1' = '4694570dcf4f80e82f9b370407312c263f5aebd398094a187ccea46b2515b399'
    'verify-backup-disposable-restore.sh' = 'f94b0c9981f32219bcb269db4aa76251bb6d54483c7a33655b470605eab7edb3'
    'auth-pilot-fingerprint.sql' = 'a1f11eb1db5dc83cd4c4a04321d191d1943fd1866a1981354e583a32f7861383'
}
$deltaEnabled = $PSBoundParameters.ContainsKey('DeltaPreparationDirectory')
$deltaSettings = @{
    Version = '20261113090001'; Name = 'active_assignment_xp_neutrality'
    SourceSha256 = '846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2'
    PacketSha256 = 'e7ce6a847f57d05d9efde376a2a774e9f6b7310b3cb362fd979936a4891be9da'
    BaselineHistorySha256 = '8f73e44618f9af60644527e44e0a78e735d7d23fe1b9fc6fc64ee3e4dc339467'
}
$utf8 = [Text.UTF8Encoding]::new($false)
$script:failure = 'LOCAL_PRECHECK_FAILED'
$script:evidence = $null
$script:dockerExe = $null
$script:processNumber = 0
$script:containerName = $null
$script:ownerToken = $null
$script:createIssued = $false
$script:verifiedFiles = @()
$script:sourceHash = $null
$script:runtimeOutput = $null

function Stop-Check([string] $Code) {
    $script:failure = $Code
    throw 'Offline checkpoint verification stopped; consult the private evidence directory.'
}

function Local-Path([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path) -or
        $Path.StartsWith('\\') -or $Path -match '[,\r\n]') { Stop-Check 'INVALID_LOCAL_PATH' }
    return [IO.Path]::GetFullPath($Path).Replace('/', '\').TrimEnd('\')
}

function Assert-NoLink([string] $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Check 'REPARSE_POINT_REJECTED' }
        $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
}

function Assert-Private([string] $Path, [switch] $Directory) {
    Assert-NoLink $Path
    $item = Get-Item -LiteralPath $Path -Force
    if ($Directory.IsPresent -ne ($item -is [IO.DirectoryInfo])) { Stop-Check 'PRIVATE_FILE_TYPE_MISMATCH' }
    $acl = Get-Acl -LiteralPath $Path
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @($sid, 'S-1-5-18') -or $rules.Count -ne 2 -or
        ($Directory -and (-not $acl.AreAccessRulesProtected -or $owner -ne $sid))) { Stop-Check 'PRIVATE_ACL_REQUIRED' }
    foreach ($identity in @($sid, 'S-1-5-18')) {
        $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $identity })
        if ($rule.Count -ne 1 -or $rule[0].AccessControlType -ne 'Allow' -or
            $rule[0].FileSystemRights -ne 'FullControl' -or $rule[0].PropagationFlags -ne 'None' -or
            ($Directory -and $rule[0].InheritanceFlags -ne 'ContainerInherit,ObjectInherit')) { Stop-Check 'PRIVATE_ACL_REQUIRED' }
    }
}

function New-PrivateDirectory([string] $Path) {
    if (Test-Path -LiteralPath $Path) { Stop-Check 'EVIDENCE_DIRECTORY_ALREADY_EXISTS' }
    Assert-NoLink ([IO.Path]::GetDirectoryName($Path))
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($owner)
    foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        [void] $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    [void] [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path), $acl)
    Assert-Private $Path -Directory
}

function Write-PrivateText([string] $Name, [string] $Text) {
    $path = Join-Path $script:evidence $Name
    [IO.File]::WriteAllText($path, $Text, $utf8)
    Assert-Private $path
}

function File-Hash([string] $Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-CodePins {
    foreach ($name in $pins.Keys) {
        $path = Join-Path $PSScriptRoot $name
        Assert-NoLink $path
        if ((File-Hash $path) -cne $pins[$name]) { Stop-Check 'REVIEWED_SCRIPT_HASH_CHANGED' }
    }
    Assert-NoLink $baselineQueryPath
    if ((File-Hash $baselineQueryPath) -cne $baselineQueryHash) { Stop-Check 'BASELINE_CHECK_QUERY_HASH_CHANGED' }
}

function Invoke-Captured([string] $Program, [string[]] $Arguments, [string] $Label, [int] $Seconds = 30) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Program
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    foreach ($key in @($start.Environment.Keys)) {
        if ($key -match '^(PG|DOCKER_|SUPABASE_)') { [void] $start.Environment.Remove($key) }
    }
    foreach ($argument in $Arguments) { [void] $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Close()
        # The existing verifier owns its own timeout/finally. Do not kill that
        # process while it is cleaning up its independently named read container.
        if ($Seconds -eq 0) { $process.WaitForExit() }
        elseif (-not $process.WaitForExit($Seconds * 1000)) { Stop-Check 'LOCAL_PROCESS_TIMEOUT' }
        $capture = [pscustomobject]@{ Code = $process.ExitCode; Output = $stdout.GetAwaiter().GetResult(); Error = $stderr.GetAwaiter().GetResult() }
        $script:processNumber++
        $prefix = '{0:D3}-{1}' -f $script:processNumber, $Label
        Write-PrivateText ($prefix + '.stdout') $capture.Output
        Write-PrivateText ($prefix + '.stderr') $capture.Error
        return $capture
    } finally {
        try { if ($process.Id -and -not $process.HasExited) { $process.Kill($true); [void] $process.WaitForExit(5000) } } catch { }
        $process.Dispose()
    }
}

function Invoke-Docker([string[]] $Arguments, [string] $Label, [int] $Seconds = 30) {
    return Invoke-Captured -Program $script:dockerExe -Arguments (@('--host', $dockerPipe) + $Arguments) -Label $Label -Seconds $Seconds
}

function Require-NativeSuccess($Capture, [string] $Code) {
    if ($Capture.Code -ne 0 -or -not [string]::IsNullOrWhiteSpace($Capture.Error)) { Stop-Check $Code }
}

function Parse-Object([string] $Text, [string] $Code) {
    if ([string]::IsNullOrWhiteSpace($Text)) { Stop-Check $Code }
    try { $value = ConvertFrom-Json -InputObject $Text -AsHashtable -Depth 100 } catch { Stop-Check $Code }
    if ($value -isnot [Collections.IDictionary]) { Stop-Check $Code }
    return $value
}

function Capture-Time($Value) {
    if ($Value -is [DateTimeOffset]) { return $Value.ToUniversalTime() }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { Stop-Check 'AMBIGUOUS_CAPTURE_TIME' }
        return ([DateTimeOffset]$Value).ToUniversalTime()
    }
    if ($Value -isnot [string] -or $Value -cnotmatch '(Z|[+-]\d{2}:\d{2})$') { Stop-Check 'INVALID_CAPTURE_TIME' }
    try { return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime() }
    catch { Stop-Check 'INVALID_CAPTURE_TIME' }
}

function Safe-FailureDetails($Record) {
    return [ordered]@{
        exceptionType = $Record.Exception.GetType().FullName
        frames = @([regex]::Matches([string]$Record.ScriptStackTrace, '(?m)^at ([^,\r\n]+),.*: line (\d+)') |
            ForEach-Object { [ordered]@{ function = $_.Groups[1].Value; line = [int]$_.Groups[2].Value } })
    }
}

function Canonical-Value($Value) {
    if ($Value -is [Collections.IDictionary]) {
        $ordered = [ordered]@{}
        $keys = [string[]] @($Value.Keys)
        [Array]::Sort($keys, [StringComparer]::Ordinal)
        foreach ($key in $keys) { $ordered[$key] = Canonical-Value $Value[$key] }
        return $ordered
    }
    if ($Value -is [array]) {
        $items = @(foreach ($item in $Value) { ,(Canonical-Value $item) })
        return ,$items
    }
    return $Value
}

function Canonical-Json($Value) {
    return ConvertTo-Json -InputObject (Canonical-Value $Value) -Depth 100 -Compress
}

function Nonnegative-Integer($Value) {
    # CSV has strings, whereas the MCP JSON row normally has JSON numbers.
    $text = [string] $Value
    if ($text -cnotmatch '^(0|[1-9][0-9]*)$') { Stop-Check 'INVALID_FINGERPRINT_COUNT' }
    try { return [long]::Parse($text, [Globalization.CultureInfo]::InvariantCulture) }
    catch { Stop-Check 'INVALID_FINGERPRINT_COUNT' }
}

function Normalize-FingerprintFields($Row) {
    if ($Row -isnot [Collections.IDictionary]) { Stop-Check 'INVALID_FINGERPRINT_ROW' }
    $keys = @('application_data', 'migration_count', 'policy_count', 'auth_table_count', 'storage_table_count')
    if ($Row.Count -ne $keys.Count) { Stop-Check 'INVALID_FINGERPRINT_COLUMNS' }
    foreach ($key in $keys) { if (@($Row.Keys) -cnotcontains $key) { Stop-Check 'INVALID_FINGERPRINT_COLUMNS' } }
    $app = $Row.application_data
    if ($app -is [string]) { $app = Parse-Object $app 'INVALID_APPLICATION_FINGERPRINT' }
    if ($app -isnot [Collections.IDictionary] -or $app.Count -ne 3 -or
        @($app.Keys) -cnotcontains 'table_count' -or @($app.Keys) -cnotcontains 'row_count' -or
        @($app.Keys) -cnotcontains 'data_digest' -or $app.data_digest -isnot [string] -or
        $app.data_digest -cnotmatch '^[0-9a-f]{32}$') { Stop-Check 'INVALID_APPLICATION_FINGERPRINT' }
    $normalized = [ordered]@{
        application_data = [ordered]@{ table_count = Nonnegative-Integer $app.table_count;
            row_count = Nonnegative-Integer $app.row_count; data_digest = $app.data_digest }
        migration_count = Nonnegative-Integer $Row.migration_count
        policy_count = Nonnegative-Integer $Row.policy_count
        auth_table_count = Nonnegative-Integer $Row.auth_table_count
        storage_table_count = Nonnegative-Integer $Row.storage_table_count
    }
    return $normalized
}

function Normalize-Fingerprint($Row) {
    $normalized = Normalize-FingerprintFields $Row
    if ($normalized.application_data.table_count -ne $profileSettings.ApplicationTables -or
        $normalized.migration_count -ne $profileSettings.MigrationRows -or
        $normalized.auth_table_count -eq 0 -or $normalized.storage_table_count -eq 0) { Stop-Check $profileSettings.ScopeFailure }
    return $normalized
}

function Assert-DeltaMode([bool] $Enabled, [string] $SelectedProfile) {
    if ($Enabled -and $SelectedProfile -cne 'Phase3Preparation') { Stop-Check 'DELTA_REQUIRES_PHASE3_PROFILE' }
}

function Assert-ExactKeys($Value, [string[]] $Keys, [string] $Code) {
    if ($Value -isnot [Collections.IDictionary] -or $Value.Count -ne $Keys.Count) { Stop-Check $Code }
    foreach ($key in $Keys) { if (@($Value.Keys) -cnotcontains $key) { Stop-Check $Code } }
}

function Assert-StringFields($Value, [string[]] $Keys, [string] $Code) {
    foreach ($key in $Keys) {
        if ($Value[$key] -isnot [string] -or [string]::IsNullOrWhiteSpace($Value[$key])) { Stop-Check $Code }
    }
}

function Assert-DeltaPreparation($Report, [string] $PacketHash) {
    Assert-DeltaMode $true $profileSettings.Name
    Assert-ExactKeys $Report @('kind','schemaVersion','decision','validReleaseEvidence','targetProjectRef','createdAt','observedAt',
        'catalogExpiresAt','manifestDigest','baselineHistorySha256','baseline','delta','excludedVersions','retiredConstraint',
        'currentScopedCapabilityCount','catalogSha256','automaticWrites','scopeLimits') 'INVALID_DELTA_PREPARATION_FIELDS'
    Assert-ExactKeys $Report.baseline @('recordedRows','combinedVersion','sourceEnvelopeCount','appliedSqlSha256') 'INVALID_DELTA_BASELINE_FIELDS'
    Assert-ExactKeys $Report.delta @('version','name','path','sourceSha256','packetSha256','productionApplied') 'INVALID_DELTA_FIELDS'
    Assert-ExactKeys $Report.retiredConstraint @('name','removalVersion','treatment') 'INVALID_DELTA_RETIRED_CONSTRAINT'
    Assert-StringFields $Report @('kind','decision','targetProjectRef','manifestDigest','baselineHistorySha256','catalogSha256') 'INVALID_DELTA_PREPARATION_TYPES'
    Assert-StringFields $Report.baseline @('combinedVersion','appliedSqlSha256') 'INVALID_DELTA_PREPARATION_TYPES'
    Assert-StringFields $Report.delta @('version','name','path','sourceSha256','packetSha256') 'INVALID_DELTA_PREPARATION_TYPES'
    Assert-StringFields $Report.retiredConstraint @('name','removalVersion','treatment') 'INVALID_DELTA_PREPARATION_TYPES'
    if ($Report.kind -cne 'phase3-combined-baseline-delta-preparation' -or
        ($Report.schemaVersion -isnot [int] -and $Report.schemaVersion -isnot [long]) -or $Report.schemaVersion -ne 1 -or
        $Report.decision -cne 'HOLD' -or $Report.validReleaseEvidence -isnot [bool] -or $Report.validReleaseEvidence -or
        $Report.targetProjectRef -cne $projectRef -or $Report.delta.productionApplied -isnot [bool] -or $Report.delta.productionApplied -or
        $Report.delta.version -cne $deltaSettings.Version -or $Report.delta.name -cne $deltaSettings.Name -or
        $Report.delta.path -cne 'supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql' -or
        $Report.delta.sourceSha256 -cne $deltaSettings.SourceSha256 -or
        $Report.delta.packetSha256 -cne $deltaSettings.PacketSha256 -or $PacketHash -cne $deltaSettings.PacketSha256 -or
        $Report.baselineHistorySha256 -cne $deltaSettings.BaselineHistorySha256 -or
        ($Report.baseline.recordedRows -isnot [int] -and $Report.baseline.recordedRows -isnot [long]) -or $Report.baseline.recordedRows -ne 17 -or
        $Report.baseline.combinedVersion -cne '20261031201901' -or
        ($Report.baseline.sourceEnvelopeCount -isnot [int] -and $Report.baseline.sourceEnvelopeCount -isnot [long]) -or $Report.baseline.sourceEnvelopeCount -ne 62 -or
        ($Report.currentScopedCapabilityCount -isnot [int] -and $Report.currentScopedCapabilityCount -isnot [long]) -or $Report.currentScopedCapabilityCount -le 0 -or
        $Report.baseline.appliedSqlSha256 -cne '9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5' -or
        $Report.manifestDigest -cnotmatch '^[0-9a-f]{64}$' -or $Report.catalogSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $Report.automaticWrites -isnot [array] -or $Report.automaticWrites.Count -ne 0 -or
        (Canonical-Json $Report.excludedVersions) -cne '["20261103215321","20261104134202"]' -or
        $Report.retiredConstraint.name -cne 'constraint-removed:public.mission_submissions.mission_submissions_creator_workspace_fk' -or
        $Report.retiredConstraint.removalVersion -cne '20260720193637' -or
        $Report.scopeLimits -isnot [array] -or $Report.scopeLimits.Count -eq 0 -or $Report.scopeLimits.Count -gt 16) { Stop-Check 'DELTA_PREPARATION_PIN_OR_SCOPE_MISMATCH' }
    foreach ($limit in $Report.scopeLimits) {
        if ($limit -isnot [string] -or [string]::IsNullOrWhiteSpace($limit) -or $limit.Length -gt 2048) { Stop-Check 'INVALID_DELTA_PREPARATION_TYPES' }
    }
    # These timestamps describe preparation provenance, not current live evidence.
    $observed = Capture-Time $Report.observedAt
    $created = Capture-Time $Report.createdAt
    $expires = Capture-Time $Report.catalogExpiresAt
    if ($created -lt $observed -or $created -gt $expires -or $expires -le $observed) { Stop-Check 'INVALID_DELTA_PREPARATION_TIMES' }
}

function Assert-DeltaDirectoryPath([string] $Directory, [string] $BackupDirectory) {
    $path = Local-Path $Directory
    if ($path.Equals($BackupDirectory, [StringComparison]::OrdinalIgnoreCase) -or
        $path.StartsWith($BackupDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { Stop-Check 'DELTA_INPUT_INSIDE_BACKUP_ROOT' }
    return $path
}

function Read-DeltaPreparation([string] $Directory) {
    $path = Assert-DeltaDirectoryPath $Directory $backupRoot
    Assert-NoLink $path
    if ((Get-Item -LiteralPath $path) -isnot [IO.DirectoryInfo]) { Stop-Check 'DELTA_PREPARATION_DIRECTORY_REQUIRED' }
    $items = @(Get-ChildItem -LiteralPath $path -Force)
    if ($items.Count -ne 2) { Stop-Check 'EXACT_DELTA_PREPARATION_FILES_REQUIRED' }
    $records = @{}
    foreach ($item in $items) {
        if ($item.Name -cnotin @('guarded-delta.sql','preparation.json')) { Stop-Check 'EXACT_DELTA_PREPARATION_FILES_REQUIRED' }
        Assert-NoLink $item.FullName
        $limit = if ($item.Name -ceq 'guarded-delta.sql') { 1MB } else { 256KB }
        if ($item -isnot [IO.FileInfo] -or $item.Length -le 0 -or $item.Length -gt $limit) { Stop-Check 'DELTA_PREPARATION_FILE_TYPE_OR_SIZE' }
        $records[$item.Name] = @{ path = $item.FullName; bytes = $item.Length; sha256 = File-Hash $item.FullName; private = $false }
    }
    $report = Parse-Object ([IO.File]::ReadAllText($records['preparation.json'].path)) 'INVALID_DELTA_PREPARATION_JSON'
    Assert-DeltaPreparation $report $records['guarded-delta.sql'].sha256
    foreach ($record in $records.Values) {
        if ((File-Hash $record.path) -cne $record.sha256 -or (Get-Item -LiteralPath $record.path).Length -ne $record.bytes) { Stop-Check 'DELTA_PREPARATION_CHANGED_DURING_READ' }
        $script:verifiedFiles += $record
    }
    return [pscustomobject]@{ Report = $report; SqlPath = $records['guarded-delta.sql'].path; PacketSha256 = $records['guarded-delta.sql'].sha256 }
}

function Normalize-DeltaFingerprint($Row) {
    Assert-DeltaMode $true $profileSettings.Name
    $normalized = Normalize-FingerprintFields $Row
    if ($normalized.application_data.table_count -ne 104 -or $normalized.migration_count -ne 18 -or
        $normalized.auth_table_count -eq 0 -or $normalized.storage_table_count -eq 0) { Stop-Check 'PHASE3_DELTA_104_TABLE_18_MIGRATION_SCOPE_REQUIRED' }
    return $normalized
}

function Assert-DeltaState($State, [ValidateSet('Before','First','Replay', IgnoreCase = $false)] [string] $Phase) {
    Assert-ExactKeys $State @('database','currentRole','sessionRole','serverVersionNum','transactionReadOnly','migrationRows','history','functions',
        'otherCatalogDigest','storageBucketsDigest') 'INVALID_DELTA_STATE_FIELDS'
    Assert-StringFields $State @('database','currentRole','sessionRole','otherCatalogDigest','storageBucketsDigest') 'DELTA_STATE_IDENTITY_OR_COUNT_MISMATCH'
    $count = if ($Phase -ceq 'Before') { 17 } else { 18 }
    if ($State.database -cne 'postgres' -or $State.currentRole -cne 'postgres' -or $State.sessionRole -cne 'postgres' -or
        ($State.serverVersionNum -isnot [int] -and $State.serverVersionNum -isnot [long]) -or $State.serverVersionNum -ne 170006 -or
        $State.transactionReadOnly -isnot [bool] -or -not $State.transactionReadOnly -or
        ($State.migrationRows -isnot [int] -and $State.migrationRows -isnot [long]) -or $State.migrationRows -ne $count -or $State.history -isnot [array] -or $State.history.Count -ne $count -or
        $State.functions -isnot [array] -or $State.functions.Count -ne 2 -or
        $State.otherCatalogDigest -isnot [string] -or $State.otherCatalogDigest -cnotmatch '^[0-9a-f]{64}$' -or
        $State.storageBucketsDigest -isnot [string] -or $State.storageBucketsDigest -cnotmatch '^[0-9a-f]{64}$') { Stop-Check 'DELTA_STATE_IDENTITY_OR_COUNT_MISMATCH' }
    $versions = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($row in $State.history) {
        Assert-ExactKeys $row @('version','name','statementCount','statementsSha256','xmin') 'INVALID_DELTA_HISTORY_FIELDS'
        if ($row.version -isnot [string] -or $row.version -cnotmatch '^\d{4}(?:\d{10})?$' -or -not $versions.Add($row.version) -or
            ($null -ne $row.name -and $row.name -isnot [string]) -or
            ($row.statementCount -isnot [int] -and $row.statementCount -isnot [long]) -or $row.statementCount -lt 0 -or
            ($null -ne $row.statementsSha256 -and ($row.statementsSha256 -isnot [string] -or $row.statementsSha256 -cnotmatch '^[0-9a-f]{64}$')) -or
            ($row.statementCount -gt 0 -and $null -eq $row.statementsSha256) -or
            $row.xmin -isnot [string] -or $row.xmin -cnotmatch '^[0-9]+$') { Stop-Check 'INVALID_DELTA_HISTORY_STATE' }
    }
    $deltaRows = @($State.history | Where-Object { $_.version -ceq $deltaSettings.Version })
    if ($Phase -ceq 'Before') {
        if ($deltaRows.Count -ne 0) { Stop-Check 'DELTA_ALREADY_PRESENT_BEFORE_REHEARSAL' }
    } elseif ($deltaRows.Count -ne 1 -or $deltaRows[0].name -cne $deltaSettings.Name -or
        $deltaRows[0].statementCount -ne 1 -or $deltaRows[0].statementsSha256 -cne $deltaSettings.SourceSha256) { Stop-Check 'DELTA_ARCHIVED_SOURCE_MISMATCH' }
    $signatures = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($function in $State.functions) {
        Assert-ExactKeys $function @('signature','oid','xmin','bodySha256','attributesAclDigest') 'INVALID_DELTA_FUNCTION_FIELDS'
        if ($function.signature -cnotin @('private.join_mission(uuid)','public.accept_application(uuid)') -or -not $signatures.Add($function.signature) -or
            $function.oid -isnot [string] -or $function.oid -cnotmatch '^[1-9][0-9]*$' -or
            $function.xmin -isnot [string] -or $function.xmin -cnotmatch '^[0-9]+$' -or
            $function.bodySha256 -isnot [string] -or $function.bodySha256 -cnotmatch '^[0-9a-f]{64}$' -or
            $function.attributesAclDigest -isnot [string] -or $function.attributesAclDigest -cnotmatch '^[0-9a-f]{64}$') { Stop-Check 'INVALID_DELTA_FUNCTION_STATE' }
    }
}

function Assert-DeltaRehearsal($Baseline, $AfterFirst, $AfterReplay, $BeforeState, $FirstState, $ReplayState) {
    $before = Normalize-Fingerprint $Baseline
    $first = Normalize-DeltaFingerprint $AfterFirst
    $replay = Normalize-DeltaFingerprint $AfterReplay
    foreach ($row in @($first, $replay)) {
        foreach ($key in @('application_data','policy_count','auth_table_count','storage_table_count')) {
            if ((Canonical-Json $row[$key]) -cne (Canonical-Json $before[$key])) { Stop-Check 'DELTA_APPLICATION_FINGERPRINT_CHANGED' }
        }
    }
    Assert-DeltaState $BeforeState Before
    Assert-DeltaState $FirstState First
    Assert-DeltaState $ReplayState Replay
    foreach ($state in @($FirstState, $ReplayState)) {
        foreach ($function in $state.functions) {
            $previous = @($BeforeState.functions | Where-Object { $_.signature -ceq $function.signature })[0]
            if ($function.attributesAclDigest -cne $previous.attributesAclDigest) { Stop-Check 'DELTA_TARGET_FUNCTION_ATTRIBUTES_OR_ACL_CHANGED' }
        }
    }
    $oldRows = @($FirstState.history | Where-Object { $_.version -cne $deltaSettings.Version })
    if ((Canonical-Json $oldRows) -cne (Canonical-Json $BeforeState.history)) { Stop-Check 'DELTA_BASELINE_HISTORY_CHANGED' }
    if ((Canonical-Json $FirstState.history) -cne (Canonical-Json $ReplayState.history) -or
        (Canonical-Json $FirstState.functions) -cne (Canonical-Json $ReplayState.functions)) { Stop-Check 'DELTA_REPLAY_TUPLE_VERSIONS_CHANGED' }
    foreach ($state in @($FirstState, $ReplayState)) {
        if ($state.otherCatalogDigest -cne $BeforeState.otherCatalogDigest -or
            $state.storageBucketsDigest -cne $BeforeState.storageBucketsDigest) { Stop-Check 'DELTA_OTHER_CATALOG_OR_BUCKETS_CHANGED' }
    }
    foreach ($function in $FirstState.functions) {
        $previous = @($BeforeState.functions | Where-Object { $_.signature -ceq $function.signature })[0]
        if ($previous.oid -cne $function.oid -or $previous.xmin -ceq $function.xmin -or $previous.bodySha256 -ceq $function.bodySha256) { Stop-Check 'DELTA_FIRST_FUNCTION_CHANGE_NOT_PROVEN' }
    }
    return [ordered]@{
        status = 'DISPOSABLE_DELTA_AND_IDENTICAL_REPLAY_VERIFIED'; productionApplied = $false; validReleaseEvidence = $false
        version = $deltaSettings.Version; sourceSha256 = $deltaSettings.SourceSha256; packetSha256 = $deltaSettings.PacketSha256
        baselineRows = 17; afterFirst = 18; afterReplay = 18; baselineHistoryPreserved = $true
        applicationDataUnchanged = $true; policyAuthStorageCountsUnchanged = $true
        replayTupleVersionsUnchanged = $true; targetFunctionAttributesAclUnchanged = $true
        otherCatalogUnchanged = $true; storageBucketsUnchanged = $true
        otherCatalogDigest = $BeforeState.otherCatalogDigest; storageBucketsDigest = $BeforeState.storageBucketsDigest
        otherCatalogScope = @('public/private/auth/storage relations, columns, defaults, constraints, indexes, policies and triggers',
            'Other function definitions/attributes/owners/ACL/config; aggregate source metadata only',
            'Schema/default ACLs, role attributes/memberships and event-trigger metadata; no physical statistics')
        functionTupleVersions = @($FirstState.functions | ForEach-Object { [ordered]@{ signature = $_.signature; oid = $_.oid; xmin = $_.xmin; attributesAclDigest = $_.attributesAclDigest } })
    }
}

function Get-DeltaRehearsalScript {
    return @'
  # Fixed metadata only: definitions and bucket rows are hashed inside Postgres.
  delta_state() {
    PGHOST=/tmp PGPORT=5432 PGUSER=postgres PGDATABASE=postgres psql -X -w -q -t -A --set=ON_ERROR_STOP=1 <<'DELTA_STATE_SQL'
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
WITH scoped_relations AS (
  SELECT c.*, n.nspname, r.rolname AS owner_name
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
  WHERE n.nspname IN ('public','private','auth','storage')
), catalog_inventory AS (
  SELECT pg_catalog.jsonb_build_object(
    'schemas', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'owner',r.rolname,'acl',n.nspacl::text) ORDER BY n.nspname COLLATE "C"),'[]'::jsonb)
      FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname IN ('public','private','auth','storage')),
    'relations', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',c.nspname,'name',c.relname,'kind',c.relkind,'owner',c.owner_name,
      'acl',c.relacl::text,'options',c.reloptions,'persistence',c.relpersistence,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
      'replicaIdentity',c.relreplident,'partitionBound',pg_get_expr(c.relpartbound,c.oid),
      'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE NULL END) ORDER BY c.nspname COLLATE "C",c.relname COLLATE "C"),'[]'::jsonb) FROM scoped_relations c),
    'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',c.nspname,'relation',c.relname,'number',a.attnum,'name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'dropped',a.attisdropped,
      'acl',a.attacl::text,'options',a.attoptions,'storage',a.attstorage,'compression',a.attcompression,
      'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END,
      'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.nspname COLLATE "C",c.relname COLLATE "C",a.attnum),'[]'::jsonb)
      FROM scoped_relations c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum),
    'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',k.conname,'type',k.contype,
      'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred,'definition',pg_get_constraintdef(k.oid,true))
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",k.conname COLLATE "C"),'[]'::jsonb)
      FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace LEFT JOIN pg_class c ON c.oid=k.conrelid WHERE n.nspname IN ('public','private','auth','storage')),
    'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',c.nspname,'relation',c.relname,'name',idx.relname,
      'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'replicaIdentity',i.indisreplident,
      'clustered',i.indisclustered,'nullsNotDistinct',i.indnullsnotdistinct) ORDER BY c.nspname COLLATE "C",c.relname COLLATE "C",idx.relname COLLATE "C"),'[]'::jsonb)
      FROM scoped_relations c JOIN pg_index i ON i.indrelid=c.oid JOIN pg_class idx ON idx.oid=i.indexrelid),
    'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'relation',tablename,'name',policyname,'permissive',permissive,
      'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY schemaname COLLATE "C",tablename COLLATE "C",policyname COLLATE "C"),'[]'::jsonb)
      FROM pg_policies WHERE schemaname IN ('public','private','auth','storage')),
    'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',c.nspname,'relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,
      'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY c.nspname COLLATE "C",c.relname COLLATE "C",t.tgname COLLATE "C"),'[]'::jsonb)
      FROM scoped_relations c JOIN pg_trigger t ON t.tgrelid=c.oid),
    'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
      'result',pg_get_function_result(p.oid),'kind',p.prokind,'language',l.lanname,'owner',r.rolname,'acl',p.proacl::text,'config',p.proconfig,
      'definition',CASE WHEN p.prokind='a' THEN p.prosrc ELSE pg_get_functiondef(p.oid) END,'binary',p.probin,
      'definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,'volatility',p.provolatile,'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows)
      ORDER BY n.nspname COLLATE "C",p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C"),'[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname IN ('public','private','auth','storage') AND p.oid NOT IN (to_regprocedure('private.join_mission(uuid)'),to_regprocedure('public.accept_application(uuid)'))),
    'defaultAcls', (SELECT coalesce(jsonb_agg(jsonb_build_object('owner',r.rolname,'schema',n.nspname,'type',a.defaclobjtype,'acl',a.defaclacl::text)
      ORDER BY r.rolname COLLATE "C",n.nspname COLLATE "C",a.defaclobjtype),'[]'::jsonb)
      FROM pg_default_acl a JOIN pg_roles r ON r.oid=a.defaclrole LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace WHERE a.defaclnamespace=0 OR n.nspname IN ('public','private','auth','storage')),
    'roles', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,
      'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'connectionLimit',rolconnlimit,'validUntil',rolvaliduntil,
      'bypassRls',rolbypassrls,'config',rolconfig) ORDER BY rolname COLLATE "C"),'[]'::jsonb) FROM pg_roles),
    'roleMembership', (SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,
      'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) ORDER BY r.rolname COLLATE "C",m.rolname COLLATE "C",g.rolname COLLATE "C"),'[]'::jsonb)
      FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor),
    'eventTriggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'owner',r.rolname,
      'function',e.evtfoid::regprocedure::text,'enabled',e.evtenabled,'tags',e.evttags) ORDER BY e.evtname COLLATE "C"),'[]'::jsonb)
      FROM pg_event_trigger e JOIN pg_roles r ON r.oid=e.evtowner)
  ) AS inventory
)
SELECT json_build_object(
  'database',current_database(),'currentRole',current_user,'sessionRole',session_user,'serverVersionNum',current_setting('server_version_num')::int,
  'transactionReadOnly',current_setting('transaction_read_only')='on',
  'migrationRows',(SELECT count(*) FROM supabase_migrations.schema_migrations),
  'history',(SELECT coalesce(json_agg(json_build_object('version',h.version,'name',h.name,'statementCount',coalesce(cardinality(h.statements),0),
    'statementsSha256',CASE WHEN h.statements IS NULL THEN NULL ELSE encode(sha256(convert_to(array_to_string(h.statements,E'\n'),'UTF8')),'hex') END,
    'xmin',h.xmin::text) ORDER BY h.version COLLATE "C"),'[]'::json) FROM supabase_migrations.schema_migrations h),
  'functions',(SELECT json_agg(json_build_object('signature',e.signature,'oid',p.oid::text,'xmin',p.xmin::text,
    'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'attributesAclDigest',encode(sha256(convert_to(jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
      'securityDefiner',p.prosecdef,'config',p.proconfig,'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),
      'volatility',p.provolatile,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,'kind',p.prokind,
      'returnsSet',p.proretset,'result',pg_get_function_result(p.oid),'arguments',pg_get_function_identity_arguments(p.oid),
      'cost',p.procost,'rows',p.prorows)::text,'UTF8')),'hex')) ORDER BY e.signature COLLATE "C")
    FROM (VALUES ('private.join_mission(uuid)'),('public.accept_application(uuid)')) e(signature) JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)),
  'otherCatalogDigest',(SELECT encode(sha256(convert_to(inventory::text,'UTF8')),'hex') FROM catalog_inventory),
  'storageBucketsDigest',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text,'[]'),'UTF8')),'hex') FROM storage.buckets b)
);
ROLLBACK;
DELTA_STATE_SQL
  }
  delta_fingerprint() {
    PGHOST=/tmp PGPORT=5432 PGUSER=postgres PGDATABASE=postgres psql -X -w -q -t --csv --set=ON_ERROR_STOP=1 --file=/current-fingerprint.sql
  }
  if test "$code" = 0; then
    delta_state >/evidence/delta-before.json 2>/evidence/delta-before.error || code=31
    if test -s /evidence/delta-before.error; then code=32; fi
  fi
  if test "$code" = 0; then
    PGHOST=/tmp PGPORT=5432 PGUSER=postgres PGDATABASE=postgres psql -X -w -q --set=ON_ERROR_STOP=1 --file=/guarded-delta.sql >/evidence/delta-first.stdout 2>/evidence/delta-first.stderr || code=33
    if test -s /evidence/delta-first.stdout || test -s /evidence/delta-first.stderr; then code=34; fi
  fi
  if test "$code" = 0; then
    delta_state >/evidence/delta-first.json 2>/evidence/delta-first.error || code=35
    if test -s /evidence/delta-first.error; then code=36; fi
  fi
  if test "$code" = 0; then
    delta_fingerprint >/evidence/delta-first-fingerprint.csv 2>/evidence/delta-first-fingerprint.error || code=37
    if test -s /evidence/delta-first-fingerprint.error; then code=38; fi
  fi
  if test "$code" = 0; then
    PGHOST=/tmp PGPORT=5432 PGUSER=postgres PGDATABASE=postgres psql -X -w -q --set=ON_ERROR_STOP=1 --file=/guarded-delta.sql >/evidence/delta-replay.stdout 2>/evidence/delta-replay.stderr || code=39
    if test -s /evidence/delta-replay.stdout || test -s /evidence/delta-replay.stderr; then code=40; fi
  fi
  if test "$code" = 0; then
    delta_state >/evidence/delta-replay.json 2>/evidence/delta-replay.error || code=41
    if test -s /evidence/delta-replay.error; then code=42; fi
  fi
  if test "$code" = 0; then
    delta_fingerprint >/evidence/delta-replay-fingerprint.csv 2>/evidence/delta-replay-fingerprint.error || code=43
    if test -s /evidence/delta-replay-fingerprint.error; then code=44; fi
  fi
'@
}

function Get-DeltaMountArguments([bool] $Enabled) {
    if ($Enabled) { return @('--mount', "type=bind,source=$script:evidence/guarded-delta.sql,target=/guarded-delta.sql,readonly") }
    return @()
}

function Get-ExpectedRestoreMounts([bool] $Enabled) {
    $mounts = @{ '/backup' = $false; '/checks.sql' = $false; '/current-fingerprint.sql' = $false; '/review/restore.sh' = $false; '/review/entrypoint.sh' = $false; '/evidence' = $true }
    if ($Enabled) { $mounts['/guarded-delta.sql'] = $false }
    return $mounts
}

function Read-RuntimeFingerprint([string] $Name) {
    $path = Join-Path $script:runtimeOutput $Name
    Assert-Private $path
    if ((Get-Item -LiteralPath $path).Length -gt 1MB) { Stop-Check 'DELTA_FINGERPRINT_TOO_LARGE' }
    $rows = @(ConvertFrom-Csv -InputObject ([IO.File]::ReadAllText($path)) -Header @('application_data','migration_count','policy_count','auth_table_count','storage_table_count'))
    if ($rows.Count -ne 1) { Stop-Check 'EXACTLY_ONE_DELTA_FINGERPRINT_ROW_REQUIRED' }
    $row = @{}
    foreach ($property in $rows[0].PSObject.Properties) { $row[$property.Name] = $property.Value }
    return $row
}

function Read-DeltaState([string] $Name) {
    $path = Join-Path $script:runtimeOutput $Name
    Assert-Private $path
    if ((Get-Item -LiteralPath $path).Length -gt 1MB) { Stop-Check 'DELTA_STATE_TOO_LARGE' }
    return Parse-Object ([IO.File]::ReadAllText($path)) 'INVALID_DELTA_STATE_JSON'
}

function Assert-InputsUnchanged {
    Assert-CodePins
    foreach ($file in $script:verifiedFiles) {
        if ($file.private) { Assert-Private $file.path }
        else {
            Assert-NoLink $file.path
            if ((Get-Item -LiteralPath $file.path) -isnot [IO.FileInfo]) { Stop-Check 'INPUT_FILE_TYPE_CHANGED' }
        }
        if ((Get-Item -LiteralPath $file.path).Length -ne $file.bytes -or (File-Hash $file.path) -cne $file.sha256) {
            Stop-Check 'INPUT_CHANGED_DURING_RESTORE'
        }
    }
}

function Remove-OwnedContainer {
    $inspect = Invoke-Docker @('container', 'inspect', $script:containerName) 'cleanup-inspect'
    if ($inspect.Code -ne 0) {
        $listing = Invoke-Docker @('container', 'ls', '--all', '--filter', ('name=^/' + $script:containerName + '$'), '--format', '{{.ID}}') 'cleanup-list'
        Require-NativeSuccess $listing 'OWN_CONTAINER_CLEANUP_UNCONFIRMED'
        if (-not [string]::IsNullOrWhiteSpace($listing.Output)) { Stop-Check 'OWN_CONTAINER_CLEANUP_UNCONFIRMED' }
        return
    }
    $objects = @(ConvertFrom-Json -InputObject $inspect.Output -AsHashtable -Depth 100)
    if ($objects.Count -ne 1 -or $objects[0].Config.Labels['kocmax.auth-pilot-restore'] -cne $script:ownerToken -or
        $objects[0].Name -cne ('/' + $script:containerName) -or $objects[0].Id -cnotmatch '^[0-9a-f]{64}$') {
        Stop-Check 'OWN_CONTAINER_IDENTITY_MISMATCH'
    }
    $removed = Invoke-Docker @('container', 'rm', '--force', '--volumes', $objects[0].Id) 'cleanup-remove'
    Require-NativeSuccess $removed 'OWN_CONTAINER_CLEANUP_UNCONFIRMED'
    $remaining = Invoke-Docker @('container', 'ls', '--all', '--filter', ('name=^/' + $script:containerName + '$'), '--format', '{{.ID}}') 'cleanup-confirm'
    Require-NativeSuccess $remaining 'OWN_CONTAINER_CLEANUP_UNCONFIRMED'
    if (-not [string]::IsNullOrWhiteSpace($remaining.Output)) { Stop-Check 'OWN_CONTAINER_CLEANUP_UNCONFIRMED' }
}

$result = [ordered]@{
    wrapperVersion = '3-optional-disposable-delta-20261113'
    status = if ($deltaEnabled) { 'PHASE3_DISPOSABLE_DELTA_REHEARSAL_NOT_VERIFIED' } else { $profileSettings.FailureStatus }
    profile = $profileSettings.Name; profileBranch = $profileSettings.Branch
    projectRef = $projectRef; attempt = $null; failureCode = $null; failureDiagnostics = $null
    checkpointNotBeforeUtc = $CheckpointNotBeforeUtc.ToUniversalTime().ToString('o')
    backupStartedUtc = $null; backupFinishedUtc = $null; sourceCapturedUtc = $null
    sourceObservedDateHkt = $null; sourceCaptureTiming = 'EXACT_TIME_NOT_SUPPLIED'
    manifestSha256 = $null; sourceFingerprintSha256 = $null; querySha256 = $pins['auth-pilot-fingerprint.sql']
    legacyCheckQuerySha256 = $baselineQueryHash
    wrapperSha256 = $null; reviewedScriptHashes = $pins; image = $restoreImage; imageId = $null
    fullArchiveRead = 'NOT_RUN'; restore = 'NOT_RUN'; comparison = 'NOT_RUN'
    inputHashesAfter = 'NOT_RUN'; containerCleanup = 'NOT_NEEDED'; evidenceDirectory = $null
    matchedCounts = $null; matchedDataDigest = $null; finishedUtc = $null
    network = 'NONE'; publishedPorts = 'NONE'; sourceCredentials = 'NONE'; backupMount = 'READ_ONLY'
    manifestModified = $false; migrationAuthorization = 'NOT_ASSESSED'; authTests = 'NOT_RUN'
    limitations = @('Separate source and backup snapshots; equality is checked, snapshot synchronization is not claimed.',
        'Auth/Storage table counts only; their row counts and contents are not independently compared. Storage object bytes are outside the archive.',
        'No hosted Auth/Storage behavior, platform recovery, role passwords or external provider verification.',
        'Source provenance/timing is supplied by the parent; offline equality does not prove that the live source remained unchanged afterward.',
        'Original owner/ACL/grantor commands are retained by restore; this fingerprint is not a separate catalog or privilege-equivalence audit.',
        'Opaque MD5 comparison is a consistency check, not a cryptographic authenticity proof.')
}
if ($deltaEnabled) {
    $result['deltaRehearsal'] = [ordered]@{ status = 'NOT_RUN'; productionApplied = $false; validReleaseEvidence = $false;
        version = $deltaSettings.Version; packetSha256 = $deltaSettings.PacketSha256 }
}
$passed = $false
try {
    Assert-DeltaMode $deltaEnabled $profileSettings.Name
    if (-not $IsWindows) { Stop-Check 'WINDOWS_HOST_REQUIRED' }
    $localData = Local-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))
    $privateRoot = Local-Path (Join-Path $localData 'KOCmax/PrivateBackups')
    $backupRoot = Local-Path (Join-Path $privateRoot $projectRef)
    $attempt = Local-Path $AttemptDirectory
    $source = Local-Path $SourceFingerprintPath
    if (-not [IO.Path]::GetDirectoryName($attempt).Equals($backupRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($attempt) -cnotmatch '^\d{8}T\d{6}Z-[0-9a-f]{32}$' -or
        $source.StartsWith($attempt + '\', [StringComparison]::OrdinalIgnoreCase)) { Stop-Check 'EXPLICIT_PRIVATE_PATH_REQUIRED' }
    foreach ($served in @($repoRoot, (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) '.codex/visualizations'))) {
        $served = Local-Path $served
        if ($backupRoot.Equals($served, [StringComparison]::OrdinalIgnoreCase) -or
            $backupRoot.StartsWith($served + '\', [StringComparison]::OrdinalIgnoreCase)) { Stop-Check 'SERVED_ROOT_REJECTED' }
    }
    foreach ($directory in @($privateRoot, $backupRoot, $attempt)) { Assert-Private $directory -Directory }
    # The parent source JSON is sanitized metadata and may live in the repository.
    # It is never mounted into the container or used as SQL. Actual backup files
    # and all runtime diagnostics retain the strict private-directory rules.
    $sourceIsPrivate = $source.StartsWith($backupRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    if ($sourceIsPrivate) { Assert-Private $source }
    else {
        Assert-NoLink $source
        if ((Get-Item -LiteralPath $source) -isnot [IO.FileInfo]) { Stop-Check 'SOURCE_JSON_FILE_REQUIRED' }
    }
    Assert-CodePins
    $result.wrapperSha256 = File-Hash $PSCommandPath
    $result.attempt = [IO.Path]::GetFileName($attempt)
    $script:evidence = Join-Path $backupRoot ('restore-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N'))
    New-PrivateDirectory $script:evidence
    $result.evidenceDirectory = $script:evidence
    $shellPath = Join-Path $PSHOME 'pwsh.exe'
    $fullRead = Invoke-Captured -Program $shellPath -Arguments @('-NoProfile', '-File', $verifierPath,
        '-AttemptDirectory', $attempt, '-TimeoutSeconds', [string]$TimeoutSeconds, '-Profile', $profileSettings.Name) -Label 'archive-verifier' -Seconds 0
    Require-NativeSuccess $fullRead 'EXISTING_ARCHIVE_VERIFIER_FAILED'
    $full = Parse-Object $fullRead.Output 'INVALID_ARCHIVE_VERIFIER_RECEIPT'
    if ($full.verifierVersion -cne '2-fixed-profiles-20261113' -or
        $full.profile -cne $profileSettings.Name -or $full.profileBranch -cne $profileSettings.Branch -or
        $full.image -cne $profileSettings.ArchiveImage -or
        $full.status -cne $profileSettings.ArchiveStatus -or $full.projectRef -cne $projectRef -or
        $full.attempt -cne $result.attempt -or $full.fullArchiveRead -cne 'PASSED' -or
        $full.hashesAfter -cne 'UNCHANGED' -or $full.containerCleanup -cne 'CONFIRMED') { Stop-Check 'ARCHIVE_VERIFIER_DID_NOT_PASS' }
    $result.fullArchiveRead = 'PASSED'
    $result.manifestSha256 = $full.manifestSha256
    foreach ($name in @('manifest.json', 'database.dump', 'roles.sql', 'toc.list')) {
        $path = Join-Path $attempt $name
        $script:verifiedFiles += @{ path = $path; bytes = (Get-Item -LiteralPath $path).Length; sha256 = File-Hash $path; private = $true }
    }
    if ($script:verifiedFiles[0].sha256 -cne $full.manifestSha256) { Stop-Check 'MANIFEST_CHANGED_AFTER_VERIFIER' }
    foreach ($artifact in $full.artifacts) {
        $record = @($script:verifiedFiles | Where-Object { [IO.Path]::GetFileName($_.path) -ceq $artifact.name })
        if ($record.Count -ne 1 -or $record[0].sha256 -cne $artifact.sha256 -or $record[0].bytes -ne $artifact.bytes) { Stop-Check 'ARTIFACT_CHANGED_AFTER_VERIFIER' }
    }
    $manifest = Parse-Object ([IO.File]::ReadAllText((Join-Path $attempt 'manifest.json'))) 'INVALID_CAPTURE_MANIFEST'
    $started = Capture-Time $manifest.startedUtc
    $finished = Capture-Time $manifest.updatedUtc
    if ($started -lt $CheckpointNotBeforeUtc -or $finished -lt $started -or $finished -gt [DateTimeOffset]::UtcNow) { Stop-Check 'FRESH_CHECKPOINT_REQUIRED' }
    $result.backupStartedUtc = $started.ToUniversalTime().ToString('o')
    $result.backupFinishedUtc = $finished.ToUniversalTime().ToString('o')
    if ((Get-Item -LiteralPath $source).Length -gt 1MB) { Stop-Check 'SOURCE_FINGERPRINT_TOO_LARGE' }
    $script:sourceHash = File-Hash $source
    $script:verifiedFiles += @{ path = $source; bytes = (Get-Item -LiteralPath $source).Length; sha256 = $script:sourceHash; private = $sourceIsPrivate }
    try { $sourceRows = @(ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($source)) -AsHashtable -Depth 32) }
    catch { Stop-Check 'INVALID_SOURCE_FINGERPRINT' }
    if ($sourceRows.Count -ne 1) { Stop-Check 'EXACTLY_ONE_SOURCE_FINGERPRINT_ROW_REQUIRED' }
    $sourceRow = $sourceRows[0]
    if ($sourceRow -isnot [Collections.IDictionary]) { Stop-Check 'INVALID_SOURCE_FINGERPRINT' }
    # Accept the parent's sanitized envelope as well as a plain MCP result row.
    # Compare only the five exact query fields; never execute envelope content.
    if ($sourceRow.Contains('projectRef') -and $sourceRow.projectRef -cne $projectRef) { Stop-Check 'SOURCE_PROJECT_MISMATCH' }
    if ($sourceRow.Contains('queryFile') -and $sourceRow.queryFile -cne 'scripts/integrations/auth-pilot-fingerprint.sql') { Stop-Check 'SOURCE_QUERY_MISMATCH' }
    $sourceValues = @{}
    foreach ($key in @('application_data', 'migration_count', 'policy_count', 'auth_table_count', 'storage_table_count')) {
        if (@($sourceRow.Keys) -cnotcontains $key) { Stop-Check 'SOURCE_FINGERPRINT_FIELD_MISSING' }
        $sourceValues[$key] = $sourceRow[$key]
    }
    $expected = Normalize-Fingerprint $sourceValues
    if ($sourceRow.Contains('observedDateHkt')) {
        if ($sourceRow.observedDateHkt -isnot [string] -or $sourceRow.observedDateHkt -cnotmatch '^\d{4}-\d{2}-\d{2}$') { Stop-Check 'INVALID_SOURCE_OBSERVATION_DATE' }
        $result.sourceObservedDateHkt = $sourceRow.observedDateHkt
    }
    if ($null -ne $SourceCapturedUtc) {
        $sourceTime = [DateTimeOffset] $SourceCapturedUtc
        if ($sourceTime -gt [DateTimeOffset]::UtcNow) { Stop-Check 'SOURCE_CAPTURE_TIME_IN_FUTURE' }
        $result.sourceCapturedUtc = $sourceTime.ToUniversalTime().ToString('o')
        $result.sourceCaptureTiming = if ($sourceTime -ge $finished) { 'AFTER_CAPTURE' } else { 'BEFORE_OR_DURING_CAPTURE' }
    }
    $result.sourceFingerprintSha256 = $script:sourceHash
    if ($deltaEnabled) { $deltaPreparation = Read-DeltaPreparation $DeltaPreparationDirectory }
    $toc = [IO.File]::ReadAllText((Join-Path $attempt 'toc.list'))
    if ($toc -match '(?m)^\d+;[^\r\n]* MATERIALIZED VIEW DATA ') { Stop-Check 'EXISTING_RESTORE_REQUIRES_MATVIEW_TAIL_PASS' }
    $script:dockerExe = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
    $image = Invoke-Docker @('image', 'inspect', $restoreImage) 'restore-image'
    Require-NativeSuccess $image 'PINNED_RESTORE_IMAGE_NOT_INSTALLED'
    $images = @(ConvertFrom-Json -InputObject $image.Output -AsHashtable -Depth 100)
    if ($images.Count -ne 1 -or $images[0].Id -cnotmatch '^sha256:[0-9a-f]{64}$') { Stop-Check 'PINNED_RESTORE_IMAGE_INVALID' }
    $result.imageId = $images[0].Id
    $volumeArguments = @()
    if ($images[0].Config.Contains('Volumes') -and $null -ne $images[0].Config.Volumes) {
        foreach ($volume in $images[0].Config.Volumes.Keys) {
            if ($volume -cnotin @('/var/lib/postgresql/data', '/var/lib/postgresql')) { Stop-Check 'UNREVIEWED_IMAGE_VOLUME' }
            $volumeArguments += @('--tmpfs', ($volume + ':rw,nosuid,nodev,noexec,size=16m,mode=1777'))
        }
    }
    [IO.File]::WriteAllBytes((Join-Path $script:evidence 'restore.sh'), [IO.File]::ReadAllBytes($restorePath))
    [IO.File]::WriteAllBytes((Join-Path $script:evidence 'checks.sql'), [IO.File]::ReadAllBytes($baselineQueryPath))
    [IO.File]::WriteAllBytes((Join-Path $script:evidence 'current-fingerprint.sql'), [IO.File]::ReadAllBytes($queryPath))
    if ($deltaEnabled) {
        Assert-InputsUnchanged
        $privateDeltaPath = Join-Path $script:evidence 'guarded-delta.sql'
        [IO.File]::WriteAllBytes($privateDeltaPath, [IO.File]::ReadAllBytes($deltaPreparation.SqlPath))
        Assert-Private $privateDeltaPath
        if ((File-Hash $privateDeltaPath) -cne $deltaSettings.PacketSha256) { Stop-Check 'PRIVATE_DELTA_COPY_HASH_MISMATCH' }
        $script:verifiedFiles += @{ path = $privateDeltaPath; bytes = (Get-Item -LiteralPath $privateDeltaPath).Length; sha256 = $deltaSettings.PacketSha256; private = $true }
    }
    $deltaCommands = if ($deltaEnabled) { Get-DeltaRehearsalScript } else { '' }
    $deltaMountArguments = @(Get-DeltaMountArguments $deltaEnabled)
    $script:runtimeOutput = Join-Path $script:evidence 'container-output'
    New-PrivateDirectory $script:runtimeOutput
    $entrypoint = @'
#!/bin/sh
set -eu
umask 077
unset PGPASSWORD PGOPTIONS PGSERVICE PGSERVICEFILE PGHOSTADDR PGSSLCERT PGSSLKEY
export PGHOST=/tmp PGPORT=5432 PGUSER=supabase_admin PGDATABASE=postgres
export PGPASSFILE=/tmp/koc-no-password-file PGCONNECT_TIMEOUT=5
trap 'pg_ctl -D /tmp/koc-restore-data -m immediate -w stop >/tmp/host-final-stop.log 2>&1 || true' EXIT
# Native TOC verification repeats the host check against the actual archive.
pg_restore --list /backup/database.dump >/tmp/host-toc.list 2>/evidence/toc.error
if test -s /evidence/toc.error || grep -Eq '^[0-9]+;.* MATERIALIZED VIEW DATA ' /tmp/host-toc.list; then exit 20; fi
set +e
/bin/sh /review/restore.sh >/evidence/restore-result.json 2>/evidence/restore-stderr.txt
code=$?
set -e
if test "$code" = 0; then
  # The unchanged restore script has cleanly stopped its local cluster. Restart
  # that SAME tmpfs cluster with the same bounded runtime, then run the parent's
  # exact SQL, which has five result columns, in CSV mode for lossless parsing.
  pg_ctl -D /tmp/koc-restore-data -l /tmp/host-server.log -o "-c listen_addresses='' -c unix_socket_directories=/tmp -c shared_preload_libraries='' -c session_preload_libraries=supautils -c supautils.privileged_role=supabase_privileged_role -c log_statement=none" -w start >/tmp/host-start.log 2>&1 || code=21
  if test "$code" = 0; then
    PGHOST=/tmp PGPORT=5432 PGUSER=supabase_admin PGDATABASE=postgres PGPASSFILE=/tmp/koc-no-password-file PGCONNECT_TIMEOUT=5 \
      psql -X -w -q -t --csv --set=ON_ERROR_STOP=1 --file=/current-fingerprint.sql >/evidence/current-fingerprint.csv 2>/evidence/current-fingerprint.error || code=22
    if test -s /evidence/current-fingerprint.error; then code=23; fi
  fi
  # OPTIONAL_DELTA_REHEARSAL
  if test "$code" = 0; then
    pg_ctl -D /tmp/koc-restore-data -m fast -w stop >/tmp/host-stop.log 2>&1 || code=24
    if test "$code" = 0; then trap - EXIT; fi
  fi
fi
# Only fixed diagnostics are retained, inside the protected private directory.
# No roles SQL, database files or backup contents are copied to host diagnostics.
for name in init.log start.log server.log bootstrap.error roles.error createdb.error restore.error checks.error metadata.error stop.log host-start.log host-server.log host-stop.log; do
  if test -f "/tmp/$name"; then cp "/tmp/$name" "/evidence/diagnostic-$name"; fi
done
exit "$code"
'@
    Write-PrivateText 'entrypoint.sh' ($entrypoint.Replace("`r`n", "`n").Replace('  # OPTIONAL_DELTA_REHEARSAL', $deltaCommands) + "`n")
    foreach ($name in @('restore.sh', 'checks.sql', 'current-fingerprint.sql')) { Assert-Private (Join-Path $script:evidence $name) }
    if ((File-Hash (Join-Path $script:evidence 'restore.sh')) -cne $pins['verify-backup-disposable-restore.sh'] -or
        (File-Hash (Join-Path $script:evidence 'checks.sql')) -cne $baselineQueryHash -or
        (File-Hash (Join-Path $script:evidence 'current-fingerprint.sql')) -cne $pins['auth-pilot-fingerprint.sql']) { Stop-Check 'PRIVATE_INPUT_COPY_HASH_MISMATCH' }
    Assert-InputsUnchanged
    $script:ownerToken = [Guid]::NewGuid().ToString('N')
    $script:containerName = 'kocmax-auth-restore-' + $script:ownerToken
    $createArguments = @('container', 'create', '--pull=never', '--name', $script:containerName,
        '--label', ('kocmax.auth-pilot-restore=' + $script:ownerToken), '--network=none', '--log-driver=none',
        '--read-only', '--user=postgres', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--pids-limit=256', '--memory=1g', '--cpus=1', '--env', 'HOME=/tmp',
        '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=2g,mode=1777',
        '--mount', "type=bind,source=$attempt,target=/backup,readonly",
        '--mount', "type=bind,source=$script:evidence/restore.sh,target=/review/restore.sh,readonly",
        '--mount', "type=bind,source=$script:evidence/checks.sql,target=/checks.sql,readonly",
        '--mount', "type=bind,source=$script:evidence/current-fingerprint.sql,target=/current-fingerprint.sql,readonly",
        '--mount', "type=bind,source=$script:evidence/entrypoint.sh,target=/review/entrypoint.sh,readonly",
        '--mount', "type=bind,source=$script:runtimeOutput,target=/evidence") + $deltaMountArguments + $volumeArguments + @('--entrypoint', '/bin/sh', $restoreImage, '/review/entrypoint.sh')
    $result.containerCleanup = 'PENDING'
    $script:createIssued = $true
    $created = Invoke-Docker $createArguments 'restore-create'
    Require-NativeSuccess $created 'LOCAL_RESTORE_CONTAINER_CREATE_FAILED'
    if ($created.Output.Trim() -cnotmatch '^[0-9a-f]{64}$') { Stop-Check 'LOCAL_RESTORE_CONTAINER_ID_INVALID' }
    $inspected = Invoke-Docker @('container', 'inspect', $script:containerName) 'restore-inspect'
    Require-NativeSuccess $inspected 'LOCAL_RESTORE_CONTAINER_INSPECT_FAILED'
    $containers = @(ConvertFrom-Json -InputObject $inspected.Output -AsHashtable -Depth 100)
    $container = $containers[0]
    if ($containers.Count -ne 1 -or $container.Id -cne $created.Output.Trim() -or
        $container.Config.Labels['kocmax.auth-pilot-restore'] -cne $script:ownerToken -or
        $container.HostConfig.NetworkMode -cne 'none' -or $container.HostConfig.LogConfig.Type -cne 'none' -or
        -not $container.HostConfig.ReadonlyRootfs -or $container.HostConfig.Privileged -or
        $container.HostConfig.PublishAllPorts -or ($null -ne $container.HostConfig.PortBindings -and $container.HostConfig.PortBindings.Count -ne 0) -or
        $container.Config.User -cne 'postgres') { Stop-Check 'LOCAL_RESTORE_ISOLATION_MISMATCH' }
    $expectedMounts = Get-ExpectedRestoreMounts $deltaEnabled
    $binds = @($container.Mounts | Where-Object { $_.Type -ceq 'bind' })
    $seenMounts = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    if ($binds.Count -ne $expectedMounts.Count -or @($container.Mounts | Where-Object { $_.Type -cnotin @('bind', 'tmpfs') }).Count -ne 0) { Stop-Check 'LOCAL_RESTORE_MOUNT_MISMATCH' }
    foreach ($mount in $binds) {
        if (@($expectedMounts.Keys) -cnotcontains $mount.Destination -or -not $seenMounts.Add($mount.Destination) -or
            $mount.RW -ne $expectedMounts[$mount.Destination]) { Stop-Check 'LOCAL_RESTORE_MOUNT_MISMATCH' }
    }
    if ($deltaEnabled) { $result.deltaRehearsal.status = 'ATTEMPTED_NOT_VERIFIED' }
    $run = Invoke-Docker @('container', 'start', '--attach', $container.Id) 'restore-run' $TimeoutSeconds
    Require-NativeSuccess $run 'DISPOSABLE_RESTORE_FAILED'
    if (-not [string]::IsNullOrWhiteSpace($run.Output)) { Stop-Check 'UNEXPECTED_RESTORE_CONSOLE_OUTPUT' }
    $stateCapture = Invoke-Docker @('container', 'inspect', $container.Id) 'restore-final-state'
    Require-NativeSuccess $stateCapture 'RESTORE_FINAL_STATE_UNAVAILABLE'
    $finalContainers = @(ConvertFrom-Json -InputObject $stateCapture.Output -AsHashtable -Depth 100)
    if ($finalContainers.Count -ne 1 -or $finalContainers[0].Id -cne $container.Id -or
        $finalContainers[0].State.Running -or $finalContainers[0].State.Status -cne 'exited' -or
        $finalContainers[0].State.ExitCode -ne 0 -or $finalContainers[0].State.OOMKilled -or
        -not [string]::IsNullOrWhiteSpace($finalContainers[0].State.Error)) { Stop-Check 'RESTORE_CONTAINER_DID_NOT_EXIT_CLEANLY' }
    $restoreResultPath = Join-Path $script:runtimeOutput 'restore-result.json'
    Assert-Private $restoreResultPath
    if ((Get-Item -LiteralPath $restoreResultPath).Length -gt 32MB) { Stop-Check 'RESTORE_RECEIPT_TOO_LARGE' }
    if ((Get-Item -LiteralPath (Join-Path $script:runtimeOutput 'restore-stderr.txt')).Length -ne 0) { Stop-Check 'RESTORE_WRAPPER_DIAGNOSTIC_REQUIRES_REVIEW' }
    $restored = Parse-Object ([IO.File]::ReadAllText($restoreResultPath)) 'INVALID_RESTORE_RECEIPT'
    if ($restored.status -cne 'RESTORE_EXECUTED_PENDING_SOURCE_COMPARISON') { Stop-Check 'DISPOSABLE_RESTORE_DID_NOT_COMPLETE' }
    $result.restore = 'EXECUTED'
    # The generic script's originalData is historical 39-table output. Never use
    # it for the current checkpoint comparison: compare the separate exact query.
    $currentPath = Join-Path $script:runtimeOutput 'current-fingerprint.csv'
    Assert-Private $currentPath
    if ((Get-Item -LiteralPath $currentPath).Length -gt 1MB) { Stop-Check 'CURRENT_FINGERPRINT_TOO_LARGE' }
    $rows = @(ConvertFrom-Csv -InputObject ([IO.File]::ReadAllText($currentPath)) -Header @('application_data', 'migration_count', 'policy_count', 'auth_table_count', 'storage_table_count'))
    if ($rows.Count -ne 1) { Stop-Check 'EXACTLY_ONE_RESTORED_FINGERPRINT_ROW_REQUIRED' }
    $row = @{}
    foreach ($property in $rows[0].PSObject.Properties) { $row[$property.Name] = $property.Value }
    $actual = Normalize-Fingerprint $row
    if ((Canonical-Json $expected) -cne (Canonical-Json $actual)) { Stop-Check 'SOURCE_RESTORE_FINGERPRINT_MISMATCH' }
    if ($restored.metadata.database -cne 'postgres' -or $restored.metadata.server_version_num -ne 170006 -or
        $restored.metadata.public_tables -ne $profileSettings.PublicTables -or
        $restored.metadata.migration_rows -ne $profileSettings.MigrationRows -or
        $restored.metadata.auth_tables -ne $actual.auth_table_count -or
        $restored.metadata.storage_tables -ne $actual.storage_table_count) { Stop-Check 'RESTORED_METADATA_MISMATCH' }
    $result.comparison = 'ALL_DECLARED_FIELDS_MATCHED_TO_SUPPLIED_BASELINE'
    $result.matchedCounts = @{ applicationTables = $actual.application_data.table_count;
        publicTables = $restored.metadata.public_tables; privateTables = $profileSettings.PrivateTables; migrationRows = $actual.migration_count;
        applicationRows = $actual.application_data.row_count; policies = $actual.policy_count;
        authTables = $restored.metadata.auth_tables; storageTables = $restored.metadata.storage_tables; eventTriggers = $restored.metadata.event_triggers }
    $result.matchedDataDigest = $actual.application_data.data_digest
    if ($deltaEnabled) {
        $firstFingerprint = Read-RuntimeFingerprint 'delta-first-fingerprint.csv'
        $replayFingerprint = Read-RuntimeFingerprint 'delta-replay-fingerprint.csv'
        $beforeState = Read-DeltaState 'delta-before.json'
        $firstState = Read-DeltaState 'delta-first.json'
        $replayState = Read-DeltaState 'delta-replay.json'
        $result.deltaRehearsal = Assert-DeltaRehearsal $actual $firstFingerprint $replayFingerprint $beforeState $firstState $replayState
    }
    $passed = $true
} catch {
    $result.failureCode = $script:failure
    $result.failureDiagnostics = Safe-FailureDetails $_
    # No exception messages, ErrorRecord/stack dumps, SQL or row values on stdout.
} finally {
    if ($script:createIssued) {
        try { Remove-OwnedContainer; $result.containerCleanup = 'CONFIRMED' }
        catch { $passed = $false; $result.containerCleanup = 'UNCONFIRMED'; $result.failureCode = 'OWN_CONTAINER_CLEANUP_UNCONFIRMED'; $result['ownedContainerToInspect'] = $script:containerName }
    }
    if ($script:verifiedFiles.Count -gt 0) {
        try { Assert-InputsUnchanged; $result.inputHashesAfter = 'UNCHANGED' }
        catch { $passed = $false; $result.inputHashesAfter = 'FAILED'; $result.failureCode = 'INPUT_CHANGED_OR_UNREADABLE_AFTER_RESTORE' }
    }
    if ($null -ne $script:evidence) {
        try {
            foreach ($file in Get-ChildItem -LiteralPath $script:evidence -Force) {
                if ($file.PSIsContainer) {
                    if ($file.FullName -cne $script:runtimeOutput) { Stop-Check 'UNEXPECTED_EVIDENCE_DIRECTORY' }
                    Assert-Private $file.FullName -Directory
                    foreach ($child in Get-ChildItem -LiteralPath $file.FullName -Force) { Assert-Private $child.FullName }
                } else { Assert-Private $file.FullName }
            }
        }
        catch { $passed = $false; $result.failureCode = 'EVIDENCE_ACL_OR_FILE_TYPE_MISMATCH' }
    }
    if ($passed) {
        $result.status = if ($deltaEnabled) { 'PHASE3_DISPOSABLE_DELTA_REPLAY_VERIFIED_AUTH_NOT_TESTED' } else { $profileSettings.SuccessStatus }
        $result.failureCode = $null
    }
    $result.finishedUtc = [DateTime]::UtcNow.ToString('o')
    if ($null -ne $script:evidence) {
        try { Write-PrivateText 'receipt.json' ($result | ConvertTo-Json -Depth 12) }
        catch {
            $passed = $false
            $result.status = if ($deltaEnabled) { 'PHASE3_DISPOSABLE_DELTA_REHEARSAL_NOT_VERIFIED' } else { $profileSettings.FailureStatus }
            $result.failureCode = 'PRIVATE_RECEIPT_WRITE_FAILED'
        }
    }
}
$result | ConvertTo-Json -Depth 12
if ($passed) { exit 0 } else { exit 1 }

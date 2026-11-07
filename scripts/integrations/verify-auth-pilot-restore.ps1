#requires -Version 7.2
<#
.SYNOPSIS
Offline host wrapper for one explicit fresh Auth-pilot restore checkpoint.
.DESCRIPTION
Runs the existing full-read verifier first, then the unchanged disposable restore
script in the installed pinned Supabase image. No remote connections, credentials,
ports, image pulls, migrations or Auth tests. Prints one sanitized JSON receipt.
See verify-auth-pilot-restore.md for the source-fingerprint input contract.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string] $AttemptDirectory,
    [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string] $SourceFingerprintPath,
    [Parameter(Mandatory)] [DateTimeOffset] $CheckpointNotBeforeUtc,
    [Nullable[DateTimeOffset]] $SourceCapturedUtc = $null,
    [ValidateRange(60, 7200)] [int] $TimeoutSeconds = 1800
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'mhkoayftiuojxlrkollf'
$dockerPipe = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$restoreImage = 'public.ecr.aws/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$verifierPath = Join-Path $PSScriptRoot 'verify-local-backup.ps1'
$restorePath = Join-Path $PSScriptRoot 'verify-backup-disposable-restore.sh'
$queryPath = Join-Path $PSScriptRoot 'auth-pilot-fingerprint.sql'
$baselineQueryPath = Join-Path $repoRoot 'docs/review/kocmax-stage-4d/d1/shared-database/execution/existing-data-fingerprint.sql'
$baselineQueryHash = 'f021185484b84b07030a1d81a2f2a8a7ba0b37282f4011b73d7432659725b009'
$pins = @{
    'verify-local-backup.ps1' = '203ed187f0e8966e987d5f6e9b0ce4d670c7425e5b09c7997857c5f48ced847c'
    'verify-backup-disposable-restore.sh' = 'f94b0c9981f32219bcb269db4aa76251bb6d54483c7a33655b470605eab7edb3'
    'auth-pilot-fingerprint.sql' = 'a1f11eb1db5dc83cd4c4a04321d191d1943fd1866a1981354e583a32f7861383'
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

function Normalize-Fingerprint($Row) {
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
    if ($normalized.application_data.table_count -ne 94 -or $normalized.migration_count -ne 15 -or
        $normalized.auth_table_count -eq 0 -or $normalized.storage_table_count -eq 0) { Stop-Check 'CURRENT_94_TABLE_15_MIGRATION_SCOPE_REQUIRED' }
    return $normalized
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
    wrapperVersion = '1-auth-pilot-current-20261101'; status = 'AUTH_PILOT_RESTORE_NOT_VERIFIED'
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
$passed = $false
try {
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
        '-AttemptDirectory', $attempt, '-TimeoutSeconds', [string]$TimeoutSeconds) -Label 'archive-verifier' -Seconds 0
    Require-NativeSuccess $fullRead 'EXISTING_ARCHIVE_VERIFIER_FAILED'
    $full = Parse-Object $fullRead.Output 'INVALID_ARCHIVE_VERIFIER_RECEIPT'
    if ($full.status -cne 'ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED' -or $full.projectRef -cne $projectRef -or
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
    Write-PrivateText 'entrypoint.sh' ($entrypoint.Replace("`r`n", "`n") + "`n")
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
        '--mount', "type=bind,source=$script:runtimeOutput,target=/evidence") + $volumeArguments + @('--entrypoint', '/bin/sh', $restoreImage, '/review/entrypoint.sh')
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
    $expectedMounts = @{ '/backup' = $false; '/checks.sql' = $false; '/current-fingerprint.sql' = $false; '/review/restore.sh' = $false; '/review/entrypoint.sh' = $false; '/evidence' = $true }
    $binds = @($container.Mounts | Where-Object { $_.Type -ceq 'bind' })
    if ($binds.Count -ne 6 -or @($container.Mounts | Where-Object { $_.Type -cnotin @('bind', 'tmpfs') }).Count -ne 0) { Stop-Check 'LOCAL_RESTORE_MOUNT_MISMATCH' }
    foreach ($mount in $binds) {
        if (-not $expectedMounts.ContainsKey($mount.Destination) -or $mount.RW -ne $expectedMounts[$mount.Destination]) { Stop-Check 'LOCAL_RESTORE_MOUNT_MISMATCH' }
    }
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
        $restored.metadata.public_tables -ne 80 -or $restored.metadata.migration_rows -ne 15 -or
        $restored.metadata.auth_tables -ne $actual.auth_table_count -or
        $restored.metadata.storage_tables -ne $actual.storage_table_count) { Stop-Check 'RESTORED_METADATA_MISMATCH' }
    $result.comparison = 'ALL_DECLARED_FIELDS_MATCHED_TO_SUPPLIED_BASELINE'
    $result.matchedCounts = @{ applicationTables = 94; publicTables = 80; privateTables = 14; migrationRows = 15;
        applicationRows = $actual.application_data.row_count; policies = $actual.policy_count;
        authTables = $restored.metadata.auth_tables; storageTables = $restored.metadata.storage_tables; eventTriggers = $restored.metadata.event_triggers }
    $result.matchedDataDigest = $actual.application_data.data_digest
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
    if ($passed) { $result.status = 'AUTH_PILOT_CURRENT_RESTORE_VERIFIED'; $result.failureCode = $null }
    $result.finishedUtc = [DateTime]::UtcNow.ToString('o')
    if ($null -ne $script:evidence) {
        try { Write-PrivateText 'receipt.json' ($result | ConvertTo-Json -Depth 12) }
        catch { $passed = $false; $result.status = 'AUTH_PILOT_RESTORE_NOT_VERIFIED'; $result.failureCode = 'PRIVATE_RECEIPT_WRITE_FAILED' }
    }
}
$result | ConvertTo-Json -Depth 12
if ($passed) { exit 0 } else { exit 1 }

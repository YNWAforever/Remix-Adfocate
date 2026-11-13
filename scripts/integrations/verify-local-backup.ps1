#requires -Version 7.2
<#
.SYNOPSIS
Read-only verification of one explicitly selected, completed local backup attempt.
.DESCRIPTION
Emits sanitized JSON only. Never prompts, reads credentials, connects to a database,
executes SQL, changes the archive/manifest, or implements a restore rehearsal.
pg_restore emits the entire unfiltered custom archive to /dev/null, offline.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string] $AttemptDirectory,
    [ValidateRange(60, 7200)] [int] $TimeoutSeconds = 1800,
    [ValidateSet('SharedDatabaseReview', 'Phase3Preparation', IgnoreCase = $false)]
    [string] $Profile = 'SharedDatabaseReview'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Get-ReviewedVerificationProfile([string] $Name) {
    switch -CaseSensitive ($Name) {
        'SharedDatabaseReview' {
            return [pscustomobject]@{
                Name = 'SharedDatabaseReview'; Branch = 'codex/kocmax-studio-stages-1-2'
                Image = 'postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232'
                HelperVersion = '3-native-readonly-20261101'
                FailureStatus = 'ARCHIVE_VERIFICATION_FAILED'
                SuccessStatus = 'ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED'
            }
        }
        'Phase3Preparation' {
            return [pscustomobject]@{
                Name = 'Phase3Preparation'; Branch = 'codex/phase3-delta-rehearsal'
                Image = 'public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108'
                TlsImage = 'node@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496'
                HelperVersion = '5-separated-tls-tools-20261113'
                FailureStatus = 'PHASE3_ARCHIVE_VERIFICATION_FAILED'
                SuccessStatus = 'PHASE3_ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED'
            }
        }
        default { throw 'Unknown reviewed verification profile; stop.' }
    }
}

$projectRef = 'mhkoayftiuojxlrkollf'
$profileSettings = Get-ReviewedVerificationProfile $Profile
$expectedBranch = $profileSettings.Branch
$toolImage = $profileSettings.Image
$dockerPipe = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$artifactNames = @('database.dump', 'roles.sql', 'toc.list')
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$script:failureCode = 'LOCAL_PRECHECK_FAILED'
$script:dockerExe = $null

function Stop-Verification([string] $Code) {
    $script:failureCode = $Code
    throw 'Verification stopped; native diagnostics and file contents are not disclosed.'
}

function Assert-VerificationBranch([string[]] $Branch, [int] $GitExitCode) {
    if ($GitExitCode -ne 0 -or $Branch.Count -ne 1 -or $Branch[0] -cne $expectedBranch) {
        Stop-Verification 'WORKTREE_BRANCH_MISMATCH'
    }
}

function Normalize-LocalPath([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path) -or
        $Path.StartsWith('\\') -or $Path -match ',') { Stop-Verification 'INVALID_LOCAL_PATH' }
    return [IO.Path]::GetFullPath($Path).Replace('/', '\').TrimEnd('\')
}

function Assert-AttemptPath([string] $Path) {
    $candidate = Normalize-LocalPath $Path
    if (-not [IO.Path]::GetDirectoryName($candidate).Equals($backupRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($candidate) -cnotmatch '^\d{8}T\d{6}Z-[0-9a-f]{32}$') {
        Stop-Verification 'ATTEMPT_OUTSIDE_EXACT_PRIVATE_ROOT'
    }
    foreach ($root in $servedRoots) {
        $normalized = Normalize-LocalPath $root
        if ($candidate.Equals($normalized, [StringComparison]::OrdinalIgnoreCase) -or
            $candidate.StartsWith($normalized + '\', [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Verification 'SERVED_ROOT_REJECTED'
        }
    }
    return $candidate
}

function Assert-NoReparse([string] $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Verification 'REPARSE_POINT_REJECTED' }
        $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
}

function Assert-PrivateAcl([string] $Path, [switch] $Directory) {
    Assert-NoReparse $Path
    $item = Get-Item -LiteralPath $Path -Force
    if ($Directory.IsPresent -ne ($item -is [IO.DirectoryInfo])) { Stop-Verification 'WRONG_FILE_TYPE' }
    $acl = Get-Acl -LiteralPath $Path
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed = @($userSid, 'S-1-5-18')
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($owner -notin $allowed -or $rules.Count -ne 2 -or
        ($Directory -and (-not $acl.AreAccessRulesProtected -or $owner -ne $userSid))) {
        Stop-Verification 'PRIVATE_ACL_REQUIRED'
    }
    foreach ($sid in $allowed) {
        $match = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
        if ($match.Count -ne 1 -or $match[0].AccessControlType -ne 'Allow' -or
            $match[0].FileSystemRights -ne 'FullControl' -or $match[0].PropagationFlags -ne 'None' -or
            ($Directory -and $match[0].InheritanceFlags -ne 'ContainerInherit,ObjectInherit')) {
            Stop-Verification 'PRIVATE_ACL_REQUIRED'
        }
    }
}

function Assert-Manifest($Manifest) {
    if ($Manifest -isnot [Collections.IDictionary]) { Stop-Verification 'INVALID_MANIFEST' }
    $expected = @{
        projectRef = $projectRef; host = 'aws-1-ap-northeast-1.pooler.supabase.com'
        user = 'postgres.mhkoayftiuojxlrkollf'; database = 'postgres'; image = $toolImage
        branch = $expectedBranch; status = 'CAPTURED_INVENTORIED_RESTORE_NOT_TESTED'
        phase = 'finished'; helperVersion = $profileSettings.HelperVersion; tls = 'verify-full'; restoreRehearsal = 'NOT_RUN'
    }
    if ($profileSettings.Name -ceq 'Phase3Preparation') {
        $expected.profile = $profileSettings.Name
        $expected.profileBranch = $expectedBranch
        $expected.tlsPreflightImage = $profileSettings.TlsImage
    }
    foreach ($key in $expected.Keys) {
        if (-not $Manifest.Contains($key) -or $Manifest[$key] -isnot [string] -or $Manifest[$key] -cne $expected[$key]) {
            Stop-Verification 'MANIFEST_IDENTITY_OR_STATUS_MISMATCH'
        }
    }
    foreach ($key in @('failureCode','activeContainer')) {
        if (-not $Manifest.Contains($key) -or $null -ne $Manifest[$key]) { Stop-Verification 'FAILED_OR_ACTIVE_CAPTURE' }
    }
    $expectedStrategy = @{
        metadata = 'explicit_read_only_transaction'
        databaseDump = 'pg_dump_17_11_native_read_only_transaction'
        rolesDump = 'pg_dumpall_17_11_catalog_select_only'
        startupOptions = 'requested_not_relied_on'
    }
    if (-not $Manifest.Contains('readOnlyStrategy') -or $Manifest.readOnlyStrategy -isnot [Collections.IDictionary] -or
        $Manifest.readOnlyStrategy.Count -ne $expectedStrategy.Count) { Stop-Verification 'MANIFEST_READONLY_STRATEGY_MISMATCH' }
    foreach ($key in $expectedStrategy.Keys) {
        if (@($Manifest.readOnlyStrategy.Keys) -cnotcontains $key -or $Manifest.readOnlyStrategy[$key] -isnot [string] -or
            $Manifest.readOnlyStrategy[$key] -cne $expectedStrategy[$key]) { Stop-Verification 'MANIFEST_READONLY_STRATEGY_MISMATCH' }
    }
    if (-not $Manifest.Contains('databaseMetadata') -or $Manifest.databaseMetadata -isnot [Collections.IDictionary]) {
        Stop-Verification 'MANIFEST_READONLY_METADATA_MISMATCH'
    }
    $metadata = $Manifest.databaseMetadata
    foreach ($key in @('transaction_read_only','row_security','default_read_only')) {
        if (-not $metadata.Contains($key) -or $metadata[$key] -isnot [string]) { Stop-Verification 'MANIFEST_READONLY_METADATA_MISMATCH' }
    }
    if ($metadata.transaction_read_only -cne 'on' -or $metadata.row_security -cne 'off' -or
        @('on','off') -cnotcontains $metadata.default_read_only) { Stop-Verification 'MANIFEST_READONLY_METADATA_MISMATCH' }
    if ($profileSettings.Name -ceq 'Phase3Preparation') {
        if (-not $Manifest.Contains('pgDumpVersion') -or $Manifest.pgDumpVersion -isnot [string] -or
            $Manifest.pgDumpVersion -cnotmatch '^pg_dump \(PostgreSQL\) 17\.11(?:\s|$)' -or
            ($metadata.server_version_num -isnot [long] -and $metadata.server_version_num -isnot [int]) -or
            $metadata.server_version_num -ne 170006 -or $metadata.database -cne 'postgres' -or
            $metadata.user -cne 'postgres' -or $metadata.session_user -cne 'postgres') {
            Stop-Verification 'PHASE3_CAPTURE_VERSION_OR_IDENTITY_MISMATCH'
        }
        if ($metadata.schemas -isnot [array] -or
            @('public','auth','storage' | Where-Object { $_ -cnotin $metadata.schemas }).Count -ne 0 -or
            $metadata.unreadable_tables -ne 0 -or $metadata.missing_schema_usage -ne 0 -or
            $metadata.foreign_tables -ne 0 -or $metadata.extra_tablespaces -ne 0) {
            Stop-Verification 'PHASE3_CAPTURE_COVERAGE_MISMATCH'
        }
    }
    if ($Manifest.port -isnot [long] -and $Manifest.port -isnot [int]) { Stop-Verification 'INVALID_MANIFEST_PORT' }
    if ($Manifest.port -ne 5432 -or $Manifest.remoteReadOnly -isnot [bool] -or -not $Manifest.remoteReadOnly -or
        $Manifest.imageId -cnotmatch '^sha256:[0-9a-f]{64}$' -or $Manifest.head -cnotmatch '^[0-9a-f]{40}$' -or
        $Manifest.scriptSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        -not (Normalize-LocalPath $Manifest.backupRoot).Equals($backupRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $Manifest.ca.fileSha256 -cne '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7' -or
        $Manifest.tlsPreflight.status -cne 'VERIFIED_CHAIN_AND_HOSTNAME_NO_AUTH' -or
        $Manifest.tlsPreflight.hostname -cne $expected.host) { Stop-Verification 'MANIFEST_GUARD_MISMATCH' }
    if ($Manifest.artifacts -isnot [array] -or $Manifest.artifacts.Count -ne 3) { Stop-Verification 'EXACT_THREE_ARTIFACTS_REQUIRED' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($artifact in $Manifest.artifacts) {
        if ($artifact -isnot [Collections.IDictionary] -or $artifact.name -isnot [string] -or
            $artifactNames -cnotcontains $artifact.name -or -not $seen.Add($artifact.name) -or
            ($artifact.bytes -isnot [long] -and $artifact.bytes -isnot [int]) -or $artifact.bytes -le 0 -or
            $artifact.sha256 -isnot [string] -or $artifact.sha256 -cnotmatch '^[0-9a-f]{64}$') {
            Stop-Verification 'INVALID_ARTIFACT_RECORD'
        }
    }
}

function Read-VerifiedSnapshot([string] $Directory) {
    $null = Assert-AttemptPath $Directory
    foreach ($path in @($privateBackupsRoot, $backupRoot, $Directory)) { Assert-PrivateAcl $path -Directory }
    $expectedFiles = @('manifest.json') + $artifactNames
    $items = @(Get-ChildItem -LiteralPath $Directory -Force)
    if ($items.Count -ne 4) { Stop-Verification 'UNEXPECTED_ATTEMPT_CONTENTS' }
    foreach ($item in $items) {
        if ($expectedFiles -cnotcontains $item.Name) { Stop-Verification 'UNEXPECTED_ATTEMPT_CONTENTS' }
        Assert-PrivateAcl $item.FullName
    }
    $manifestPath = Join-Path $Directory 'manifest.json'
    if ((Get-Item -LiteralPath $manifestPath).Length -gt 1MB) { Stop-Verification 'MANIFEST_TOO_LARGE' }
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json -AsHashtable -Depth 32
    Assert-Manifest $manifest
    $artifacts = @()
    foreach ($name in $artifactNames) {
        $record = @($manifest.artifacts | Where-Object { $_.name -ceq $name })[0]
        $path = Join-Path $Directory $name
        $size = (Get-Item -LiteralPath $path).Length
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($size -ne $record.bytes -or $hash -cne $record.sha256) { Stop-Verification 'ARTIFACT_SIZE_OR_HASH_MISMATCH' }
        $artifacts += [ordered]@{ name = $name; bytes = $size; sha256 = $hash }
    }
    if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestHash) {
        Stop-Verification 'MANIFEST_CHANGED_DURING_READ'
    }
    return [pscustomobject]@{ Manifest = $manifest; ManifestHash = $manifestHash; Artifacts = $artifacts }
}

function Invoke-LocalDocker([string[]] $Arguments, [int] $WaitSeconds = 30) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $script:dockerExe
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    foreach ($key in @($start.Environment.Keys)) {
        if ($key -match '^(PG|DOCKER_)') { [void] $start.Environment.Remove($key) }
    }
    foreach ($argument in (@('--host', $dockerPipe) + $Arguments)) { [void] $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Close()
        if (-not $process.WaitForExit($WaitSeconds * 1000)) { Stop-Verification 'LOCAL_TOOL_TIMEOUT' }
        # Never return this object to the caller's stdout or interpolate its diagnostics.
        return [pscustomobject]@{ Code = $process.ExitCode; Output = $stdout.GetAwaiter().GetResult(); Error = $stderr.GetAwaiter().GetResult() }
    } finally {
        try { if ($process.Id -and -not $process.HasExited) { $process.Kill($true); $process.WaitForExit() } } catch { }
        $process.Dispose()
    }
}

function Get-ArchiveReadArguments([string] $Directory, [string] $ContainerName) {
    return @('run', '--rm', '--pull=never', '--name', $ContainerName,
        '--network=none', '--read-only', '--log-driver=none', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=1g', '--cpus=1',
        '--mount', "type=bind,source=$Directory,target=/backup,readonly",
        '--entrypoint', 'pg_restore', $toolImage, '--no-password', '--format=custom',
        '--file=/dev/null', '/backup/database.dump')
}

$result = [ordered]@{
    verifierVersion = '2-fixed-profiles-20261113'; status = $profileSettings.FailureStatus
    profile = $profileSettings.Name; profileBranch = $expectedBranch
    projectRef = $projectRef; attempt = $null; failureCode = $null; checkedUtc = $null
    manifestSha256 = $null; captureScriptSha256 = $null; artifacts = @(); image = $toolImage
    fullArchiveRead = 'NOT_RUN'; hashesAfter = 'NOT_RUN'; containerCleanup = 'NOT_NEEDED'
    restoreTested = $false; manifestModified = $false; migrationGate = 'NOT_ASSESSED'
    coverage = @('Manifest identity/status and private ACLs', 'Three artifact sizes and SHA-256 before/after', 'Unfiltered custom-archive read/decompression to /dev/null only')
    limitations = @('No database restore or SQL execution', 'No proof of source completeness or authenticity from hashes alone', 'roles.sql and toc.list are hash-checked, not executed', 'Storage object bytes and platform configuration remain outside this backup')
}
$exitCode = 1
try {
    if (-not $IsWindows) { Stop-Verification 'WINDOWS_REQUIRED' }
    $localData = Normalize-LocalPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))
    $privateBackupsRoot = Normalize-LocalPath (Join-Path $localData 'KOCmax/PrivateBackups')
    $backupRoot = Normalize-LocalPath (Join-Path $privateBackupsRoot $projectRef)
    $servedRoots = @($repoRoot, (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) '.codex/visualizations'))
    $attempt = Assert-AttemptPath $AttemptDirectory
    $result.attempt = [IO.Path]::GetFileName($attempt)
    # Git output is retained privately; only a fixed failure code is emitted on mismatch.
    $branch = @(& git -C $repoRoot branch --show-current 2>$null)
    Assert-VerificationBranch -Branch $branch -GitExitCode $LASTEXITCODE
    $before = Read-VerifiedSnapshot $attempt
    $result.manifestSha256 = $before.ManifestHash
    $result.captureScriptSha256 = $before.Manifest.scriptSha256
    $result.artifacts = $before.Artifacts
    $script:dockerExe = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
    $engine = Invoke-LocalDocker @('info', '--format', '{{.OSType}}')
    if ($engine.Code -ne 0 -or $engine.Error.Trim() -ne '' -or $engine.Output.Trim() -cne 'linux') { Stop-Verification 'LOCAL_LINUX_DOCKER_REQUIRED' }
    $image = Invoke-LocalDocker @('image', 'inspect', '--format', '{{.Id}}', $toolImage)
    if ($image.Code -ne 0 -or $image.Error.Trim() -ne '' -or $image.Output.Trim() -cne $before.Manifest.imageId) {
        Stop-Verification 'PINNED_LOCAL_IMAGE_MISMATCH'
    }
    $container = 'kocmax-verify-' + [Guid]::NewGuid().ToString('N')
    $result.containerCleanup = 'PENDING'
    try {
        try {
            $read = Invoke-LocalDocker -Arguments (Get-ArchiveReadArguments $attempt $container) -WaitSeconds $TimeoutSeconds
            if ($read.Code -ne 0 -or $read.Error.Trim() -ne '' -or $read.Output.Trim() -ne '') { Stop-Verification 'ARCHIVE_FULL_READ_FAILED' }
            $result.fullArchiveRead = 'PASSED'
        } finally {
            $cleanup = Invoke-LocalDocker @('rm', '--force', '--volumes', $container)
            if ($cleanup.Code -ne 0 -and $cleanup.Error -notmatch 'No such container') { Stop-Verification 'OWN_CONTAINER_CLEANUP_UNCONFIRMED' }
            $result.containerCleanup = 'CONFIRMED'
        }
    } finally {
        $after = Read-VerifiedSnapshot $attempt
        if ($after.ManifestHash -cne $before.ManifestHash) { Stop-Verification 'MANIFEST_CHANGED_AFTER_READ' }
        # Both snapshots validate the exact three files against the same immutable manifest hash.
        $result.hashesAfter = 'UNCHANGED'
    }
    $result.status = $profileSettings.SuccessStatus
    $exitCode = 0
} catch {
    $result.failureCode = $script:failureCode
    if ($result.fullArchiveRead -eq 'NOT_RUN' -and $result.containerCleanup -ne 'NOT_NEEDED') { $result.fullArchiveRead = 'FAILED_OR_INTERRUPTED' }
    if ($result.containerCleanup -eq 'PENDING') { $result['ownedContainerToInspect'] = $container }
    # Do not emit $_, exception messages, native stdout/stderr, or manifest/SQL contents.
} finally {
    $result.checkedUtc = [DateTime]::UtcNow.ToString('o')
}
$result | ConvertTo-Json -Depth 6
exit $exitCode

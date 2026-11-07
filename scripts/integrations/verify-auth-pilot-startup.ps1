#requires -Version 7.2
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$reports = Join-Path $repo 'docs/review/kocmax-stage-4d/d1/auth-permission-execution'
$privateRoot = 'C:\Users\laich\AppData\Local\KOCmax\AuthPilot'
$runId = '5f694251-c6eb-4f5f-a281-25e91db81c04'
$privateRun = [IO.Path]::GetFullPath((Join-Path $privateRoot $runId))
$statusPath = Join-Path $reports 'startup-status.json'
$gatePath = Join-Path $reports 'auth-pilot-readonly-gate.json'
$worker = $null
$utf8 = [Text.UTF8Encoding]::new($false)
$launcher = Join-Path $PSScriptRoot 'open-auth-pilot.ps1'
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($launcher, [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count) { throw 'LAUNCHER_PARSE_FAILED' }
foreach ($definition in $ast.FindAll({
    param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $false)) { . ([scriptblock]::Create($definition.Extent.Text)) }

if ((& git -C $repo branch --show-current).Trim() -cne 'codex/kocmax-studio-stages-1-2' -or
    (& git -C $repo rev-parse HEAD).Trim() -cne '5c60020091e8e6fee934b61c498bf7518944c433') { throw 'CHECKOUT_MISMATCH' }
if ([IO.Path]::GetDirectoryName($privateRun) -cne $privateRoot -or
    [IO.Path]::GetFileName($privateRun) -cne $runId) { throw 'PRIVATE_TARGET_MISMATCH' }
Assert-PrivateDirectory $privateRoot
Assert-PrivateDirectory $privateRun
$children = @(Get-ChildItem -LiteralPath $privateRun -Force)
if ($children.Count -ne 1 -or $children[0].Name -cne 'control.json' -or
    $children[0].PSIsContainer -or ($children[0].Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'ONLY_ABANDONED_STARTUP_CONTROL_PERMITTED'
}
if (Test-Path -LiteralPath $statusPath) { throw 'EXISTING_STARTUP_STATUS_MUST_BE_PRESERVED' }
foreach ($name in @('runtime-receipt.json','users-created.json')) {
    if (Test-Path -LiteralPath (Join-Path $reports $name)) { throw 'ACTUAL_RUN_EVIDENCE_EXISTS' }
}
$helpers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'pwsh.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'auth-pilot-worker\.mjs|open-auth-pilot\.ps1' })
if ($helpers.Count) { throw 'EXISTING_HELPER_MUST_BE_PRESERVED' }
$listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
if (@($listeners | Where-Object Port -in 8784,8785,8786).Count) { throw 'PILOT_LISTENER_ALREADY_EXISTS' }
$gateBytes = [IO.File]::ReadAllBytes($gatePath)
$gate = [Text.Encoding]::UTF8.GetString($gateBytes) | ConvertFrom-Json
$observedAt = [DateTimeOffset]::Parse([string] $gate.observedAt)
if ($gate.projectRef -cne 'mhkoayftiuojxlrkollf' -or $gate.runId -cne $runId -or
    ([DateTimeOffset]::UtcNow - $observedAt).TotalMinutes -le 15) {
    throw 'NATURALLY_STALE_APPROVED_GATE_REQUIRED_NO_TIMESTAMP_EDIT'
}
$gateHash = (Get-FileHash -LiteralPath $gatePath -Algorithm SHA256).Hash
$control = Get-Content -LiteralPath $children[0].FullName -Raw | ConvertFrom-Json
if ($control.runId -cne $runId -or $control.origin -cne 'http://127.0.0.1:8786' -or
    $control.token -cnotmatch '^[a-f0-9]{64}$') { throw 'CONTROL_CONTRACT_MISMATCH' }
$controlHash = (Get-FileHash -LiteralPath $children[0].FullName -Algorithm SHA256).Hash
$executable = Get-PilotNodeExecutable
Assert-PilotNodeStartup $executable (Join-Path $PSScriptRoot 'auth-pilot-worker.mjs')

try {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $executable
    $info.WorkingDirectory = $repo
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $networkGuardUrl = [Uri]::new([IO.Path]::GetFullPath(
        (Join-Path $PSScriptRoot 'auth-pilot-offline-network-guard.mjs'))).AbsoluteUri
    foreach ($argument in @('--import', $networkGuardUrl,
        (Join-Path $PSScriptRoot 'auth-pilot-worker.mjs'), '--private-dir', $privateRun,
        '--public-key-file', (Join-Path $reports 'runtime-public-config.json'))) {
        $info.ArgumentList.Add($argument)
    }
    $worker = [Diagnostics.Process]::new()
    $worker.StartInfo = $info
    [void] $worker.Start()
    $stdout = $worker.StandardOutput.ReadToEndAsync()
    $stderr = $worker.StandardError.ReadToEndAsync()
    # A deliberately fake key, never a credential obtained from the user.
    $message = @{serviceKey=('sb_secret_' + ('s' * 40));controlToken=$control.token} | ConvertTo-Json -Compress
    $worker.StandardInput.WriteLine($message)
    $worker.StandardInput.Close()
    $message = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $status = $null
    while ([DateTime]::UtcNow -lt $deadline -and -not $worker.HasExited) {
        if (Test-Path -LiteralPath $statusPath) {
            $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
            break
        }
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $status -or $status.status -cne 'WAITING_PARENT_PREFLIGHT' -or
        $status.projectRef -cne 'mhkoayftiuojxlrkollf' -or $status.runId -cne $runId) {
        if ($worker.HasExited) {
            $safeDiagnostic = $stderr.GetAwaiter().GetResult().Trim() | ConvertFrom-Json
            if ($safeDiagnostic.ok -eq $false -and $safeDiagnostic.code -cmatch '^[A-Z0-9_]{1,80}$') {
                Write-Host ('SYNTHETIC_STARTUP_CODE: ' + $safeDiagnostic.code)
            }
        }
        throw 'SYNTHETIC_STARTUP_DID_NOT_REACH_PREFLIGHT_BARRIER'
    }
    if ((Get-FileHash -LiteralPath $gatePath -Algorithm SHA256).Hash -cne $gateHash) {
        throw 'READONLY_GATE_CHANGED_DURING_SYNTHETIC_STARTUP'
    }
    if (@(Get-ChildItem -LiteralPath $privateRun -Force).Count -ne 1) { throw 'UNEXPECTED_PRIVATE_RUN_WRITE' }
    $worker.Kill()
    [void] $worker.WaitForExit(5000)
    [void] $stdout.GetAwaiter().GetResult()
    [void] $stderr.GetAwaiter().GetResult()
    Move-Item -LiteralPath $statusPath -Destination (Join-Path $reports 'startup-smoke.synthetic-status.json')
    # Preserve this exact abandoned control-only directory, never overwrite it.
    $archiveName = $runId + '.startup-only-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $archive = [IO.Path]::GetFullPath((Join-Path $privateRoot $archiveName))
    if ([IO.Path]::GetDirectoryName($archive) -cne $privateRoot -or (Test-Path -LiteralPath $archive)) {
        throw 'UNSAFE_ARCHIVE_TARGET'
    }
    Rename-Item -LiteralPath $privateRun -NewName $archiveName
    Assert-PrivateDirectory $archive
    if ((Get-FileHash -LiteralPath (Join-Path $archive 'control.json') -Algorithm SHA256).Hash -cne $controlHash) {
        throw 'CONTROL_ARCHIVE_HASH_MISMATCH'
    }
    $report = [ordered]@{recordedAtUtc=[DateTime]::UtcNow.ToString('o');status='PASS_SYNTHETIC_STARTUP_ONLY';
        projectRef='mhkoayftiuojxlrkollf';runId=$runId;launcherSha256=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant();
        selectedNodePath=$executable;selectedNodeIsSinglePath=$true;actualChildProcessStarted=$true;
        stdinPipeVerified=$true;privateAclVerified=$true;checkoutVerified=$true;publicConfigVerified=$true;
        evidenceHashesVerified=$true;staleGateBarrierObserved=$true;readonlyGateUnchanged=$true;
        networkAndListenersBlockedByPreload=$true;realKeyUsed=$false;authClientsStarted=0;authAccountsCreated=0;
        runCredentialsCreated=$false;ownedChildStopped=$true;startupOnlyDirectoryPreservedAs=$archiveName;
        controlSha256=$controlHash.ToLowerInvariant();filesDeleted=0}
    [IO.File]::WriteAllText((Join-Path $reports 'launcher-worker-startup-smoke.json'),
        ($report | ConvertTo-Json -Depth 6),$utf8)
    'PASS: actual worker reached the stale-evidence barrier using synthetic input; no client, listener or network; startup-only control preserved.'
} finally {
    if ($null -ne $worker) {
        if (-not $worker.HasExited) { $worker.Kill(); [void] $worker.WaitForExit(5000) }
        $worker.Dispose()
    }
}

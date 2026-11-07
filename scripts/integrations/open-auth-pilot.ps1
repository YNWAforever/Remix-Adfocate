#requires -Version 7.2
[CmdletBinding()]
param([switch] $ValidateOnly, [switch] $CheckInputForm)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$projectRef = 'mhkoayftiuojxlrkollf'
$runId = '5f694251-c6eb-4f5f-a281-25e91db81c04'
$sqlHash = 'ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d'
$reviewDirectory = Join-Path $repoRoot 'docs/review/kocmax-stage-4d/d1/auth-permission-execution'
$workerPath = Join-Path $PSScriptRoot 'auth-pilot-worker.mjs'
$publicKeyPath = Join-Path $reviewDirectory 'runtime-public-config.json'
$receiptPath = Join-Path $reviewDirectory 'application-receipt.json'
$sqlPath = Join-Path $reviewDirectory '22-proposed-auth-boundary-apply.sql'
$privateRoot = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'KOCmax/AuthPilot'
$privateDirectory = [IO.Path]::GetFullPath((Join-Path $privateRoot $runId))
$utf8 = [Text.UTF8Encoding]::new($false)

if ((& git -C $repoRoot branch --show-current).Trim() -cne 'codex/kocmax-studio-stages-1-2') { throw 'Unexpected branch.' }
if ((Get-FileHash -LiteralPath $sqlPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sqlHash) { throw 'Approved SQL changed.' }
if ($ValidateOnly) {
    Write-Host 'VALIDATED: exact branch, approved SQL and fixed pilot target. No prompt, file write, client or network.'
    return
}
if (-not $IsWindows -or [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Use Windows PowerShell 7 -STA.' }
if (-not (Test-Path -LiteralPath $workerPath) -or -not (Test-Path -LiteralPath $publicKeyPath) -or -not (Test-Path -LiteralPath $receiptPath)) {
    throw 'Worker, public configuration or applied SQL receipt is not ready. No credential requested.'
}
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.status -cne 'APPLIED_AND_READ_ONLY_POSTCONDITIONS_PASSED' -or
    $receipt.projectRef -cne $projectRef -or $receipt.sqlSha256 -cne $sqlHash) {
    throw 'Applied SQL receipt does not match the approved pilot.'
}

function Assert-NoReparse([string] $Path) {
    # A missing leaf must not hide a junction in an existing ancestor.
    $candidate = [IO.Path]::GetFullPath($Path)
    while (-not (Test-Path -LiteralPath $candidate)) {
        $candidate = [IO.Path]::GetDirectoryName($candidate)
        if (-not $candidate) { throw 'Existing local parent required.' }
    }
    $item = Get-Item -LiteralPath $candidate -Force
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse path rejected.' }
        $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
}
function Assert-PrivateDirectory([string] $Path) {
    Assert-NoReparse $Path
    if (-not (Get-Item -LiteralPath $Path -Force).PSIsContainer) { throw 'Private path must be a directory.' }
    $acl = Get-Acl -LiteralPath $Path
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if (-not $acl.AreAccessRulesProtected -or
        $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid -or $rules.Count -ne 2) {
        throw 'Private directory must be owned by the current user and limited to the current user and SYSTEM.'
    }
    foreach ($identity in @($sid, 'S-1-5-18')) {
        $rule = @($rules | Where-Object { $_.IdentityReference.Value -ceq $identity })
        if ($rule.Count -ne 1 -or $rule[0].AccessControlType -ne 'Allow' -or
            $rule[0].FileSystemRights -ne 'FullControl' -or
            $rule[0].InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or
            $rule[0].PropagationFlags -ne 'None') {
            throw 'Private directory grants unexpected access.'
        }
    }
}
function New-PrivateDirectory([string] $Path) {
    Assert-NoReparse $Path
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($sid)
    foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (-not $item.PSIsContainer) { throw 'Private path must be a directory.' }
        $existing = Get-Acl -LiteralPath $Path
        if ($existing.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value) {
            throw 'Existing private directory belongs to another owner; no ownership change permitted.'
        }
        try {
            Assert-PrivateDirectory $Path
            return
        } catch {
            # Recover only an empty, current-user-owned leftover from failed startup.
            if (@(Get-ChildItem -LiteralPath $Path -Force).Count -ne 0) {
                throw 'Existing nonprivate directory contains files. No permissions or contents changed.'
            }
        }
        # Persist only the DACL. Generic Set-Acl may request SACL/audit privileges
        # when reapplying a new security descriptor to an already protected path.
        $accessOnly = [Security.AccessControl.DirectorySecurity]::new()
        $section = [Security.AccessControl.AccessControlSections]::Access
        $accessOnly.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($section), $section)
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path), $accessOnly)
    } else {
        # New folders are private from creation, before any credential file exists.
        [void] [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path), $acl)
    }
    Assert-PrivateDirectory $Path
}
function Get-PilotKeyInputCode([string] $Value) {
    # Shape/type check only. The worker and Supabase verify the actual credential.
    # Never return input text, decoded claims or parser diagnostics to the UI/log.
    $valueToCheck = if ($null -eq $Value) { '' } else { $Value.Trim() }
    if ($valueToCheck.Length -lt 32) { return 'SERVER_KEY_REQUIRED' }
    if ($valueToCheck -cmatch '^sb_secret_[A-Za-z0-9_-]{20,}$') { return 'OK' }
    if ($valueToCheck -cmatch '^sb_publishable_') { return 'SERVER_KEY_TYPE_INVALID' }
    $segments = $valueToCheck.Split('.')
    if ($segments.Count -ne 3 -or @($segments | Where-Object { $_ -cnotmatch '^[A-Za-z0-9_-]+$' }).Count) {
        return 'SERVER_KEY_TYPE_INVALID'
    }
    try {
        $payload = $segments[1].Replace('-','+').Replace('_','/')
        $payload += '=' * ((4 - $payload.Length % 4) % 4)
        $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        if ($claims.role -cne 'service_role' -or $claims.ref -cne 'mhkoayftiuojxlrkollf') {
            return 'SERVER_KEY_WRONG_PROJECT_OR_ROLE'
        }
        return 'OK'
    } catch { return 'SERVER_KEY_TYPE_INVALID' }
}
function Get-PilotNodeExecutable {
    # Get-Command may return several applications for an explicit .exe name.
    # A ProcessStartInfo filename must be exactly one path, never an array.
    $candidates = @(Get-Command node.exe -CommandType Application -ErrorAction Stop)
    if ($candidates.Count -lt 1) { throw 'NODE_RUNTIME_REQUIRED_BEFORE_KEY_INPUT' }
    $executable = [string] $candidates[0].Source
    if (-not $executable -or -not [IO.Path]::IsPathFullyQualified($executable) -or
        -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw 'NODE_RUNTIME_PATH_INVALID_BEFORE_KEY_INPUT'
    }
    return $executable
}
function Assert-PilotNodeStartup([string] $Executable, [string] $ScriptPath) {
    $probeInfo = [Diagnostics.ProcessStartInfo]::new()
    $probeInfo.FileName = $Executable
    $probeInfo.ArgumentList.Add('--check')
    $probeInfo.ArgumentList.Add($ScriptPath)
    $probeInfo.UseShellExecute = $false
    $probeInfo.CreateNoWindow = $true
    $probeInfo.RedirectStandardOutput = $true
    $probeInfo.RedirectStandardError = $true
    $probe = [Diagnostics.Process]::new()
    try {
        $probe.StartInfo = $probeInfo
        [void] $probe.Start()
        $probeOutput = $probe.StandardOutput.ReadToEndAsync()
        $probeError = $probe.StandardError.ReadToEndAsync()
        if (-not $probe.WaitForExit(15000)) {
            $probe.Kill()
            throw 'NODE_STARTUP_CHECK_TIMED_OUT_BEFORE_KEY_INPUT'
        }
        [void] $probeOutput.GetAwaiter().GetResult()
        [void] $probeError.GetAwaiter().GetResult()
        if ($probe.ExitCode -ne 0) { throw 'NODE_WORKER_SYNTAX_CHECK_FAILED_BEFORE_KEY_INPUT' }
    } finally { $probe.Dispose() }
}
$nodeExecutable = Get-PilotNodeExecutable
Assert-PilotNodeStartup $nodeExecutable $workerPath
Assert-NoReparse (Split-Path -Parent $privateRoot)
if (Test-Path -LiteralPath $privateDirectory) {
    throw 'This private pilot directory already exists. Inspect its receipt before resuming; no overwrite.'
}
New-PrivateDirectory $privateRoot

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dialog = [Windows.Forms.Form]::new()
$inputBox = [Windows.Forms.TextBox]::new()
$secret = [Security.SecureString]::new()
$worker = $null
$bstr = [IntPtr]::Zero
try {
    $dialog.Text = 'KOCmax - approved Auth pilot secure input v4'
    $dialog.ClientSize = [Drawing.Size]::new(680, 385)
    $dialog.StartPosition = 'CenterScreen'
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.ShowInTaskbar = $true
    $dialog.TopMost = $true
    $dialog.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Font
    $label = [Windows.Forms.Label]::new()
    $label.SetBounds(20, 15, 640, 195)
    $label.Text = "Project: Remix-Adfocate ($projectRef)`r`n`r`n請從此專案 Settings > API Keys 複製現有 server key：`r`n• service_role（Legacy API Keys）或 sb_secret_ 開頭的 secret key`r`n• 資料庫密碼、登入密碼、anon / publishable key 不適用`r`n`r`n金鑰只留在本機記憶體，用於已批准的九帳戶測試。`r`n不建立或重設金鑰；不部署、不連接 Instagram / Drive。`r`n請勿把金鑰貼到對話。"
    $inputBox.SetBounds(20, 225, 640, 28)
    $inputBox.UseSystemPasswordChar = $true
    $inputBox.AccessibleName = 'Existing Remix-Adfocate server key'
    $start = [Windows.Forms.Button]::new()
    $start.Text = 'Start local test helper'
    $start.SetBounds(350, 325, 190, 35)
    $inputError = [Windows.Forms.Label]::new()
    $inputError.SetBounds(20, 265, 640, 45)
    $inputError.ForeColor = [Drawing.Color]::Firebrick
    $inputError.AccessibleName = 'Server key input guidance'
    $keyInputCheck = ${function:Get-PilotKeyInputCode}
    $start.add_Click({
        $inputCode = & $keyInputCheck $inputBox.Text
        if ($inputCode -cne 'OK') {
            $inputError.Text = if ($inputCode -ceq 'SERVER_KEY_WRONG_PROJECT_OR_ROLE') {
                '請使用 Remix-Adfocate 專案的 service_role server key。此輸入的專案或權限類型不符。'
            } else {
                '請貼上完整的 service_role 或 sb_secret_ server key。資料庫密碼及公開 key 不適用。'
            }
            [void] $inputBox.Focus()
            $inputBox.SelectAll()
            return
        }
        $inputError.Text = ''
        $dialog.DialogResult = [Windows.Forms.DialogResult]::OK
    }.GetNewClosure())
    $cancel = [Windows.Forms.Button]::new()
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(550, 325, 110, 35)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $dialog.Controls.AddRange([Windows.Forms.Control[]]@($label, $inputBox, $inputError, $start, $cancel))
    $dialog.AcceptButton = $start
    $dialog.CancelButton = $cancel
    $dialog.add_Shown({ $dialog.Activate(); $dialog.BringToFront(); [void]$inputBox.Focus() }.GetNewClosure())
    if ($CheckInputForm) {
        # Exercise the real event handler with synthetic text; stop before key
        # capture, private run creation, process launch or any network operation.
        $dialog.Show()
        [Windows.Forms.Application]::DoEvents()
        $inputBox.Text = 'synthetic-password'
        $start.PerformClick()
        if ($dialog.DialogResult -ne [Windows.Forms.DialogResult]::None -or -not $inputError.Text) {
            throw 'Input form did not retain invalid synthetic input.'
        }
        $inputBox.Text = 'sb_secret_' + ('a' * 40)
        $start.PerformClick()
        if ($dialog.DialogResult -ne [Windows.Forms.DialogResult]::OK -or $inputError.Text) {
            throw 'Input form did not accept valid synthetic key shape.'
        }
        Write-Host 'INPUT_FORM_VERIFIED: invalid input remains editable; valid shape advances. Synthetic input only; no worker or network.'
        return
    }
    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Local input cancelled. No Auth client started.' }
    $characters = $inputBox.Text.Trim().ToCharArray()
    try { foreach ($character in $characters) { $secret.AppendChar($character) } }
    finally { [Array]::Clear($characters, 0, $characters.Length); $inputBox.Clear() }
    $secret.MakeReadOnly()
    if ($secret.Length -lt 32) { throw 'The existing server key is required; no Auth client started.' }
    if (Test-Path -LiteralPath $privateDirectory) { throw 'Private pilot directory collision. No client started.' }
    New-PrivateDirectory $privateDirectory
    $controlToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $privateDirectory 'control.json'), (@{
        origin = 'http://127.0.0.1:8786'; token = $controlToken; runId = $runId
    } | ConvertTo-Json -Compress), $utf8)
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $nodeExecutable
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @($workerPath, '--private-dir', $privateDirectory, '--public-key-file', $publicKeyPath)) {
        $startInfo.ArgumentList.Add($argument)
    }
    $worker = [Diagnostics.Process]::new()
    $worker.StartInfo = $startInfo
    [void]$worker.Start()
    $outputTask = $worker.StandardOutput.ReadToEndAsync()
    $errorTask = $worker.StandardError.ReadToEndAsync()
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $credentialMessage = @{ serviceKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr); controlToken = $controlToken } | ConvertTo-Json -Compress
    $worker.StandardInput.WriteLine($credentialMessage)
    $worker.StandardInput.Close()
    $credentialMessage = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $bstr = [IntPtr]::Zero
    $secret.Dispose(); $secret = $null
    Write-Host 'LOCAL_HELPER_STARTED: key is not written to a file or command line. Check the sanitized pilot receipt.'
    $worker.WaitForExit()
    [void]$outputTask.GetAwaiter().GetResult()
    [void]$errorTask.GetAwaiter().GetResult()
    Write-Host ('LOCAL_HELPER_EXITED: ' + $worker.ExitCode)
} finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($null -ne $secret) { $secret.Dispose() }
    $inputBox.Clear()
    $inputBox.Dispose()
    $dialog.Dispose()
    if ($null -ne $worker) { $worker.Dispose() }
}

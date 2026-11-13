#requires -Version 7.2
<#
.SYNOPSIS
Read-only logical backup of the one approved Supabase project using interactive input or Windows Credential Manager.
.DESCRIPTION
No restore, migrations, provider calls, image downloads, password reset, or .env reads.
The connection password goes from secure user input through an anonymous stdin pipe to a
short-lived container environment, never Docker arguments/configuration or a file.
Archive contents are sensitive, including Auth hashes and application secrets.
#>
[CmdletBinding()]
param(
    [string] $DbHost = 'aws-1-ap-northeast-1.pooler.supabase.com',
    [int] $DbPort = 5432,
    [string] $DbUser = 'postgres.mhkoayftiuojxlrkollf',
    [string] $Database = 'postgres',
    [string] $PostgresImage = 'postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232',
    [ValidateRange(60, 7200)] [int] $CommandTimeoutSeconds = 1800,
    [switch] $ValidateOnly,
    [switch] $GuiPrompt,
    [switch] $UseStoredCredential,
    [string] $StoredCredentialTarget = 'KOCmax/Remix-Adfocate/database',
    [switch] $ValidateStoredCredentialOnly,
    [ValidateSet('SharedDatabaseReview', 'Phase3Preparation', IgnoreCase = $false)]
    [string] $Profile = 'SharedDatabaseReview'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Get-ReviewedBackupProfile([string] $Name) {
    switch -CaseSensitive ($Name) {
        'SharedDatabaseReview' {
            return [pscustomobject]@{
                Name = 'SharedDatabaseReview'
                Branch = 'codex/kocmax-studio-stages-1-2'
                Image = 'postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232'
            }
        }
        'Phase3Preparation' {
            return [pscustomobject]@{
                Name = 'Phase3Preparation'
                Branch = 'codex/phase3-delta-rehearsal'
                Image = 'public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108'
            }
        }
        default { throw 'Unknown reviewed backup profile; stop.' }
    }
}

$projectRef = 'mhkoayftiuojxlrkollf'
$profileSettings = Get-ReviewedBackupProfile $Profile
$approvedImage = $profileSettings.Image
$approvedBranch = $profileSettings.Branch
# Preserve the original parameter default; explicit image arguments still face Assert-Target.
if (-not $PSBoundParameters.ContainsKey('PostgresImage')) { $PostgresImage = $approvedImage }
$caFile = Join-Path $PSScriptRoot 'certs/supabase-prod-ca-2021.crt'
$caFileSha256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
$caCertificateSha256 = '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa'
# An explicit local named pipe prevents DOCKER_HOST/context from choosing a remote daemon.
$dockerPipe = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$localAppDataDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppDataDirectory) -or
    -not [IO.Path]::IsPathFullyQualified($localAppDataDirectory) -or $localAppDataDirectory.StartsWith('\\')) {
    throw 'A local, absolute Windows LocalApplicationData directory is required.'
}
$privateBackupsRoot = Join-Path $localAppDataDirectory 'KOCmax/PrivateBackups'
$backupRoot = [IO.Path]::GetFullPath((Join-Path $privateBackupsRoot $projectRef))
$servedRoots = @(
    $repoRoot,
    (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) '.codex/visualizations')
)
$utf8 = [Text.UTF8Encoding]::new($false)
$script:failureCode = 'PRECHECK_FAILED'
$script:manifest = $null
$script:runDir = $null
$script:dockerExe = $null
$script:dbSecret = $null

function Read-StoredBackupSecret {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;

public static class KocmaxBackupCredentialReader
{
    private const uint CRED_TYPE_GENERIC = 1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    private static extern void CredFree(IntPtr credential);

    public static SecureString Read(string target, out string userName)
    {
        IntPtr pointer = IntPtr.Zero;
        SecureString secret = new SecureString();
        try
        {
            if (!CredRead(target, CRED_TYPE_GENERIC, 0, out pointer))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var credential = Marshal.PtrToStructure<CREDENTIAL>(pointer);
            userName = credential.UserName;
            if (credential.CredentialBlobSize % 2 != 0)
                throw new InvalidOperationException("Stored credential has an invalid Unicode length.");
            for (int offset = 0; offset < credential.CredentialBlobSize; offset += 2)
                secret.AppendChar((char)Marshal.ReadInt16(credential.CredentialBlob, offset));
            secret.MakeReadOnly();
            return secret;
        }
        catch
        {
            secret.Dispose();
            throw;
        }
        finally
        {
            if (pointer != IntPtr.Zero) CredFree(pointer);
        }
    }
}
'@
    if ($StoredCredentialTarget -cne 'KOCmax/Remix-Adfocate/database') {
        throw 'Unexpected local credential target; no credential was read.'
    }
    $storedUser = $null
    $secret = [KocmaxBackupCredentialReader]::Read($StoredCredentialTarget, [ref] $storedUser)
    if ($null -eq $secret -or $secret.Length -eq 0) {
        if ($null -ne $secret) { $secret.Dispose() }
        throw 'No usable stored credential exists; nothing connected.'
    }
    if ($storedUser -cne $DbUser) {
        $secret.Dispose()
        throw 'The stored credential user does not match the approved project role; nothing connected.'
    }
    return $secret
}

function Read-GuiBackupSecret {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $dialog = [Windows.Forms.Form]::new()
    $inputBox = [Windows.Forms.TextBox]::new()
    $secret = $null
    $characters = $null
    $handedOff = $false
    try {
        $dialog.Text = 'KOCmax - read-only local backup v3 diagnostics'
        $dialog.ClientSize = [Drawing.Size]::new(640, 405)
        $dialog.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
        $dialog.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
        $dialog.MaximizeBox = $false
        $dialog.MinimizeBox = $false
        $dialog.ShowInTaskbar = $true
        $dialog.TopMost = $true
        $dialog.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Font
        $purpose = [Windows.Forms.Label]::new()
        $purpose.SetBounds(20, 15, 600, 235)
        $purpose.Text = "Read-only database backup to private LOCAL files.`r`n`r`nProject: $projectRef`r`nHost: ${DbHost}:$DbPort`r`nUser: $DbUser`r`nDatabase: $Database`r`nDestination: $script:runDir`r`nOutside the repository and visualization roots.`r`nNo migration, remote restore, provider access or password reset."
        $label = [Windows.Forms.Label]::new()
        $label.SetBounds(20, 255, 600, 22)
        $label.Text = 'Enter the EXISTING database password (user input only):'
        $inputBox.SetBounds(20, 280, 600, 28)
        $inputBox.UseSystemPasswordChar = $true
        $inputBox.AccessibleName = 'Existing database password'
        $inputBox.TabIndex = 0
        $backupButton = [Windows.Forms.Button]::new()
        $backupButton.SetBounds(390, 340, 110, 35)
        $backupButton.Text = 'Backup'
        $backupButton.DialogResult = [Windows.Forms.DialogResult]::OK
        $backupButton.Enabled = $false
        $backupButton.TabIndex = 1
        $cancelButton = [Windows.Forms.Button]::new()
        $cancelButton.SetBounds(510, 340, 110, 35)
        $cancelButton.Text = 'Cancel'
        $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
        $cancelButton.TabIndex = 2
        $dialog.CancelButton = $cancelButton
        # No default AcceptButton: the user explicitly selects Backup.
        $inputBox.add_TextChanged({ $backupButton.Enabled = $inputBox.TextLength -gt 0 }.GetNewClosure())
        $dialog.Controls.AddRange([Windows.Forms.Control[]]@($purpose, $label, $inputBox, $backupButton, $cancelButton))
        $dialog.add_Shown({ $dialog.Activate(); $dialog.BringToFront(); [void] $inputBox.Focus() }.GetNewClosure())
        if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return $null }
        $secret = [Security.SecureString]::new()
        $characters = $inputBox.Text.ToCharArray()
        $inputBox.Clear()
        foreach ($character in $characters) { $secret.AppendChar($character) }
        $secret.MakeReadOnly()
        $handedOff = $true
        return $secret
    } finally {
        if ($null -ne $characters) { [Array]::Clear($characters, 0, $characters.Length) }
        $inputBox.Clear()
        $inputBox.Dispose()
        $dialog.Dispose()
        if (-not $handedOff -and $null -ne $secret) { $secret.Dispose() }
    }
}

function Assert-Target {
    if ($DbHost -cne 'aws-1-ap-northeast-1.pooler.supabase.com' -or
        $DbPort -ne 5432 -or $DbUser -cne "postgres.$projectRef" -or
        $Database -cne 'postgres' -or $PostgresImage -cne $approvedImage) {
        throw 'Target/image mismatch. Only the reviewed session pooler, project user, database and image digest are allowed.'
    }
}

function Assert-BackupBranch([string] $Branch, [int] $GitExitCode) {
    if ($GitExitCode -ne 0 -or $Branch -cne $approvedBranch) { throw 'Unexpected branch; stop.' }
}

function Assert-BackupInputMode([bool] $InputRedirected, [Threading.ApartmentState] $ApartmentState) {
    # Stored credentials never enter either interactive prompt path.
    if (-not $UseStoredCredential) {
        if (-not $GuiPrompt -and $InputRedirected) { throw 'Use a visible interactive console for secure input.' }
        if ($GuiPrompt -and $ApartmentState -ne [Threading.ApartmentState]::STA) {
            throw 'GUI input requires pwsh -STA. No database connection opened.'
        }
    }
}

function Assert-NoReparsePoint([string] $Path) {
    $cursor = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
    while ($null -ne $cursor) {
        if ($cursor.Exists -and ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'A backup path ancestor is a reparse point. Stop rather than redirect private data.'
        }
        $cursor = $cursor.Parent
    }
}

function Assert-OutsideServedRoots([string] $Path) {
    $candidate = [IO.Path]::GetFullPath($Path).Replace('/', '\').TrimEnd('\')
    foreach ($root in $servedRoots) {
        $normalizedRoot = [IO.Path]::GetFullPath($root).Replace('/', '\').TrimEnd('\')
        if ($candidate.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase) -or
            $candidate.StartsWith($normalizedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Backup destination must be outside the repository and all visualization roots.'
        }
    }
}

function Assert-PinnedCa {
    Assert-NoReparsePoint (Split-Path -Parent $caFile)
    $certificateFile = Get-Item -LiteralPath $caFile -Force
    if ($certificateFile.PSIsContainer -or
        ($certificateFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $certificateFile.Length -ne 1367 -or $caFile -match ',') {
        throw 'Official CA must be the approved regular file, without a reparse point or unsafe mount path.'
    }
    if ((Get-FileHash -LiteralPath $caFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $caFileSha256) {
        throw 'Official CA file hash mismatch. No credential input or new connection is permitted.'
    }
}

function Get-PrivateAcl {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl.SetOwner($owner)
    foreach ($sid in @($owner, $system)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        [void] $acl.AddAccessRule($rule)
    }
    return $acl
}

function Assert-PrivateAcl([string] $Path) {
    $acl = Get-Acl -LiteralPath $Path
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner -or $rules.Count -ne 2) {
        throw 'Backup directory ACL must be protected and limited to the current user and SYSTEM.'
    }
    foreach ($sid in @($owner, 'S-1-5-18')) {
        $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
        if ($rule.Count -ne 1 -or $rule[0].AccessControlType -ne 'Allow' -or
            $rule[0].FileSystemRights -ne 'FullControl' -or
            $rule[0].InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or
            $rule[0].PropagationFlags -ne 'None') {
            throw 'Backup ACL verification failed. No database connection will be opened.'
        }
    }
}

function New-PrivateDirectory([string] $Path) {
    Assert-NoReparsePoint $Path
    if (Test-Path -LiteralPath $Path) {
        Assert-PrivateAcl $Path
        return
    }
    # Create with the restrictive ACL, rather than creating files before locking it down.
    [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path), (Get-PrivateAcl))
    Assert-PrivateAcl $Path
}

function Assert-PrivateFiles {
    $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
    foreach ($file in Get-ChildItem -LiteralPath $script:runDir -Force -File) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected output link.' }
        $acl = Get-Acl -LiteralPath $file.FullName
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        if ($rules.Count -ne 2 -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed) {
            throw 'Output file ACL verification failed.'
        }
        foreach ($sid in $allowed) {
            $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
            if ($rule.Count -ne 1 -or $rule[0].AccessControlType -ne 'Allow' -or $rule[0].FileSystemRights -ne 'FullControl') {
                throw 'Output file grants unexpected access.'
            }
        }
    }
}

function Write-Manifest {
    $script:manifest.updatedUtc = [DateTime]::UtcNow.ToString('o')
    $temp = Join-Path $script:runDir 'manifest.json.partial'
    [IO.File]::WriteAllText($temp, ($script:manifest | ConvertTo-Json -Depth 12), $utf8)
    Move-Item -LiteralPath $temp -Destination (Join-Path $script:runDir 'manifest.json') -Force
}

function Invoke-DockerCapture {
    param([string[]] $DockerArguments, [Security.SecureString] $Secret = $null, [int] $TimeoutSeconds = 60)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $script:dockerExe
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $start.StandardInputEncoding = $utf8
    foreach ($key in @($start.Environment.Keys)) {
        if ($key -match '^(PG|DOCKER_)') { [void] $start.Environment.Remove($key) }
    }
    foreach ($argument in (@('--host', $dockerPipe) + $DockerArguments)) {
        [void] $start.ArgumentList.Add($argument)
    }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $buffer = $null
    $bstr = [IntPtr]::Zero
    try {
        # Validate the one-line stdin framing before any process/connection starts.
        if ($null -ne $Secret) {
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
            $buffer = [char[]]::new($Secret.Length)
            for ($index = 0; $index -lt $buffer.Length; $index++) {
                $buffer[$index] = [char]([Runtime.InteropServices.Marshal]::ReadInt16($bstr, $index * 2) -band 0xffff)
                if ([int]$buffer[$index] -in @(0, 10, 13)) {
                    $script:failureCode = 'CREDENTIAL_FRAMING_UNSUPPORTED'
                    throw 'Credential contains an unsupported line delimiter.'
                }
            }
        }
        [void] $process.Start()
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        if ($null -ne $buffer) {
            $process.StandardInput.Write($buffer, 0, $buffer.Length)
            $process.StandardInput.Write([char]10)
            $process.StandardInput.Flush()
        }
        $process.StandardInput.Close()
        if ($null -ne $buffer) { [Array]::Clear($buffer, 0, $buffer.Length); $buffer = $null }
        if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $bstr = [IntPtr]::Zero }
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $script:failureCode = 'COMMAND_TIMEOUT'
            throw 'Command timed out; this attempt is not a completed backup.'
        }
        return [pscustomobject]@{ Code = $process.ExitCode; Output = $output.GetAwaiter().GetResult(); Error = $errors.GetAwaiter().GetResult() }
    } finally {
        if ($null -ne $buffer) { [Array]::Clear($buffer, 0, $buffer.Length) }
        if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        try { if ($process.Id -and -not $process.HasExited) { $process.Kill($true); $process.WaitForExit() } } catch { }
        $process.Dispose()
    }
}

function Assert-CommandResult($Result, [string] $Phase) {
    if ($Result.Code -eq 0 -and [string]::IsNullOrWhiteSpace($Result.Error)) { return }
    $script:failureCode = switch -Regex ($Result.Error) {
        'certificate|sslrootcert|SSL error|TLS' { 'TLS_VERIFICATION_FAILED'; break }
        'password authentication|SASL|Tenant or user not found' { 'AUTHENTICATION_FAILED'; break }
        'permission denied|row-level security|must be superuser' { 'PRIVILEGE_OR_RLS_INCOMPLETE'; break }
        default { if ($Result.Code -eq 0) { 'WARNING_REQUIRES_REVIEW' } else { 'TOOL_FAILED' } }
    }
    # Never print or persist native stderr: it can contain schema details or sensitive values.
    throw "$Phase failed ($script:failureCode). No exclusions or weaker TLS will be attempted."
}

function Get-SafeBackupFailureDiagnostics($Record) {
    $frames = @([regex]::Matches([string]$Record.ScriptStackTrace, '(?m)^at ([^,\r\n]+),.*: line (\d+)') |
        ForEach-Object { [ordered]@{ function = $_.Groups[1].Value; line = [int]$_.Groups[2].Value } })
    return [ordered]@{
        exceptionType = $Record.Exception.GetType().FullName
        innerExceptionType = if ($null -ne $Record.Exception.InnerException) { $Record.Exception.InnerException.GetType().FullName } else { $null }
        frames = $frames
    }
}

function Assert-TlsPreflightResult($Result) {
    # s_client -brief reports successful handshake diagnostics on stderr.
    # Keep this exception confined to credential-free TLS, never pg_dump/psql.
    $diagnostics = $Result.Output + "`n" + $Result.Error
    if ($Result.Code -ne 0 -or
        $diagnostics -notmatch '(?m)^\s*CONNECTION ESTABLISHED\s*$' -or
        $diagnostics -notmatch '(?m)^\s*Verification: OK\s*$') {
        $script:failureCode = 'TLS_PREFLIGHT_VERIFICATION_FAILED'
        throw 'Credential-free TLS did not confirm the pinned CA chain and exact hostname. No password will be requested.'
    }
}

function Invoke-PgTool {
    param([string] $Tool, [string[]] $ToolArguments, [string] $Phase, [switch] $Remote, [switch] $TlsPreflight)
    if ($Remote -and $TlsPreflight) { throw 'TLS preflight cannot use the credential-bearing tool path.' }
    if ($TlsPreflight -and $Tool -cne 'openssl') { throw 'TLS preflight requires the fixed OpenSSL tool.' }
    if ($Remote -or $TlsPreflight) { Assert-PinnedCa }
    $name = 'kocmax-backup-' + [Guid]::NewGuid().ToString('N')
    $script:manifest.activeContainer = $name
    $script:manifest.phase = $Phase
    Write-Manifest
    $network = if ($Remote -or $TlsPreflight) { 'bridge' } else { 'none' }
    $arguments = @('run', '--rm', '--pull=never', '--name', $name, '--network', $network,
        '--log-driver=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--pids-limit=64', '--memory=1g', '--cpus=1', '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
        '--env', 'HOME=/tmp')
    if (-not $TlsPreflight) {
        $arguments += @('--mount', "type=bind,source=$script:runDir,target=/backup")
    }
    if ($Remote -or $TlsPreflight) {
        $arguments += @('--mount', "type=bind,source=$caFile,target=/tls/supabase-root.crt,readonly")
    }
    $secret = $null
    if ($Remote) {
        $arguments += @('-i', '--env', "PGHOST=$DbHost", '--env', "PGPORT=$DbPort",
            '--env', "PGUSER=$DbUser", '--env', "PGDATABASE=$Database", '--env', 'PGSSLMODE=verify-full',
            '--env', 'PGSSLROOTCERT=/tls/supabase-root.crt', '--env', 'PGGSSENCMODE=disable', '--env', 'PGCONNECT_TIMEOUT=15',
            '--env', 'PGPASSFILE=/dev/null', '--env', 'PGSERVICEFILE=/dev/null',
            '--env', 'PGAPPNAME=kocmax-readonly-local-backup', '--env', 'PGCLIENTENCODING=UTF8',
            # Defense-in-depth request only: the session pooler may ignore startup options.
            # Metadata and pg_dump establish their own read-only transactions; roles export is catalog-only.
            '--env', 'PGOPTIONS=-c default_transaction_read_only=on -c transaction_read_only=on -c row_security=off -c lock_timeout=5000',
            '--entrypoint', '/bin/sh', $PostgresImage, '-c',
            'set +x; IFS= read -r PGPASSWORD || exit 90; export PGPASSWORD; exec "$@" </dev/null',
            'backup-stdin', $Tool)
        $secret = $script:dbSecret
    } else {
        $arguments += @('--entrypoint', $Tool, $PostgresImage)
    }
    try {
        $timeoutSeconds = if ($TlsPreflight) { 30 } else { $CommandTimeoutSeconds }
        $result = Invoke-DockerCapture -DockerArguments ($arguments + $ToolArguments) -Secret $secret -TimeoutSeconds $timeoutSeconds
        if ($TlsPreflight) { Assert-TlsPreflightResult $result } else { Assert-CommandResult $result $Phase }
        return $result.Output
    } finally {
        # This UUID name belongs only to this attempt. Never prune volumes/images or other containers.
        $cleanup = Invoke-DockerCapture -DockerArguments @('rm', '--force', '--volumes', $name) -TimeoutSeconds 30
        if ($cleanup.Code -ne 0 -and $cleanup.Error -notmatch 'No such container') {
            $script:failureCode = 'CONTAINER_CLEANUP_UNCONFIRMED'
            throw 'Own backup container removal could not be confirmed; stop and inspect its recorded name locally.'
        }
        $script:manifest.activeContainer = $null
        Write-Manifest
    }
}

Assert-Target
if (-not $IsWindows) { throw 'This helper requires Windows PowerShell 7 with NTFS ACL support.' }
Assert-OutsideServedRoots $backupRoot
Assert-NoReparsePoint $backupRoot
Assert-PinnedCa
if ($backupRoot -match ',') { throw 'Docker bind mount source must not contain commas.' }
$branch = (& git -C $repoRoot branch --show-current).Trim()
Assert-BackupBranch -Branch $branch -GitExitCode $LASTEXITCODE
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot record current HEAD.' }
if ($ValidateOnly) {
    Write-Host 'VALIDATED: fixed target/image, pinned official CA bytes, branch, destination outside repository/visualizations, and no path reparse points. No Docker, credential input, filesystem writes or database access.'
    return
}
if ($ValidateStoredCredentialOnly) {
    if (-not $UseStoredCredential) { throw 'Stored-credential validation requires -UseStoredCredential.' }
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
        throw 'Stored-credential validation requires pwsh -STA for clipboard-safe local execution.'
    }
    $probeSecret = $null
    try {
        $probeSecret = Read-StoredBackupSecret
        Write-Host 'VALIDATED: Windows Credential Manager contains a nonempty credential for the approved project role. No Docker, network connection, database access, plaintext output or backup was performed.'
    }
    finally {
        if ($null -ne $probeSecret) { $probeSecret.Dispose(); $probeSecret = $null }
    }
    return
}
Assert-BackupInputMode -InputRedirected ([Console]::IsInputRedirected) -ApartmentState ([Threading.Thread]::CurrentThread.GetApartmentState())
$script:dockerExe = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
$engine = Invoke-DockerCapture -DockerArguments @('info', '--format', '{{.OSType}}')
Assert-CommandResult $engine 'Local Docker engine'
if ($engine.Output.Trim() -cne 'linux') { throw 'The pinned tools require the local Docker Desktop Linux engine.' }
$image = Invoke-DockerCapture -DockerArguments @('image', 'inspect', '--format', '{{.Id}}', $PostgresImage)
Assert-CommandResult $image 'Installed pinned image'
if ($image.Output.Trim() -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Pinned image identity unavailable; no pull is attempted.' }

[void] [IO.Directory]::CreateDirectory((Join-Path $localAppDataDirectory 'KOCmax'))
New-PrivateDirectory $privateBackupsRoot
New-PrivateDirectory $backupRoot
$script:runDir = Join-Path $backupRoot ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N'))
Assert-OutsideServedRoots $script:runDir
New-PrivateDirectory $script:runDir
$script:manifest = [ordered]@{
    status = 'IN_PROGRESS'; phase = 'local_precheck'; startedUtc = [DateTime]::UtcNow.ToString('o'); updatedUtc = $null
    projectRef = $projectRef; host = $DbHost; port = $DbPort; user = $DbUser; database = $Database; backupRoot = $backupRoot
    helperVersion = '4-reviewed-profiles-20261113'
    profile = $profileSettings.Name; profileBranch = $approvedBranch
    credentialSource = if ($UseStoredCredential) { 'windows_credential_manager' } else { 'interactive_prompt' }
    branch = $branch; head = $head; scriptSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    image = $PostgresImage; imageId = $image.Output.Trim(); dockerEndpoint = $dockerPipe
    tls = 'verify-full'; remoteReadOnly = $true; activeContainer = $null
    # Describes read-only effects, not a claim that every connection is server-enforced read-only.
    readOnlyStrategy = [ordered]@{
        metadata = 'explicit_read_only_transaction'
        databaseDump = 'pg_dump_17_11_native_read_only_transaction'
        rolesDump = 'pg_dumpall_17_11_catalog_select_only'
        startupOptions = 'requested_not_relied_on'
    }
    ca = [ordered]@{
        file = 'scripts/integrations/certs/supabase-prod-ca-2021.crt'; bytes = 1367
        fileSha256 = $caFileSha256; certificateSha256 = $caCertificateSha256
        dashboard = 'https://supabase.com/dashboard/project/mhkoayftiuojxlrkollf/database/settings'
        download = 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt'
        provenance = 'Parent verified the dashboard Download certificate link and downloaded through verified HTTPS.'
    }
    tlsPreflight = [ordered]@{ status = 'NOT_RUN'; hostname = $DbHost; checkedUtc = $null }
    pgDumpVersion = $null; databaseMetadata = $null; artifacts = @(); failureCode = $null; failureDiagnostics = $null
    coverage = 'One unrestricted pg_dump custom archive; separately timed roles without login passwords; native extension semantics.'
    excluded = @('Storage object bytes', 'role passwords', 'other databases', 'tablespace definitions and cluster parameter grants', 'WAL/PITR', 'platform settings and encryption root keys', 'extension binaries')
    restoreRehearsal = 'NOT_RUN'; migrationAuthorization = 'NOT_ASSESSED_BY_BACKUP'
}
Write-Manifest
try {
    $version = (Invoke-PgTool -Tool pg_dump -ToolArguments @('--version') -Phase 'tool_version').Trim()
    if ($version -notmatch '^pg_dump \(PostgreSQL\) 17\.11(?:\s|$)') { throw 'Pinned image must provide the reviewed pg_dump 17.11.' }
    $script:manifest.pgDumpVersion = $version
    $null = Invoke-PgTool -TlsPreflight -Tool openssl -ToolArguments @(
        's_client', '-starttls', 'postgres', '-connect', "${DbHost}:$DbPort",
        '-servername', $DbHost, '-verify_hostname', $DbHost, '-verify_return_error',
        '-CAfile', '/tls/supabase-root.crt', '-no-CApath', '-no-CAstore', '-brief', '-no_ign_eof'
    ) -Phase 'tls_preflight'
    $script:manifest.tlsPreflight.status = 'VERIFIED_CHAIN_AND_HOSTNAME_NO_AUTH'
    $script:manifest.tlsPreflight.checkedUtc = [DateTime]::UtcNow.ToString('o')
    $script:manifest.phase = 'awaiting_secure_credential_input'
    Write-Manifest
    Assert-PinnedCa
    Write-Host 'Ready: approved project, session pooler, reviewed read-only backup tools, verified TLS; private local files only.'
    if ($UseStoredCredential) {
        $script:dbSecret = Read-StoredBackupSecret
    } elseif ($GuiPrompt) {
        $script:dbSecret = Read-GuiBackupSecret
        if ($null -eq $script:dbSecret) {
            $script:failureCode = 'USER_CANCELLED_NO_AUTHENTICATED_CONNECTION'
            throw 'Backup cancelled by the user after credential-free TLS only.'
        }
    } else {
        $script:dbSecret = Read-Host 'Enter the EXISTING database password here (never paste into chat)' -AsSecureString
    }
    if ($script:dbSecret.Length -eq 0) { throw 'Empty credential; nothing connected.' }
    $metadataSql = @'
BEGIN READ ONLY;
SET LOCAL row_security = off;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
 'database', current_database(), 'user', current_user, 'session_user', session_user,
 'server_version_num', current_setting('server_version_num')::int,
 'default_read_only', current_setting('default_transaction_read_only'),
 'transaction_read_only', current_setting('transaction_read_only'), 'row_security', current_setting('row_security'),
 'schemas', (SELECT coalesce(json_agg(nspname ORDER BY nspname), '[]'::json) FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),
 'extensions', (SELECT coalesce(json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname), '[]'::json) FROM pg_catalog.pg_extension),
 'unreadable_tables', (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','m') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND NOT has_table_privilege(c.oid,'SELECT')),
 'unreadable_relations', (SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname)), '[]'::json) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','m') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND NOT has_table_privilege(c.oid,'SELECT')),
 'missing_schema_usage', (SELECT count(*) FROM pg_catalog.pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND NOT has_schema_privilege(n.oid,'USAGE')),
 'foreign_tables', (SELECT count(*) FROM pg_catalog.pg_foreign_table),
 'extra_tablespaces', (SELECT count(*) FROM pg_catalog.pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global'))
);
ROLLBACK;
'@
    $script:failureCode = 'READONLY_METADATA_CLIENT_OR_PIPE_FAILED'
    $metadataJson = Invoke-PgTool -Remote -Tool psql -ToolArguments @('-X', '-w', '-A', '-t', '-q', '--set=ON_ERROR_STOP=1', '--command', $metadataSql) -Phase 'readonly_metadata'
    $script:failureCode = 'READONLY_METADATA_JSON_INVALID'
    $metadata = $metadataJson | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $metadata) { throw 'Metadata JSON is empty.' }
    $script:manifest.databaseMetadata = $metadata
    if ($metadata.database -cne 'postgres' -or $metadata.user -cne 'postgres' -or $metadata.session_user -cne 'postgres' -or
        $metadata.default_read_only -cnotin @('on','off') -or $metadata.transaction_read_only -cne 'on' -or $metadata.row_security -cne 'off' -or
        $metadata.server_version_num -lt 170000 -or $metadata.server_version_num -ge 180000) {
        $script:failureCode = 'REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH'
        throw 'Remote metadata did not match the reviewed PostgreSQL 17 read-only target.'
    }
    if (@('public','auth','storage' | Where-Object { $_ -notin $metadata.schemas }).Count -ne 0 -or
        $metadata.unreadable_tables -ne 0 -or $metadata.missing_schema_usage -ne 0 -or
        $metadata.foreign_tables -ne 0 -or $metadata.extra_tablespaces -ne 0) {
        $script:failureCode = 'PRIVILEGE_OR_COVERAGE_INCOMPLETE'
        throw 'Managed-schema access or full logical coverage is incomplete; no partial fallback is allowed.'
    }
    Write-Manifest
    Write-Host 'Read-only metadata passed. Creating one database snapshot and a separate password-free role export.'
    $null = Invoke-PgTool -Remote -Tool pg_dump -ToolArguments @('-w', '--format=custom', '--create', '--lock-wait-timeout=5s', '--file=/backup/database.dump.partial') -Phase 'database_snapshot'
    $null = Invoke-PgTool -Remote -Tool pg_dumpall -ToolArguments @('-w', '--database=postgres', '--roles-only', '--no-role-passwords', '--file=/backup/roles.sql.partial') -Phase 'roles_snapshot'
    $script:dbSecret.Dispose(); $script:dbSecret = $null
    $null = Invoke-PgTool -Tool pg_restore -ToolArguments @('--list', '--file=/backup/toc.list.partial', '/backup/database.dump.partial') -Phase 'offline_inventory'
    $tocPath = Join-Path $script:runDir 'toc.list.partial'
    $toc = [IO.File]::ReadAllText($tocPath)
    foreach ($schema in @('public','auth','storage')) {
        if ($toc -notmatch "(?m)^\d+;\s+\d+\s+\d+\s+(TABLE|TABLE DATA)\s+$schema\s+") {
            $script:failureCode = 'ARCHIVE_MANAGED_SCHEMA_INVENTORY_MISSING'
            throw 'Archive inventory lacks a required managed/application schema; no completion marker will be written.'
        }
    }
    foreach ($name in @('database.dump','roles.sql','toc.list')) {
        $partial = Join-Path $script:runDir ($name + '.partial')
        if ((Get-Item -LiteralPath $partial).Length -eq 0) { throw 'An output artifact is empty.' }
        $final = Join-Path $script:runDir $name
        Move-Item -LiteralPath $partial -Destination $final
        $script:manifest.artifacts += [ordered]@{ name = $name; bytes = (Get-Item -LiteralPath $final).Length; sha256 = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    Assert-PrivateAcl $script:runDir
    Assert-PrivateFiles
    $script:manifest.status = 'CAPTURED_INVENTORIED_RESTORE_NOT_TESTED'
    $script:manifest.phase = 'finished'
    Write-Manifest
    Write-Host "Capture and inventory complete: $script:runDir"
    Write-Host 'Restore NOT TESTED. No SQL applied. Share only the status/hashes, never archive contents or credentials.'
} catch {
    $script:manifest.failureDiagnostics = Get-SafeBackupFailureDiagnostics $_
    if ($script:manifest.phase -eq 'tls_preflight') { $script:manifest.tlsPreflight.status = 'FAILED' }
    $script:manifest.status = 'FAILED_NOT_A_VERIFIED_BACKUP'
    $script:manifest.failureCode = $script:failureCode
    try { Write-Manifest } catch { }
    Write-Host "Backup stopped ($script:failureCode). Private attempt directory: $script:runDir"
    Write-Host 'Do not apply the migration on the strength of this attempt. No retry/exclusion/TLS downgrade was performed.'
    throw 'Local backup did not complete. See the private manifest status; raw server diagnostics are intentionally not printed.'
} finally {
    if ($null -ne $script:dbSecret) { $script:dbSecret.Dispose(); $script:dbSecret = $null }
}

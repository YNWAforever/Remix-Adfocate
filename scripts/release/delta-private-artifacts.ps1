#requires -Version 5.1
# Private local byte storage only. No database, credentials, network, or old backup profiles.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Create','Check','Open','Write','Seal','Read','Inspect')][string] $Action,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')][string] $AttemptId,
  [Parameter(Mandatory)][string] $RepoRoot,
  [string] $ServedRootsJson = '[]',
  [ValidateSet('database.dump','roles.sql','toc.list','manifest.json')][string] $Name = 'database.dump',
  [string] $ExpectedDirectoryId = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$stream = $null
$buffer = $null
$phase = 'initialization'
try {
  if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1') { throw 'held' }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DeltaPrivateFileIdentity {
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written; public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
  [StructLayout(LayoutKind.Sequential)] struct Security { public int Length; public IntPtr Descriptor; public int Inherit; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string path,ref Security security);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint length,uint flags);
  public static void CreateDirectory(string path,byte[] descriptor) {
    var pin=GCHandle.Alloc(descriptor,GCHandleType.Pinned);
    try { var security=new Security {Length=Marshal.SizeOf(typeof(Security)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0}; if(!CreateDirectoryW(path,ref security)) throw new IOException("held"); }
    finally {pin.Free();}
  }
  public static string Check(SafeFileHandle handle,string expected,bool directory) {
    Info info; if(!GetFileInformationByHandle(handle,out info)||(info.Attributes&0x400)!=0||(((info.Attributes&0x10)!=0)!=directory)||(!directory&&info.Links!=1)) throw new IOException("held");
    var text=new StringBuilder(32768); uint length=GetFinalPathNameByHandleW(handle,text,32768,0);
    if(length==0||length>=32768) throw new IOException("held");
    var actual=text.ToString(); if(actual.StartsWith(@"\\?\")) actual=actual.Substring(4);
    if(!String.Equals(actual,expected,StringComparison.OrdinalIgnoreCase)) throw new IOException("held");
    return info.Volume.ToString("x8")+":"+info.IndexHigh.ToString("x8")+info.IndexLow.ToString("x8");
  }
  public static string CanonicalDirectory(string path) {
    using(var handle=CreateFileW(path,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
      Info info; if(handle.IsInvalid||!GetFileInformationByHandle(handle,out info)||(info.Attributes&0x400)!=0||(info.Attributes&0x10)==0) throw new IOException("held");
      var text=new StringBuilder(32768); uint length=GetFinalPathNameByHandleW(handle,text,32768,0); if(length==0||length>=32768) throw new IOException("held");
      var actual=text.ToString(); return actual.StartsWith(@"\\?\")?actual.Substring(4):actual;
    }
  }
  public static string Directory(string path) { using(var h=CreateFileW(path,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {if(h.IsInvalid) throw new IOException("held"); return Check(h,path,true);} }
}
'@
  $phase = 'identity'
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $owner -or $owner.Value -eq 'S-1-5-18') { throw 'held' }
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $installerSid = ([Security.Principal.NTAccount]::new('NT SERVICE','TrustedInstaller')).Translate([Security.Principal.SecurityIdentifier]).Value
  $trustedAncestors = @($owner.Value,'S-1-5-18','S-1-5-32-544',$installerSid)
  function FullPath([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path) -or $Path.StartsWith('\\') -or $Path -match '[\x00-\x1f]') { throw 'held' }
    $value = [IO.Path]::GetFullPath($Path)
    if ($value.Length -gt 3) { $value = $value.TrimEnd('\') }
    if ($value -notmatch '^[A-Za-z]:\\' -or [IO.DriveInfo]::new([IO.Path]::GetPathRoot($value)).DriveType -ne 'Fixed') { throw 'held' }
    return $value
  }
  function NoReparse([string] $Path) {
    $cursor = $Path
    while ($cursor) {
      try {
        $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'held' }
      } catch [System.Management.Automation.ItemNotFoundException] { }
      $next = [IO.Path]::GetDirectoryName($cursor)
      if ($next -eq $cursor) { break }; $cursor = $next
    }
  }
  function UnsafeAncestorRule($Rule) {
    if ($Rule.AccessControlType -ne 'Allow' -or ($Rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { return $false }
    $renameRights = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
    return ($Rule.IdentityReference.Value -notin $trustedAncestors -and ($Rule.FileSystemRights -band $renameRights) -ne 0)
  }
  function CheckAncestors([string] $Path) {
    NoReparse $Path
    $chain = [Collections.Generic.List[string]]::new()
    $cursor = $Path
    while ($cursor) { $chain.Add($cursor); $cursor = [IO.Path]::GetDirectoryName($cursor) }
    for ($index = $chain.Count - 1; $index -ge 0; $index--) {
      if (-not [IO.Directory]::Exists($chain[$index])) { throw 'held' }
      $security = Get-Acl -LiteralPath $chain[$index]
      if ($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trustedAncestors) { throw 'held' }
      foreach ($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if (UnsafeAncestorRule $rule) { throw 'held' }
      }
    }
  }
  function CanonicalBoundary([string] $Path,[bool] $RequireTrustedAncestors = $false) {
    $full = FullPath $Path
    NoReparse $full
    $cursor = $full; $suffix = [Collections.Generic.Stack[string]]::new()
    while (-not [IO.Directory]::Exists($cursor)) {
      if ([IO.File]::Exists($cursor)) { throw 'held' }
      $parent = [IO.Path]::GetDirectoryName($cursor)
      if (-not $parent -or $parent -eq $cursor) { throw 'held' }
      $suffix.Push([IO.Path]::GetFileName($cursor)); $cursor = $parent
    }
    if ($RequireTrustedAncestors) { CheckAncestors $cursor }
    $canonical = [DeltaPrivateFileIdentity]::CanonicalDirectory($cursor)
    if (-not $canonical.Equals($cursor,[StringComparison]::OrdinalIgnoreCase)) { throw 'held' }
    while ($suffix.Count -gt 0) { $canonical = Join-Path $canonical $suffix.Pop() }
    return FullPath $canonical
  }
  function NewAcl([bool] $Directory) {
    if ($Directory) { $acl = [Security.AccessControl.DirectorySecurity]::new(); $flags = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
    else { $acl = [Security.AccessControl.FileSecurity]::new(); $flags = [Security.AccessControl.InheritanceFlags]::None }
    $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($owner)
    foreach ($sid in @($owner,$system)) {
      [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
    }
    return $acl
  }
  function CheckAcl($Acl,[bool] $Directory) {
    $rules = @($Acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if (-not $Acl.AreAccessRulesProtected -or $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value -or $rules.Count -ne 2) { throw 'held' }
    $flags = [Security.AccessControl.InheritanceFlags]::None
    if ($Directory) { $flags = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
    foreach ($sid in @($owner.Value,$system.Value)) {
      $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
      if ($rule.Count -ne 1 -or $rule[0].AccessControlType -ne 'Allow' -or $rule[0].FileSystemRights -ne 'FullControl' -or $rule[0].InheritanceFlags -ne $flags -or $rule[0].PropagationFlags -ne 'None' -or $rule[0].IsInherited) { throw 'held' }
    }
  }
  function CheckDirectory([string] $Path) {
    CheckAncestors $Path
    if (-not [IO.Directory]::Exists($Path)) { throw 'held' }
    CheckAcl (Get-Acl -LiteralPath $Path) $true
    return [DeltaPrivateFileIdentity]::Directory($Path)
  }
  function EnsureDirectory([string] $Path) {
    NoReparse $Path
    if (-not [IO.Directory]::Exists($Path)) { [DeltaPrivateFileIdentity]::CreateDirectory($Path,(NewAcl $true).GetSecurityDescriptorBinaryForm()) }
    [void](CheckDirectory $Path)
  }
  $phase = 'fixed-root-local'
  $local = CanonicalBoundary ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) $true
  $phase = 'fixed-root-home'
  $userHome = CanonicalBoundary ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) $true
  $phase = 'anchor'
  NoReparse $local
  $anchorAcl = Get-Acl -LiteralPath $local
  if ($anchorAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'held' }
  $anchorWriters = @($owner.Value,'S-1-5-18','S-1-5-32-544')
  $writeRights = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  foreach ($rule in $anchorAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $writeRights) -ne 0 -and $rule.IdentityReference.Value -notin $anchorWriters) { throw 'held' }
  }
  $privateRoot = Join-Path $local 'KOCmaxPrivatePairedRecovery'
  $projectRoot = Join-Path $privateRoot 'mhkoayftiuojxlrkollf'
  $directory = FullPath (Join-Path $projectRoot $AttemptId)
  $phase = 'served-roots'
  $served = @((FullPath $RepoRoot),(Join-Path $userHome '.codex\visualizations'),(Join-Path $userHome '.dsh\visualizations'))
  $additionalRoots = ConvertFrom-Json -InputObject $ServedRootsJson
  foreach ($additional in $additionalRoots) { $served += [string]$additional }
  foreach ($root in $served) {
    $bound = CanonicalBoundary ([string]$root)
    if ($directory.Equals($bound,[StringComparison]::OrdinalIgnoreCase) -or $directory.StartsWith($bound+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'held' }
  }
  $phase = 'private-parent'
  EnsureDirectory $privateRoot; EnsureDirectory $projectRoot
  $phase = 'attempt'
  if ($Action -eq 'Create') { [DeltaPrivateFileIdentity]::CreateDirectory($directory,(NewAcl $true).GetSecurityDescriptorBinaryForm()) }
  $identity = CheckDirectory $directory
  if ($Action -ne 'Create' -and $Action -ne 'Open' -and $identity -cne $ExpectedDirectoryId) { throw 'held' }
  $allowed = @('database.dump','roles.sql','toc.list','manifest.json')
  $inventory = @(Get-ChildItem -LiteralPath $directory -Force)
  foreach ($item in $inventory) {
    if ($item.PSIsContainer -or $item.Name -cnotin $allowed -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'held' }
  }
  if ($Action -eq 'Open' -and ($inventory.Count -ne 4 -or @($inventory | Where-Object Name -eq 'manifest.json').Count -ne 1)) { throw 'held' }
  if ($Action -eq 'Create' -or $Action -eq 'Check' -or $Action -eq 'Open') {
    [Console]::Out.Write((@{directory=$directory;identity=$identity;inventory=@($inventory | ForEach-Object { $_.Name })} | ConvertTo-Json -Compress)); exit 0
  }
  if (($Action -eq 'Write' -or $Action -eq 'Seal') -and [IO.File]::Exists((Join-Path $directory 'manifest.json'))) { throw 'held' }
  if ($Action -eq 'Seal' -and $inventory.Count -ne 3) { throw 'held' }
  if (($Action -eq 'Write' -and $Name -eq 'manifest.json') -or ($Action -eq 'Seal' -and $Name -ne 'manifest.json')) { throw 'held' }
  $phase = 'private-file'
  $path = FullPath (Join-Path $directory $Name); NoReparse $path
  if ($Action -eq 'Write' -or $Action -eq 'Seal') {
    $stream = [IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,81920,[IO.FileOptions]::WriteThrough,(NewAcl $false))
  } else { $stream = [IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None) }
  CheckAcl ($stream.GetAccessControl()) $false
  [void][DeltaPrivateFileIdentity]::Check($stream.SafeFileHandle,$path,$false)
  $buffer = New-Object byte[] 81920
  if ($Action -eq 'Write' -or $Action -eq 'Seal') {
    $inputStream = [Console]::OpenStandardInput(); [long]$total = 0
    while (($count = $inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
      $total += $count; if ($total -gt 268435456) { throw 'held' }; $stream.Write($buffer,0,$count); [Array]::Clear($buffer,0,$buffer.Length)
    }
    if ($total -lt 1) { throw 'held' }; $stream.Flush($true); $stream.Position = 0
  }
  if ($stream.Length -lt 1 -or $stream.Length -gt 268435456) { throw 'held' }
  if ($Action -eq 'Read') {
    $outputStream = [Console]::OpenStandardOutput()
    while (($count = $stream.Read($buffer,0,$buffer.Length)) -gt 0) { $outputStream.Write($buffer,0,$count); [Array]::Clear($buffer,0,$buffer.Length) }
    $outputStream.Flush()
  } else {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
    if ((CheckDirectory $directory) -cne $identity) { throw 'held' }
    CheckAcl ($stream.GetAccessControl()) $false; [void][DeltaPrivateFileIdentity]::Check($stream.SafeFileHandle,$path,$false)
    [Console]::Out.Write((@{name=$Name;bytes=$stream.Length;sha256=$digest} | ConvertTo-Json -Compress))
  }
  if ((CheckDirectory $directory) -cne $identity) { throw 'held' }
  CheckAcl ($stream.GetAccessControl()) $false
  [void][DeltaPrivateFileIdentity]::Check($stream.SafeFileHandle,$path,$false)
  $stream.Dispose(); $stream = $null
  exit 0
} catch {
  [Console]::Error.Write('private artifact operation held: '+$phase); exit 1
} finally {
  if ($null -ne $buffer) { [Array]::Clear($buffer,0,$buffer.Length) }
  if ($null -ne $stream) { $stream.Dispose() }
}

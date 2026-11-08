#requires -Version 7.2
[CmdletBinding()]
param([string] $ReportPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'These tests exercise real Windows filesystem permissions.' }

# Import only function definitions: never execute the launcher's input form or worker.
$parseErrors = $null
$tokens = $null
$launcherPath = Join-Path $PSScriptRoot 'open-auth-pilot.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($launcherPath, [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count) { throw 'Launcher parse failed.' }
foreach ($definition in $ast.FindAll({
    param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}

$cacheRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../node_modules/.cache'))
[void] [IO.Directory]::CreateDirectory($cacheRoot)
$testRoot = Join-Path $cacheRoot ('auth-pilot-acl-test-' + [guid]::NewGuid().ToString('N'))
[void] [IO.Directory]::CreateDirectory($testRoot)
$junctions = [Collections.Generic.List[string]]::new()
$results = [Collections.Generic.List[object]]::new()
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Assert-Condition([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}
function Assert-ExactPrivateAcl([string] $Path, [switch] $File) {
    $acl = Get-Acl -LiteralPath $Path
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    Assert-Condition ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $currentSid) 'Owner changed.'
    Assert-Condition ($rules.Count -eq 2) 'Expected exactly current user and SYSTEM.'
    if (-not $File) { Assert-Condition $acl.AreAccessRulesProtected 'Inherited directory access was not disabled.' }
    foreach ($identity in @($currentSid, 'S-1-5-18')) {
        $rule = @($rules | Where-Object { $_.IdentityReference.Value -ceq $identity })
        Assert-Condition ($rule.Count -eq 1) 'Unexpected principal.'
        Assert-Condition ($rule[0].AccessControlType -eq 'Allow' -and
            $rule[0].FileSystemRights -eq 'FullControl' -and
            $rule[0].PropagationFlags -eq 'None') 'Unexpected access rights.'
        if (-not $File) {
            Assert-Condition ($rule[0].InheritanceFlags -eq 'ContainerInherit,ObjectInherit') 'Missing inheritance to private files.'
        }
    }
}
function Invoke-Case([string] $Name, [scriptblock] $Body) {
    try {
        & $Body
        $results.Add([pscustomobject]@{ name = $Name; status = 'PASS' })
    } catch {
        $results.Add([pscustomobject]@{ name = $Name; status = 'FAIL'; error = $_.Exception.Message })
    }
}
function Assert-RejectedWithoutMutation([string] $Path) {
    $before = (Get-Acl -LiteralPath $Path).Sddl
    $rejected = $false
    try { New-PrivateDirectory $Path } catch { $rejected = $true }
    Assert-Condition $rejected 'Unsafe existing path was accepted.'
    Assert-Condition ((Get-Acl -LiteralPath $Path).Sddl -ceq $before) 'Rejected path permissions were changed.'
}

try {
    Invoke-Case 'new directory and file are private without audit privileges' {
        $path = Join-Path $testRoot 'new'
        New-PrivateDirectory $path
        Assert-ExactPrivateAcl $path
        $file = Join-Path $path 'synthetic.txt'
        [IO.File]::WriteAllText($file, 'synthetic only')
        Assert-ExactPrivateAcl $file -File
    }
    Invoke-Case 'populated private root can be reused without rewriting ACL or contents' {
        $path = Join-Path $testRoot 'new'
        $before = (Get-Acl -LiteralPath $path).Sddl
        New-PrivateDirectory $path
        Assert-ExactPrivateAcl $path
        Assert-Condition ((Get-Acl -LiteralPath $path).Sddl -ceq $before) 'Private root ACL was rewritten.'
        Assert-Condition ([IO.File]::ReadAllText((Join-Path $path 'synthetic.txt')) -ceq 'synthetic only') 'Existing file changed.'
    }
    Invoke-Case 'empty current-user leftover is repaired and reverified' {
        $path = Join-Path $testRoot 'empty-leftover'
        [void] [IO.Directory]::CreateDirectory($path)
        New-PrivateDirectory $path
        Assert-ExactPrivateAcl $path
    }
    Invoke-Case 'populated nonprivate directory is refused without mutation' {
        $path = Join-Path $testRoot 'populated-unsafe'
        [void] [IO.Directory]::CreateDirectory($path)
        [IO.File]::WriteAllText((Join-Path $path 'preserve.txt'), 'preserve')
        Assert-RejectedWithoutMutation $path
        Assert-Condition ([IO.File]::ReadAllText((Join-Path $path 'preserve.txt')) -ceq 'preserve') 'Existing content changed.'
    }
    Invoke-Case 'regular file is refused without mutation' {
        $path = Join-Path $testRoot 'regular-file'
        [IO.File]::WriteAllText($path, 'preserve')
        Assert-RejectedWithoutMutation $path
    }
    Invoke-Case 'direct junction is rejected without touching its target' {
        $target = Join-Path $testRoot 'junction-target'
        [void] [IO.Directory]::CreateDirectory($target)
        $link = Join-Path $testRoot 'junction'
        [void] (New-Item -ItemType Junction -Path $link -Target $target)
        $junctions.Add($link)
        Assert-RejectedWithoutMutation $link
    }
    Invoke-Case 'nonexistent descendant under a junction is rejected before creation' {
        $path = Join-Path $testRoot 'junction/missing/child'
        $rejected = $false
        try { New-PrivateDirectory $path } catch { $rejected = $true }
        Assert-Condition $rejected 'Junction ancestor of nonexistent path was accepted.'
        Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $testRoot 'junction-target/missing'))) 'Rejected path was created.'
    }
    Invoke-Case 'short password-like input is rejected before closing the form' {
        Assert-Condition ((Get-PilotKeyInputCode 'synthetic-password') -ceq 'SERVER_KEY_REQUIRED') 'Short input was accepted.'
    }
    Invoke-Case 'publishable key is refused for server use' {
        Assert-Condition ((Get-PilotKeyInputCode ('sb_publishable_' + ('a' * 40))) -ceq 'SERVER_KEY_TYPE_INVALID') 'Public key was accepted.'
    }
    Invoke-Case 'modern secret-key shape is accepted for later server verification' {
        Assert-Condition ((Get-PilotKeyInputCode ('sb_secret_' + ('a' * 40))) -ceq 'OK') 'Secret-key shape was rejected.'
    }
    foreach ($fixture in @(
        @{ role='service_role'; ref='mhkoayftiuojxlrkollf'; expected='OK'; name='legacy server-key shape accepted for later verification' },
        @{ role='anon'; ref='mhkoayftiuojxlrkollf'; expected='SERVER_KEY_WRONG_PROJECT_OR_ROLE'; name='legacy anon key refused' },
        @{ role='service_role'; ref='different-project'; expected='SERVER_KEY_WRONG_PROJECT_OR_ROLE'; name='legacy other-project key refused' }
    )) {
        $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(
            (@{role=$fixture.role;ref=$fixture.ref} | ConvertTo-Json -Compress))).TrimEnd('=').Replace('+','-').Replace('/','_')
        $syntheticKey = 'eyJhbGciOiJIUzI1NiJ9.' + $payload + '.' + ('a' * 43)
        Invoke-Case $fixture.name {
            Assert-Condition ((Get-PilotKeyInputCode $syntheticKey) -ceq $fixture.expected) 'Incorrect role/project decision.'
        }
    }
    Invoke-Case 'malformed token returns an allowlisted code without echoing input' {
        Assert-Condition ((Get-PilotKeyInputCode ('bad.' + ('a' * 40) + '.bad')) -ceq 'SERVER_KEY_TYPE_INVALID') 'Malformed input was accepted.'
    }
    Invoke-Case 'multiple Node installations resolve to one runnable executable' {
        $executable = Get-PilotNodeExecutable
        Assert-Condition ($executable -is [string] -and (Test-Path -LiteralPath $executable -PathType Leaf)) 'Expected one existing executable path.'
        $probe = [Diagnostics.ProcessStartInfo]::new()
        $probe.FileName = $executable
        $probe.ArgumentList.Add('--version')
        $probe.UseShellExecute = $false
        $probe.CreateNoWindow = $true
        $probe.RedirectStandardOutput = $true
        $probe.RedirectStandardError = $true
        $process = [Diagnostics.Process]::new()
        try {
            $process.StartInfo = $probe
            [void] $process.Start()
            $output = $process.StandardOutput.ReadToEnd()
            $diagnostic = $process.StandardError.ReadToEnd()
            Assert-Condition ($process.WaitForExit(10000) -and $process.ExitCode -eq 0 -and
                $output.Trim() -match '^v[0-9]+\.[0-9]+\.[0-9]+$' -and -not $diagnostic.Trim()) 'Selected Node runtime did not start.'
        } finally { $process.Dispose() }
    }
} finally {
    # Only remove this invocation's synthetic paths, and unlink junctions first.
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedRoot.StartsWith($cacheRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedRoot) -notmatch '^auth-pilot-acl-test-[a-f0-9]{32}$') {
        throw 'Unsafe test cleanup target.'
    }
    foreach ($link in $junctions) { Remove-Item -LiteralPath $link -Force }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}
$report = [ordered]@{
    recordedAtUtc = [DateTime]::UtcNow.ToString('o')
    launcherSha256 = (Get-FileHash -LiteralPath $launcherPath -Algorithm SHA256).Hash.ToLowerInvariant()
    elevated = ([Security.Principal.WindowsPrincipal]::new(
        [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    cases = @($results.ToArray())
    passed = @($results | Where-Object status -eq 'PASS').Count
    failed = @($results | Where-Object status -eq 'FAIL').Count
    syntheticPathsCleaned = -not (Test-Path -LiteralPath $testRoot)
    networkCalls = 0
    credentialInput = $false
}
$json = $report | ConvertTo-Json -Depth 6
if ($ReportPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath), $json, [Text.UTF8Encoding]::new($false)) }
$json
if ($report.failed) { exit 1 }

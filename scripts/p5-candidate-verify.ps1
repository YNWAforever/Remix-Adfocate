param(
  [Parameter(Mandatory)][ValidateSet('full','browser','tcp','builds','checks','focused','sql')][string]$Group
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$p5Review = 'docs/review/kocmax-controlled-pilot'
$p5Core = Get-Content -LiteralPath "$p5Review/p5-candidate-core.json" -Raw | ConvertFrom-Json
if ($p5Core.candidateId -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid frozen candidate fingerprint' }
$p5Evidence = '.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-freeze-' + $p5Core.candidateId.Substring(0,16)
$null = New-Item -ItemType Directory -Force -Path "$p5Evidence/tmp"
$env:TMP = (Resolve-Path -LiteralPath "$p5Evidence/tmp").Path
$env:TEMP = $env:TMP
$env:TMPDIR = $env:TMP
$env:RUN_INTEGRATION = '0'
$env:RUN_AUDIT_INTEGRATION = '0'
$env:P5_DEV_API_TCP = '0'
$env:CI = 'true'
$env:FORCE_COLOR = '0'
$env:NO_COLOR = '1'
$p5Failed = [System.Collections.Generic.List[string]]::new()

function Read-P5Fingerprint {
  $p5Actual = & node --experimental-strip-types --input-type=module -e 'import {buildCandidateCore} from "./scripts/integrations/pilotCandidateCore.ts"; console.log((await buildCandidateCore(process.cwd())).candidateId);'
  if ($LASTEXITCODE -ne 0 -or $p5Actual -ne $p5Core.candidateId) { throw 'Frozen candidate fingerprint changed' }
  return $p5Actual
}

function Invoke-P5Evidence {
  param([string]$Name,[string]$Kind,[string]$Environment,[string]$Executable,[string[]]$ArgsList,[string]$Note = '')
  $p5Before = Read-P5Fingerprint
  $p5Started = [DateTimeOffset]::UtcNow.ToString('o')
  $p5Log = "$p5Evidence/$Name.log"
  & $Executable @ArgsList *> $p5Log
  $p5Rc = $LASTEXITCODE
  $p5Finished = [DateTimeOffset]::UtcNow.ToString('o')
  $p5After = Read-P5Fingerprint
  $p5Run = [ordered]@{
    candidateId = $p5Before
    completedCandidateId = $p5After
    kind = $Kind
    command = (("$Executable " + ($ArgsList -join ' ')).Trim() + $Note)
    environment = $Environment
    startedAt = $p5Started
    completedAt = $p5Finished
    exitCode = $p5Rc
    logPath = $p5Log
    logSha256 = (Get-FileHash -LiteralPath $p5Log -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  @{ candidateId = $p5Core.candidateId; run = $p5Run } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$p5Evidence/$Name.run.json" -Encoding utf8
  Write-Host "$Name : exit $p5Rc"
  Get-Content -LiteralPath $p5Log -Tail 8
  if ($p5Rc -ne 0) { $p5Failed.Add($Name) }
}

$p5Vitest = @('node_modules/vitest/vitest.mjs','run')
$p5Serial = @('--maxWorkers=1','--minWorkers=1','--reporter=dot')
$p5Transport = @('server/devApi.test.ts','server/devApi.transport.test.ts')

switch ($Group) {
  'full' {
    Invoke-P5Evidence 'full-suite' 'test' 'offline' 'node' ($p5Vitest + @('--maxWorkers=2','--minWorkers=1','--reporter=dot')) ' [offline: integration and TCP opt-ins off]'
  }
  'browser' {
    Invoke-P5Evidence 'browser' 'browser' 'local-browser' 'node' @('scripts/p5-candidate-browser.mjs') ' [isolated fixture build; Chrome; all network requests intercepted]'
    Copy-Item -LiteralPath '.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-browser-results.json' -Destination "$p5Evidence/browser-results.json"
  }
  'tcp' {
    $env:P5_DEV_API_TCP = '1'
    Invoke-P5Evidence 'tcp-loopback' 'test' 'offline' 'node' ($p5Vitest + $p5Transport + $p5Serial) ' [P5_DEV_API_TCP=1; 127.0.0.1 only]'
  }
  'focused' {
    Invoke-P5Evidence 'focused' 'test' 'offline' 'node' ($p5Vitest + @(
      'scripts/integrations/pilotCandidateCore.test.ts','scripts/integrations/pilotCandidateEvidence.test.ts',
      'scripts/integrations/pilotCandidateCli.test.ts','scripts/integrations/pilotGateLedger.test.ts'
    ) + $p5Transport + $p5Serial) ' [real Node HTTP client/server over paired streams; no socket]'
  }
  'sql' {
    Invoke-P5Evidence 'sql-inventory' 'inventory' 'pglite' 'node' ($p5Vitest + @(
      'server/test/controlled-pilot-native-bundle.test.ts','server/test/controlled-pilot-provider-schema.test.ts',
      'server/test/creator-growth-rollback.test.ts','server/test/creator-growth-publish-schema.test.ts',
      'server/test/integrations-sql.test.ts'
    ) + $p5Serial)
  }
  'checks' {
    Invoke-P5Evidence 'types' 'typecheck' 'offline' 'npm.cmd' @('run','type-check')
    $p5TsConfig = "$p5Evidence/tmp/verification-tsconfig.json"
    $p5Inputs = @('vite.p5-candidate.config.ts','playwright.p5-candidate.config.ts','e2e/p5-candidate-freeze.spec.ts','scripts/integrations/pilotCandidateCli.ts')
    @{
      extends = (Resolve-Path -LiteralPath 'tsconfig.json').Path
      include = @($p5Inputs | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $p5TsConfig -Encoding utf8
    Invoke-P5Evidence 'verification-types' 'typecheck' 'offline' 'node' @('node_modules/typescript/bin/tsc','--project',$p5TsConfig,'--noEmit')
    Invoke-P5Evidence 'lint' 'lint' 'offline' 'npm.cmd' @('run','lint')
    Invoke-P5Evidence 'diff-check' 'inventory' 'offline' 'git' @('diff','--check')
  }
  'builds' {
    foreach ($p5Name in [Environment]::GetEnvironmentVariables().Keys) {
      if ($p5Name -like 'VITE_*') { [Environment]::SetEnvironmentVariable($p5Name, $null, 'Process') }
    }
    $env:VITE_SUPABASE_URL = 'https://example.invalid'
    $env:VITE_SUPABASE_ANON_KEY = 'offline-build-placeholder'
    $env:VITE_STUDIO_FIXTURE = 'false'
    $env:VITE_PUBLIC_MISSION_PREVIEW = 'false'
    foreach ($p5Build in @('default','studio')) {
      $p5Flag = if ($p5Build -eq 'studio') { 'true' } else { 'false' }
      $env:VITE_STUDIO_SHELL = $p5Flag
      $env:VITE_STUDIO_THREADS = $p5Flag
      $p5Dist = "$p5Evidence/build-$p5Build"
      Invoke-P5Evidence "build-$p5Build" 'build' 'offline' 'npm.cmd' @('run','build','--','--outDir',$p5Dist) " [Studio shell/threads=$p5Flag; fixtures off; placeholder config]"
      Invoke-P5Evidence "markers-$p5Build" 'inventory' 'offline' 'node' @('scripts/integrations/p5CandidateScan.mjs',"$p5Dist/assets")
    }
  }
}
if ($p5Failed.Count) { exit 1 }

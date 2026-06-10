# Pack Windows installer after `npm run build` (from WSL or Windows).
# Uses Windows Node on the JS cli — works with node_modules installed in WSL.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$nodeCandidates = @(
  'C:\Program Files\nodejs\node.exe',
  "$env:ProgramFiles\nodejs\node.exe",
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
)

$nodeExe = $null
foreach ($candidate in $nodeCandidates) {
  if (Test-Path $candidate) {
    $nodeExe = $candidate
    break
  }
}

if (-not $nodeExe) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $nodeExe = $nodeCmd.Source
  }
}

if (-not $nodeExe) {
  Write-Error 'Windows Node.js not found. Install from https://nodejs.org or fix PATH.'
}

$cli = Join-Path $root 'node_modules\electron-builder\cli.js'
if (-not (Test-Path $cli)) {
  Write-Error "Missing $cli. Run npm install in WSL first."
}

if (-not (Test-Path (Join-Path $root 'out\main\index.js'))) {
  Write-Error 'Missing out/main/index.js. Run npm run build in WSL first.'
}

# Embed app icon via rcedit without requiring a code-signing certificate.
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Host "Packing Windows installer with $nodeExe ..."
& $nodeExe $cli --win @args
exit $LASTEXITCODE

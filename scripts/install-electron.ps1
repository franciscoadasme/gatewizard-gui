# Install Electron binary on Windows (download + extract + path.txt).
# Run from the gatewizard-gui folder:
#   powershell -ExecutionPolicy Bypass -File scripts\install-electron.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$electronDir = Join-Path $root 'node_modules\electron'
$pkg = Get-Content (Join-Path $electronDir 'package.json') | ConvertFrom-Json
$version = $pkg.version
$file = "electron-v$version-win32-x64.zip"
$url = "https://github.com/electron/electron/releases/download/v$version/$file"
$cacheDir = Join-Path $env:LOCALAPPDATA 'gatewizard-gui-electron'
$zip = Join-Path $cacheDir $file
$dist = Join-Path $electronDir 'dist'
$pathFile = Join-Path $electronDir 'path.txt'
$exe = Join-Path $dist 'electron.exe'

if ((Test-Path $exe) -and (Test-Path $pathFile) -and ((Get-Content $pathFile -Raw).Trim() -eq 'electron.exe')) {
  Write-Host "[install-electron] Already installed: $exe"
  exit 0
}

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if ((Test-Path $zip) -and ((Get-Item $zip).Length -gt 100MB)) {
  Write-Host "[install-electron] Using cached zip: $zip"
} else {
  Write-Host "[install-electron] Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Write-Host "[install-electron] Download complete ($([math]::Round((Get-Item $zip).Length / 1MB)) MB)"
}

if (Test-Path $dist) {
  Write-Host "[install-electron] Removing old dist folder..."
  Remove-Item -Recurse -Force $dist
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Write-Host "[install-electron] Extracting to $dist ..."
Expand-Archive -Path $zip -DestinationPath $dist -Force
Write-Host "[install-electron] Extract complete."

Set-Content -Path $pathFile -Value 'electron.exe' -NoNewline

if (-not (Test-Path $exe)) {
  throw "electron.exe not found at $exe"
}

Write-Host "[install-electron] OK: $exe"

/**
 * Install the Electron binary when npm's install.js exits too early.
 * Windows: full install via PowerShell (Expand-Archive — extract-zip crashes Node here).
 */
const { execFileSync } = require('child_process')
const extract = require('extract-zip')
const fs = require('fs')
const os = require('os')
const path = require('path')

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const pkg = require(path.join(electronDir, 'package.json'))
const version = pkg.version

function logStep(message) {
  process.stdout.write(`[ensure-electron] ${message}\n`)
}

function getPlatformPath() {
  switch (process.platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'win32':
      return 'electron.exe'
    default:
      return 'electron'
  }
}

function getCacheDir() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'gatewizard-gui-electron')
}

function isInstalled() {
  const platformPath = getPlatformPath()
  const distPath = path.join(electronDir, 'dist', platformPath)
  const pathFile = path.join(electronDir, 'path.txt')
  try {
    if (!fs.existsSync(distPath)) return false
    if (!fs.existsSync(pathFile)) return false
    return fs.readFileSync(pathFile, 'utf-8').trim() === platformPath
  } catch {
    return false
  }
}

function installWindows() {
  const ps1 = path.join(__dirname, 'install-electron.ps1')
  logStep(`Running PowerShell installer...`)
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { stdio: 'inherit', timeout: 600000 }
  )
  if (!isInstalled()) {
    throw new Error('PowerShell install finished but electron.exe is still missing')
  }
}

async function extractZip(zipPath, extractDir) {
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
  fs.mkdirSync(extractDir, { recursive: true })
  logStep(`Extracting to ${extractDir}...`)
  await extract(zipPath, { dir: extractDir })
  logStep('Extract complete.')
}

function installFromExtractDir(extractDir) {
  const platformPath = getPlatformPath()
  const distDir = path.join(electronDir, 'dist')
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true })
  }
  fs.mkdirSync(distDir, { recursive: true })
  fs.cpSync(extractDir, distDir, { recursive: true })
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath)

  const exePath = path.join(distDir, platformPath)
  if (!fs.existsSync(exePath)) {
    throw new Error(`Electron binary missing after install: ${exePath}`)
  }
  logStep(`Installed: ${exePath}`)
}

async function installGeneric() {
  const { downloadArtifact } = require('@electron/get')
  const cacheDir = getCacheDir()
  fs.mkdirSync(cacheDir, { recursive: true })

  logStep(`Downloading via @electron/get for ${process.platform}-${process.arch}...`)
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    cacheRoot: cacheDir,
    checksums: require(path.join(electronDir, 'checksums.json'))
  })

  const extractDir = path.join(cacheDir, 'extracted')
  await extractZip(zipPath, extractDir)
  installFromExtractDir(extractDir)
}

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    throw new Error('ELECTRON_SKIP_BINARY_DOWNLOAD is set — unset it to install Electron.')
  }

  const platformPath = getPlatformPath()
  if (isInstalled()) {
    logStep(`Electron ${version} already installed (${platformPath}).`)
    return
  }

  logStep(`Installing Electron ${version} for ${process.platform}-${process.arch}...`)

  if (process.platform === 'win32') {
    installWindows()
    return
  }

  await installGeneric()
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('[ensure-electron] Failed:', err && err.stack ? err.stack : err)
    console.error('')
    console.error('Manual fallback (PowerShell):')
    console.error('  powershell -ExecutionPolicy Bypass -File scripts\\install-electron.ps1')
    process.exit(1)
  })

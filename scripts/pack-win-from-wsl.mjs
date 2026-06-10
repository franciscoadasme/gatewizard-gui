/**
 * Pack the Windows installer from WSL using native Windows Node (no Wine).
 * Run via: npm run build:win:pack
 */
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainBundle = join(root, 'out', 'main', 'index.js')

if (!existsSync(mainBundle)) {
  console.error('Run npm run build first.')
  process.exit(1)
}

const wslpath = spawnSync('wslpath', ['-w', root], { encoding: 'utf-8' })
if (wslpath.status !== 0 || !wslpath.stdout?.trim()) {
  console.error('wslpath failed — run this script from WSL.')
  process.exit(1)
}

const winRoot = wslpath.stdout.trim()
const ps1 = `${winRoot}\\scripts\\pack-win.ps1`
const extraArgs = process.argv.slice(2)

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...extraArgs],
  { stdio: 'inherit' }
)

process.exit(result.status ?? 1)

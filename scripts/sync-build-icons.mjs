/**
 * Regenerate electron-builder icons from resources/brand/manifest.mjs.
 * Run before packaging: npm run sync:icons
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import pngToIco from 'png-to-ico'
import {
  brandAssets,
  legacyAppWindowIcon,
  resolvePackagingIconSource
} from '../resources/brand/manifest.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'build')
const iconPng = path.join(buildDir, 'icon.png')
const iconIco = path.join(buildDir, 'icon.ico')

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve packaging source with fallbacks for gradual migration.
 * @returns {Promise<string>}
 */
async function resolveSource() {
  const candidates = [
    resolvePackagingIconSource(),
    brandAssets.appWindow.files.light,
    brandAssets.appWindow.files.dark,
    legacyAppWindowIcon
  ]

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }

  throw new Error(
    [
      'No packaging icon found. Add one of:',
      `  ${path.relative(root, resolvePackagingIconSource())} (recommended — installer / .exe)`,
      `  ${path.relative(root, brandAssets.appWindow.files.light)}`,
      `  ${path.relative(root, brandAssets.appWindow.files.dark)}`,
      `  ${path.relative(root, legacyAppWindowIcon)} (legacy)`,
      'See resources/brand/manifest.mjs for details.'
    ].join('\n')
  )
}

const source = await resolveSource()

await fs.mkdir(buildDir, { recursive: true })
await fs.copyFile(source, iconPng)

const icoBuffer = await pngToIco(source)
await fs.writeFile(iconIco, icoBuffer)

// Remove stale .icns so macOS packaging regenerates from icon.png on the Mac runner.
const iconIcns = path.join(buildDir, 'icon.icns')
await fs.rm(iconIcns, { force: true })

console.log(`Synced ${path.relative(root, source)} -> build/icon.png, build/icon.ico`)
console.log(`Defined in resources/brand/manifest.mjs (${brandAssets.packaging.label})`)

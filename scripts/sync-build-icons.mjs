/**
 * Regenerate electron-builder icons from resources/brand/manifest.mjs.
 * Run before packaging: npm run sync:icons
 */
import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import pngToIco from 'png-to-ico'
import {
  brandAssets,
  legacyAppWindowIcon,
  resolvePackagingIconSource
} from '../resources/brand/manifest.mjs'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'build')
const iconPng = path.join(buildDir, 'icon.png')
const iconIco = path.join(buildDir, 'icon.ico')
const linuxIconsDir = path.join(buildDir, 'icons')
const linuxIconSizes = [16, 24, 32, 48, 64, 128, 256, 512]

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

function resizePng(sourcePng, targetSize) {
  const targetPng = new PNG({ width: targetSize, height: targetSize })
  const scaleX = sourcePng.width / targetSize
  const scaleY = sourcePng.height / targetSize

  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    const startY = Math.floor(targetY * scaleY)
    const endY = Math.ceil((targetY + 1) * scaleY)

    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      const startX = Math.floor(targetX * scaleX)
      const endX = Math.ceil((targetX + 1) * scaleX)
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let samples = 0

      for (let sourceY = startY; sourceY < endY; sourceY += 1) {
        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          const sourceIndex = (sourcePng.width * sourceY + sourceX) << 2
          const sourceAlpha = sourcePng.data[sourceIndex + 3] / 255

          red += sourcePng.data[sourceIndex] * sourceAlpha
          green += sourcePng.data[sourceIndex + 1] * sourceAlpha
          blue += sourcePng.data[sourceIndex + 2] * sourceAlpha
          alpha += sourceAlpha
          samples += 1
        }
      }

      const targetIndex = (targetSize * targetY + targetX) << 2
      targetPng.data[targetIndex] = alpha > 0 ? Math.round(red / alpha) : 0
      targetPng.data[targetIndex + 1] = alpha > 0 ? Math.round(green / alpha) : 0
      targetPng.data[targetIndex + 2] = alpha > 0 ? Math.round(blue / alpha) : 0
      targetPng.data[targetIndex + 3] = Math.round((alpha / samples) * 255)
    }
  }

  return targetPng
}

async function writeLinuxIcons(source) {
  const sourcePng = PNG.sync.read(await fs.readFile(source))

  if (sourcePng.width !== sourcePng.height) {
    throw new Error('Linux packaging icon must be square.')
  }

  await fs.rm(linuxIconsDir, { recursive: true, force: true })
  await fs.mkdir(linuxIconsDir, { recursive: true })

  for (const size of linuxIconSizes) {
    if (size > sourcePng.width) continue

    const resized = resizePng(sourcePng, size)
    await fs.writeFile(path.join(linuxIconsDir, `${size}x${size}.png`), PNG.sync.write(resized))
  }
}

const source = await resolveSource()

await fs.mkdir(buildDir, { recursive: true })
await fs.copyFile(source, iconPng)

const icoBuffer = await pngToIco(source)
await fs.writeFile(iconIco, icoBuffer)

await writeLinuxIcons(source)

// Remove stale .icns so macOS packaging regenerates from icon.png on the Mac runner.
const iconIcns = path.join(buildDir, 'icon.icns')
await fs.rm(iconIcns, { force: true })

console.log(`Synced ${path.relative(root, source)} -> build/icon.png, build/icon.ico, build/icons/`)
console.log(`Defined in resources/brand/manifest.mjs (${brandAssets.packaging.label})`)

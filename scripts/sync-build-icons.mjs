/**
 * Regenerate electron-builder icons from resources/window_icon.png.
 * Run before packaging (npm run sync:icons).
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import pngToIco from 'png-to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const source = path.join(root, 'resources', 'window_icon.png')
const buildDir = path.join(root, 'build')
const iconPng = path.join(buildDir, 'icon.png')
const iconIco = path.join(buildDir, 'icon.ico')

await fs.mkdir(buildDir, { recursive: true })
await fs.copyFile(source, iconPng)

const icoBuffer = await pngToIco(source)
await fs.writeFile(iconIco, icoBuffer)

// Remove stale .icns so macOS packaging regenerates from icon.png on the Mac runner.
const iconIcns = path.join(buildDir, 'icon.icns')
await fs.rm(iconIcns, { force: true })

console.log(`Synced ${path.relative(root, source)} -> build/icon.png, build/icon.ico`)

#!/usr/bin/env node
/**
 * Merge releases/versions.json (gatewizard pins) with GUI release URLs for a tag.
 * Usage: node scripts/build-versions-manifest.mjs <owner/repo> <tag> <version>
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const [repo, tag, version] = process.argv.slice(2)
if (!repo || !tag || !version) {
  console.error(
    'Usage: node scripts/build-versions-manifest.mjs <owner/repo> <tag> <version>'
  )
  process.exit(1)
}

const templatePath = path.join(root, 'releases', 'versions.json')
const base = JSON.parse(fs.readFileSync(templatePath, 'utf-8'))

const releasePage = `https://github.com/${repo}/releases/tag/${tag}`
const downloadBase = `https://github.com/${repo}/releases/download/${tag}`

const manifest = {
  schema: 1,
  released_at: new Date().toISOString().slice(0, 10),
  ...base,
  gui: {
    latest: version,
    min_gatewizard: base.gatewizard?.min_for_gui ?? base.gatewizard?.latest ?? null,
    release_page: releasePage,
    downloads: {
      linux: `${downloadBase}/gatewizard-gui-${version}.AppImage`,
      win: `${downloadBase}/gatewizard-gui-${version}-setup.exe`,
      mac: `${downloadBase}/gatewizard-gui-${version}.dmg`,
      mac_arm64: `${downloadBase}/gatewizard-gui-${version}-arm64.dmg`,
      mac_x64: `${downloadBase}/gatewizard-gui-${version}.dmg`
    }
  }
}

const outPath = path.join(root, 'dist', 'versions.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${outPath}`)

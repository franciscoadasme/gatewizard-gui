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
      linux_appimage: `${downloadBase}/gatewizard-gui-${version}-linux-x86_64.AppImage`,
      linux_deb: `${downloadBase}/gatewizard-gui-${version}-linux-amd64.deb`,
      // Default "linux" key used by older clients — prefer the installable .deb.
      linux: `${downloadBase}/gatewizard-gui-${version}-linux-amd64.deb`,
      mac: `${downloadBase}/gatewizard-gui-${version}-mac-arm64.dmg`,
      mac_arm64: `${downloadBase}/gatewizard-gui-${version}-mac-arm64.dmg`,
      mac_x64: `${downloadBase}/gatewizard-gui-${version}-mac-x64.dmg`
    },
    platform_notes: {
      win:
        'No native Windows installer. Install the Linux .deb or AppImage inside WSL 2 (Ubuntu 24.04 recommended).'
    }
  }
}

const outPath = path.join(root, 'dist', 'versions.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${outPath}`)

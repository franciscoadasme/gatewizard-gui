import { app } from 'electron'

/** Public manifest (gatewizard repo). Override with GATEWIZARD_UPDATE_MANIFEST_URL. */
export const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/maurobedoya/gatewizard/main/releases/gui-versions.json'

export function getManifestUrl() {
  return process.env.GATEWIZARD_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL
}

/**
 * @param {string | null | undefined} version
 * @returns {[number, number, number] | null}
 */
export function parseSemver(version) {
  if (!version) return null
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
export function compareSemver(a, b) {
  const av = parseSemver(a)
  const bv = parseSemver(b)
  if (!av && !bv) return 0
  if (!av) return -1
  if (!bv) return 1
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] - bv[i]
  }
  return 0
}

/**
 * @param {string} platform
 * @param {Record<string, string | undefined>} downloads
 */
export function pickGuiDownloadUrl(platform, downloads = {}) {
  if (!downloads) return null
  // No native Windows releases — users on Windows install the Linux build in WSL.
  if (platform === 'win32') return null
  if (platform === 'darwin') {
    return process.arch === 'arm64'
      ? downloads.mac_arm64 ?? downloads.mac ?? null
      : downloads.mac_x64 ?? downloads.mac ?? null
  }
  if (platform === 'linux') return downloads.linux ?? null
  return downloads.linux ?? downloads.mac ?? null
}

/**
 * @param {{ guiVersion: string, gatewizardVersion: string | null, manifestUrl?: string }} options
 */
export async function checkForUpdates(options) {
  const manifestUrl = options.manifestUrl || getManifestUrl()
  const result = {
    ok: false,
    manifestUrl,
    local: {
      gui: options.guiVersion,
      gatewizard: options.gatewizardVersion
    },
    remote: {
      gui: null,
      gatewizard: null,
      min_gatewizard: null
    },
    gui: {
      updateAvailable: false,
      downloadUrl: null,
      releasePage: null
    },
    gatewizard: {
      updateAvailable: false,
      installSpec: null
    },
    notes: null,
    error: null
  }

  let manifest
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'gatewizard-gui' }
    })
    if (!response.ok) {
      throw new Error(`Manifest HTTP ${response.status}`)
    }
    manifest = await response.json()
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Failed to fetch update manifest'
    return result
  }

  result.ok = true
  result.remote.gui = manifest.gui?.latest ?? null
  result.remote.gatewizard = manifest.gatewizard?.latest ?? null
  result.remote.min_gatewizard =
    manifest.gui?.min_gatewizard ?? manifest.gatewizard?.min_for_gui ?? null
  result.notes = manifest.notes ?? null

  if (manifest.gui?.latest && compareSemver(options.guiVersion, manifest.gui.latest) < 0) {
    result.gui.updateAvailable = true
    result.gui.releasePage = manifest.gui.release_page ?? null
    result.gui.downloadUrl = pickGuiDownloadUrl(process.platform, manifest.gui.downloads)
  }

  const remoteApi = manifest.gatewizard?.latest
  const localApi = options.gatewizardVersion
  if (remoteApi && localApi && compareSemver(localApi, remoteApi) < 0) {
    result.gatewizard.updateAvailable = true
    result.gatewizard.installSpec = manifest.gatewizard?.install ?? null
  } else if (remoteApi && !localApi) {
    result.gatewizard.updateAvailable = true
    result.gatewizard.installSpec = manifest.gatewizard?.install ?? null
  }

  if (
    result.remote.min_gatewizard &&
    localApi &&
    compareSemver(localApi, result.remote.min_gatewizard) < 0 &&
    !result.gatewizard.updateAvailable
  ) {
    result.gatewizard.updateAvailable = true
    result.gatewizard.installSpec = manifest.gatewizard?.install ?? null
  }

  return result
}

export function getLocalGuiVersion() {
  return app.getVersion()
}

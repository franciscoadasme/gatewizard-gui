/** Public manifest (gatewizard repo). Override with GATEWIZARD_UPDATE_MANIFEST_URL. */
export const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/maurobedoya/gatewizard/main/releases/gui-versions.json'

/**
 * Fallback when the gatewizard-repo manifest is stale or the CI sync secret
 * was missing. Every GUI GitHub Release attaches dist/versions.json.
 */
export const FALLBACK_MANIFEST_URL =
  'https://github.com/franciscoadasme/gatewizard-gui/releases/latest/download/versions.json'

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
  // Prefer the installable .deb on Linux / WSL (and for native Windows, which
  // has no GUI installer — users install the Linux .deb inside WSL).
  const linuxDeb =
    downloads.linux_deb ?? downloads.linux ?? downloads.linux_appimage ?? null
  if (platform === 'win32') return linuxDeb
  if (platform === 'darwin') {
    return process.arch === 'arm64'
      ? downloads.mac_arm64 ?? downloads.mac ?? null
      : downloads.mac_x64 ?? downloads.mac ?? null
  }
  if (platform === 'linux') return linuxDeb
  return linuxDeb ?? downloads.mac ?? null
}

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
async function fetchManifestJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'gatewizard-gui' },
    redirect: 'follow'
  })
  if (!response.ok) {
    throw new Error(`Manifest HTTP ${response.status} (${url})`)
  }
  return response.json()
}

/**
 * Prefer the manifest that advertises the newer GUI (then newer API).
 * @param {object | null} a
 * @param {object | null} b
 */
export function pickNewerManifest(a, b) {
  if (!a) return b
  if (!b) return a
  const guiCmp = compareSemver(a.gui?.latest, b.gui?.latest)
  if (guiCmp !== 0) return guiCmp > 0 ? a : b
  const apiCmp = compareSemver(a.gatewizard?.latest, b.gatewizard?.latest)
  return apiCmp >= 0 ? a : b
}

/**
 * @param {{ guiVersion: string, gatewizardVersion: string | null, manifestUrl?: string }} options
 */
export async function checkForUpdates(options) {
  const primaryUrl = options.manifestUrl || getManifestUrl()
  const envOverride = Boolean(process.env.GATEWIZARD_UPDATE_MANIFEST_URL || options.manifestUrl)
  const result = {
    ok: false,
    manifestUrl: primaryUrl,
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

  /** @type {object | null} */
  let primary = null
  /** @type {object | null} */
  let fallback = null
  /** @type {string | null} */
  let primaryError = null
  /** @type {string | null} */
  let fallbackError = null

  try {
    primary = await fetchManifestJson(primaryUrl)
  } catch (error) {
    primaryError = error instanceof Error ? error.message : 'Failed to fetch primary manifest'
  }

  // Always try the GUI release asset unless the caller forced a custom URL.
  // That keeps update banners working when CI forgot to sync gui-versions.json.
  if (!envOverride) {
    try {
      fallback = await fetchManifestJson(FALLBACK_MANIFEST_URL)
    } catch (error) {
      fallbackError =
        error instanceof Error ? error.message : 'Failed to fetch fallback manifest'
    }
  }

  const manifest = pickNewerManifest(primary, fallback)
  if (!manifest) {
    result.error = primaryError || fallbackError || 'Failed to fetch update manifest'
    return result
  }

  if (fallback && pickNewerManifest(primary, fallback) === fallback) {
    result.manifestUrl = FALLBACK_MANIFEST_URL
  } else {
    result.manifestUrl = primaryUrl
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
  // Lazy import so pure helpers can be unit-tested without Electron.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron')
  return app.getVersion()
}

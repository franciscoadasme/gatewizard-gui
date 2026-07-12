/**
 * App-level preferences (notifications, updates, scene-defaults remember flag).
 * Theme stays in theme.svelte.js (`gw_theme`). Merge-with-defaults for forward compatibility.
 */

const STORAGE_KEY = 'gw_app_settings'

/** @typedef {{
 *   jobNotificationsEnabled: boolean,
 *   updateCheckOnLaunch: boolean,
 *   rememberViewerDefaults: boolean,
 *   dismissedUpdateKey: string | null
 * }} AppSettings */

/** @type {AppSettings} */
export const DEFAULT_APP_SETTINGS = {
  jobNotificationsEnabled: true,
  updateCheckOnLaunch: true,
  rememberViewerDefaults: false,
  dismissedUpdateKey: null
}

/**
 * @param {unknown} raw
 * @returns {AppSettings}
 */
function normalizeLoaded(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APP_SETTINGS }
  const o = /** @type {Record<string, unknown>} */ (raw)
  return {
    jobNotificationsEnabled:
      typeof o.jobNotificationsEnabled === 'boolean'
        ? o.jobNotificationsEnabled
        : DEFAULT_APP_SETTINGS.jobNotificationsEnabled,
    updateCheckOnLaunch:
      typeof o.updateCheckOnLaunch === 'boolean'
        ? o.updateCheckOnLaunch
        : DEFAULT_APP_SETTINGS.updateCheckOnLaunch,
    rememberViewerDefaults:
      typeof o.rememberViewerDefaults === 'boolean'
        ? o.rememberViewerDefaults
        : DEFAULT_APP_SETTINGS.rememberViewerDefaults,
    dismissedUpdateKey:
      typeof o.dismissedUpdateKey === 'string' || o.dismissedUpdateKey === null
        ? /** @type {string | null} */ (o.dismissedUpdateKey)
        : DEFAULT_APP_SETTINGS.dismissedUpdateKey
  }
}

/** @type {AppSettings} */
export const appSettings = $state({ ...DEFAULT_APP_SETTINGS })

export function persistAppSettings() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        jobNotificationsEnabled: appSettings.jobNotificationsEnabled,
        updateCheckOnLaunch: appSettings.updateCheckOnLaunch,
        rememberViewerDefaults: appSettings.rememberViewerDefaults,
        dismissedUpdateKey: appSettings.dismissedUpdateKey
      })
    )
  } catch {
    /* ignore */
  }
}

export function initAppSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      Object.assign(appSettings, normalizeLoaded(JSON.parse(raw)))
    }
  } catch {
    Object.assign(appSettings, { ...DEFAULT_APP_SETTINGS })
  }
}

/**
 * @param {Partial<AppSettings>} patch
 */
export function updateAppSettings(patch) {
  Object.assign(appSettings, patch)
  persistAppSettings()
}

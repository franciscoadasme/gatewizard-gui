/**
 * App-level preferences (notifications, updates, scene-defaults remember flag, UI scale).
 * Theme stays in theme.svelte.js (`gw_theme`). Merge-with-defaults for forward compatibility.
 */

const STORAGE_KEY = 'gw_app_settings'

/** Chromium zoom step (~1.0905). */
export const UI_ZOOM_STEP = 1.2 ** (1 / 3)

export const UI_SCALE_MIN = 0.8
export const UI_SCALE_MAX = 1.5

/** @typedef {{
 *   jobNotificationsEnabled: boolean,
 *   updateCheckOnLaunch: boolean,
 *   rememberViewerDefaults: boolean,
 *   dismissedUpdateKey: string | null,
 *   uiScale: number
 * }} AppSettings */

/** @type {AppSettings} */
export const DEFAULT_APP_SETTINGS = {
  jobNotificationsEnabled: true,
  updateCheckOnLaunch: true,
  rememberViewerDefaults: false,
  dismissedUpdateKey: null,
  uiScale: 1.1
}

/**
 * @param {unknown} n
 * @returns {number}
 */
export function clampUiScale(n) {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return DEFAULT_APP_SETTINGS.uiScale
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v))
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
        : DEFAULT_APP_SETTINGS.dismissedUpdateKey,
    uiScale:
      typeof o.uiScale === 'number'
        ? clampUiScale(o.uiScale)
        : DEFAULT_APP_SETTINGS.uiScale
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
        dismissedUpdateKey: appSettings.dismissedUpdateKey,
        uiScale: clampUiScale(appSettings.uiScale)
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
  const next = { ...patch }
  if ('uiScale' in next) {
    next.uiScale = clampUiScale(next.uiScale)
  }
  Object.assign(appSettings, next)
  persistAppSettings()
}

/**
 * Apply Settings uiScale to the main window (startup / reset target + live factor).
 * @param {number} [factor]
 */
export async function applyUiScale(factor = appSettings.uiScale) {
  const scale = clampUiScale(factor)
  try {
    await window.api?.setUiZoomDefault?.(scale)
    await window.api?.setUiZoomFactor?.(scale)
  } catch {
    /* ignore when not in Electron */
  }
}

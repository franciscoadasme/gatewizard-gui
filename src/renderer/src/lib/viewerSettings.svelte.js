/**
 * Global 3D scene settings (background, lighting). Using .svelte.js so $state works outside components.
 */

/** @typedef {'dark' | 'light'} BrandTheme */
/** @typedef {'theme' | 'custom'} BackgroundMode */
/** @typedef {{ enabled: boolean, position: [number, number, number], intensity: number }} DirectionalLightConfig */

const STORAGE_KEY = 'gw_viewer_settings'
const MAX_DIRECTIONAL_LIGHTS = 8

/** @type {readonly DirectionalLightConfig[]} */
const DEFAULT_DIRECTIONAL_LIGHTS = [
  { enabled: true, position: [7, 11, 9], intensity: 0.42 },
  { enabled: true, position: [-9, 6, -7], intensity: 0.34 }
]

export const DEFAULT_VIEWER_SETTINGS = {
  backgroundMode: /** @type {BackgroundMode} */ ('theme'),
  customBackgroundHex: '#0c0e12',
  hemisphereSky: '#c4d2e8',
  hemisphereGround: '#0c0e12',
  hemisphereIntensity: 1.4,
  ambientIntensity: 1.0,
  directionalLights: DEFAULT_DIRECTIONAL_LIGHTS.map((l) => ({
    enabled: l.enabled,
    position: [...l.position],
    intensity: l.intensity
  }))
}

export const viewerSettings = $state({ ...DEFAULT_VIEWER_SETTINGS })

/**
 * @param {BrandTheme} theme
 */
export function themeBackgroundHex(theme) {
  return theme === 'light' ? '#e8eaef' : '#0c0e12'
}

/**
 * @param {BrandTheme} theme
 */
export function resolveSceneBackground(theme) {
  if (viewerSettings.backgroundMode === 'custom') {
    return viewerSettings.customBackgroundHex
  }
  return themeBackgroundHex(theme)
}

/**
 * @param {unknown} src
 * @param {DirectionalLightConfig} fallback
 */
function normalizeDirectionalLight(src, fallback) {
  if (!src || typeof src !== 'object') {
    return {
      enabled: fallback.enabled,
      position: [...fallback.position],
      intensity: fallback.intensity
    }
  }
  const l = /** @type {Record<string, unknown>} */ (src)
  const pos = Array.isArray(l.position) ? l.position : fallback.position
  return {
    enabled: typeof l.enabled === 'boolean' ? l.enabled : fallback.enabled,
    position: [
      Number(pos[0]) || fallback.position[0],
      Number(pos[1]) || fallback.position[1],
      Number(pos[2]) || fallback.position[2]
    ],
    intensity: typeof l.intensity === 'number' ? l.intensity : fallback.intensity
  }
}

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_VIEWER_SETTINGS}
 */
function normalizeLoaded(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VIEWER_SETTINGS }

  const o = /** @type {Record<string, unknown>} */ (raw)
  const lights = Array.isArray(o.directionalLights) ? o.directionalLights : []
  /** @type {DirectionalLightConfig[]} */
  const directionalLights =
    lights.length > 0
      ? lights.slice(0, MAX_DIRECTIONAL_LIGHTS).map((src, i) =>
          normalizeDirectionalLight(src, DEFAULT_DIRECTIONAL_LIGHTS[i] ?? DEFAULT_DIRECTIONAL_LIGHTS[0])
        )
      : DEFAULT_VIEWER_SETTINGS.directionalLights.map((l) => ({
          enabled: l.enabled,
          position: [...l.position],
          intensity: l.intensity
        }))

  return {
    backgroundMode: o.backgroundMode === 'custom' ? 'custom' : 'theme',
    customBackgroundHex:
      typeof o.customBackgroundHex === 'string' ? o.customBackgroundHex : DEFAULT_VIEWER_SETTINGS.customBackgroundHex,
    hemisphereSky:
      typeof o.hemisphereSky === 'string' ? o.hemisphereSky : DEFAULT_VIEWER_SETTINGS.hemisphereSky,
    hemisphereGround:
      typeof o.hemisphereGround === 'string' ? o.hemisphereGround : DEFAULT_VIEWER_SETTINGS.hemisphereGround,
    hemisphereIntensity:
      typeof o.hemisphereIntensity === 'number'
        ? o.hemisphereIntensity
        : DEFAULT_VIEWER_SETTINGS.hemisphereIntensity,
    ambientIntensity:
      typeof o.ambientIntensity === 'number' ? o.ambientIntensity : DEFAULT_VIEWER_SETTINGS.ambientIntensity,
    directionalLights
  }
}

export function persistViewerSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(viewerSettings))
  } catch {
    /* ignore */
  }
}

export function initViewerSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const loaded = normalizeLoaded(JSON.parse(raw))
      Object.assign(viewerSettings, loaded)
    }
  } catch {
    Object.assign(viewerSettings, { ...DEFAULT_VIEWER_SETTINGS })
  }
}

export function resetViewerSettings() {
  Object.assign(viewerSettings, {
    ...DEFAULT_VIEWER_SETTINGS,
    directionalLights: DEFAULT_VIEWER_SETTINGS.directionalLights.map((l) => ({
      enabled: l.enabled,
      position: [...l.position],
      intensity: l.intensity
    }))
  })
  persistViewerSettings()
}

export function addDirectionalLight() {
  if (viewerSettings.directionalLights.length >= MAX_DIRECTIONAL_LIGHTS) return
  viewerSettings.directionalLights = [
    ...viewerSettings.directionalLights,
    { enabled: true, position: [5, 8, 5], intensity: 0.35 }
  ]
  persistViewerSettings()
}

/** @param {number} index */
export function removeDirectionalLight(index) {
  if (viewerSettings.directionalLights.length <= 1) return
  viewerSettings.directionalLights = viewerSettings.directionalLights.filter((_, i) => i !== index)
  persistViewerSettings()
}

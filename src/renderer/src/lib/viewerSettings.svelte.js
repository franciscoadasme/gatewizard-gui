/**
 * Global 3D scene settings (background, lighting). Using .svelte.js so $state works outside components.
 * Persistence is gated by appSettings.rememberViewerDefaults (Settings only writes when on).
 */

import { appSettings } from './appSettings.svelte.js'

/** @typedef {'dark' | 'light'} BrandTheme */
/** @typedef {'theme' | 'custom'} BackgroundMode */
/** @typedef {{ enabled: boolean, position: [number, number, number], intensity: number }} DirectionalLightConfig */
/**
 * @typedef {{
 *   enabled: boolean,
 *   focusDistance: number,
 *   focusRange: number,
 *   bokehScale: number,
 *   focusTarget: { x: number, y: number, z: number } | null
 * }} DepthOfFieldConfig
 */

const STORAGE_KEY = 'gw_viewer_settings'
const MAX_DIRECTIONAL_LIGHTS = 8

/** @type {readonly DirectionalLightConfig[]} */
const DEFAULT_DIRECTIONAL_LIGHTS = [
  { enabled: true, position: [7, 11, 9], intensity: 0.42 },
  { enabled: true, position: [-9, 6, -7], intensity: 0.34 }
]

/** @type {DepthOfFieldConfig} */
export const DEFAULT_DOF = {
  enabled: false,
  focusDistance: 80,
  focusRange: 20,
  bokehScale: 2.5,
  focusTarget: null
}

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
  })),
  dof: { ...DEFAULT_DOF }
}

/**
 * @param {unknown} raw
 * @returns {DepthOfFieldConfig}
 */
export function normalizeDof(raw) {
  const d = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const t = d.focusTarget && typeof d.focusTarget === 'object'
    ? /** @type {Record<string, unknown>} */ (d.focusTarget)
    : null
  return {
    enabled: d.enabled === true,
    focusDistance:
      typeof d.focusDistance === 'number' && Number.isFinite(d.focusDistance)
        ? Math.max(0.1, d.focusDistance)
        : DEFAULT_DOF.focusDistance,
    focusRange:
      typeof d.focusRange === 'number' && Number.isFinite(d.focusRange)
        ? Math.max(0.1, d.focusRange)
        : DEFAULT_DOF.focusRange,
    bokehScale:
      typeof d.bokehScale === 'number' && Number.isFinite(d.bokehScale)
        ? Math.max(0, d.bokehScale)
        : DEFAULT_DOF.bokehScale,
    focusTarget:
      t &&
      typeof t.x === 'number' &&
      typeof t.y === 'number' &&
      typeof t.z === 'number'
        ? { x: t.x, y: t.y, z: t.z }
        : null
  }
}

/**
 * @returns {typeof DEFAULT_VIEWER_SETTINGS}
 */
function cloneDefaults() {
  return {
    ...DEFAULT_VIEWER_SETTINGS,
    directionalLights: DEFAULT_VIEWER_SETTINGS.directionalLights.map((l) => ({
      enabled: l.enabled,
      position: [...l.position],
      intensity: l.intensity
    })),
    dof: { ...DEFAULT_DOF, focusTarget: null }
  }
}

export const viewerSettings = $state(cloneDefaults())

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
  if (!raw || typeof raw !== 'object') return cloneDefaults()

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
    directionalLights,
    dof: normalizeDof(o.dof)
  }
}

/** Write current scene settings when Remember scene defaults is on. */
export function persistViewerSettings() {
  if (!appSettings.rememberViewerDefaults) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(viewerSettings))
  } catch {
    /* ignore */
  }
}

export function clearPersistedViewerSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function initViewerSettings() {
  if (!appSettings.rememberViewerDefaults) {
    Object.assign(viewerSettings, cloneDefaults())
    return
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      Object.assign(viewerSettings, normalizeLoaded(JSON.parse(raw)))
    } else {
      Object.assign(viewerSettings, cloneDefaults())
    }
  } catch {
    Object.assign(viewerSettings, cloneDefaults())
  }
}

export function resetViewerSettings() {
  Object.assign(viewerSettings, cloneDefaults())
}

export function addDirectionalLight() {
  if (viewerSettings.directionalLights.length >= MAX_DIRECTIONAL_LIGHTS) return
  viewerSettings.directionalLights = [
    ...viewerSettings.directionalLights,
    { enabled: true, position: [5, 8, 5], intensity: 0.35 }
  ]
}

/** @param {number} index */
export function removeDirectionalLight(index) {
  if (viewerSettings.directionalLights.length <= 1) return
  viewerSettings.directionalLights = viewerSettings.directionalLights.filter((_, i) => i !== index)
}

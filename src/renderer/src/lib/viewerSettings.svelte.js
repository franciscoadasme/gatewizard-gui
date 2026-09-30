/**
 * Global 3D scene settings (background, lighting). Using .svelte.js so $state works outside components.
 * Persistence is gated by appSettings.rememberViewerDefaults (Settings only writes when on).
 */

import { appSettings } from './appSettings.svelte.js'

/** @typedef {'dark' | 'light'} BrandTheme */
/** @typedef {'theme' | 'custom'} BackgroundMode */
/** @typedef {'camera' | 'world'} LightMode */
/**
 * @typedef {{
 *   enabled: boolean,
 *   position: [number, number, number],
 *   intensity: number,
 *   color: string
 * }} DirectionalLightConfig
 */
/**
 * @typedef {{
 *   enabled: boolean,
 *   focusDistance: number,
 *   focusRange: number,
 *   bokehScale: number,
 *   focusTarget: { x: number, y: number, z: number } | null
 * }} DepthOfFieldConfig
 */
/**
 * @typedef {{
 *   enabled: boolean,
 *   near: number,
 *   far: number,
 *   color: string,
 *   matchBackground: boolean
 * }} FogConfig
 */
/**
 * @typedef {{
 *   enabled: boolean,
 *   strength: number,
 *   softness: number
 * }} ShadowConfig
 */

const STORAGE_KEY = 'gw_viewer_settings'
export const MAX_DIRECTIONAL_LIGHTS = 8
/** Shadow darkness slider ceiling — Three.js documents intensity as [0, 1]. */
export const SHADOW_STRENGTH_MAX = 1
/** Softness → PCF radius ceiling (higher values look grainy / stippled). */
export const SHADOW_RADIUS_MAX = 3

/** @type {readonly DirectionalLightConfig[]} */
const DEFAULT_DIRECTIONAL_LIGHTS = [
  { enabled: true, position: [7, 11, 9], intensity: 0.42, color: '#ffffff' },
  { enabled: true, position: [-9, 6, -7], intensity: 0.34, color: '#ffffff' }
]

/** @type {DepthOfFieldConfig} */
export const DEFAULT_DOF = {
  enabled: false,
  focusDistance: 80,
  focusRange: 20,
  bokehScale: 2.5,
  focusTarget: null
}

/** @type {FogConfig} */
export const DEFAULT_FOG = {
  enabled: false,
  /** Camera distance where fog begins — atoms closer stay fully lit. */
  near: 70,
  /** Camera distance where fog is fully opaque. */
  far: 140,
  color: '#0c0e12',
  matchBackground: true
}

/** @type {ShadowConfig} */
export const DEFAULT_SHADOWS = {
  enabled: false,
  /** Darkness 0–1 (Three shadow.intensity). */
  strength: 1,
  /** Soft blur 0–1 → PCF radius up to SHADOW_RADIUS_MAX. */
  softness: 0.45
}

/**
 * Map softness slider 0–1 to a PCF radius that stays free of stipple artifacts.
 * @param {number} softness
 */
export function shadowRadiusFromSoftness(softness) {
  const soft = Math.max(0, Math.min(1, typeof softness === 'number' ? softness : 0.45))
  // Hard edge ≈ 0.5 … soft edge ≈ SHADOW_RADIUS_MAX (Three default radius is 1)
  return 0.5 + soft * (SHADOW_RADIUS_MAX - 0.5)
}

/**
 * Near/Far so the front of the framed structure stays bright and the back fades
 * (DOF-style range along the view axis).
 * @param {{ position: { distanceTo?: (v: unknown) => number, length?: () => number } }} cam
 * @param {{ distanceTo?: (v: unknown) => number } | null | undefined} target
 * @returns {{ near: number, far: number }}
 */
export function fogRangeFromCamera(cam, target) {
  const mid =
    target && typeof target.distanceTo === 'function'
      ? Math.max(8, cam.position.distanceTo(target))
      : Math.max(
          8,
          typeof cam.position.length === 'function' ? cam.position.length() : DEFAULT_FOG.near
        )
  const span = Math.max(20, mid * 0.55)
  // Front of molecule ≈ mid − span/2 → keep clear until just past the front face
  const near = Math.max(1, mid - span * 0.35)
  const far = mid + span * 0.9
  return { near, far: Math.max(near + 4, far) }
}

export const DEFAULT_VIEWER_SETTINGS = {
  backgroundMode: /** @type {BackgroundMode} */ ('theme'),
  customBackgroundHex: '#0c0e12',
  lightMode: /** @type {LightMode} */ ('camera'),
  hemisphereSky: '#c4d2e8',
  hemisphereGround: '#0c0e12',
  hemisphereIntensity: 1.4,
  ambientColor: '#ffffff',
  ambientIntensity: 1.4,
  directionalLights: DEFAULT_DIRECTIONAL_LIGHTS.map((l) => ({
    enabled: l.enabled,
    position: /** @type {[number, number, number]} */ ([...l.position]),
    intensity: l.intensity,
    color: l.color
  })),
  fog: { ...DEFAULT_FOG },
  shadows: { ...DEFAULT_SHADOWS },
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
 * @param {unknown} raw
 * @returns {FogConfig}
 */
export function normalizeFog(raw) {
  const d = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  let near =
    typeof d.near === 'number' && Number.isFinite(d.near) ? Math.max(0.1, d.near) : NaN
  let far =
    typeof d.far === 'number' && Number.isFinite(d.far) ? Math.max(0.1, d.far) : NaN

  // Legacy density / FogExp2 → approximate Near/Far (front clear, back cued).
  if (!Number.isFinite(near) || !Number.isFinite(far)) {
    let strength = 0.45
    if (typeof d.density === 'number' && Number.isFinite(d.density)) {
      const rawD = d.density
      strength =
        rawD > 1
          ? 1
          : rawD < 0.05 && rawD > 0
            ? Math.min(1, rawD / 0.04)
            : Math.max(0, Math.min(1, rawD))
    }
    const mid = 80
    const span = Math.max(20, mid * 0.55)
    // Higher legacy strength → cue starts closer to mid (more of front stays clear)
    // and far extends further behind.
    near = Math.max(1, mid - span * (0.45 - 0.2 * strength))
    far = mid + span * (0.45 + 0.55 * strength)
  }

  if (far <= near) far = near + 4
  return {
    enabled: d.enabled === true,
    near,
    far,
    color: typeof d.color === 'string' && d.color.startsWith('#') ? d.color : DEFAULT_FOG.color,
    matchBackground: d.matchBackground !== false
  }
}

/**
 * @param {unknown} raw
 * @returns {ShadowConfig}
 */
export function normalizeShadows(raw) {
  const d = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const strength =
    typeof d.strength === 'number' && Number.isFinite(d.strength)
      ? Math.max(0, Math.min(SHADOW_STRENGTH_MAX, d.strength))
      : DEFAULT_SHADOWS.strength
  const softness =
    typeof d.softness === 'number' && Number.isFinite(d.softness)
      ? Math.max(0, Math.min(1, d.softness))
      : DEFAULT_SHADOWS.softness
  return {
    enabled: d.enabled === true,
    strength,
    softness
  }
}

/**
 * @param {DirectionalLightConfig} light
 * @returns {DirectionalLightConfig}
 */
function cloneLight(light) {
  return {
    enabled: light.enabled,
    position: /** @type {[number, number, number]} */ ([...light.position]),
    intensity: light.intensity,
    color: light.color || '#ffffff'
  }
}

/**
 * @returns {typeof DEFAULT_VIEWER_SETTINGS}
 */
function cloneDefaults() {
  return {
    ...DEFAULT_VIEWER_SETTINGS,
    lightMode: DEFAULT_VIEWER_SETTINGS.lightMode,
    ambientColor: DEFAULT_VIEWER_SETTINGS.ambientColor,
    directionalLights: DEFAULT_VIEWER_SETTINGS.directionalLights.map(cloneLight),
    fog: { ...DEFAULT_FOG },
    shadows: { ...DEFAULT_SHADOWS },
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
 * Fog color for the current scene (match background or explicit).
 * @param {BrandTheme} theme
 */
export function resolveFogColor(theme) {
  const fog = viewerSettings.fog ?? DEFAULT_FOG
  if (fog.matchBackground !== false) return resolveSceneBackground(theme)
  return fog.color || resolveSceneBackground(theme)
}

/**
 * @param {unknown} src
 * @param {DirectionalLightConfig} fallback
 * @returns {DirectionalLightConfig}
 */
function normalizeDirectionalLight(src, fallback) {
  if (!src || typeof src !== 'object') {
    return cloneLight(fallback)
  }
  const l = /** @type {Record<string, unknown>} */ (src)
  const pos = Array.isArray(l.position) ? l.position : fallback.position
  const color =
    typeof l.color === 'string' && l.color.startsWith('#')
      ? l.color
      : fallback.color || '#ffffff'
  return {
    enabled: typeof l.enabled === 'boolean' ? l.enabled : fallback.enabled,
    position: [
      Number(pos[0]) || fallback.position[0],
      Number(pos[1]) || fallback.position[1],
      Number(pos[2]) || fallback.position[2]
    ],
    intensity: typeof l.intensity === 'number' ? l.intensity : fallback.intensity,
    color
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
      : DEFAULT_VIEWER_SETTINGS.directionalLights.map(cloneLight)

  return {
    backgroundMode: o.backgroundMode === 'custom' ? 'custom' : 'theme',
    customBackgroundHex:
      typeof o.customBackgroundHex === 'string' ? o.customBackgroundHex : DEFAULT_VIEWER_SETTINGS.customBackgroundHex,
    lightMode: o.lightMode === 'world' ? 'world' : 'camera',
    hemisphereSky:
      typeof o.hemisphereSky === 'string' ? o.hemisphereSky : DEFAULT_VIEWER_SETTINGS.hemisphereSky,
    hemisphereGround:
      typeof o.hemisphereGround === 'string' ? o.hemisphereGround : DEFAULT_VIEWER_SETTINGS.hemisphereGround,
    hemisphereIntensity:
      typeof o.hemisphereIntensity === 'number'
        ? o.hemisphereIntensity
        : DEFAULT_VIEWER_SETTINGS.hemisphereIntensity,
    ambientColor:
      typeof o.ambientColor === 'string' && o.ambientColor.startsWith('#')
        ? o.ambientColor
        : DEFAULT_VIEWER_SETTINGS.ambientColor,
    ambientIntensity:
      typeof o.ambientIntensity === 'number' ? o.ambientIntensity : DEFAULT_VIEWER_SETTINGS.ambientIntensity,
    directionalLights,
    fog: normalizeFog(o.fog),
    shadows: normalizeShadows(o.shadows),
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

/**
 * Place two key/fill lights around a structure bounding sphere.
 * Camera mode writes camera-local offsets; world mode writes world XYZ.
 * @param {{ center: [number, number, number], radius: number }} bbox
 */
export function resetLightsAroundStructure(bbox) {
  const r = Math.max(8, Number(bbox.radius) || 20)
  const [cx, cy, cz] = bbox.center
  const key = /** @type {[number, number, number]} */ ([r * 0.7, r * 1.1, r * 0.9])
  const fill = /** @type {[number, number, number]} */ ([-r * 0.9, r * 0.6, -r * 0.7])
  if (viewerSettings.lightMode === 'world') {
    viewerSettings.directionalLights = [
      {
        enabled: true,
        position: [cx + key[0], cy + key[1], cz + key[2]],
        intensity: 0.55,
        color: '#ffffff'
      },
      {
        enabled: true,
        position: [cx + fill[0], cy + fill[1], cz + fill[2]],
        intensity: 0.32,
        color: '#d8e4ff'
      }
    ]
  } else {
    viewerSettings.directionalLights = [
      { enabled: true, position: key, intensity: 0.55, color: '#ffffff' },
      { enabled: true, position: fill, intensity: 0.32, color: '#d8e4ff' }
    ]
  }
}

export function addDirectionalLight() {
  if (viewerSettings.directionalLights.length >= MAX_DIRECTIONAL_LIGHTS) return
  viewerSettings.directionalLights = [
    ...viewerSettings.directionalLights,
    { enabled: true, position: [5, 8, 5], intensity: 0.35, color: '#ffffff' }
  ]
}

/** @param {number} index */
export function removeDirectionalLight(index) {
  if (viewerSettings.directionalLights.length <= 1) return
  viewerSettings.directionalLights = viewerSettings.directionalLights.filter((_, i) => i !== index)
}

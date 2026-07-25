/** @typedef {import('./easing.js').AnimationEasingKind} AnimationEasingKind */

import { reconcileViewTracks } from './tracks.js'
import { DEFAULT_EASING_KIND, normalizeBezier, normalizeEasingKind } from './easing.js'
import { normalizeFadeSettings } from './fade.js'
import { DEFAULT_ANIMATION_EXPORT_FORMAT, normalizeExportFormat } from './exportFormats.js'

/**
 * @typedef {Object} AnimationCameraFraming
 * @property {[number, number, number]} center
 * @property {number} extent
 * @property {number} framingZoom
 */

/**
 * @typedef {Object} AnimationCameraPose
 * @property {[number, number, number]} position
 * @property {[number, number, number]} target
 * @property {[number, number, number]} up
 * @property {number} zoom
 * @property {AnimationCameraFraming} [framing]
 */

/**
 * @typedef {Object} AnimationViewport
 * @property {boolean} [axesVisible]
 * @property {boolean} [axesLinesVisible]
 */

/**
 * @typedef {Object} SerializedAtomLabel
 * @property {string} id
 * @property {number} atomIndex
 * @property {string} text
 * @property {number} [size]
 * @property {string} [color]
 * @property {string} [background]
 * @property {number} [backgroundOpacity]
 * @property {number} [padding]
 * @property {number} [radius]
 * @property {number} [offsetY]
 * @property {'up' | 'down' | 'left' | 'right'} [liftDir]
 * @property {number} [screenDX] runtime/interpolated screen offset X (px)
 * @property {number} [screenDY] runtime/interpolated screen offset Y (px)
 * @property {boolean} [visible]
 * @property {boolean} [fadeEnabled]
 * @property {number} [fadeIn_s]
 * @property {number} [fadeOut_s]
 * @property {import('./easing.js').AnimationEasingKind} [fadeInEasing]
 * @property {import('./easing.js').AnimationEasingKind} [fadeOutEasing]
 * @property {[number, number, number, number]} [fadeInBezier]
 * @property {[number, number, number, number]} [fadeOutBezier]
 */

/**
 * @typedef {Object} SerializedMeasurement
 * @property {string} id
 * @property {'distance' | 'angle' | 'dihedral'} type
 * @property {number[]} atomIndices
 * @property {string} [color]
 * @property {number} [size]
 * @property {number} [lineWidth]
 * @property {boolean} [visible]
 * @property {boolean} [fadeEnabled]
 * @property {number} [fadeIn_s]
 * @property {number} [fadeOut_s]
 * @property {import('./easing.js').AnimationEasingKind} [fadeInEasing]
 * @property {import('./easing.js').AnimationEasingKind} [fadeOutEasing]
 * @property {[number, number, number, number]} [fadeInBezier]
 * @property {[number, number, number, number]} [fadeOutBezier]
 */

/**
 * @typedef {Object} SerializedView
 * @property {string} id
 * @property {string} selection
 * @property {string} baseSelection
 * @property {{ type: string }} representation
 * @property {boolean} visible
 * @property {{ name: string, color?: string }} colorScheme
 * @property {Record<string, string> | null} [ssColors]
 * @property {Record<string, unknown>} material
 * @property {number} [helixWidth]
 * @property {number} [sheetWidth]
 * @property {number} [coilWidth]
 * @property {number} [tubeRadius]
 * @property {number} [atomScale]
 * @property {number} [bondScale]
 * @property {number} [pointSize]
 * @property {number} [quality]
 * @property {boolean} [fadeEnabled]
 * @property {number} [fadeIn_s]
 * @property {number} [fadeOut_s]
 * @property {import('./easing.js').AnimationEasingKind} [fadeInEasing]
 * @property {import('./easing.js').AnimationEasingKind} [fadeOutEasing]
 * @property {[number, number, number, number]} [fadeInBezier]
 * @property {[number, number, number, number]} [fadeOutBezier]
 * @property {number} [opacity]
 */

/**
 * @typedef {Object} AnimationKeyframe
 * @property {string} id
 * @property {string} [name]
 * @property {number} time_s
 * @property {number} [hold_s]
 * @property {AnimationEasingKind} [easing]
 * @property {[number, number, number, number]} [easingBezier]
 * @property {AnimationCameraPose} camera
 * @property {SerializedView[]} views
 * @property {Record<string, unknown>} scene
 * @property {AnimationViewport} [viewport]
 * @property {SerializedAtomLabel[]} [labels]
 * @property {SerializedMeasurement[]} [measurements]
 * @property {{ indices: number[], xyz: number[] } | null} [coordPatch]
 *   Sparse absolute coordinates for atoms that differ from the project base pose.
 */

/**
 * @typedef {'16:9' | '9:16' | '4:3' | '3:4' | '1:1' | 'custom'} AnimationAspectPreset
 */

/**
 * @typedef {'mp4' | 'webm' | 'mov' | 'gif' | 'png'} AnimationExportFormat
 */

/**
 * @typedef {Object} AnimationExportFrame
 * @property {AnimationAspectPreset} aspectPreset
 * @property {number} width
 * @property {number} height
 * @property {boolean} showGuide
 * @property {AnimationExportFormat} [exportFormat]
 */

/**
 * @typedef {Object} AnimationProject
 * @property {'gatewizard-animation'} format
 * @property {number} version
 * @property {string} name
 * @property {{ path: string, topology?: string | null }} structure
 * @property {number} fps
 * @property {number} duration_s
 * @property {AnimationKeyframe[]} keyframes
 * @property {string[]} [viewTracks]
 * @property {AnimationExportFrame} [exportFrame]
 * @property {string} [outputFolder]
 * @property {Record<string, unknown>} [sceneDefaults]
 */

export const ANIMATION_FORMAT = 'gatewizard-animation'
/** v4: optional per-keyframe sparse `coordPatch` for atom motion. */
export const ANIMATION_VERSION = 4
export const DEFAULT_FPS = 30
export const DEFAULT_EASING = DEFAULT_EASING_KIND

/** @type {Record<AnimationAspectPreset, { width: number, height: number }>} */
export const EXPORT_ASPECT_PRESETS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1440, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
  '1:1': { width: 1080, height: 1080 },
  custom: { width: 1920, height: 1080 }
}

/** @returns {AnimationExportFrame} */
export function defaultExportFrame() {
  return {
    aspectPreset: '16:9',
    width: 1920,
    height: 1080,
    showGuide: true,
    exportFormat: DEFAULT_ANIMATION_EXPORT_FORMAT
  }
}

/**
 * @param {unknown} raw
 * @returns {AnimationExportFrame}
 */
export function normalizeExportFrame(raw) {
  const d = defaultExportFrame()
  const r = /** @type {Record<string, unknown>} */ (raw ?? {})
  const preset =
    typeof r.aspectPreset === 'string' && r.aspectPreset in EXPORT_ASPECT_PRESETS
      ? /** @type {AnimationAspectPreset} */ (r.aspectPreset)
      : d.aspectPreset
  const presetSize = EXPORT_ASPECT_PRESETS[preset]
  const width =
    typeof r.width === 'number' && r.width > 0
      ? Math.round(r.width)
      : preset === 'custom'
        ? d.width
        : presetSize.width
  const height =
    typeof r.height === 'number' && r.height > 0
      ? Math.round(r.height)
      : preset === 'custom'
        ? d.height
        : presetSize.height
  return {
    aspectPreset: preset,
    width,
    height,
    showGuide: r.showGuide !== false,
    exportFormat: normalizeExportFormat(r.exportFormat)
  }
}

/**
 * @param {Partial<AnimationProject>} [overrides]
 * @returns {AnimationProject}
 */
export function createEmptyProject(overrides = {}) {
  return {
    format: ANIMATION_FORMAT,
    version: ANIMATION_VERSION,
    name: 'Untitled animation',
    structure: { path: '', topology: null },
    fps: DEFAULT_FPS,
    duration_s: 10,
    keyframes: [],
    viewTracks: [],
    exportFrame: defaultExportFrame(),
    outputFolder: '',
    sceneDefaults: {},
    ...overrides
  }
}

/**
 * @param {unknown} data
 * @returns {AnimationProject}
 */
export function normalizeProject(data) {
  const raw = /** @type {Record<string, unknown>} */ (data ?? {})
  if (raw.format !== ANIMATION_FORMAT) {
    throw new Error('Not a GateWizard animation file (expected format gatewizard-animation)')
  }
  const keyframes = Array.isArray(raw.keyframes) ? raw.keyframes : []
  const project = createEmptyProject({
    name: typeof raw.name === 'string' ? raw.name : 'Animation',
    structure:
      raw.structure && typeof raw.structure === 'object'
        ? /** @type {{ path: string, topology?: string | null }} */ (raw.structure)
        : { path: '', topology: null },
    fps: typeof raw.fps === 'number' && raw.fps > 0 ? raw.fps : DEFAULT_FPS,
    duration_s:
      typeof raw.duration_s === 'number' && raw.duration_s > 0
        ? raw.duration_s
        : Math.max(10, ...keyframes.map((k) => /** @type {AnimationKeyframe} */ (k).time_s ?? 0)),
    keyframes: keyframes.map((k, i) => normalizeKeyframe(k, i)),
    viewTracks: Array.isArray(raw.viewTracks)
      ? raw.viewTracks.map(String)
      : undefined,
    exportFrame: normalizeExportFrame(raw.exportFrame),
    outputFolder: typeof raw.outputFolder === 'string' ? raw.outputFolder : '',
    sceneDefaults:
      raw.sceneDefaults && typeof raw.sceneDefaults === 'object'
        ? /** @type {Record<string, unknown>} */ (raw.sceneDefaults)
        : {}
  })
  project.viewTracks = reconcileViewTracks(project.viewTracks, project.keyframes)
  return project
}

function normalizeAtomLabel(raw) {
  const l = /** @type {Record<string, unknown>} */ (raw ?? {})
  if (typeof l.id !== 'string' || typeof l.atomIndex !== 'number' || typeof l.text !== 'string') {
    return null
  }
  return {
    id: l.id,
    atomIndex: l.atomIndex,
    text: l.text,
    size: typeof l.size === 'number' ? l.size : 12,
    color: typeof l.color === 'string' ? l.color : '#ffffff',
    background: typeof l.background === 'string' ? l.background : '#000000',
    backgroundOpacity:
      typeof l.backgroundOpacity === 'number' && l.backgroundOpacity >= 0
        ? Math.min(1, l.backgroundOpacity)
        : 0.75,
    padding: typeof l.padding === 'number' && l.padding >= 0 ? Math.min(24, l.padding) : 6,
    radius: typeof l.radius === 'number' && l.radius >= 0 ? Math.min(24, l.radius) : 4,
    offsetY: typeof l.offsetY === 'number' && l.offsetY >= 0 ? Math.min(80, l.offsetY) : 22,
    liftDir:
      l.liftDir === 'up' || l.liftDir === 'down' || l.liftDir === 'left' || l.liftDir === 'right'
        ? l.liftDir
        : 'up',
    visible: l.visible !== false,
    ...normalizeFadeSettings(l)
  }
}

function normalizeMeasurement(raw) {
  const m = /** @type {Record<string, unknown>} */ (raw ?? {})
  if (
    typeof m.id !== 'string' ||
    (m.type !== 'distance' && m.type !== 'angle' && m.type !== 'dihedral') ||
    !Array.isArray(m.atomIndices)
  ) {
    return null
  }
  const atomIndices = m.atomIndices.filter((i) => typeof i === 'number')
  if (!atomIndices.length) return null
  return {
    id: m.id,
    type: /** @type {'distance' | 'angle' | 'dihedral'} */ (m.type),
    atomIndices,
    color: typeof m.color === 'string' ? m.color : '#facc15',
    size: typeof m.size === 'number' ? m.size : 15,
    lineWidth: typeof m.lineWidth === 'number' ? m.lineWidth : 3,
    visible: m.visible !== false,
    ...normalizeFadeSettings(m)
  }
}

function normalizeCamera(raw) {
  const c = /** @type {Record<string, unknown>} */ (raw ?? {})
  const position = /** @type {[number, number, number]} */ (
    Array.isArray(c.position) ? c.position : [0, 0, 100]
  )
  const target = /** @type {[number, number, number]} */ (
    Array.isArray(c.target) ? c.target : [0, 0, 0]
  )
  const up = /** @type {[number, number, number]} */ (Array.isArray(c.up) ? c.up : [0, 1, 0])
  const zoom = typeof c.zoom === 'number' ? c.zoom : 1
  const framingRaw = /** @type {Record<string, unknown> | undefined} */ (c.framing)
  const center = Array.isArray(framingRaw?.center)
    ? /** @type {[number, number, number]} */ (framingRaw.center)
    : /** @type {[number, number, number]} */ ([...target])
  return {
    position: [...position],
    target: [...target],
    up: [...up],
    zoom,
    framing: {
      center: [...center],
      extent: typeof framingRaw?.extent === 'number' ? framingRaw.extent : 50,
      framingZoom: typeof framingRaw?.framingZoom === 'number' ? framingRaw.framingZoom : zoom
    }
  }
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @returns {AnimationKeyframe}
 */
/**
 * @param {unknown} raw
 * @returns {{ indices: number[], xyz: number[] } | null}
 */
export function normalizeCoordPatch(raw) {
  if (!raw || typeof raw !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  if (!Array.isArray(r.indices) || !Array.isArray(r.xyz)) return null
  const indices = r.indices.filter((i) => typeof i === 'number' && Number.isFinite(i)).map((i) => Math.trunc(i))
  const xyz = r.xyz.filter((n) => typeof n === 'number' && Number.isFinite(n))
  if (!indices.length || xyz.length !== indices.length * 3) return null
  return { indices, xyz: xyz.map(Number) }
}

function normalizeKeyframe(raw, index) {
  const k = /** @type {Record<string, unknown>} */ (raw ?? {})
  const camera = normalizeCamera(k.camera)
  const viewportRaw = /** @type {Record<string, unknown>} */ (k.viewport ?? {})
  const easing = normalizeEasingKind(k.easing)
  const coordPatch = normalizeCoordPatch(k.coordPatch)
  return {
    id: typeof k.id === 'string' ? k.id : crypto.randomUUID(),
    name: typeof k.name === 'string' ? k.name : `Keyframe ${index + 1}`,
    time_s: typeof k.time_s === 'number' ? k.time_s : index * 2,
    hold_s: typeof k.hold_s === 'number' ? k.hold_s : 0,
    easing,
    easingBezier: easing === 'bezier' ? normalizeBezier(k.easingBezier, easing) : undefined,
    camera,
    views: Array.isArray(k.views) ? /** @type {SerializedView[]} */ (k.views) : [],
    scene:
      k.scene && typeof k.scene === 'object'
        ? /** @type {Record<string, unknown>} */ (k.scene)
        : {},
    viewport: {
      axesVisible: viewportRaw.axesVisible !== false,
      axesLinesVisible: viewportRaw.axesLinesVisible === true
    },
    labels: Array.isArray(k.labels)
      ? k.labels.map(normalizeAtomLabel).filter(Boolean)
      : [],
    measurements: Array.isArray(k.measurements)
      ? k.measurements.map(normalizeMeasurement).filter(Boolean)
      : [],
    ...(coordPatch ? { coordPatch } : {})
  }
}

/**
 * Deep plain-object copy safe for Electron IPC.
 * @param {unknown} value
 */
export function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Plain JSON snapshot safe for Electron IPC (avoids Svelte $state proxy clone errors).
 * @param {AnimationProject} project
 * @param {{ path: string, topology?: string | null }} [structure]
 * @returns {AnimationProject}
 */
export function serializeAnimationProject(project, structure) {
  return toPlainJson({
    format: ANIMATION_FORMAT,
    version: ANIMATION_VERSION,
    name: project.name,
    structure: structure ?? project.structure,
    fps: project.fps,
    duration_s: project.duration_s,
    viewTracks: [...(project.viewTracks ?? [])],
    exportFrame: { ...(project.exportFrame ?? defaultExportFrame()) },
    keyframes: project.keyframes.map((k) => ({
      id: k.id,
      name: k.name,
      time_s: k.time_s,
      hold_s: k.hold_s,
      easing: k.easing,
      easingBezier: k.easingBezier ? [...k.easingBezier] : undefined,
      camera: {
        position: [...k.camera.position],
        target: [...k.camera.target],
        up: [...k.camera.up],
        zoom: k.camera.zoom,
        framing: k.camera.framing
          ? {
              center: [...k.camera.framing.center],
              extent: k.camera.framing.extent,
              framingZoom: k.camera.framing.framingZoom
            }
          : undefined
      },
      views: k.views.map((v) => ({
        id: v.id,
        selection: v.selection,
        baseSelection: v.baseSelection,
        representation: { type: v.representation.type },
        visible: v.visible,
        colorScheme: { ...v.colorScheme },
        ssColors: v.ssColors ? { ...v.ssColors } : null,
        material: { ...v.material },
        helixWidth: v.helixWidth,
        sheetWidth: v.sheetWidth,
        coilWidth: v.coilWidth,
        tubeRadius: v.tubeRadius,
        atomScale: v.atomScale,
        bondScale: v.bondScale,
        pointSize: v.pointSize,
        quality: v.quality,
        ...normalizeFadeSettings(v)
      })),
      scene: {
        ...k.scene,
        directionalLights: Array.isArray(k.scene?.directionalLights)
          ? k.scene.directionalLights.map((l) => ({
              enabled: l.enabled,
              position: Array.isArray(l.position) ? [...l.position] : [0, 0, 0],
              intensity: l.intensity
            }))
          : undefined
      },
      viewport: k.viewport ? { ...k.viewport } : undefined,
      labels: (k.labels ?? []).map((l) => ({ ...l })),
      measurements: (k.measurements ?? []).map((m) => ({
        ...m,
        atomIndices: [...m.atomIndices]
      })),
      ...(k.coordPatch?.indices?.length
        ? {
            coordPatch: {
              indices: [...k.coordPatch.indices],
              xyz: [...k.coordPatch.xyz]
            }
          }
        : {})
    })),
    outputFolder: project.outputFolder ?? '',
    sceneDefaults: project.sceneDefaults ? { ...project.sceneDefaults } : {}
  })
}

/**
 * @param {AnimationProject} project
 */
export function sortKeyframes(project) {
  project.keyframes.sort((a, b) => a.time_s - b.time_s)
}

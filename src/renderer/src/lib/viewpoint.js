/**
 * GateWizard viewpoint / session files — a single snapshot of the visualizer:
 * structure path, camera orbit+zoom, representations (materials/colors), scene lights,
 * axes, labels, and measurements. Reuses animation serialization primitives so the
 * saved look matches what the user sees.
 */

import { toPlainJson } from './animation/schema.js'
import { normalizeFadeSettings } from './animation/fade.js'

export const VIEWPOINT_FORMAT = 'gatewizard-viewpoint'
export const VIEWPOINT_VERSION = 1

/**
 * @typedef {Object} ViewerViewpoint
 * @property {'gatewizard-viewpoint'} format
 * @property {number} version
 * @property {string} name
 * @property {{ path: string, topology?: string | null }} structure
 * @property {import('./animation/schema.js').AnimationCameraPose} camera
 * @property {import('./animation/schema.js').SerializedView[]} views
 * @property {Record<string, unknown>} scene
 * @property {import('./animation/schema.js').AnimationViewport} viewport
 * @property {import('./animation/schema.js').SerializedAtomLabel[]} labels
 * @property {import('./animation/schema.js').SerializedMeasurement[]} measurements
 */

/**
 * @param {unknown} raw
 * @returns {import('./animation/schema.js').AnimationCameraPose}
 */
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
    position: /** @type {[number, number, number]} */ ([...position]),
    target: /** @type {[number, number, number]} */ ([...target]),
    up: /** @type {[number, number, number]} */ ([...up]),
    zoom,
    framing: {
      center: /** @type {[number, number, number]} */ ([...center]),
      extent: typeof framingRaw?.extent === 'number' ? framingRaw.extent : 50,
      framingZoom: typeof framingRaw?.framingZoom === 'number' ? framingRaw.framingZoom : zoom
    }
  }
}

/**
 * @param {unknown} raw
 * @returns {import('./animation/schema.js').SerializedAtomLabel | null}
 */
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

/**
 * @param {unknown} raw
 * @returns {import('./animation/schema.js').SerializedMeasurement | null}
 */
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

/**
 * @param {unknown} raw
 * @returns {import('./animation/schema.js').SerializedView | null}
 */
function normalizeView(raw) {
  const v = /** @type {Record<string, unknown>} */ (raw ?? {})
  if (typeof v.id !== 'string') return null
  const representation = /** @type {Record<string, unknown>} */ (v.representation ?? {})
  const colorScheme = /** @type {Record<string, unknown>} */ (v.colorScheme ?? {})
  const schemeName = typeof colorScheme.name === 'string' ? colorScheme.name : 'cpk'
  return {
    id: v.id,
    selection: typeof v.selection === 'string' ? v.selection : 'all',
    baseSelection:
      typeof v.baseSelection === 'string'
        ? v.baseSelection
        : typeof v.selection === 'string'
          ? v.selection
          : 'all',
    representation: {
      type: typeof representation.type === 'string' ? representation.type : 'points'
    },
    visible: v.visible !== false,
    colorScheme: {
      name: schemeName,
      ...(typeof colorScheme.color === 'string' ? { color: colorScheme.color } : {})
    },
    ssColors:
      v.ssColors && typeof v.ssColors === 'object'
        ? /** @type {Record<string, string>} */ ({ ...v.ssColors })
        : null,
    material:
      v.material && typeof v.material === 'object'
        ? /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(v.material)))
        : undefined,
    helixWidth: typeof v.helixWidth === 'number' ? v.helixWidth : 1,
    sheetWidth: typeof v.sheetWidth === 'number' ? v.sheetWidth : 0.875,
    coilWidth: typeof v.coilWidth === 'number' ? v.coilWidth : 0.125,
    tubeRadius: typeof v.tubeRadius === 'number' ? v.tubeRadius : 0.9,
    atomScale: typeof v.atomScale === 'number' ? v.atomScale : 1,
    bondScale: typeof v.bondScale === 'number' ? v.bondScale : 1,
    pointSize: typeof v.pointSize === 'number' ? v.pointSize : 3,
    quality: typeof v.quality === 'number' ? v.quality : 3,
    ...normalizeFadeSettings(v)
  }
}

/**
 * Wrap a `captureViewerSnapshot()` result into a viewpoint document.
 * @param {{
 *   name?: string
 *   structure: { path: string, topology?: string | null }
 *   snapshot: {
 *     camera: import('./animation/schema.js').AnimationCameraPose
 *     views: import('./animation/schema.js').SerializedView[]
 *     scene: Record<string, unknown>
 *     viewport: import('./animation/schema.js').AnimationViewport
 *     labels: import('./animation/schema.js').SerializedAtomLabel[]
 *     measurements: import('./animation/schema.js').SerializedMeasurement[]
 *   }
 * }} opts
 * @returns {ViewerViewpoint}
 */
export function buildViewpoint(opts) {
  const snap = opts.snapshot
  return {
    format: VIEWPOINT_FORMAT,
    version: VIEWPOINT_VERSION,
    name: opts.name || 'Viewpoint',
    structure: {
      path: opts.structure?.path ?? '',
      topology: opts.structure?.topology ?? null
    },
    camera: snap.camera,
    views: snap.views,
    scene: snap.scene,
    viewport: snap.viewport,
    labels: snap.labels,
    measurements: snap.measurements
  }
}

/**
 * Plain JSON safe for Electron IPC.
 * @param {ViewerViewpoint} viewpoint
 */
export function serializeViewpoint(viewpoint) {
  return toPlainJson({
    format: VIEWPOINT_FORMAT,
    version: VIEWPOINT_VERSION,
    name: viewpoint.name,
    structure: viewpoint.structure,
    camera: viewpoint.camera,
    views: viewpoint.views,
    scene: viewpoint.scene,
    viewport: viewpoint.viewport,
    labels: viewpoint.labels,
    measurements: viewpoint.measurements
  })
}

/**
 * @param {unknown} data
 * @returns {ViewerViewpoint}
 */
export function normalizeViewpoint(data) {
  const raw = /** @type {Record<string, unknown>} */ (data ?? {})
  if (raw.format !== VIEWPOINT_FORMAT) {
    throw new Error('Not a GateWizard viewpoint file (expected format gatewizard-viewpoint)')
  }
  const structureRaw = /** @type {Record<string, unknown>} */ (raw.structure ?? {})
  const viewportRaw = /** @type {Record<string, unknown>} */ (raw.viewport ?? {})
  const views = Array.isArray(raw.views)
    ? raw.views.map(normalizeView).filter(Boolean)
    : []
  return {
    format: VIEWPOINT_FORMAT,
    version: typeof raw.version === 'number' ? raw.version : VIEWPOINT_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'Viewpoint',
    structure: {
      path: typeof structureRaw.path === 'string' ? structureRaw.path : '',
      topology:
        typeof structureRaw.topology === 'string' || structureRaw.topology === null
          ? /** @type {string | null} */ (structureRaw.topology)
          : null
    },
    camera: normalizeCamera(raw.camera),
    views: /** @type {import('./animation/schema.js').SerializedView[]} */ (views),
    scene:
      raw.scene && typeof raw.scene === 'object'
        ? /** @type {Record<string, unknown>} */ (raw.scene)
        : {},
    viewport: {
      axesVisible: viewportRaw.axesVisible !== false,
      axesLinesVisible: viewportRaw.axesLinesVisible === true
    },
    labels: Array.isArray(raw.labels)
      ? /** @type {import('./animation/schema.js').SerializedAtomLabel[]} */ (
          raw.labels.map(normalizeAtomLabel).filter(Boolean)
        )
      : [],
    measurements: Array.isArray(raw.measurements)
      ? /** @type {import('./animation/schema.js').SerializedMeasurement[]} */ (
          raw.measurements.map(normalizeMeasurement).filter(Boolean)
        )
      : []
  }
}

import {
  chainScheme,
  constantScheme,
  cpkScheme,
  defaultColorScheme,
  goodsellChainScheme,
  residueNatureScheme,
  ssScheme,
  DEFAULT_VIEW_MATERIAL
} from '../colorSchemes.js'
import { viewerSettings } from '../viewerSettings.svelte.js'
import { captureCameraPose } from './cameraPose.js'
import { defaultFadeSettings, normalizeFadeSettings } from './fade.js'

/** @param {Record<string, unknown> | null | undefined} material */
export function cloneMaterial(material) {
  return JSON.parse(JSON.stringify(material ?? DEFAULT_VIEW_MATERIAL))
}

/**
 * @param {{ name: string, color?: string }} colorScheme
 * @param {{ residues?: unknown[], ssColors?: Record<string, string> | null }} view
 */
export function rebuildColorScheme(colorScheme, view) {
  const name = colorScheme?.name ?? 'cpk'
  const color = colorScheme?.color
  if (name === 'constant' && color) {
    return { name, color, resolver: constantScheme(color) }
  }
  if (name === 'constant') {
    return { name, color: '#00aaff', resolver: constantScheme('#00aaff') }
  }
  if (name === 'cpk-carbon' && color) {
    return { name, color, resolver: cpkScheme({ carbonColor: color }) }
  }
  if (name === 'chain') return { name, resolver: chainScheme() }
  if (name === 'goodsell') return { name, resolver: goodsellChainScheme() }
  if (name === 'residue_nature') return { name, resolver: residueNatureScheme() }
  if (name === 'ss') {
    const residues = view.residues
    const ssColors = view.ssColors
    return {
      name,
      resolver: residues?.length ? ssScheme(residues, ssColors ?? {}) : cpkScheme()
    }
  }
  if (name === 'cpk') return { name, resolver: cpkScheme() }
  return { name: 'default', resolver: defaultColorScheme }
}

/**
 * @param {{ id: string, atom: { index?: number }, text: string, size?: number, color?: string, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, visible?: boolean }} label
 * @returns {import('./schema.js').SerializedAtomLabel | null}
 */
export function serializeAtomLabel(label) {
  const atomIndex = label.atom?.index
  if (typeof atomIndex !== 'number') return null
  const fade = normalizeFadeSettings(label)
  const liftDir =
    label.liftDir === 'up' ||
    label.liftDir === 'down' ||
    label.liftDir === 'left' ||
    label.liftDir === 'right'
      ? label.liftDir
      : 'up'
  return {
    id: label.id,
    atomIndex,
    text: label.text,
    size: label.size ?? 12,
    color: label.color ?? '#ffffff',
    background: label.background ?? '#000000',
    backgroundOpacity:
      typeof label.backgroundOpacity === 'number' ? label.backgroundOpacity : 0.75,
    padding: typeof label.padding === 'number' ? label.padding : 6,
    radius: typeof label.radius === 'number' ? label.radius : 4,
    offsetY: typeof label.offsetY === 'number' ? label.offsetY : 22,
    liftDir,
    visible: label.visible !== false,
    ...fade
  }
}

/**
 * @param {{ id: string, type: 'distance' | 'angle' | 'dihedral', atoms: { index?: number }[], color?: string, size?: number, lineWidth?: number, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, visible?: boolean }} measurement
 * @returns {import('./schema.js').SerializedMeasurement | null}
 */
export function serializeMeasurement(measurement) {
  const atomIndices = measurement.atoms
    .map((a) => a.index)
    .filter((i) => typeof i === 'number')
  if (atomIndices.length !== measurement.atoms.length) return null
  const fade = normalizeFadeSettings(measurement)
  const liftDir =
    measurement.liftDir === 'up' ||
    measurement.liftDir === 'down' ||
    measurement.liftDir === 'left' ||
    measurement.liftDir === 'right'
      ? measurement.liftDir
      : 'up'
  return {
    id: measurement.id,
    type: measurement.type,
    atomIndices,
    color: measurement.color ?? '#facc15',
    size: measurement.size ?? 15,
    lineWidth: measurement.lineWidth ?? 3,
    background: measurement.background ?? '#000000',
    backgroundOpacity:
      typeof measurement.backgroundOpacity === 'number' ? measurement.backgroundOpacity : 0.75,
    padding: typeof measurement.padding === 'number' ? measurement.padding : 6,
    radius: typeof measurement.radius === 'number' ? measurement.radius : 4,
    offsetY: typeof measurement.offsetY === 'number' ? measurement.offsetY : 0,
    liftDir,
    visible: measurement.visible !== false,
    ...fade
  }
}

/**
 * @param {import('./schema.js').SerializedAtomLabel} data
 * @param {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} atoms
 */
export function deserializeAtomLabel(data, atoms) {
  const atom = atoms?.find((a) => a.index === data.atomIndex)
  if (!atom) return null
  const fade = normalizeFadeSettings(data)
  const opacity = typeof data.opacity === 'number' ? data.opacity : undefined
  return {
    id: data.id,
    atom,
    text: data.text,
    size: data.size ?? 12,
    color: data.color ?? '#ffffff',
    background: data.background ?? '#000000',
    backgroundOpacity:
      typeof data.backgroundOpacity === 'number' ? data.backgroundOpacity : 0.75,
    padding: typeof data.padding === 'number' ? data.padding : 6,
    radius: typeof data.radius === 'number' ? data.radius : 4,
    offsetY: typeof data.offsetY === 'number' ? data.offsetY : 22,
    liftDir:
      data.liftDir === 'up' ||
      data.liftDir === 'down' ||
      data.liftDir === 'left' ||
      data.liftDir === 'right'
        ? data.liftDir
        : 'up',
    // Continuous screen offset used during animation playback (not required on disk).
    ...(typeof data.screenDX === 'number' ? { screenDX: data.screenDX } : {}),
    ...(typeof data.screenDY === 'number' ? { screenDY: data.screenDY } : {}),
    visible: data.visible !== false,
    opacity,
    ...fade
  }
}

/**
 * @param {import('./schema.js').SerializedMeasurement} data
 * @param {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} atoms
 */
export function deserializeMeasurement(data, atoms) {
  const resolved = data.atomIndices.map((i) => atoms?.find((a) => a.index === i))
  if (resolved.some((a) => !a)) return null
  const fade = normalizeFadeSettings(data)
  const opacity = typeof data.opacity === 'number' ? data.opacity : undefined
  return {
    id: data.id,
    type: data.type,
    atoms: /** @type {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} */ (
      resolved
    ),
    color: data.color ?? '#facc15',
    size: data.size ?? 15,
    lineWidth: data.lineWidth ?? 3,
    background: data.background ?? '#000000',
    backgroundOpacity:
      typeof data.backgroundOpacity === 'number' ? data.backgroundOpacity : 0.75,
    padding: typeof data.padding === 'number' ? data.padding : 6,
    radius: typeof data.radius === 'number' ? data.radius : 4,
    offsetY: typeof data.offsetY === 'number' ? data.offsetY : 0,
    liftDir:
      data.liftDir === 'up' ||
      data.liftDir === 'down' ||
      data.liftDir === 'left' ||
      data.liftDir === 'right'
        ? data.liftDir
        : 'up',
    ...(typeof data.screenDX === 'number' ? { screenDX: data.screenDX } : {}),
    ...(typeof data.screenDY === 'number' ? { screenDY: data.screenDY } : {}),
    visible: data.visible !== false,
    opacity,
    ...fade
  }
}

/** @returns {ReturnType<typeof defaultFadeSettings>} */
export function liveOverlayFadeDefaults() {
  return defaultFadeSettings()
}

/**
 * @param {import('./schema.js').SerializedAtomLabel[]} labels
 * @param {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} atoms
 */
export function deserializeAtomLabels(labels, atoms) {
  return labels.map((l) => deserializeAtomLabel(l, atoms)).filter(Boolean)
}

/**
 * @param {import('./schema.js').SerializedMeasurement[]} measurements
 * @param {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} atoms
 */
export function deserializeMeasurements(measurements, atoms) {
  return measurements.map((m) => deserializeMeasurement(m, atoms)).filter(Boolean)
}

/**
 * @param {Record<string, unknown>} view
 * @returns {import('./schema.js').SerializedView}
 */
export function serializeView(view) {
  const cs = /** @type {{ name?: string, color?: string }} */ (view.colorScheme ?? {})
  const schemeName = cs.name === 'default' ? 'cpk' : (cs.name ?? 'cpk')
  const fade = normalizeFadeSettings(view)
  return {
    id: String(view.id),
    selection: String(view.selection ?? 'all'),
    baseSelection: String(view.baseSelection ?? view.selection ?? 'all'),
    representation: { type: String(view.representation?.type ?? 'points') },
    visible: view.visible !== false,
    colorScheme: {
      name: schemeName,
      ...(cs.color ? { color: cs.color } : {})
    },
    ssColors: view.ssColors ? { .../** @type {Record<string, string>} */ (view.ssColors) } : null,
    material: cloneMaterial(view.material),
    helixWidth: Number(view.helixWidth ?? 1),
    sheetWidth: Number(view.sheetWidth ?? 0.875),
    coilWidth: Number(view.coilWidth ?? 0.125),
    tubeRadius: Number(view.tubeRadius ?? 0.9),
    atomScale: Number(view.atomScale ?? 1),
    bondScale: Number(view.bondScale ?? 1),
    pointSize: Number(view.pointSize ?? 3),
    quality: Number(view.quality ?? 3),
    ...fade
  }
}

/**
 * Apply serialized visual settings onto an existing live view (keeps atoms/bonds/residues/path).
 * @param {Record<string, unknown>} live
 * @param {import('./schema.js').SerializedView} data
 */
export function mergeSerializedViewInto(live, data) {
  const prevScheme = /** @type {{ name?: string, color?: string } | undefined} */ (live.colorScheme)
  const nextSchemeName = data.colorScheme?.name ?? 'cpk'
  const prevSchemeName = prevScheme?.name === 'default' ? 'cpk' : prevScheme?.name ?? 'cpk'
  const panelSyncNeeded =
    prevSchemeName !== nextSchemeName ||
    prevScheme?.color !== data.colorScheme?.color ||
    live.representation?.type !== (data.representation?.type ?? 'points')

  live.selection = data.selection
  live.baseSelection = data.baseSelection ?? data.selection
  live.representation = { type: data.representation?.type ?? 'points' }
  live.visible = data.visible !== false
  live.ssColors = data.ssColors ? { ...data.ssColors } : null
  live.material = cloneMaterial(data.material)
  live.helixWidth = data.helixWidth ?? 1
  live.sheetWidth = data.sheetWidth ?? 0.875
  live.coilWidth = data.coilWidth ?? 0.125
  live.tubeRadius = data.tubeRadius ?? 0.9
  live.atomScale = data.atomScale ?? 1
  live.bondScale = data.bondScale ?? 1
  live.pointSize = data.pointSize ?? 3
  live.quality = data.quality ?? 3
  // `colorScheme.resolver` is a function identity that representation components
  // (Cartoon/Tube in particular) use as an effect dependency to rebuild their whole
  // mesh geometry. Rebuilding it on every animation frame — even when the scheme
  // hasn't actually changed — forces a full geometry rebuild every frame during
  // playback, which is catastrophically expensive for large representations and
  // can starve the render loop badly enough that visual updates never catch up.
  // Only rebuild (and hand out a new resolver reference) when the scheme inputs
  // actually changed.
  const residueCount = /** @type {unknown[] | undefined} */ (live.residues)?.length ?? 0
  const schemeSig = JSON.stringify([
    nextSchemeName,
    data.colorScheme?.color ?? null,
    data.ssColors ?? null,
    residueCount
  ])
  if (live._colorSchemeSig !== schemeSig || !live.colorScheme) {
    live.colorScheme = rebuildColorScheme(data.colorScheme, {
      residues: /** @type {unknown[] | undefined} */ (live.residues),
      ssColors: data.ssColors
    })
    live._colorSchemeSig = schemeSig
  }
  const fade = normalizeFadeSettings(data)
  live.fadeIn_s = fade.fadeIn_s
  live.fadeOut_s = fade.fadeOut_s
  live.fadeInEasing = fade.fadeInEasing
  live.fadeOutEasing = fade.fadeOutEasing
  live.fadeInBezier = fade.fadeInBezier
  live.fadeOutBezier = fade.fadeOutBezier
  live.fadeEnabled = fade.fadeEnabled
  if (typeof data.opacity === 'number') live.opacity = data.opacity
  else delete live.opacity
  if (panelSyncNeeded) {
    live._animSyncRev = (/** @type {number} */ (live._animSyncRev) || 0) + 1
  }
}

/**
 * @param {import('./schema.js').SerializedView} data
 * @param {{ path: string | null, atoms?: unknown[], bonds?: unknown[], residues?: unknown[] }} structureCtx
 */
export function deserializeView(data, structureCtx) {
  const nextSchemeName = data.colorScheme?.name ?? 'cpk'
  const colorScheme = rebuildColorScheme(data.colorScheme, {
    residues: structureCtx.residues,
    ssColors: data.ssColors
  })
  return {
    id: data.id || crypto.randomUUID(),
    selection: data.selection,
    baseSelection: data.baseSelection ?? data.selection,
    representation: { type: data.representation?.type ?? 'points' },
    path: structureCtx.path,
    atoms: structureCtx.atoms,
    bonds: structureCtx.bonds,
    residues: structureCtx.residues,
    visible: data.visible !== false,
    colorScheme,
    _colorSchemeSig: JSON.stringify([
      nextSchemeName,
      data.colorScheme?.color ?? null,
      data.ssColors ?? null,
      structureCtx.residues?.length ?? 0
    ]),
    ssColors: data.ssColors ? { ...data.ssColors } : null,
    material: cloneMaterial(data.material),
    helixWidth: data.helixWidth ?? 1,
    sheetWidth: data.sheetWidth ?? 0.875,
    coilWidth: data.coilWidth ?? 0.125,
    tubeRadius: data.tubeRadius ?? 0.9,
    atomScale: data.atomScale ?? 1,
    bondScale: data.bondScale ?? 1,
    pointSize: data.pointSize ?? 3,
    quality: data.quality ?? 3,
    ...normalizeFadeSettings(data)
  }
}

/**
 * @param {{
 *   views: Record<string, unknown>[]
 *   filePath: string | null
 *   structure: { atoms?: unknown[], bonds?: unknown[], residues?: unknown[] } | null
 *   getFraming?: () => {
 *     center: { x: number, y: number, z: number }
 *     extent: number
 *     framingZoom?: number
 *   } | null
 *   getViewport?: () => import('./schema.js').AnimationViewport
 *   getLabels?: () => Array<{ id: string, atom: { index?: number }, text: string, size?: number, color?: string, visible?: boolean }>
 *   getMeasurements?: () => Array<{ id: string, type: 'distance' | 'angle' | 'dihedral', atoms: { index?: number }[], color?: string, size?: number, lineWidth?: number, visible?: boolean }>
 * }} ctx
 */
export function captureViewerSnapshot(ctx) {
  const pose = captureCameraPose()
  if (!pose) throw new Error('Camera not ready')

  const framingState = ctx.getFraming?.()
  // Live orbit zoom lives on the Three.js camera (`pose.zoom`), not on the Svelte
  // framing object (whose `framingZoom` is usually left at the default 1). Always
  // prefer the live zoom so saved viewpoints / keyframes restore the real zoom.
  const liveZoom = typeof pose.zoom === 'number' ? pose.zoom : 1
  const camera = {
    ...pose,
    zoom: liveZoom,
    framing: framingState
      ? {
          center: [framingState.center.x, framingState.center.y, framingState.center.z],
          extent: framingState.extent,
          framingZoom: liveZoom
        }
      : {
          center: [...pose.target],
          extent: 50,
          framingZoom: liveZoom
        }
  }

  return {
    camera,
    // Never persist ephemeral select-mode highlight layers (cartoon/tube assistants).
    views: ctx.views.filter((v) => !v._isSelHighlight).map((v) => serializeView(v)),
    scene: serializeSceneSettings(),
    viewport: ctx.getViewport?.() ?? { axesVisible: true, axesLinesVisible: false },
    labels: (ctx.getLabels?.() ?? []).map(serializeAtomLabel).filter(Boolean),
    measurements: (ctx.getMeasurements?.() ?? []).map(serializeMeasurement).filter(Boolean)
  }
}

export function serializeSceneSettings() {
  const dof = viewerSettings.dof ?? {
    enabled: false,
    focusDistance: 80,
    focusRange: 20,
    bokehScale: 2.5,
    focusTarget: null
  }
  return JSON.parse(
    JSON.stringify({
      backgroundMode: viewerSettings.backgroundMode,
      customBackgroundHex: viewerSettings.customBackgroundHex,
      hemisphereSky: viewerSettings.hemisphereSky,
      hemisphereGround: viewerSettings.hemisphereGround,
      hemisphereIntensity: viewerSettings.hemisphereIntensity,
      ambientIntensity: viewerSettings.ambientIntensity,
      directionalLights: viewerSettings.directionalLights.map((l) => ({
        enabled: l.enabled,
        position: [...l.position],
        intensity: l.intensity
      })),
      dof: {
        enabled: dof.enabled === true,
        focusDistance: dof.focusDistance,
        focusRange: dof.focusRange,
        bokehScale: dof.bokehScale,
        focusTarget: dof.focusTarget
          ? { x: dof.focusTarget.x, y: dof.focusTarget.y, z: dof.focusTarget.z }
          : null
      }
    })
  )
}

/**
 * @param {Record<string, unknown>} scene
 */
export function applySceneSettings(scene) {
  if (typeof scene.backgroundMode === 'string') {
    viewerSettings.backgroundMode = /** @type {'theme' | 'custom'} */ (scene.backgroundMode)
  }
  if (typeof scene.customBackgroundHex === 'string') {
    viewerSettings.customBackgroundHex = scene.customBackgroundHex
  }
  if (typeof scene.hemisphereSky === 'string') viewerSettings.hemisphereSky = scene.hemisphereSky
  if (typeof scene.hemisphereGround === 'string') {
    viewerSettings.hemisphereGround = scene.hemisphereGround
  }
  if (typeof scene.hemisphereIntensity === 'number') {
    viewerSettings.hemisphereIntensity = scene.hemisphereIntensity
  }
  if (typeof scene.ambientIntensity === 'number') {
    viewerSettings.ambientIntensity = scene.ambientIntensity
  }
  if (Array.isArray(scene.directionalLights)) {
    viewerSettings.directionalLights = scene.directionalLights.map((l, i) => {
      const fallback = viewerSettings.directionalLights[i] ?? {
        enabled: true,
        position: [0, 0, 0],
        intensity: 0.4
      }
      const item = /** @type {Record<string, unknown>} */ (l)
      return {
        enabled: item.enabled !== false,
        position: Array.isArray(item.position)
          ? /** @type {[number, number, number]} */ ([...item.position])
          : fallback.position,
        intensity:
          typeof item.intensity === 'number' ? item.intensity : fallback.intensity
      }
    })
  }
  if (scene.dof && typeof scene.dof === 'object') {
    const d = /** @type {Record<string, unknown>} */ (scene.dof)
    const t = d.focusTarget && typeof d.focusTarget === 'object'
      ? /** @type {Record<string, unknown>} */ (d.focusTarget)
      : null
    viewerSettings.dof = {
      enabled: d.enabled === true,
      focusDistance:
        typeof d.focusDistance === 'number' ? d.focusDistance : viewerSettings.dof?.focusDistance ?? 80,
      focusRange:
        typeof d.focusRange === 'number' ? d.focusRange : viewerSettings.dof?.focusRange ?? 20,
      bokehScale:
        typeof d.bokehScale === 'number' ? d.bokehScale : viewerSettings.dof?.bokehScale ?? 2.5,
      focusTarget:
        t &&
        typeof t.x === 'number' &&
        typeof t.y === 'number' &&
        typeof t.z === 'number'
          ? { x: t.x, y: t.y, z: t.z }
          : null
    }
  }
}

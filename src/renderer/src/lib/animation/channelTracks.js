/**
 * Per-channel animation keys with independent times.
 * Camera, structure motion, and representation view keys are sampled separately.
 */

import { applyEasing, DEFAULT_EASING_KIND, normalizeBezier, normalizeEasingKind } from './easing.js'
import { normalizeFadeSettings, computeOverlayOpacity } from './fade.js'
import { interpolateCameraPose } from './cameraPoseMath.js'
import { interpolateScene, interpolateView } from './interpolate.js'
import { lerpPatches, normalizeCoordPatch } from '../viewer/workingCoords.js'

/**
 * @typedef {{
 *   id: string
 *   time_s: number
 *   camera: import('./schema.js').AnimationCameraPose
 *   cameraEasing?: import('./easing.js').AnimationEasingKind
 *   cameraEasingBezier?: [number, number, number, number]
 *   scene?: Record<string, unknown>
 *   viewport?: import('./schema.js').AnimationViewport
 *   labels?: import('./schema.js').SerializedAtomLabel[]
 *   measurements?: import('./schema.js').SerializedMeasurement[]
 * }} CameraChannelKey
 */

/**
 * @typedef {{
 *   id: string
 *   time_s: number
 *   coordPatch?: { indices: number[], xyz: number[] } | null
 *   trajFrame?: number
 *   motionEasing?: import('./easing.js').AnimationEasingKind
 *   motionEasingBezier?: [number, number, number, number]
 * }} StructureChannelKey
 */

/**
 * @typedef {{
 *   id: string
 *   time_s: number
 *   view: import('./schema.js').SerializedView
 *   styleEasing?: import('./easing.js').AnimationEasingKind
 *   styleEasingBezier?: [number, number, number, number]
 * }} ViewChannelKey
 */

/**
 * @typedef {{ keys: CameraChannelKey[] }} CameraTrack
 * @typedef {{ keys: StructureChannelKey[] }} StructureTrack
 * @typedef {{ keys: ViewChannelKey[] }} ViewKeyTrack
 */

/** @param {Array<{ time_s: number }>} keys */
export function sortChannelKeys(keys) {
  keys.sort((a, b) => a.time_s - b.time_s)
  return keys
}

/**
 * @template {{ time_s: number }} T
 * @param {T[]} keys
 * @param {number} time_s
 * @returns {{ from: T, to: T, rawT: number, segmentDuration: number } | null}
 */
export function findChannelSegment(keys, time_s) {
  if (!keys?.length) return null
  const sorted = [...keys].sort((a, b) => a.time_s - b.time_s)
  if (sorted.length === 1) {
    return { from: sorted[0], to: sorted[0], rawT: 0, segmentDuration: 0 }
  }
  if (time_s <= sorted[0].time_s) {
    return { from: sorted[0], to: sorted[0], rawT: 0, segmentDuration: 0 }
  }
  let from = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const to = sorted[i]
    if (time_s <= to.time_s) {
      const segmentDuration = Math.max(0.001, to.time_s - from.time_s)
      const rawT = (time_s - from.time_s) / segmentDuration
      return { from, to, rawT, segmentDuration }
    }
    from = to
  }
  const last = sorted[sorted.length - 1]
  return { from: last, to: last, rawT: 0, segmentDuration: 0 }
}

/**
 * @param {number} rawT
 * @param {import('./easing.js').AnimationEasingKind | undefined} easing
 * @param {[number, number, number, number] | undefined} bezier
 */
export function easedT(rawT, easing, bezier) {
  return applyEasing(rawT, easing ?? DEFAULT_EASING_KIND, bezier)
}

/**
 * @param {unknown} raw
 * @returns {CameraTrack}
 */
export function normalizeCameraTrack(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw ?? {})
  const keys = Array.isArray(r.keys) ? r.keys : []
  return {
    keys: sortChannelKeys(
      keys.map((k, i) => normalizeCameraChannelKey(k, i)).filter(Boolean)
    )
  }
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @returns {CameraChannelKey | null}
 */
function normalizeCameraChannelKey(raw, index) {
  const k = /** @type {Record<string, unknown>} */ (raw ?? {})
  const cam = k.camera && typeof k.camera === 'object' ? /** @type {any} */ (k.camera) : null
  if (!cam || !Array.isArray(cam.position) || !Array.isArray(cam.target)) return null
  const cameraEasing = normalizeEasingKind(k.cameraEasing)
  return {
    id: typeof k.id === 'string' ? k.id : crypto.randomUUID(),
    time_s: typeof k.time_s === 'number' ? k.time_s : index,
    camera: {
      position: [...cam.position],
      target: [...cam.target],
      up: Array.isArray(cam.up) ? [...cam.up] : [0, 1, 0],
      zoom: typeof cam.zoom === 'number' ? cam.zoom : 1,
      framing: cam.framing
    },
    cameraEasing,
    cameraEasingBezier:
      cameraEasing === 'bezier' ? normalizeBezier(k.cameraEasingBezier, cameraEasing) : undefined,
    scene: k.scene && typeof k.scene === 'object' ? /** @type {Record<string, unknown>} */ (k.scene) : {},
    viewport: k.viewport && typeof k.viewport === 'object'
      ? /** @type {import('./schema.js').AnimationViewport} */ (k.viewport)
      : undefined,
    labels: Array.isArray(k.labels) ? /** @type {any[]} */ (k.labels) : [],
    measurements: Array.isArray(k.measurements) ? /** @type {any[]} */ (k.measurements) : []
  }
}

/**
 * @param {unknown} raw
 * @returns {Record<string, StructureTrack>}
 */
export function normalizeStructureTracks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  /** @type {Record<string, StructureTrack>} */
  const out = {}
  for (const [sid, track] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    const t = /** @type {Record<string, unknown>} */ (track ?? {})
    const keys = Array.isArray(t.keys) ? t.keys : []
    out[sid] = {
      keys: sortChannelKeys(
        keys.map((k, i) => normalizeStructureChannelKey(k, i)).filter(Boolean)
      )
    }
  }
  return out
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @returns {StructureChannelKey | null}
 */
function normalizeStructureChannelKey(raw, index) {
  const k = /** @type {Record<string, unknown>} */ (raw ?? {})
  const motionEasing = normalizeEasingKind(k.motionEasing)
  const coordPatch = normalizeCoordPatch(k.coordPatch)
  return {
    id: typeof k.id === 'string' ? k.id : crypto.randomUUID(),
    time_s: typeof k.time_s === 'number' ? k.time_s : index,
    ...(coordPatch ? { coordPatch } : {}),
    ...(typeof k.trajFrame === 'number' && Number.isFinite(k.trajFrame)
      ? { trajFrame: Math.max(0, k.trajFrame) }
      : {}),
    motionEasing,
    motionEasingBezier:
      motionEasing === 'bezier' ? normalizeBezier(k.motionEasingBezier, motionEasing) : undefined
  }
}

/**
 * @param {unknown} raw
 * @returns {Record<string, ViewKeyTrack>}
 */
export function normalizeViewKeyTracks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  /** @type {Record<string, ViewKeyTrack>} */
  const out = {}
  for (const [vid, track] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    const t = /** @type {Record<string, unknown>} */ (track ?? {})
    const keys = Array.isArray(t.keys) ? t.keys : []
    out[vid] = {
      keys: sortChannelKeys(
        keys.map((k, i) => normalizeViewChannelKey(k, i, vid)).filter(Boolean)
      )
    }
  }
  return out
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @param {string} viewId
 * @returns {ViewChannelKey | null}
 */
function normalizeViewChannelKey(raw, index, viewId) {
  const k = /** @type {Record<string, unknown>} */ (raw ?? {})
  const view = k.view && typeof k.view === 'object' ? /** @type {any} */ (k.view) : null
  if (!view) return null
  const styleEasing = normalizeEasingKind(k.styleEasing)
  return {
    id: typeof k.id === 'string' ? k.id : crypto.randomUUID(),
    time_s: typeof k.time_s === 'number' ? k.time_s : index,
    view: {
      ...view,
      id: String(view.id || viewId),
      ...normalizeFadeSettings(view)
    },
    styleEasing,
    styleEasingBezier:
      styleEasing === 'bezier' ? normalizeBezier(k.styleEasingBezier, styleEasing) : undefined
  }
}

/**
 * Expand legacy shared keyframes into independent channel tracks.
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {string | null} [primaryId]
 */
export function migrateKeyframesToChannelTracks(keyframes, primaryId = null) {
  /** @type {CameraChannelKey[]} */
  const cameraKeys = []
  /** @type {Record<string, StructureChannelKey[]>} */
  const structureKeys = {}
  /** @type {Record<string, ViewChannelKey[]>} */
  const viewKeys = {}

  for (const kf of keyframes || []) {
    cameraKeys.push({
      id: crypto.randomUUID(),
      time_s: kf.time_s,
      camera: kf.camera,
      cameraEasing: kf.cameraEasing ?? kf.easing,
      cameraEasingBezier: kf.cameraEasingBezier ?? kf.easingBezier,
      scene: kf.scene ?? {},
      viewport: kf.viewport,
      labels: kf.labels ?? [],
      measurements: kf.measurements ?? []
    })

    const patches = { ...(kf.coordPatches || {}) }
    if (primaryId && kf.coordPatch && !patches[primaryId]) {
      patches[primaryId] = kf.coordPatch
    }
    const sidList = Object.keys(patches)
    if (!sidList.length && typeof kf.trajFrame === 'number' && primaryId) {
      sidList.push(primaryId)
    }
    for (const sid of sidList) {
      if (!structureKeys[sid]) structureKeys[sid] = []
      const me = kf.motionEasings?.[sid]
      structureKeys[sid].push({
        id: crypto.randomUUID(),
        time_s: kf.time_s,
        ...(patches[sid] ? { coordPatch: patches[sid] } : {}),
        ...(typeof kf.trajFrame === 'number' ? { trajFrame: kf.trajFrame } : {}),
        motionEasing: me?.easing ?? kf.motionEasing,
        motionEasingBezier: me?.easingBezier ?? kf.motionEasingBezier
      })
    }

    for (const v of kf.views || []) {
      const vid = String(v.id)
      if (!viewKeys[vid]) viewKeys[vid] = []
      viewKeys[vid].push({
        id: crypto.randomUUID(),
        time_s: kf.time_s,
        view: JSON.parse(JSON.stringify(v)),
        styleEasing: DEFAULT_EASING_KIND
      })
    }
  }

  /** @type {Record<string, StructureTrack>} */
  const structureTracks = {}
  for (const [sid, keys] of Object.entries(structureKeys)) {
    structureTracks[sid] = { keys: sortChannelKeys(keys) }
  }
  /** @type {Record<string, ViewKeyTrack>} */
  const viewKeyTracks = {}
  for (const [vid, keys] of Object.entries(viewKeys)) {
    viewKeyTracks[vid] = { keys: sortChannelKeys(keys) }
  }

  return {
    cameraTrack: { keys: sortChannelKeys(cameraKeys) },
    structureTracks,
    viewKeyTracks
  }
}

/**
 * @param {import('./schema.js').AnimationProject} project
 * @returns {boolean}
 */
export function projectHasChannelTracks(project) {
  return !!(
    project?.cameraTrack?.keys?.length ||
    (project?.structureTracks && Object.keys(project.structureTracks).length) ||
    (project?.viewKeyTracks && Object.keys(project.viewKeyTracks).length)
  )
}

/**
 * Upsert a key at time_s on a sorted key list (merge within 0.05s).
 * @template {{ id: string, time_s: number }} T
 * @param {T[]} keys
 * @param {T} key
 * @returns {T[]}
 */
export function upsertChannelKey(keys, key) {
  const next = [...(keys || [])]
  const idx = next.findIndex((k) => Math.abs(k.time_s - key.time_s) < 0.05)
  if (idx >= 0) {
    next[idx] = { ...key, id: next[idx].id, time_s: key.time_s }
  } else {
    next.push(key)
  }
  return sortChannelKeys(next)
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
function lerpNum(a, b, t) {
  return a + (b - a) * t
}

/**
 * Sample independent channels at playhead time.
 * @param {import('./schema.js').AnimationProject} project
 * @param {number} time_s
 * @param {Map<number, [number, number, number]> | null} [baseCoords]
 * @param {string | null} [primaryStructureId]
 */
export function interpolateChannelsAtTime(
  project,
  time_s,
  baseCoords = null,
  primaryStructureId = null
) {
  const cameraTrack = project.cameraTrack ?? { keys: [] }
  const structureTracks = project.structureTracks ?? {}
  const viewKeyTracks = project.viewKeyTracks ?? {}
  const viewOrder =
    Array.isArray(project.viewTracks) && project.viewTracks.length
      ? project.viewTracks
      : Object.keys(viewKeyTracks)

  const camSeg = findChannelSegment(cameraTrack.keys, time_s)
  if (!camSeg && !Object.keys(structureTracks).length && !Object.keys(viewKeyTracks).length) {
    return null
  }

  let camera = camSeg?.from.camera
  let scene = camSeg?.from.scene ?? {}
  let viewport = camSeg?.from.viewport
  let labels = camSeg?.from.labels ?? []
  let measurements = camSeg?.from.measurements ?? []

  if (camSeg && camSeg.from !== camSeg.to) {
    const t = easedT(camSeg.rawT, camSeg.to.cameraEasing, camSeg.to.cameraEasingBezier)
    const pose = interpolateCameraPose(camSeg.from.camera, camSeg.to.camera, t)
    const fa = camSeg.from.camera.framing
    const fb = camSeg.to.camera.framing
    camera = {
      ...pose,
      framing:
        fa && fb
          ? {
              center: [
                lerpNum(fa.center[0], fb.center[0], t),
                lerpNum(fa.center[1], fb.center[1], t),
                lerpNum(fa.center[2], fb.center[2], t)
              ],
              extent: lerpNum(fa.extent, fb.extent, t),
              framingZoom: lerpNum(fa.framingZoom ?? 1, fb.framingZoom ?? 1, t)
            }
          : fa || fb
    }
    scene = interpolateScene(camSeg.from.scene ?? {}, camSeg.to.scene ?? {}, t)
    viewport = t < 0.5 ? camSeg.from.viewport : camSeg.to.viewport
    labels = t < 0.5 ? (camSeg.from.labels ?? []) : (camSeg.to.labels ?? [])
    measurements = t < 0.5 ? (camSeg.from.measurements ?? []) : (camSeg.to.measurements ?? [])
  }

  /** @type {Record<string, { indices: number[], xyz: number[] }>} */
  const coordPatches = {}
  let trajFrame = /** @type {number | null} */ (null)
  let primaryPatch = /** @type {{ indices: number[], xyz: number[] } | null} */ (null)

  for (const [sid, track] of Object.entries(structureTracks)) {
    const sortedKeys = [...(track.keys || [])].sort((a, b) => a.time_s - b.time_s)
    if (!sortedKeys.length) continue
    // No motion before the first structure key (independent channel start).
    if (time_s + 1e-9 < sortedKeys[0].time_s) continue
    const seg = findChannelSegment(sortedKeys, time_s)
    if (!seg) continue
    const t = easedT(seg.rawT, seg.to.motionEasing, seg.to.motionEasingBezier)
    const patch = lerpPatches(seg.from.coordPatch ?? null, seg.to.coordPatch ?? null, t, baseCoords)
    if (patch) {
      coordPatches[sid] = patch
      if (sid === primaryStructureId) primaryPatch = patch
    }
    const tf =
      t < 0.5
        ? seg.from.trajFrame
        : seg.to.trajFrame ?? seg.from.trajFrame
    if (typeof tf === 'number' && (sid === primaryStructureId || trajFrame == null)) {
      trajFrame = tf
    }
  }

  /** @type {import('./schema.js').SerializedView[]} */
  const views = []
  for (const vid of viewOrder) {
    const track = viewKeyTracks[vid]
    const sortedKeys = [...(track?.keys || [])].sort((a, b) => a.time_s - b.time_s)
    if (!sortedKeys.length) continue
    // Hold first representation key only once we reach it.
    if (time_s + 1e-9 < sortedKeys[0].time_s) continue
    const seg = findChannelSegment(sortedKeys, time_s)
    if (!seg) continue
    const fromV = seg.from.view
    const toV = seg.to.view
    const fadeFactor =
      seg.from === seg.to
        ? fromV.visible === false
          ? 0
          : 1
        : computeOverlayOpacity(fromV, toV, seg.rawT, seg.segmentDuration)
    /** @type {import('./schema.js').SerializedView} */
    let styled
    if (seg.from === seg.to) {
      styled = JSON.parse(JSON.stringify(fromV))
    } else {
      const t = easedT(seg.rawT, seg.to.styleEasing, seg.to.styleEasingBezier)
      styled = interpolateView(fromV, toV, t)
    }
    const baseOpacity = typeof styled.opacity === 'number' ? styled.opacity : 1
    const opacity = Math.max(0, Math.min(1, baseOpacity * fadeFactor))
    views.push({
      ...styled,
      opacity,
      visible: opacity > 0.001
    })
  }

  if (!camera && !views.length && !Object.keys(coordPatches).length) return null

  return {
    camera: camera ?? {
      position: [0, 0, 50],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1
    },
    views,
    scene,
    viewport,
    labels,
    measurements,
    coordPatch: primaryPatch,
    ...(Object.keys(coordPatches).length ? { coordPatches } : {}),
    ...(trajFrame != null ? { trajFrame } : {})
  }
}

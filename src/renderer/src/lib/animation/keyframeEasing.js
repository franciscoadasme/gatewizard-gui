import { DEFAULT_EASING_KIND } from './easing.js'

/**
 * @param {number} a
 * @param {number} b
 * @param {number} [abs]
 * @param {number} [rel]
 */
function numsClose(a, b, abs = 0.02, rel = 1e-4) {
  const da = Number(a)
  const db = Number(b)
  if (!Number.isFinite(da) || !Number.isFinite(db)) return !Number.isFinite(da) && !Number.isFinite(db)
  const d = Math.abs(da - db)
  return d <= abs || d <= rel * Math.max(Math.abs(da), Math.abs(db), 1)
}

/**
 * @param {number[] | null | undefined} a
 * @param {number[] | null | undefined} b
 */
function vecsClose(a, b) {
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false
  return a.every((v, i) => numsClose(v, b[i]))
}

/**
 * True when orbit/pan/zoom/framing did not change between two keyframe cameras.
 * @param {import('./schema.js').AnimationCameraPose | null | undefined} a
 * @param {import('./schema.js').AnimationCameraPose | null | undefined} b
 */
export function camerasApproximatelyEqual(a, b) {
  if (!a || !b) return !a && !b
  if (!vecsClose(a.position, b.position)) return false
  if (!vecsClose(a.target, b.target)) return false
  if (!vecsClose(a.up, b.up)) return false
  if (!numsClose(a.zoom ?? 1, b.zoom ?? 1, 1e-3, 1e-4)) return false
  const fa = a.framing
  const fb = b.framing
  if (fa && fb) {
    if (!vecsClose(fa.center, fb.center)) return false
    if (!numsClose(fa.extent, fb.extent, 0.05, 1e-4)) return false
    if (!numsClose(fa.framingZoom ?? 1, fb.framingZoom ?? 1, 1e-3, 1e-4)) return false
  }
  return true
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function hexEqual(a, b) {
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function sceneNum(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 */
function fogApproximatelyEqual(a, b) {
  const fa = a && typeof a === 'object' ? a : {}
  const fb = b && typeof b === 'object' ? b : {}
  if ((fa.enabled === true) !== (fb.enabled === true)) return false
  if ((fa.matchBackground !== false) !== (fb.matchBackground !== false)) return false
  if (!hexEqual(fa.color ?? '#0c0e12', fb.color ?? '#0c0e12')) return false
  if (!numsClose(sceneNum(fa.near, 70), sceneNum(fb.near, 70), 1e-2, 1e-4)) return false
  if (!numsClose(sceneNum(fa.far, 140), sceneNum(fb.far, 140), 1e-2, 1e-4)) return false
  return true
}

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 */
function shadowsApproximatelyEqual(a, b) {
  const sa = a && typeof a === 'object' ? a : {}
  const sb = b && typeof b === 'object' ? b : {}
  if ((sa.enabled === true) !== (sb.enabled === true)) return false
  if (!numsClose(sceneNum(sa.strength, 1), sceneNum(sb.strength, 1), 1e-3, 1e-4)) return false
  if (!numsClose(sceneNum(sa.softness, 0.45), sceneNum(sb.softness, 0.45), 1e-3, 1e-4)) return false
  return true
}

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 */
function dofApproximatelyEqual(a, b) {
  const da = a && typeof a === 'object' ? a : {}
  const db = b && typeof b === 'object' ? b : {}
  if ((da.enabled === true) !== (db.enabled === true)) return false
  if (!numsClose(sceneNum(da.focusDistance, 80), sceneNum(db.focusDistance, 80), 1e-2, 1e-4)) return false
  if (!numsClose(sceneNum(da.focusRange, 20), sceneNum(db.focusRange, 20), 1e-2, 1e-4)) return false
  if (!numsClose(sceneNum(da.bokehScale, 2.5), sceneNum(db.bokehScale, 2.5), 1e-3, 1e-4)) return false
  const ta = da.focusTarget && typeof da.focusTarget === 'object' ? /** @type {Record<string, number>} */ (da.focusTarget) : null
  const tb = db.focusTarget && typeof db.focusTarget === 'object' ? /** @type {Record<string, number>} */ (db.focusTarget) : null
  if (!ta || !tb) return !ta && !tb
  return (
    numsClose(ta.x ?? 0, tb.x ?? 0, 1e-3, 1e-4) &&
    numsClose(ta.y ?? 0, tb.y ?? 0, 1e-3, 1e-4) &&
    numsClose(ta.z ?? 0, tb.z ?? 0, 1e-3, 1e-4)
  )
}

/**
 * True when background, lights, depth cueing, shadows, and depth of field match.
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 */
export function scenesApproximatelyEqual(a, b) {
  if (!a || !b) return !a && !b
  if ((a.backgroundMode ?? 'theme') !== (b.backgroundMode ?? 'theme')) return false
  if (!hexEqual(a.customBackgroundHex ?? '', b.customBackgroundHex ?? '')) return false
  if ((a.theme ?? '') !== (b.theme ?? '')) return false
  if ((a.lightMode ?? 'camera') !== (b.lightMode ?? 'camera')) return false
  if (!hexEqual(a.hemisphereSky ?? '', b.hemisphereSky ?? '')) return false
  if (!hexEqual(a.hemisphereGround ?? '', b.hemisphereGround ?? '')) return false
  if (!numsClose(sceneNum(a.hemisphereIntensity, 1.4), sceneNum(b.hemisphereIntensity, 1.4), 1e-3, 1e-4)) {
    return false
  }
  if (!hexEqual(a.ambientColor ?? '#ffffff', b.ambientColor ?? '#ffffff')) return false
  if (!numsClose(sceneNum(a.ambientIntensity, 1.4), sceneNum(b.ambientIntensity, 1.4), 1e-3, 1e-4)) {
    return false
  }
  const la = Array.isArray(a.directionalLights) ? a.directionalLights : []
  const lb = Array.isArray(b.directionalLights) ? b.directionalLights : []
  if (la.length !== lb.length) return false
  for (let i = 0; i < la.length; i++) {
    const lightA = /** @type {Record<string, unknown>} */ (la[i] ?? {})
    const lightB = /** @type {Record<string, unknown>} */ (lb[i] ?? {})
    if ((lightA.enabled !== false) !== (lightB.enabled !== false)) return false
    if (!hexEqual(lightA.color ?? '#ffffff', lightB.color ?? '#ffffff')) return false
    if (!numsClose(sceneNum(lightA.intensity, 0.4), sceneNum(lightB.intensity, 0.4), 1e-3, 1e-4)) return false
    const posA = Array.isArray(lightA.position) ? /** @type {number[]} */ (lightA.position) : [0, 0, 0]
    const posB = Array.isArray(lightB.position) ? /** @type {number[]} */ (lightB.position) : [0, 0, 0]
    if (!vecsClose(posA, posB)) return false
  }
  if (!fogApproximatelyEqual(/** @type {Record<string, unknown>} */ (a.fog), /** @type {Record<string, unknown>} */ (b.fog))) {
    return false
  }
  if (
    !shadowsApproximatelyEqual(
      /** @type {Record<string, unknown>} */ (a.shadows),
      /** @type {Record<string, unknown>} */ (b.shadows)
    )
  ) {
    return false
  }
  if (!dofApproximatelyEqual(/** @type {Record<string, unknown>} */ (a.dof), /** @type {Record<string, unknown>} */ (b.dof))) {
    return false
  }
  return true
}

/**
 * Previous keyframe in time (not ``excludeId``).
 * @param {Array<{ id?: string, time_s: number }>} keyframes
 * @param {number} time_s
 * @param {string | null} [excludeId]
 */
export function previousKeyframeAtTime(keyframes, time_s, excludeId = null) {
  const t = Number(time_s)
  if (!keyframes?.length || !Number.isFinite(t)) return null
  let best = null
  for (const k of keyframes) {
    if (!k || k.id === excludeId) continue
    if (k.time_s > t + 1e-6) continue
    if (!best || k.time_s > best.time_s) best = k
  }
  return best
}

/**
 * Incoming-segment easing when capturing a keyframe.
 * Trajectory + unchanged camera → linear (constant MD play). Camera moved → Smooth out.
 * @param {{
 *   hasTrajectory: boolean
 *   prevCamera?: import('./schema.js').AnimationCameraPose | null
 *   nextCamera?: import('./schema.js').AnimationCameraPose | null
 *   hasPrevious?: boolean
 * }} opts
 * @returns {import('./easing.js').AnimationEasingKind | undefined}
 */
export function easingForCapturedKeyframe(opts) {
  if (!opts.hasTrajectory || !opts.hasPrevious) return undefined
  if (camerasApproximatelyEqual(opts.prevCamera, opts.nextCamera)) return 'linear'
  return DEFAULT_EASING_KIND
}

/**
 * @param {{ indices?: number[], xyz?: number[] } | null | undefined} a
 * @param {{ indices?: number[], xyz?: number[] } | null | undefined} b
 */
export function coordPatchesApproximatelyEqual(a, b) {
  const ai = a?.indices ?? []
  const bi = b?.indices ?? []
  if (ai.length !== bi.length) return false
  if (ai.some((v, i) => v !== bi[i])) return false
  const ax = a?.xyz ?? []
  const bx = b?.xyz ?? []
  if (ax.length !== bx.length) return false
  return ax.every((v, i) => numsClose(v, bx[i], 1e-3, 1e-5))
}

/** @param {import('./schema.js').SerializedView | null | undefined} view */
function viewIsShown(view) {
  return !!view && view.visible !== false && (typeof view.opacity !== 'number' || view.opacity > 0.001)
}

/** Size sliders that interpolate on the representation channel. */
const VIEW_SIZE_FIELDS = [
  ['atomScale', 1],
  ['bondScale', 1],
  ['pointSize', 3],
  ['stickRoundness', 1],
  ['helixWidth', 1],
  ['sheetWidth', 0.875],
  ['coilWidth', 0.125],
  ['tubeRadius', 0.9],
  ['surfaceInflate', 0.25]
]

/**
 * Cheap style equality for representation channel capture (color/repr/opacity/visibility/size).
 * A hidden view stays hidden even when an older key still has opacity 1.
 * @param {import('./schema.js').SerializedView | null | undefined} a
 * @param {import('./schema.js').SerializedView | null | undefined} b
 */
export function viewsApproximatelyEqual(a, b) {
  if (!a || !b) return !a && !b
  if (String(a.id) !== String(b.id)) return false
  const aShown = viewIsShown(a)
  const bShown = viewIsShown(b)
  if (aShown !== bShown) return false
  if (
    aShown &&
    !numsClose(typeof a.opacity === 'number' ? a.opacity : 1, typeof b.opacity === 'number' ? b.opacity : 1, 1e-3, 1e-4)
  ) {
    return false
  }
  for (const [key, fallback] of VIEW_SIZE_FIELDS) {
    const va = /** @type {number | undefined} */ (/** @type {any} */ (a)[key])
    const vb = /** @type {number | undefined} */ (/** @type {any} */ (b)[key])
    if (!numsClose(typeof va === 'number' ? va : fallback, typeof vb === 'number' ? vb : fallback, 1e-3, 1e-4)) {
      return false
    }
  }
  if ((a.representation?.type ?? '') !== (b.representation?.type ?? '')) return false
  if ((a.selection ?? '') !== (b.selection ?? '')) return false
  if ((a.baseSelection ?? '') !== (b.baseSelection ?? '')) return false
  const ca = a.colorScheme ?? {}
  const cb = b.colorScheme ?? {}
  if ((ca.name ?? '') !== (cb.name ?? '')) return false
  if ((ca.color ?? '') !== (cb.color ?? '')) return false
  if ((ca.carbonColor ?? '') !== (cb.carbonColor ?? '')) return false
  const sa = /** @type {Record<string, string>} */ (a.ssColors ?? {})
  const sb = /** @type {Record<string, string>} */ (b.ssColors ?? {})
  const sKeys = new Set([...Object.keys(sa), ...Object.keys(sb)])
  for (const k of sKeys) {
    if ((sa[k] ?? '') !== (sb[k] ?? '')) return false
  }
  return true
}

/**
 * @param {import('./easing.js').AnimationEasingKind | undefined} existingKind
 * @param {[number, number, number, number] | undefined} existingBezier
 * @param {import('./easing.js').AnimationEasingKind | undefined} prevKind
 * @param {[number, number, number, number] | undefined} prevBezier
 * @param {import('./easing.js').AnimationEasingKind} fallback
 */
function copiedCurve(existingKind, existingBezier, prevKind, prevBezier, fallback) {
  const kind = existingKind || prevKind || fallback
  const sourceBezier = existingKind ? existingBezier : prevBezier
  return {
    kind,
    bezier: kind === 'bezier' ? sourceBezier : undefined
  }
}

/**
 * @param {import('./schema.js').AnimationKeyframe | null | undefined} kf
 * @param {string | null | undefined} structureId
 */
function motionCurveFromKeyframe(kf, structureId) {
  if (!kf) return { kind: undefined, bezier: undefined }
  const entry = structureId && kf.motionEasings?.[structureId]
  if (entry) return { kind: entry.easing, bezier: entry.easingBezier }
  return { kind: kf.motionEasing, bezier: kf.motionEasingBezier }
}

/**
 * Camera and per-structure molecule curves written when a keyframe is captured.
 * An unchanged channel keeps the curve already on that keyframe, or the previous keyframe's curve.
 * A trajectory step with still atoms stores linear molecule easing and does not change the camera curve.
 * @param {{
 *   cameraChanged: boolean
 *   atomsChanged: boolean
 *   trajChanged: boolean
 *   structureId?: string | null
 *   existing?: import('./schema.js').AnimationKeyframe | null
 *   prev?: import('./schema.js').AnimationKeyframe | null
 * }} opts
 */
export function curvesForCapturedKeyframe(opts) {
  const existing = opts.existing ?? null
  const prev = opts.prev ?? null
  const sid = opts.structureId ?? null
  const camera = opts.cameraChanged
    ? copiedCurve(existing?.cameraEasing, existing?.cameraEasingBezier, undefined, undefined, DEFAULT_EASING_KIND)
    : copiedCurve(
        existing?.cameraEasing,
        existing?.cameraEasingBezier,
        prev?.cameraEasing,
        prev?.cameraEasingBezier,
        DEFAULT_EASING_KIND
      )
  const exMotion = motionCurveFromKeyframe(existing, sid)
  const prevMotion = motionCurveFromKeyframe(prev, sid)
  const motion = opts.atomsChanged
    ? copiedCurve(exMotion.kind, exMotion.bezier, undefined, undefined, DEFAULT_EASING_KIND)
    : opts.trajChanged
      ? copiedCurve(exMotion.kind, exMotion.bezier, undefined, undefined, 'linear')
      : copiedCurve(exMotion.kind, exMotion.bezier, prevMotion.kind, prevMotion.bezier, DEFAULT_EASING_KIND)

  /** @type {Record<string, { easing: import('./easing.js').AnimationEasingKind, easingBezier?: [number, number, number, number] }>} */
  const motionEasings = { ...(existing?.motionEasings || prev?.motionEasings || {}) }
  if (sid) {
    motionEasings[sid] = {
      easing: motion.kind,
      ...(motion.bezier ? { easingBezier: motion.bezier } : {})
    }
  }

  return {
    cameraEasing: camera.kind,
    cameraEasingBezier: camera.bezier,
    motionEasing: motion.kind,
    motionEasingBezier: motion.bezier,
    motionEasings
  }
}

/**
 * Ensure every representation of ``structureId`` has an explicit view entry on the keyframe.
 * @param {import('./schema.js').AnimationKeyframe} keyframe
 * @param {string} structureId
 * @param {import('./schema.js').SerializedView[]} snapViews
 * @param {import('./schema.js').AnimationKeyframe | null} [prev]
 */
export function stampViewsForMovedStructure(keyframe, structureId, snapViews, prev = null) {
  const sid = String(structureId)
  const byId = new Map((keyframe.views || []).map((v) => [String(v.id), v]))
  for (const snap of snapViews) {
    if (String(snap.structureId || '') !== sid) continue
    const id = String(snap.id)
    if (byId.has(id)) continue
    const fromPrev = prev?.views?.find((v) => String(v.id) === id)
    byId.set(id, JSON.parse(JSON.stringify(fromPrev || snap)))
  }
  keyframe.views = [...byId.values()]
  return keyframe
}

/**
 * Structure ids that have motion (coord patch or traj) on any keyframe.
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {string | null} [primaryId]
 * @returns {string[]}
 */
export function structureIdsWithMotion(keyframes, primaryId = null) {
  /** @type {Set<string>} */
  const ids = new Set()
  for (const kf of keyframes || []) {
    if (kf.coordPatches) {
      for (const [sid, patch] of Object.entries(kf.coordPatches)) {
        if (patch?.indices?.length) ids.add(sid)
      }
    }
    if (kf.coordPatch?.indices?.length && primaryId) ids.add(primaryId)
    if (typeof kf.trajFrame === 'number' && primaryId) ids.add(primaryId)
  }
  return [...ids]
}

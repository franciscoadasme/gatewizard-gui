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

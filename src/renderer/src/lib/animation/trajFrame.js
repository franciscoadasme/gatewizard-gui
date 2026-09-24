/**
 * Trajectory playhead on cinematic keyframes (logical frame after stride).
 */

/**
 * Inherit ``trajFrame`` from the previous keyframe when a keyframe omits it.
 * @param {import('./schema.js').AnimationKeyframe} kf
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @returns {number | null}
 */
export function resolvedTrajFrame(kf, keyframes) {
  if (typeof kf?.trajFrame === 'number' && Number.isFinite(kf.trajFrame)) {
    return Math.max(0, kf.trajFrame)
  }
  if (!keyframes?.length) return null
  const sorted = [...keyframes].sort((a, b) => a.time_s - b.time_s)
  let found = null
  for (const k of sorted) {
    if (kf && k.time_s > kf.time_s + 1e-9) break
    if (typeof k.trajFrame === 'number' && Number.isFinite(k.trajFrame)) {
      found = Math.max(0, k.trajFrame)
    }
  }
  return found
}

/**
 * @param {import('./schema.js').AnimationKeyframe} from
 * @param {import('./schema.js').AnimationKeyframe} to
 * @param {number} localT
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @returns {number | undefined}
 */
export function interpolateTrajFrame(from, to, localT, keyframes) {
  const trajFrom = resolvedTrajFrame(from, keyframes)
  const trajTo = resolvedTrajFrame(to, keyframes) ?? trajFrom
  if (trajFrom == null && trajTo == null) return undefined
  const a = trajFrom ?? trajTo ?? 0
  const b = trajTo ?? trajFrom ?? 0
  const t = Number.isFinite(localT) ? localT : 0
  return a + (b - a) * t
}

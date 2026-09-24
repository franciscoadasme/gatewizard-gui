/**
 * Animation-timeline playhead math (cinematic time / frames, not MD frames).
 */

/**
 * @param {number} time_s
 * @param {number} fps
 * @param {number} duration_s
 */
export function snapAnimTime(time_s, fps, duration_s) {
  const step = 1 / Math.max(1, Number(fps) || 1)
  const dur = Math.max(0, Number(duration_s) || 0)
  const t = Number(time_s)
  if (!Number.isFinite(t)) return 0
  const snapped = Math.round(t / step) * step
  const precision = Math.min(6, Math.max(2, String(step).split('.')[1]?.length ?? 0) + 1)
  return Math.max(0, Math.min(dur, Number(snapped.toFixed(precision))))
}

/**
 * Same numbering as the timeline label: ``round(t * fps)``.
 * @param {number} time_s
 * @param {number} fps
 */
export function animTimeToFrame(time_s, fps) {
  const f = Math.max(1, Number(fps) || 1)
  return Math.round(Math.max(0, Number(time_s) || 0) * f)
}

/**
 * @param {number} frame
 * @param {number} fps
 * @param {number} duration_s
 */
export function animFrameToTime(frame, fps, duration_s) {
  const f = Math.max(1, Number(fps) || 1)
  return snapAnimTime((Number(frame) || 0) / f, f, duration_s)
}

/**
 * Keyframe whose diamond is under the playhead (same tolerance as the highlight).
 * @param {Array<{ id?: string, time_s: number }> | null | undefined} keyframes
 * @param {number} playhead
 * @param {number} fps
 */
export function keyframeAtPlayhead(keyframes, playhead, fps) {
  const step = 1 / Math.max(1, Number(fps) || 1)
  const tol = step * 0.51
  const t = Number(playhead)
  if (!Number.isFinite(t) || !keyframes?.length) return null
  let best = null
  let bestDist = Infinity
  for (const kf of keyframes) {
    if (!kf || !Number.isFinite(kf.time_s)) continue
    const d = Math.abs(kf.time_s - t)
    if (d < tol && d < bestDist) {
      best = kf
      bestDist = d
    }
  }
  return best
}

/**
 * @param {{ indices?: number[], xyz?: number[] } | null | undefined} patch
 */
export function coordPatchSignature(patch) {
  if (!patch?.indices?.length) return ''
  const idx = patch.indices
  const xyz = patch.xyz ?? []
  let hash = idx.length * 1009 + xyz.length
  for (let i = 0; i < idx.length; i++) hash = (Math.imul(hash, 33) + (idx[i] | 0)) | 0
  for (let i = 0; i < xyz.length; i++) hash = (Math.imul(hash, 33) + ((xyz[i] * 1000) | 0)) | 0
  return `${idx.length}:${xyz.length}:${idx[0]}:${idx[idx.length - 1]}:${xyz[0] ?? ''}:${xyz[xyz.length - 1] ?? ''}:${hash}`
}

/**
 * @param {string | undefined} prevSig
 * @param {{ indices?: number[], xyz?: number[] } | null | undefined} patch
 */
export function shouldApplyCoordPatch(prevSig, patch) {
  const signature = coordPatchSignature(patch)
  return { apply: prevSig !== signature, signature }
}

/**
 * @param {Array<{ id?: unknown }> | null | undefined} liveViews
 * @param {Array<{ id?: unknown }> | null | undefined} nextViews
 */
export function viewListNeedsReplace(liveViews, nextViews) {
  if (!liveViews || !nextViews || liveViews.length !== nextViews.length) return true
  for (let i = 0; i < liveViews.length; i++) {
    if (liveViews[i] !== nextViews[i]) return true
  }
  return false
}

/**
 * @param {number} requested
 * @param {number} currentDisplay
 */
export function shouldSeekTrajFrame(requested, currentDisplay) {
  const want = Math.round(Number(requested) || 0)
  const have = Math.round(Number(currentDisplay) || 0)
  return want !== have
}

/**
 * Horizontal timeline zoom. 1 fits the movie. The closest step shows about
 * four seconds of a long movie and never exceeds 512×.
 * @param {number} duration_s
 */
export function timelineZoomMax(duration_s) {
  const dur = Math.max(0.01, Number(duration_s) || 0)
  return Math.min(512, Math.max(8, dur / 4))
}

/**
 * @param {number} current
 * @param {number} direction positive zooms in
 * @param {number} duration_s
 */
export function nextTimelineZoom(current, direction, duration_s) {
  const maxZoom = timelineZoomMax(duration_s)
  const base = Number.isFinite(current) && current > 0 ? current : 1
  const next = direction > 0 ? base * 2 : base / 2
  return Math.min(maxZoom, Math.max(1, next))
}

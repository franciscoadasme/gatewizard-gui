/**
 * Uniform downsample for chart display. Keeps first/last points and evenly spaced middles.
 * Full-resolution arrays stay in memory for CSV/export; only plot paths use this.
 */

/** Default max points per series drawn in Analysis LineChart. */
export const DEFAULT_CHART_MAX_POINTS = 4000

/**
 * @param {number} n
 * @param {number} maxPoints
 * @returns {number[] | null} index list, or null when no downsample needed
 */
export function downsampleIndices(n, maxPoints = DEFAULT_CHART_MAX_POINTS) {
  const max = Math.max(2, Math.floor(Number(maxPoints) || DEFAULT_CHART_MAX_POINTS))
  if (!Number.isFinite(n) || n <= max) return null
  /** @type {number[]} */
  const idx = new Array(max)
  const last = n - 1
  for (let i = 0; i < max; i++) {
    idx[i] = Math.round((i * last) / (max - 1))
  }
  // Ensure strictly increasing (round collisions)
  for (let i = 1; i < max; i++) {
    if (idx[i] <= idx[i - 1]) idx[i] = Math.min(last, idx[i - 1] + 1)
  }
  idx[max - 1] = last
  return idx
}

/**
 * @param {number[]} x
 * @param {number[]} y
 * @param {number} [maxPoints]
 * @returns {{ x: number[], y: number[] }}
 */
export function downsampleXY(x, y, maxPoints = DEFAULT_CHART_MAX_POINTS) {
  const n = Math.min(x?.length ?? 0, y?.length ?? 0)
  if (n === 0) return { x: [], y: [] }
  const idx = downsampleIndices(n, maxPoints)
  if (!idx) {
    if ((x?.length ?? 0) === n && (y?.length ?? 0) === n) return { x, y }
    return { x: x.slice(0, n), y: y.slice(0, n) }
  }
  /** @type {number[]} */
  const xs = new Array(idx.length)
  /** @type {number[]} */
  const ys = new Array(idx.length)
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i]
    xs[i] = x[j]
    ys[i] = y[j]
  }
  return { x: xs, y: ys }
}

/**
 * @template {{ x?: number[], y?: number[] }} T
 * @param {T} series
 * @param {number} [maxPoints]
 * @returns {T}
 */
export function downsampleSeries(series, maxPoints = DEFAULT_CHART_MAX_POINTS) {
  const { x, y } = downsampleXY(series.x || [], series.y || [], maxPoints)
  return { ...series, x, y }
}

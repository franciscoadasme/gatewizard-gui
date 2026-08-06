/**
 * Client-side statistics for chart series over a time range.
 */

/**
 * @param {{ x: number[], y: number[] }} series
 * @param {number|null} t0
 * @param {number|null} t1
 */
export function computeSeriesStats(series, t0 = null, t1 = null) {
  const xs = series?.x ?? []
  const ys = series?.y ?? []
  const n = Math.min(xs.length, ys.length)
  if (n === 0) {
    return { count: 0, mean: null, std: null, min: null, max: null }
  }

  const values = []
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (t0 != null && x < t0) continue
    if (t1 != null && x > t1) continue
    values.push(y)
  }

  if (values.length === 0) {
    return { count: 0, mean: null, std: null, min: null, max: null }
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  const std = Math.sqrt(variance)
  return {
    count: values.length,
    mean,
    std,
    min: Math.min(...values),
    max: Math.max(...values)
  }
}

/**
 * @param {Array<{ name: string, x: number[], y: number[] }>} seriesList
 * @param {number|null} t0
 * @param {number|null} t1
 */
export function computeMultiSeriesStats(seriesList, t0 = null, t1 = null) {
  /** @type {Record<string, ReturnType<typeof computeSeriesStats>>} */
  const out = {}
  for (const s of seriesList ?? []) {
    out[s.name] = computeSeriesStats(s, t0, t1)
  }
  return out
}

/**
 * Format stats for display.
 * @param {ReturnType<typeof computeSeriesStats>} stats
 */
export function formatStats(stats) {
  if (!stats || stats.count === 0) return '—'
  const f = (v) =>
    Number.isFinite(v)
      ? Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.01)
        ? v.toExponential(3)
        : v.toFixed(3)
      : '—'
  return `n=${stats.count} · μ=${f(stats.mean)} · σ=${f(stats.std)} · min=${f(stats.min)} · max=${f(stats.max)}`
}

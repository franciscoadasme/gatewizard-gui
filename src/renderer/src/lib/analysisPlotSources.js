/**
 * Per-file plot segments so removing a trajectory or changing its Time (ns)
 * can update the chart without a re-run. Stride still requires a re-run.
 */

/**
 * @param {string} path
 */
export function fileBasename(path) {
  return String(path || '').split(/[\\/]/).pop() || String(path || '')
}

/**
 * @param {string} path
 */
export function isCoordinateTrajectoryPath(path) {
  return !/\.(pdb|ent|gro)$/i.test(String(path || ''))
}

/**
 * @param {unknown} timeNs
 */
export function durationNs(timeNs) {
  const n = Number(timeNs)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Inclusive linspace, matching numpy.linspace(start, end, n).
 * @param {number} start
 * @param {number} end
 * @param {number} n
 */
export function linspaceInclusive(start, end, n) {
  const count = Math.max(0, Math.floor(Number(n) || 0))
  if (count <= 0) return []
  if (count === 1) return [start]
  const out = new Array(count)
  const step = (end - start) / (count - 1)
  for (let i = 0; i < count; i++) out[i] = start + step * i
  out[count - 1] = end
  return out
}

/**
 * @param {Array<{ path?: string, timeNs?: string }>} files
 * @param {{ coordinateOnly?: boolean }} [opts]
 */
export function plotSourceFileList(files, opts = {}) {
  const coordinateOnly = opts.coordinateOnly !== false
  const list = Array.isArray(files) ? files : []
  const filtered = coordinateOnly
    ? list.filter((f) => f?.path && isCoordinateTrajectoryPath(f.path))
    : list.filter((f) => f?.path)
  return filtered.length ? filtered : list.filter((f) => f?.path)
}

/**
 * Split a concatenated time axis into per-file segments using analysis-time durations.
 * @param {number[]} rawX
 * @param {Array<{ path: string, timeNs?: string }>} files
 * @param {{ coordinateOnly?: boolean }} [opts]
 * @returns {Array<{ path: string, basename: string, timeNs: string, start: number, nPoints: number }> | null}
 */
export function capturePlotSourceFiles(rawX, files, opts = {}) {
  const list = plotSourceFileList(files, opts)
  const x = Array.isArray(rawX) ? rawX.map((v) => Number(v)) : []
  if (!list.length || x.length === 0) return null
  if (!list.some((f) => durationNs(f.timeNs) > 0)) return null

  const n = x.length
  let i = 0
  let t0 = Number.isFinite(x[0]) ? x[0] : 0
  /** @type {Array<{ path: string, basename: string, timeNs: string, start: number, nPoints: number }>} */
  const segs = []
  for (let f = 0; f < list.length; f++) {
    const file = list[f]
    const isLast = f === list.length - 1
    if (isLast) {
      segs.push({
        path: file.path,
        basename: fileBasename(file.path),
        timeNs: String(file.timeNs ?? ''),
        start: i,
        nPoints: Math.max(0, n - i)
      })
      break
    }
    const d = durationNs(file.timeNs)
    let j = i
    if (d > 0) {
      const tEnd = t0 + d
      const eps = Math.max(1e-6, Math.abs(tEnd) * 1e-9)
      while (j < n && x[j] < tEnd - eps) j++
      if (j < n && Math.abs(x[j] - tEnd) <= eps) j++
      if (j <= i) j = Math.min(n, i + 1)
    } else {
      const remainingFiles = list.length - f
      const remainingPts = n - i
      const take = Math.max(1, remainingPts - (remainingFiles - 1))
      j = Math.min(n, i + take)
    }
    segs.push({
      path: file.path,
      basename: fileBasename(file.path),
      timeNs: String(file.timeNs ?? ''),
      start: i,
      nPoints: j - i
    })
    t0 = d > 0 ? t0 + d : Number.isFinite(x[Math.max(j - 1, 0)]) ? x[Math.max(j - 1, 0)] : t0
    i = j
  }
  const total = segs.reduce((sum, g) => sum + g.nPoints, 0)
  if (segs.length && total !== n) {
    segs[segs.length - 1].nPoints = Math.max(0, segs[segs.length - 1].nPoints + (n - total))
  }
  return segs
}

/**
 * @param {{ basename?: string, path?: string }} src
 * @param {string} base
 */
function sourceMatchesBasename(src, base) {
  return src.basename === base || fileBasename(src.path || '') === base
}

/**
 * Drop removed files and rebuild Time (ns) from the current file list.
 * Does not apply stride. Returns `res` unchanged when there is nothing to do.
 * @param {object} res
 * @param {Array<{ path: string, timeNs?: string }>} currentFiles
 * @param {{ timeX?: boolean, coordinateOnly?: boolean }} [opts]
 */
export function applyPlotSourcesToResult(res, currentFiles, opts = {}) {
  if (!res || typeof res !== 'object') return res
  const timeX = opts.timeX !== false
  const sources = res.sourceFiles
  if (!timeX || !Array.isArray(sources) || sources.length === 0) return res

  const current = plotSourceFileList(currentFiles, opts)
  /** @type {Array<{ src: { path: string, basename: string, timeNs: string, start: number, nPoints: number }, timeNs: string }>} */
  const ordered = []
  const used = new Set()
  for (const f of current) {
    const base = fileBasename(f.path)
    if (used.has(base)) continue
    const src = sources.find((s) => sourceMatchesBasename(s, base))
    if (!src) continue
    ordered.push({ src, timeNs: String(f.timeNs ?? '') })
    used.add(base)
  }

  const same =
    ordered.length === sources.length &&
    ordered.every(
      (row, i) =>
        sourceMatchesBasename(row.src, sources[i].basename || fileBasename(sources[i].path)) &&
        durationNs(row.timeNs) === durationNs(sources[i].timeNs)
    )
  if (same) return res

  const rawX0 = Array.isArray(res.rawX) ? res.rawX : []
  /** @type {number[]} */
  const indexMap = []
  /** @type {number[]} */
  const newX = []
  let t = 0
  for (const { src, timeNs } of ordered) {
    const nPts = Math.max(0, Math.floor(Number(src.nPoints) || 0))
    const start = Math.max(0, Math.floor(Number(src.start) || 0))
    for (let k = 0; k < nPts; k++) indexMap.push(start + k)
    const d = durationNs(timeNs)
    const origD = durationNs(src.timeNs)
    if (nPts <= 0) continue
    if (d > 0) {
      newX.push(...linspaceInclusive(t, t + d, nPts))
      t += d
    } else if (origD > 0 && nPts > 0) {
      const origStart = Number(rawX0[start])
      const base = Number.isFinite(origStart) ? origStart : 0
      for (let k = 0; k < nPts; k++) {
        const orig = Number(rawX0[start + k])
        newX.push(t + ((Number.isFinite(orig) ? orig : base) - base))
      }
      t = newX.length ? newX[newX.length - 1] : t
    } else {
      const first = Number(rawX0[start])
      const shift = t - (Number.isFinite(first) ? first : 0)
      for (let k = 0; k < nPts; k++) {
        const orig = Number(rawX0[start + k])
        newX.push((Number.isFinite(orig) ? orig : 0) + shift)
      }
      t = newX.length ? newX[newX.length - 1] : t
    }
  }

  const pick = (arr) =>
    Array.isArray(arr) ? indexMap.map((idx) => arr[idx]) : arr

  /** @type {object} */
  const next = { ...res, rawX: newX }
  if (Array.isArray(res.rawY)) next.rawY = pick(res.rawY)
  if (Array.isArray(res.extraSeries)) {
    next.extraSeries = res.extraSeries.map((s) => ({
      ...s,
      rawY: pick(s.rawY)
    }))
  }
  if (Array.isArray(res.rawSeries)) {
    next.rawSeries = res.rawSeries.map((s) => ({
      ...s,
      y: pick(s.y)
    }))
  }
  return next
}

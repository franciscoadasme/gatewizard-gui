/** @param {unknown} err @param {AbortSignal|undefined|null} [signal] */
export function isPullCancelledError(err, signal) {
  if (signal?.aborted) return true
  if (!err) return false
  if (err instanceof Error) {
    if (err.name === 'PullCancelled' || err.name === 'AbortError') return true
    const msg = err.message || ''
    if (/\bcancel/i.test(msg) || /\babort/i.test(msg)) return true
  }
  const text = String(err)
  return /\bcancel/i.test(text) || /\babort/i.test(text)
}

/** @param {string} message @param {string} [name] */
export function createCancelledError(message, name = 'Cancelled') {
  const err = new Error(message)
  err.name = name
  return err
}

/** Error thrown when the user stops an active cluster pull. */
export function createPullCancelledError() {
  return createCancelledError('Pull cancelled', 'PullCancelled')
}

/** Error thrown when the user stops a running analysis. */
export function createAnalysisCancelledError() {
  return createCancelledError('Analysis cancelled', 'AnalysisCancelled')
}

/** Alias for pull, analysis, and other abortable backend requests. */
export const isRequestCancelledError = isPullCancelledError

/** Monotonic local bytes during pull (rsync session counters can dip below on-disk size). */
export function mergePullLocalBytes(current, incoming) {
  const cur = Number(current)
  const inc = Number(incoming)
  if (Number.isFinite(cur) && cur >= 0 && Number.isFinite(inc) && inc >= 0) {
    return Math.max(cur, inc)
  }
  if (Number.isFinite(inc) && inc >= 0) return inc
  if (Number.isFinite(cur) && cur >= 0) return cur
  return incoming ?? current ?? null
}

/** @param {number} n @param {{ fine?: boolean }} [opts] */
export function formatByteSize(n, opts = {}) {
  const fine = Boolean(opts.fine)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, Number(n) || 0)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  if (i === 0) return `${Math.round(v)} ${units[i]}`
  if (fine && (units[i] === 'GB' || units[i] === 'TB')) {
    return `${v.toFixed(2)} ${units[i]}`
  }
  if (fine) return `${v.toFixed(1)} ${units[i]}`
  return `${v.toFixed(1)} ${units[i]}`
}

/** Format transfer rate like rsync progress lines (e.g. 12.5MB/s). */
export function formatRsyncSpeed(bps) {
  const n = Number(bps)
  if (!Number.isFinite(n) || n <= 0) return null
  const suffixes = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < suffixes.length - 1) {
    v /= 1024
    i += 1
  }
  const digits = i === 0 ? 0 : v >= 10 ? 1 : 2
  const num = i === 0 ? String(Math.round(v)) : v.toFixed(digits).replace(/\.?0+$/, '')
  return `${num}${suffixes[i]}/s`
}

/** @param {string} message */
export function extractPullSpeedFromMessage(message) {
  const m = String(message || '').match(/·\s*([\d.]+[kKMGT]?B\/s)\s*$/)
  return m ? m[1] : null
}

/**
 * @param {number} bytes
 * @param {number} totalBytes
 * @param {string} [localFormatted]
 * @param {string|null} [speed]
 */
export function formatPullTransferText(bytes, totalBytes, localFormatted, speed) {
  const local =
    localFormatted || formatByteSize(bytes, { fine: true })
  let base
  const total = Number(totalBytes)
  if (Number.isFinite(total) && total > 0) {
    base = `Downloading… ${local} / ${formatByteSize(total, { fine: true })}`
  } else if (Number(bytes) > 0) {
    base = `Downloading… ${local} on disk`
  } else {
    base = 'Downloading…'
  }
  if (speed) base = `${base} · ${speed}`
  return base
}

/** Smooth download rate from monotonic byte samples (for local folder polling). */
export function createPullSpeedTracker() {
  /** @type {{ t: number, bytes: number }} */
  let last = { t: 0, bytes: -1 }
  let smoothed = 0

  return {
    reset() {
      last = { t: 0, bytes: -1 }
      smoothed = 0
    },
    /** @param {number} bytes */
    sample(bytes) {
      const b = Number(bytes)
      if (!Number.isFinite(b) || b < 0) return null
      const now = performance.now()
      if (last.bytes < 0) {
        last = { t: now, bytes: b }
        return smoothed > 0 ? formatRsyncSpeed(smoothed) : null
      }
      const dt = (now - last.t) / 1000
      if (dt < 0.25) {
        return smoothed > 0 ? formatRsyncSpeed(smoothed) : null
      }
      const delta = b - last.bytes
      last = { t: now, bytes: b }
      if (delta <= 0) {
        return smoothed > 0 ? formatRsyncSpeed(smoothed) : null
      }
      const instant = delta / dt
      smoothed = smoothed > 0 ? smoothed * 0.65 + instant * 0.35 : instant
      return formatRsyncSpeed(smoothed)
    }
  }
}

/**
 * @param {{
 *   message?: string,
 *   bytes?: number|null,
 *   totalBytes?: number|null,
 *   speed?: string|null,
 *   localFormatted?: string,
 *   remoteFormatted?: string
 * }} opts
 */
export function formatPullStatusLine(opts) {
  const speed =
    opts.speed ||
    extractPullSpeedFromMessage(opts.message) ||
    null
  const bytes = Number(opts.bytes)
  const total = Number(opts.totalBytes)
  // Prefer live on-disk / remote totals when available — stream messages can
  // lag or say "on disk" without the remote size while the ring already has both.
  if (Number.isFinite(bytes) && bytes >= 0) {
    return formatPullTransferText(
      bytes,
      Number.isFinite(total) && total > 0 ? total : 0,
      opts.localFormatted,
      speed
    )
  }
  const stripped = formatPullStatusMessage(opts.message)
  if (stripped) {
    if (speed && !stripped.includes(speed)) {
      return `${stripped} · ${speed}`
    }
    return stripped
  }
  return speed ? `Downloading… · ${speed}` : 'Downloading…'
}

/** Strip redundant `(N%)` from pull status text when the sync ring already shows percent. */
export function formatPullStatusMessage(message) {
  if (!message) return ''
  return String(message)
    .replace(/\s*\(\d+%\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Pull progress percent from transferred bytes (matches PullSyncRing local ÷ remote).
 * @param {number|null|undefined} bytes
 * @param {number|null|undefined} totalBytes
 * @param {number|null|undefined} [fallback]
 */
export function pullTransferPercent(bytes, totalBytes, fallback = null) {
  const b = Number(bytes)
  const t = Number(totalBytes)
  if (Number.isFinite(t) && t > 0 && Number.isFinite(b) && b >= 0) {
    return Math.max(0, Math.min(100, Math.round((100 * b) / t)))
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.max(0, Math.min(100, fallback))
  }
  return null
}

/**
 * @param {{
 *   pulling?: boolean,
 *   pullProgress?: { phase?: string, percent?: number|null } | null,
 *   syncSizes?: { localBytes?: number|null, remoteBytes?: number|null } | null
 * }} job
 */
export function jobPullDisplayPercent(job) {
  if (job.pullProgress?.phase === 'done') return 100
  const sync = job.syncSizes
  const fromBytes = pullTransferPercent(sync?.localBytes, sync?.remoteBytes, null)
  if (
    fromBytes != null &&
    (job.pulling || job.pullProgress?.phase === 'sync' || job.pullProgress?.phase === 'finalize')
  ) {
    return fromBytes
  }
  return job.pullProgress?.percent ?? fromBytes
}

/**
 * @param {{
 *   phase?: string,
 *   percent?: number|null,
 *   bytes?: number,
 *   total_bytes?: number
 * }} evt
 * @param {number|null} [fallback]
 */
export function pullEventPercent(evt, fallback = null) {
  if (evt?.phase === 'done') return 100
  const fromBytes = pullTransferPercent(evt?.bytes, evt?.total_bytes, null)
  if (fromBytes != null && (evt?.phase === 'sync' || evt?.phase === 'finalize')) {
    return fromBytes
  }
  if (typeof evt?.percent === 'number' && Number.isFinite(evt.percent)) {
    return Math.max(0, Math.min(100, evt.percent))
  }
  return fallback
}

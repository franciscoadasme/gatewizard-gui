/**
 * Animation play clock. Does not wait for onFrame (which may seek a trajectory)
 * before the next rAF, so the playhead stays fluid.
 *
 * @param {{
 *   duration_s: number
 *   getPlayhead: () => number
 *   setPlayhead: (t: number) => void
 *   isPlaying: () => boolean
 *   setPlaying: (v: boolean) => void
 *   onFrame: (time_s: number) => void
 *   onDone?: () => void
 * }} opts
 */
export function startPlayback(opts) {
  let raf = 0
  let startWall = 0
  let startPlayhead = opts.getPlayhead()

  const tick = (now) => {
    if (!opts.isPlaying()) return
    if (!startWall) startWall = now
    const elapsed = (now - startWall) / 1000
    let t = startPlayhead + elapsed
    if (t >= opts.duration_s) {
      t = opts.duration_s
      opts.setPlayhead(t)
      Promise.resolve()
        .then(() => opts.onFrame(t))
        .catch((err) => console.error('[animation] onFrame failed (final frame)', err))
        .then(() => {
          opts.setPlaying(false)
          opts.onDone?.()
        })
      return
    }
    opts.setPlayhead(t)
    Promise.resolve()
      .then(() => opts.onFrame(t))
      .catch((err) => console.error('[animation] onFrame failed', err))
    if (opts.isPlaying()) raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
  return () => {
    if (raf) cancelAnimationFrame(raf)
  }
}

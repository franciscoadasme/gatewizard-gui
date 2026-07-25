/** Global flag while the 3D viewer is doing heavy work (glow lights, mesh rebuild, etc.). */
export const viewerBusy = $state({
  active: false,
  label: ''
})

let _depth = 0

/** @param {string} [label] */
export function beginViewerBusy(label = 'Updating view…') {
  _depth += 1
  viewerBusy.active = true
  viewerBusy.label = label
}

/** @param {string} [label] */
export function endViewerBusy(label) {
  _depth = Math.max(0, _depth - 1)
  if (_depth === 0) {
    viewerBusy.active = false
    viewerBusy.label = ''
  } else if (label && viewerBusy.label === label) {
    viewerBusy.label = 'Updating view…'
  }
}

/**
 * Wait until viewer heavy work has finished for several consecutive frames.
 * Schedules a short head-start so effects (e.g. glow light placement) can mark
 * themselves busy before we begin counting idle frames.
 * @param {{ idleFrames?: number, timeoutMs?: number, settleMs?: number }} [opts]
 * @returns {Promise<boolean>} true if idle was reached, false on timeout
 */
export function waitForViewerIdle(opts = {}) {
  const idleFrames = opts.idleFrames ?? 4
  const timeoutMs = opts.timeoutMs ?? 20000
  const settleMs = opts.settleMs ?? 50
  const started = Date.now()
  return new Promise((resolve) => {
    let idle = 0
    let startedCounting = false

    const startCounting = () => {
      startedCounting = true
      requestAnimationFrame(tick)
    }

    // Let Svelte/Threlte effects schedule their busy work first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (settleMs > 0) setTimeout(startCounting, settleMs)
        else startCounting()
      })
    })

    function tick() {
      if (!startedCounting) return
      if (!viewerBusy.active) {
        idle += 1
        if (idle >= idleFrames) {
          resolve(true)
          return
        }
      } else {
        idle = 0
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false)
        return
      }
      requestAnimationFrame(tick)
    }
  })
}

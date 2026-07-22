/**
 * Step-weighted install progress for the splash screen.
 * Long conda/pip steps use a heartbeat creep within their slice so the UI
 * keeps moving instead of looking frozen.
 */

/**
 * @typedef {{ id: string, label: string, weight: number }} ProgressStep
 * @typedef {{
 *   message: string,
 *   percent: number,
 *   stepIndex: number,
 *   stepCount: number,
 *   stepId: string,
 *   busy: boolean
 * }} ProgressUpdate
 */

/** @type {Record<string, ProgressStep[]>} */
const MODES = {
  cold: [
    { id: 'start', label: 'Preparing Python environment…', weight: 1 },
    { id: 'micromamba', label: 'Downloading micromamba…', weight: 2 },
    { id: 'env', label: 'Creating Python environment…', weight: 5 },
    { id: 'pip_tools', label: 'Upgrading pip tools…', weight: 1 },
    { id: 'pip_reqs', label: 'Installing Python packages…', weight: 5 },
    { id: 'mempro', label: 'Optional packages (MemPrO)…', weight: 1 },
    { id: 'openmm', label: 'Installing OpenMM…', weight: 4 },
    { id: 'gromacs', label: 'Installing GROMACS…', weight: 3 },
    { id: 'ready', label: 'Runtime ready', weight: 1 }
  ],
  pipUpdate: [
    { id: 'start', label: 'Updating dependencies…', weight: 1 },
    { id: 'pip_tools', label: 'Upgrading pip tools…', weight: 1 },
    { id: 'pip_reqs', label: 'Updating Python packages…', weight: 5 },
    { id: 'mempro', label: 'Optional packages (MemPrO)…', weight: 1 },
    { id: 'openmm', label: 'Refreshing OpenMM…', weight: 2 },
    { id: 'gromacs', label: 'Refreshing GROMACS…', weight: 2 },
    { id: 'ready', label: 'Runtime ready', weight: 1 }
  ],
  cached: [
    { id: 'start', label: 'Checking Python environment…', weight: 1 },
    { id: 'sync', label: 'Syncing conda packages…', weight: 3 },
    { id: 'ready', label: 'Runtime ready', weight: 1 }
  ],
  external: [
    { id: 'start', label: 'Using external Python…', weight: 1 },
    { id: 'ready', label: 'Runtime ready', weight: 1 }
  ],
  backend: [
    { id: 'backend', label: 'Starting backend…', weight: 1 },
    { id: 'ready', label: 'Ready', weight: 1 }
  ]
}

/**
 * @param {ProgressStep[]} steps
 * @returns {number}
 */
function totalWeight(steps) {
  return steps.reduce((sum, s) => sum + s.weight, 0)
}

/**
 * @param {ProgressStep[]} steps
 * @param {number} index inclusive start fraction of this step
 */
function stepBounds(steps, index) {
  const total = totalWeight(steps)
  let before = 0
  for (let i = 0; i < index; i += 1) before += steps[i].weight
  const start = before / total
  const end = (before + steps[index].weight) / total
  return { start, end }
}

/**
 * @param {(update: ProgressUpdate) => void} onUpdate
 */
export function createInstallProgress(onUpdate) {
  /** @type {ProgressStep[]} */
  let steps = MODES.cold
  let stepIndex = 0
  let fraction = 0
  let busy = true
  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeat = null
  let stepEnteredAt = Date.now()

  function emit(message, overrideBusy = busy) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100)
    onUpdate({
      message,
      percent: pct,
      stepIndex: stepIndex + 1,
      stepCount: steps.length,
      stepId: steps[stepIndex]?.id ?? 'unknown',
      busy: overrideBusy
    })
  }

  function stopHeartbeat() {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  function startHeartbeat() {
    stopHeartbeat()
    stepEnteredAt = Date.now()
    const { start, end } = stepBounds(steps, stepIndex)
    const creepCap = start + (end - start) * 0.88
    heartbeat = setInterval(() => {
      if (fraction >= creepCap) return
      // Asymptotic creep: fast at first, slows so we never finish the slice early.
      const elapsed = Date.now() - stepEnteredAt
      const t = Math.min(1, elapsed / 180000) // ~3 min to near creepCap
      const eased = 1 - Math.pow(1 - t, 2.2)
      const next = start + (creepCap - start) * eased
      if (next > fraction) {
        fraction = next
        emit(lastMessage)
      }
    }, 400)
  }

  let lastMessage = steps[0]?.label ?? 'Starting…'

  return {
    /**
     * @param {keyof typeof MODES} mode
     * @param {string} [message]
     */
    begin(mode, message) {
      steps = MODES[mode] ?? MODES.cold
      stepIndex = 0
      fraction = 0
      busy = true
      lastMessage = message ?? steps[0].label
      emit(lastMessage)
      startHeartbeat()
    },

    /**
     * Jump to a named step (and optional detail message).
     * @param {string} stepId
     * @param {string} [message]
     */
    enter(stepId, message) {
      const idx = steps.findIndex((s) => s.id === stepId)
      if (idx < 0) {
        lastMessage = message ?? lastMessage
        emit(lastMessage)
        return
      }
      if (idx < stepIndex) {
        // Never go backwards in UI.
        lastMessage = message ?? steps[idx].label
        emit(lastMessage)
        return
      }
      stepIndex = idx
      const { start } = stepBounds(steps, stepIndex)
      fraction = Math.max(fraction, start)
      lastMessage = message ?? steps[stepIndex].label
      busy = stepId !== 'ready'
      emit(lastMessage, busy)
      if (busy) startHeartbeat()
      else stopHeartbeat()
    },

    /**
     * Soft status note without changing the current step slice.
     * @param {string} message
     */
    note(message) {
      lastMessage = message
      emit(message)
    },

    /**
     * Mark complete (100%).
     * @param {string} [message]
     */
    done(message) {
      stopHeartbeat()
      stepIndex = Math.max(0, steps.length - 1)
      fraction = 1
      busy = false
      lastMessage = message ?? 'Ready'
      emit(lastMessage, false)
    },

    dispose() {
      stopHeartbeat()
    }
  }
}

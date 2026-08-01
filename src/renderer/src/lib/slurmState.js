/** Slurm / sacct state helpers (handles ``CANCELLED by 1002``, ``COMPLETED+``, …). */

/**
 * @param {unknown} state
 * @returns {string}
 */
export function canonicalizeSlurmState(state) {
  const u = String(state || '')
    .trim()
    .toUpperCase()
  if (!u) return ''
  const bases = [
    'OUT_OF_MEMORY',
    'NODE_FAIL',
    'BOOT_FAIL',
    'CONFIGURING',
    'COMPLETING',
    'CANCELLED',
    'COMPLETED',
    'PREEMPTED',
    'SUSPENDED',
    'REQUEUED',
    'TIMEOUT',
    'RUNNING',
    'PENDING',
    'FAILED',
    'COMPLETE'
  ]
  for (const base of bases) {
    if (u === base || u.startsWith(`${base} `) || u.startsWith(`${base}+`)) {
      return base === 'COMPLETE' ? 'COMPLETED' : base
    }
  }
  return u.split(/\s+/)[0].split('+')[0] || u
}

/**
 * @param {unknown} state
 * @returns {boolean}
 */
export function isSlurmActiveState(state) {
  return ['RUNNING', 'PENDING', 'CONFIGURING', 'COMPLETING', 'REQUEUED', 'SUSPENDED'].includes(
    canonicalizeSlurmState(state)
  )
}

/**
 * @param {unknown} state
 * @returns {boolean}
 */
export function isSlurmPendingState(state) {
  return ['PENDING', 'CONFIGURING', 'REQUEUED'].includes(canonicalizeSlurmState(state))
}

/**
 * @param {unknown} state
 * @returns {boolean}
 */
export function isSlurmRunningState(state) {
  return canonicalizeSlurmState(state) === 'RUNNING'
}

/**
 * @param {unknown} state
 * @returns {boolean}
 */
export function isSlurmTerminalState(state) {
  return [
    'FAILED',
    'CANCELLED',
    'TIMEOUT',
    'NODE_FAIL',
    'COMPLETED',
    'OUT_OF_MEMORY',
    'PREEMPTED',
    'BOOT_FAIL'
  ].includes(canonicalizeSlurmState(state))
}

/**
 * Confirm copy when the user Pulls while the Slurm job is still live.
 * @param {unknown} state
 * @returns {string}
 */
export function partialPullConfirmMessage(state) {
  const label = canonicalizeSlurmState(state) || 'active'
  return (
    `This job is still ${label} on the cluster.\n\n` +
    'A Pull now only downloads what is already available (submit directory, ' +
    'and staged scratch logs when possible). Trajectories and later stages ' +
    'may be incomplete or missing.\n\n' +
    'Pull a partial snapshot anyway?'
  )
}

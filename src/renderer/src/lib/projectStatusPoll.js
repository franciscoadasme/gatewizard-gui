export const PROJECT_STATUS_POLL_MS = 5000
export const PROJECT_STATUS_BACKOFF_MS = 15000

/**
 * 0 = do not poll (Visualize). 15 s when the last scan was empty; else 5 s.
 * @param {{ pageId?: string, emptyTasks?: boolean }} opts
 */
export function projectStatusPollMs(opts = {}) {
  if (opts.pageId === 'visualize') return 0
  if (opts.emptyTasks) return PROJECT_STATUS_BACKOFF_MS
  return PROJECT_STATUS_POLL_MS
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function projectStatusTasksEqual(a, b) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

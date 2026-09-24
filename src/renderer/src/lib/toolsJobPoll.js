/**
 * Tools folder-walk prune only while the Tools page is visible.
 * Running jobs still use cheap /job-status polls.
 */

/**
 * @param {{ pageActive?: boolean, jobCount?: number }} opts
 */
export function shouldStartToolsPrune(opts = {}) {
  const pageActive = opts.pageActive !== false
  const jobCount = Number(opts.jobCount) || 0
  return pageActive && jobCount > 0
}

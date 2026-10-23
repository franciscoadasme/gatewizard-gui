/**
 * A launch folder of `/` (macOS App Translocation) or a drive root such as `C:\`
 * is not a project directory.
 * @param {string | null | undefined} dir
 */
export function isFilesystemRoot(dir) {
  const trimmed = String(dir || '').trim()
  if (!trimmed) return false
  const stripped = trimmed.replace(/[\\/]+$/, '')
  if (!stripped) return true
  return /^[A-Za-z]:$/.test(stripped)
}

/**
 * Empty string when no writable project folder has been chosen.
 * @param {string | null | undefined} dir
 */
export function usableWorkingDir(dir) {
  const trimmed = String(dir || '').trim()
  if (!trimmed || isFilesystemRoot(trimmed)) return ''
  return trimmed
}

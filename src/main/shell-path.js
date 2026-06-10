import { spawnSync } from 'child_process'
import path from 'path'

function mergePathSegments(...segments) {
  const seen = new Set()
  const parts = []
  for (const segment of segments) {
    if (!segment) continue
    for (const part of segment.split(path.delimiter)) {
      const trimmed = part.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      parts.push(trimmed)
    }
  }
  return parts.join(path.delimiter)
}

function getWindowsRegistryPath() {
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')"
      ],
      { encoding: 'utf-8', windowsHide: true, timeout: 8000 }
    )
    if (result.status === 0 && result.stdout?.trim()) {
      return result.stdout.trim()
    }
  } catch {
    // Fall back to the process PATH below.
  }
  return ''
}

function getUnixLoginPath() {
  const shell = process.env.SHELL || '/bin/bash'
  const isFish = shell.toLowerCase().includes('fish')
  const args = isFish
    ? ['-l', '-c', 'echo -n $PATH']
    : ['-l', '-i', '-c', 'echo -n $PATH']

  try {
    const result = spawnSync(shell, args, {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, TERM: 'dumb' }
    })
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim()
    }
  } catch {
    // Fall back to the process PATH below.
  }
  return ''
}

/**
 * Desktop / Start-menu launches often inherit a minimal PATH (no shell profile).
 * Merge the login-shell PATH so external tools such as NAMD and GROMACS are found.
 */
export function getLoginShellPath() {
  if (process.platform === 'win32') {
    return getWindowsRegistryPath()
  }
  if (process.platform === 'linux' || process.platform === 'darwin') {
    return getUnixLoginPath()
  }
  return process.env.PATH || ''
}

/**
 * @param {string} [currentPath]
 * @param {string} [prefixDirs] colon/semicolon-separated dirs to prepend (e.g. conda bin)
 */
export function buildAugmentedPath(currentPath = process.env.PATH || '', prefixDirs = '') {
  const loginPath = getLoginShellPath()
  return mergePathSegments(prefixDirs, loginPath, currentPath)
}

/**
 * Electron may run on Windows or inside WSL. Sidecar paths arrive as either
 * ``C:\...`` or ``/mnt/c/...`` — try both so open() does not ENOENT.
 * @param {string} filePath
 * @returns {string[]}
 */
export function sidecarFsCandidates(filePath) {
  const raw = String(filePath || '')
  /** @type {string[]} */
  const out = []
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p)
  }
  add(raw)
  const slash = raw.replace(/\\/g, '/')
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(raw)
  if (win) add(`/mnt/${win[1].toLowerCase()}/${win[2].replace(/\\/g, '/')}`)
  const mnt = /^\/mnt\/([A-Za-z])\/(.*)$/.exec(slash)
  if (mnt) add(`${mnt[1].toUpperCase()}:\\${mnt[2].replace(/\//g, '\\')}`)
  return out
}

/**
 * Paths to try when reading a trajectory cache. A finished extract renames
 * ``*.gwxyz.part`` to ``*.gwxyz``; play may still hold the partial name.
 * @param {string} filePath
 * @returns {string[]}
 */
export function sidecarReadCandidates(filePath) {
  const raw = String(filePath || '')
  /** @type {string[]} */
  const names = []
  const addName = (p) => {
    if (p && !names.includes(p)) names.push(p)
  }
  addName(raw)
  if (raw.endsWith('.gwxyz.part')) addName(raw.slice(0, -'.part'.length))
  /** @type {string[]} */
  const out = []
  for (const name of names) {
    for (const candidate of sidecarFsCandidates(name)) {
      if (!out.includes(candidate)) out.push(candidate)
    }
  }
  return out
}

/**
 * Pick a candidate the current process can see or create (parent exists).
 * @param {string} dirPath
 * @param {(p: string) => boolean} exists
 * @param {(p: string) => string} dirname
 * @returns {string}
 */
export function resolveWritableDir(dirPath, exists, dirname) {
  const candidates = sidecarFsCandidates(dirPath)
  if (!candidates.length) return String(dirPath || '')
  const existing = candidates.find((p) => exists(p))
  if (existing) return existing
  const creatable = candidates.find((p) => {
    try {
      return exists(dirname(p))
    } catch {
      return false
    }
  })
  return creatable || candidates[0]
}

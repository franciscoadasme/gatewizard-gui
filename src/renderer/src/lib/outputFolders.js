/** @param {string} filePath */
export function fileBasename(filePath) {
  return filePath.split(/[/\\]/).pop() ?? ''
}

/** @param {string} filePath */
export function pdbStem(filePath) {
  return fileBasename(filePath).replace(/\.pdb$/i, '') || 'structure'
}

/** Strip trailing slashes and normalize separators. @param {string} [dirPath] */
export function normalizeDirPath(dirPath) {
  return String(dirPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/** @param {string} dirPath */
export function dirBasename(dirPath) {
  return normalizeDirPath(dirPath).split('/').pop() ?? ''
}

/** @param {string} [a] @param {string} [b] */
export function dirsEqual(a, b) {
  return normalizeDirPath(a) === normalizeDirPath(b)
}

/** Parent directory of a file or folder path. @param {string} [fileOrDir] */
export function parentDirPath(fileOrDir) {
  const n = normalizeDirPath(fileOrDir)
  if (!n) return ''
  const i = n.lastIndexOf('/')
  if (i <= 0) return ''
  return n.slice(0, i)
}

/**
 * Unique non-empty directory list, preserving order.
 * @param {...string} dirs
 */
export function uniqueDirList(...dirs) {
  const seen = new Set()
  const out = []
  for (const d of dirs) {
    const n = normalizeDirPath(d)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * Compact path for dropdowns: relative to `relativeTo` when nested under it.
 * @param {string} [dir]
 * @param {string} [relativeTo]
 */
export function compactDirPath(dir, relativeTo = '') {
  const n = normalizeDirPath(dir)
  if (!n) return ''
  const base = normalizeDirPath(relativeTo)
  if (base && (n === base || n.startsWith(`${base}/`))) {
    const rel = n.slice(base.length).replace(/^\/+/, '')
    return rel ? `./${rel}` : '.'
  }
  return n
}

/** @param {string} topologyPath */
export function topologyStem(topologyPath) {
  return fileBasename(topologyPath).replace(/\.(pdb|psf|prmtop|parm7|gro)$/i, '') || 'topology'
}

/** @param {string} workingDir @param {string} folderName */
export function outputFolderPath(workingDir, folderName) {
  const name = folderName.trim()
  const parent = normalizeDirPath(workingDir)
  if (!parent || !name) return ''
  return `${parent}/${name}`
}

/** @param {string} workingFile */
export function defaultPreparationFolderName(workingFile) {
  if (!workingFile) return ''
  return `01_preparation_${pdbStem(workingFile)}`
}

/** @param {string} workingFile */
export function defaultBuildFolderName(workingFile) {
  if (!workingFile) return '02_build_bilayer'
  return `02_build_${pdbStem(workingFile)}`
}

/** @param {string} [inputDir] */
export function defaultEquilibrationFolderName(inputDir = '') {
  if (!inputDir) return '03_equilibration'
  const base = dirBasename(inputDir)
  return base ? `03_equilibration_${base}` : '03_equilibration'
}

/**
 * Default analysis output folder under the working directory.
 * Kept as a simple numbered name (not topology-stemmed) so energetic runs
 * without a topology and structural runs share the same clear default.
 *
 * @param {string} [_topologyPath] unused; kept for call-site compatibility
 */
export function defaultAnalysisFolderName(_topologyPath = '') {
  return '04_analysis'
}

/**
 * Default tools output folder under the working directory.
 *
 * @param {string} [_topologyPath] unused; kept for call-site compatibility
 */
export function defaultToolsFolderName(_topologyPath = '') {
  return '05_tools'
}

/** @param {string} workingFile */
export function defaultHydrationFolderName(workingFile) {
  if (!workingFile) return ''
  return `hydration_${pdbStem(workingFile).toLowerCase()}`
}

/** @param {string} [structurePath] */
export function defaultAnimationFolderName(structurePath = '') {
  if (!structurePath) return 'animation'
  return `animation_${pdbStem(structurePath).toLowerCase()}`
}

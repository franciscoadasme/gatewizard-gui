/** @param {string} filePath */
export function fileBasename(filePath) {
  return filePath.split(/[/\\]/).pop() ?? ''
}

/** @param {string} filePath */
export function pdbStem(filePath) {
  return fileBasename(filePath).replace(/\.pdb$/i, '') || 'structure'
}

/** @param {string} dirPath */
export function dirBasename(dirPath) {
  return dirPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}

/** @param {string} topologyPath */
export function topologyStem(topologyPath) {
  return fileBasename(topologyPath).replace(/\.(pdb|psf|prmtop|parm7|gro)$/i, '') || 'topology'
}

/** @param {string} workingDir @param {string} folderName */
export function outputFolderPath(workingDir, folderName) {
  const name = folderName.trim()
  if (!workingDir || !name) return ''
  return `${workingDir.replace(/[/\\]+$/, '')}/${name}`
}

/** @param {string} workingFile */
export function defaultPreparationFolderName(workingFile) {
  if (!workingFile) return ''
  return `01_preparation_${pdbStem(workingFile)}`
}

/** @param {string} workingFile */
export function defaultBuildFolderName(workingFile) {
  if (!workingFile) return ''
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

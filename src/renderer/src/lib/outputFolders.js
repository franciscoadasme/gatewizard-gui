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

/** @param {string} [topologyPath] */
export function defaultAnalysisFolderName(topologyPath = '') {
  if (!topologyPath) return '04_analysis'
  return `04_analysis_${topologyStem(topologyPath)}`
}

/** @param {string} workingFile */
export function defaultHydrationFolderName(workingFile) {
  if (!workingFile) return ''
  return `hydration_${pdbStem(workingFile).toLowerCase()}`
}

/**
 * One notice under the Builder PDB after a structure check.
 * @param {{
 *   summary?: { missing_atoms?: number, altlocs?: number },
 *   missing_residues?: Array<{ count?: number }>,
 *   hydrogens?: { protein_hydrogen?: number }
 * } | null | undefined} report
 */
export function structureNoticeFromReport(report) {
  if (!report) return ''
  const lines = []
  const missing = (report.summary?.missing_atoms || 0) > 0
  const longGap = (report.missing_residues || []).some((gap) => Number(gap.count) > 6)
  const hydrogens = report.hydrogens?.protein_hydrogen
  if (missing || longGap || hydrogens === 0) {
    lines.push('Prepare this file on the Preparation page before building.')
  }
  if ((report.summary?.altlocs || 0) > 0) {
    lines.push('Preparation can keep the most likely conformation.')
  }
  return lines.join(' ')
}

/**
 * Blocking problems that disable Generate Input Files.
 * A force-field warning is not included.
 * @param {{
 *   includeProtein: boolean,
 *   workingFile: string,
 *   lipidCount: number,
 *   needsMembraneSize: boolean,
 *   membraneSize: number,
 *   addSalt: boolean,
 *   saltConcentration: number,
 *   forceFieldError: string,
 *   pendingParameters: boolean
 * }} input
 */
export function builderBlockers(input) {
  /** @type {string[]} */
  const problems = []
  if (input.includeProtein && !input.workingFile) problems.push('Choose a PDB file.')
  if (input.lipidCount < 1) problems.push('Add at least one lipid.')
  if (input.needsMembraneSize && !(input.membraneSize > 0)) {
    problems.push('Set a membrane XY size.')
  }
  if (input.addSalt) {
    const conc = input.saltConcentration
    if (!Number.isFinite(conc) || conc < 0) {
      problems.push('Salt concentration cannot be negative.')
    }
  }
  if (input.forceFieldError) problems.push(input.forceFieldError)
  if (input.pendingParameters) {
    problems.push('Parametrize before generating, or tleap will fail.')
  }
  return problems
}

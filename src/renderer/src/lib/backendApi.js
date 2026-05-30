/** Must match `BACKEND_URL` in `src/main/index.js`. */
export const BACKEND_BASE_URL = 'http://127.0.0.1:8765'

// Add functions for the backend API here.
// Annotate the arguments and return type with the expected response shape.

/**
 * @returns {Promise<{ lipids: string[] }>}
 */
export function getAvailableLipids() {
  return backendJson('/available-lipids')
}

/**
 * @returns {Promise<{ water_models: string[], protein_ffs: string[], lipid_ffs: string[] }>}
 */
export function getAvailableForceFields() {
  return backendJson('/available-forcefields')
}

/**
 * @param {object} params
 * @returns {Promise<{ valid: boolean, error: string }>}
 */
export function validateBuilder(params) {
  return backendJson('/validate-builder', params)
}

/**
 * @param {object} params
 * @returns {Promise<{ success: boolean, message: string, job_dir: string }>}
 */
export function startPreparation(params) {
  return backendJson('/start-preparation', params)
}

/**
 * Poll the status.json for a running/completed job.
 * @param {string} jobDir  Absolute path to the job directory
 * @returns {Promise<{ status: string, current_step: number, steps_completed: string[], error: string|null, start_time: string, end_time: string|null }>}
 */
export function getJobStatus(jobDir) {
  return backendJson('/job-status', { jobDir })
}

/**
 * Read the tail of a log file for a job.
 * @param {string} jobDir  Absolute path to the job directory
 * @param {string} [logName='preparation.log']
 * @param {number} [tail=200]
 * @returns {Promise<{ lines: string[], exists: boolean }>}
 */
export function getJobLog(jobDir, logName = 'preparation.log', tail = 200) {
  return backendJson('/job-log', { jobDir, logName, tail })
}

/**
 * Scan a directory for existing preparation job sub-directories.
 * @param {string} directory  Absolute path to the working directory
 * @returns {Promise<{ jobs: Array<{ job_dir: string, name: string, status: string, current_step: number, steps_completed: string[], error: string|null, start_time: string|null, end_time: string|null }> }>}
 */
export function scanJobs(directory) {
  return backendJson('/scan-jobs', { directory })
}

/**
 * @typedef {{ id: string, name: string, type: 'preparation'|'equilibration', status: string, progress: number, current_step: number, total_steps: number, steps?: string[], steps_completed?: string[], engine?: string, error: string|null, start_time: string|null, end_time: string|null }} ProjectTask
 * @param {string} directory  Absolute path to the working directory
 * @returns {Promise<{ tasks: ProjectTask[], active: boolean }>}
 */
export function getProjectStatus(directory) {
  return backendJson(`/project-status?directory=${encodeURIComponent(directory)}`)
}

/**
 * @param {string} filePath
 * @returns {Promise<{ ligands: {name: string, formula: string, n_atoms: number}[] }>}
 */
export function detectLigands(filePath) {
  return backendJson('/detect-ligands', { path: filePath })
}

/**
 * @param {string} filePath
 * @param {string} ligandName
 * @param {number} charge
 * @param {number} multiplicity
 * @returns {Promise<{ success: boolean, message: string, frcmod: string, lib: string }>}
 */
export function parametrizeLigand(filePath, ligandName, charge = 0, multiplicity = 1) {
  return backendJson('/parametrize-ligand', {
    path: filePath,
    ligandName,
    charge,
    multiplicity
  })
}

/**
 * Get a base64-encoded 2D image of a ligand.
 * Provide either pdb_lines (initial) or mol2_path (final, after parametrization).
 * @param {{ pdbLines?: string[], mol2Path?: string, width?: number, height?: number }} opts
 * @returns {Promise<{ image: string }>}
 */
export function getLigandImage(opts) {
  return backendJson('/ligand-image', opts)
}

/**
 * Check which ligands already have frcmod/lib from a previous parametrization run.
 * @param {string} pdbPath
 * @param {string[]} ligandNames
 * @returns {Promise<{ parametrized: Record<string, { frcmod: string, lib: string, mol2: string|null }> }>}
 */
export function checkLigandParametrization(pdbPath, ligandNames) {
  return backendJson('/check-ligand-parametrization', {
    pdbPath,
    ligandNames
  })
}

/**
 * Run structural trajectory analysis (RMSD/RMSF/Distance/Rg).
 * @param {{ topologyPath: string, trajectoryPaths: string[], analysisType: string, selection?: string, selection2?: string, referenceFrame?: number, align?: boolean, fileTimes?: Record<string, number> }} payload
 * @returns {Promise<{ analysis_type: string, x: number[], y: number[], x_label: string, y_label: string, series_name: string, x_labels?: string[], stats?: Record<string, number> }>}
 */
export function runStructuralAnalysis(payload) {
  return backendJson('/analysis-structural', payload)
}

/**
 * Detect available energetic properties from NAMD log files.
 * @param {{ logPaths: string[], fileTimes?: Record<string, number> }} payload
 * @returns {Promise<{ properties: string[] }>}
 */
export function getEnergeticProperties(payload) {
  return backendJson('/analysis-energetic-properties', payload)
}

/**
 * Run energetic analysis from NAMD logs.
 * @param {{ logPaths: string[], properties?: string[], fileTimes?: Record<string, number>, timeUnits?: string, energyUnits?: string, pressureUnits?: string, temperatureUnits?: string, volumeUnits?: string }} payload
 * @returns {Promise<{ x: number[], x_label: string, series: Array<{ name: string, key: string, unit: string, y: number[] }>, statistics: Record<string, Record<string, number>> }>}
 */
export function runEnergeticAnalysis(payload) {
  return backendJson('/analysis-energetic', payload)
}

/**
 * Analyze a topology file and return structural summary.
 * @param {{ topologyPath: string }} payload
 * @returns {Promise<{ n_atoms: number, n_residues: number, n_segments: number, segments: Array<{ segid: string, n_residues: number, n_atoms: number }>, residue_types: string[] }>}
 */
export function analyzeTopology(payload) {
  return backendJson('/analyze-topology', payload)
}

/**
 * @param {{ path: string, topology: string|null, selection: string|null, needs_bonds: boolean, needs_secondary_structure: boolean, save_dir?: string|null }} payload
 * @returns {Promise<{
 *   path: string,
 *   atoms: { x: number, y: number, z: number, element: string, name: string }[],
 *   bonds: [number, number][],
 *   residues: Array<{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }> }>}
 */
export function getStructure(payload) {
  return backendJson('/get-structure', payload)
}

/**
 * @param {string} filePath
 * @param {float} targetPh
 * @param {boolean} capProtein
 * @returns {Promise<{ residues: {residue: string, res_id: number, chain: string, pka: number, atom: string, atom_type: string, model_pka: number, current_state: string, initial_state: string, all_states: string[]}[], residue_renumbering_table: Record<string, number> }>}
 */
export async function runPropKa(filePath, targetPh, capProtein) {
  return backendJson('/run-propka', { path: filePath, targetPh, capProtein })
}

/**
 * @param {string} filePath
 * @param {number} maxDisulfideDistance
 * @returns {Promise<{ disulfide_bonds: [[ [string, number], [string, number] ]] }>}
 */
export async function detectDisulfideBonds(filePath, maxDisulfideDistance) {
  return backendJson('/detect-disulfide-bonds', {
    path: filePath,
    maxDisulfideDistance
  })
}

/**
 * @param {{ path: string, outputPath: string, protonationStates: object, targetPh: number, disulfideBonds: [[ [string, number], [string, number] ]] }} props
 * @returns {Promise<{ output: string }>}
 */
export async function preparePDB(props) {
  return backendJson('/prepare-pdb', props)
}

/**
 * @param {{ workingDir: string, outputName: string, ensemble: string, programConfig: object, protocol: object, addComRestraint?: boolean, comSelection?: string, comRestraintK?: number, addRotationRestraint?: boolean, rotationRestraintK?: number }} props
 * @returns {Promise<void>}
 */
export async function generateEquilibration(props) {
  return backendJson('/generate-equilibration', props)
}

/**
 * @param {{ engine: string, executable: string }} props
 * @returns {Promise<{ engine: string, executable: string, exists: boolean, resolved_path: string|null, version: string|null }>}
 */
export async function checkExecutable(props) {
  return backendJson('/check-executable', props)
}

/**
 * @param {{ inputDir: string, outputDir: string, programConfig: { engine: string, executable: string }, comSelection?: string, comRestraintK?: number, addRotationRestraint?: boolean, rotationRestraintK?: number }} props
 * @returns {Promise<{ output: string, engine: string }>}
 */
export async function generateComRestraint(props) {
  return backendJson('/generate-com-restraint', props)
}

/**
 * @param {{ workingDir: string, engine: string }} props
 * @returns {Promise<void>}
 */
export async function runEquilibration(props) {
  return backendJson('/run-equilibration', props)
}

/**
 * @param {{ workingDir: string, engine: string }} props
 * @returns {Promise<{ status: 'empty' | 'running' | 'completed' | 'error' | 'not_started', stages: { name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, output: string }[], output: string }>}
 */
export async function getEquilibrationStatus(props) {
  return backendJson('/get-equilibration-status', props)
}

/**
 * @param {{ workingDir: string, engine: string }} props
 * @returns {Promise<{ stopped: boolean }>}
 */
export async function stopEquilibration(props) {
  return backendJson('/stop-equilibration', props)
}

/**
 * @param {{ workingDir: string, engine: string }} props
 * @returns {Promise<{ pid: number|null, running: boolean, command: string|null, start_time: string|null, working_dir: string, engine: string }>}
 */
export async function getProcessInfo(props) {
  return backendJson('/process-info', props)
}

/**
 * @returns {Promise<{ platforms: { name: string, speed: number }[], error?: string }>}
 */
export async function getOpenmmPlatforms() {
  return backendJson('/get-openmm-platforms')
}

/**
 * @param {string} filePath
 * @returns {Promise<{ selection: string, atoms: { x: number, y: number, z: number, element: string, name: string }[], residues?: Array<{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }> }[]>}
 */
export async function detectMolecules(filePath) {
  return backendJson('/detect-molecules', { path: filePath })
}

// Helper functions for the backend API.

/**
 * @param {unknown} data
 * @param {Response} response
 */
function throwFromFastApiBody(data, response) {
  const detail =
    data && typeof data === 'object' && data !== null && 'detail' in data
      ? /** @type {{ detail: unknown }} */ (data).detail
      : undefined
  const msg =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail
            .map((d) =>
              d && typeof d === 'object' && 'msg' in d ? String(d.msg) : JSON.stringify(d)
            )
            .join('; ')
        : detail != null
          ? JSON.stringify(detail)
          : `HTTP ${response.status}`
  throw new Error(msg)
}

// ---------------------------------------------------------------------------
// Structure editing
// ---------------------------------------------------------------------------

/** @typedef {{ path: string, atoms: object[], bonds: number[][] }} EditResult */

/**
 * @param {{ path: string, oldChain: string, newChain: string }} payload
 * @returns {Promise<EditResult>}
 */
export function editRenameChain(payload) {
  return backendJson('/edit/rename-chain', payload)
}

/**
 * @param {{ path: string, chainId: string, start: number, end: number, newName: string }} payload
 * @returns {Promise<EditResult>}
 */
export function editRenameResidues(payload) {
  return backendJson('/edit/rename-residues', payload)
}

/**
 * @param {{ path: string, chainId: string, start: number, end: number, newStart?: number }} payload
 * @returns {Promise<EditResult>}
 */
export function editRenumberResidues(payload) {
  return backendJson('/edit/renumber-residues', payload)
}

/**
 * @param {{ path: string, selection: string }} payload
 * @returns {Promise<EditResult>}
 */
export function editDeleteAtoms(payload) {
  return backendJson('/edit/delete-atoms', payload)
}

/**
 * Delete atoms by their MDAnalysis index array.
 * @param {{ path: string, indices: number[] }} payload
 * @returns {Promise<EditResult>}
 */
export function editDeleteByIndices(payload) {
  return backendJson('/edit/delete-by-indices', payload)
}

/**
 * @param {{ path: string, rotate?: { angle: number, axis: string }, translate?: [number, number, number] }} payload
 * @returns {Promise<EditResult>}
 */
export function editTransform(payload) {
  return backendJson('/edit/transform', payload)
}

/**
 * Copy a PDB file to a new destination path.
 * @param {{ source: string, dest: string }} payload
 * @returns {Promise<{ path: string, success: boolean }>}
 */
export function editSavePdb(payload) {
  return backendJson('/edit/save-pdb', payload)
}

/**
 * Count atoms matching a MDAnalysis selection.
 * @param {{ path: string, selection: string }} payload
 * @returns {Promise<{ count: number, total: number }>}
 */
export function transformCountSelection(payload) {
  return backendJson('/transform/count-selection', payload)
}

/**
 * Preview a transform — returns new atom positions without saving.
 * @param {{ path: string, selection?: string|null, op: object }} payload
 * @returns {Promise<{ positions: number[][], affected_count: number }>}
 */
export function transformPreview(payload) {
  return backendJson('/transform/preview', payload)
}

/**
 * Apply a transform, save to temp PDB, return updated structure.
 * @param {{ path: string, selection?: string|null, op: object }} payload
 * @returns {Promise<{ path: string, atoms: object[], bonds: number[][] }>}
 */
export function transformApply(payload) {
  return backendJson('/transform/apply', payload)
}

/**
 * Start a MemPro orientation job asynchronously.
 * @param {object} payload
 * @returns {Promise<{ job_id: string }>}
 */
export function memproRun(payload) {
  return backendJson('/mempro/run', payload)
}

/**
 * Poll the status of a MemPro job.
 * @param {string} jobId
 * @returns {Promise<{ status: string, results: object[]|null, error: string|null }>}
 */
export function memproStatus(jobId) {
  return backendJson(`/mempro/status/${jobId}`)
}

/**
 * Load an oriented PDB as the current structure.
 * @param {{ pdb_path: string }} payload
 * @returns {Promise<{ path: string, atoms: object[], bonds: number[][] }>}
 */
export function memproApply(payload) {
  return backendJson('/mempro/apply', payload)
}

/**
 * @template T
 * @param {string} path
 * @param {Record<string, unknown> | null | undefined} [payload] JSON-serialized when present and the method allows a body
 * @returns {Promise<T>}
 */
export async function backendJson(path, payload) {
  const url = `${BACKEND_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  /** @type {RequestInit} */
  const init = { method: payload ? 'POST' : 'GET' }
  if (payload != null) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(keysToSnakeCase(payload))
  }

  let response
  try {
    response = await fetch(url, init)
  } catch (err) {
    console.error('[backendApi] fetch failed', { url, err })
    throw err
  }

  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok) {
    throwFromFastApiBody(data, response)
  }
  return /** @type {T} */ (data)
}

/** @param {string} str */
function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
}

/**
 * Recursively convert all object keys from camelCase to snake_case.
 * @param {unknown} obj
 * @returns {unknown}
 */
function keysToSnakeCase(obj) {
  if (Array.isArray(obj)) return obj.map(keysToSnakeCase)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toSnakeCase(k), keysToSnakeCase(v)])
    )
  }
  return obj
}

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
 * @param {string} filePath
 * @returns {Promise<{ n_atoms: number, positions: number[], elements: string[] }>}
 */
export function loadPdb(filePath) {
  return backendJson('/load-pdb', { path: filePath })
}

/**
 * @param {string} filePath
 * @param {string} selection
 * @returns {Promise<{ n_atoms: number, positions: number[], elements: string[] }>}
 */
export async function selectAtoms(filePath, selection) {
  return backendJson('/select', { path: filePath, selection })
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
 * @param {{ workingDir: string, outputName: string, ensemble: string, programConfig: object, protocol: object }} props
 * @returns {Promise<void>}
 */
export async function generateEquilibration(props) {
  return backendJson('/generate-equilibration', props)
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

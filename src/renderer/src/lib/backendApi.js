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
  return backendJson('/job-status', { job_dir: jobDir })
}

/**
 * Read the tail of a log file for a job.
 * @param {string} jobDir  Absolute path to the job directory
 * @param {string} [logName='preparation.log']
 * @param {number} [tail=200]
 * @returns {Promise<{ lines: string[], exists: boolean }>}
 */
export function getJobLog(jobDir, logName = 'preparation.log', tail = 200) {
  return backendJson('/job-log', { job_dir: jobDir, log_name: logName, tail })
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
    ligand_name: ligandName,
    charge,
    multiplicity
  })
}

/**
 * Get a base64-encoded 2D image of a ligand.
 * Provide either pdb_lines (initial) or mol2_path (final, after parametrization).
 * @param {{ pdb_lines?: string[], mol2_path?: string, width?: number, height?: number }} opts
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
    pdb_path: pdbPath,
    ligand_names: ligandNames
  })
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
 * @returns {Promise<{ residues: {residue: string, res_id: number, chain: string, pka: number, atom: string, atom_type: string, model_pka: number}[] }>}
 */
export async function runPropKa(filePath, targetPh) {
  return backendJson('/run-propka', { path: filePath, targetPh })
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
    init.body = JSON.stringify(payload)
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

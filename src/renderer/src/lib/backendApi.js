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
 * @typedef {Object} DependencyInfo
 * @property {boolean} available
 * @property {boolean} required
 * @property {string} install_group
 * @property {string} description
 * @property {string|null} version
 */

/**
 * @typedef {Object} ExecutableInfo
 * @property {string} name
 * @property {string|null} path
 * @property {string|null} version
 * @property {boolean} available
 * @property {string} [description]
 */

/**
 * @returns {Promise<{
 *   dependencies: Record<string, DependencyInfo>,
 *   platform?: { python_version?: string, platform?: string, system?: string },
 *   executables?: ExecutableInfo[]
 * }>}
 */
export function getDependencyVersions() {
  return backendJson('/dependency-versions')
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
 * Generate preparation input files without launching the job.
 * @param {object} params
 * @returns {Promise<{ success: boolean, message: string, job_dir: string }>}
 */
export function generatePreparation(params) {
  return backendJson('/generate-preparation', params)
}

/**
 * Launch a previously generated preparation job.
 * @param {string} jobDir  Absolute path to the job directory
 * @returns {Promise<{ success: boolean, message: string, job_dir: string }>}
 */
export function runPreparation(jobDir) {
  return backendJson('/run-preparation', { jobDir })
}

/**
 * Cancel a running Builder preparation job.
 * @param {string} jobDir Absolute path to the job directory
 * @returns {Promise<{ success: boolean, job_dir: string, stopped: boolean, status: string, message: string, killed_process?: boolean }>}
 */
export function cancelPreparation(jobDir) {
  return backendJson('/cancel-preparation', { jobDir })
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
 * List allow-listed log/text files under an equilibration job folder.
 * @param {string} jobDir
 * @returns {Promise<{ files: Array<{ path: string, name: string, mtime: number, size: number }> }>}
 */
export function listEquilibrationJobFiles(jobDir) {
  return backendJson('/equilibration-job-files', { jobDir })
}

/**
 * Read head or tail of a relative path under an equilibration job folder.
 * @param {{
 *   jobDir?: string,
 *   job_dir?: string,
 *   relPath?: string,
 *   rel_path?: string,
 *   mode?: 'head'|'tail',
 *   lines?: number
 * }} props
 * @returns {Promise<{ lines: string[], exists: boolean, mode: string, line_count: number, file_size: number }>}
 */
export function getEquilibrationJobLog(props) {
  return backendJson('/equilibration-job-log', {
    jobDir: props.jobDir || props.job_dir,
    relPath: props.relPath || props.rel_path,
    mode: props.mode || 'tail',
    lines: props.lines ?? 50
  })
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
 * @typedef {{ cpu_cores_min?: number|null, cpu_cores_max?: number|null, gpu_id_min?: number|null, gpu_id_max?: number|null, num_gpus?: number|null, use_gpu?: boolean|null, platform?: string|null, engine?: string }} EquilibrationJobResources
 * @typedef {{ job_dir: string, name: string, engine: string, variant: string|null, status: string, start_time: string|null, dir_mtime?: number|null, stages_done: number, stages_total: number, error: string|null, can_run?: boolean, can_resume?: boolean, resume_reason?: string, resume_stage_index?: number, resume_stage_name?: string, resume_completed_stages?: number, resources?: EquilibrationJobResources, input_dir?: string|null, ensemble?: string|null, protocol?: { name: string, description?: string, stages: object[] }|null, gpu_resident?: boolean|null, execution?: object|null }} EquilibrationJobSummary
 * Scan a directory for equilibration job folders (run_equilibration.sh).
 * @param {string} directory  Absolute path to the working directory
 * @returns {Promise<{ jobs: EquilibrationJobSummary[] }>}
 */
export function scanEquilibrationJobs(directory) {
  return backendJson('/scan-equilibration-jobs', { directory })
}

/**
 * Re-read a single equilibration job folder from disk.
 * @param {string} jobDir
 * @param {string} [workingDir]
 * @param {{ forForm?: boolean }} [opts]
 * @returns {Promise<EquilibrationJobSummary>}
 */
export function getEquilibrationJobSummary(jobDir, workingDir, opts = {}) {
  return backendJson('/equilibration-job-summary', {
    jobDir,
    ...(workingDir ? { workingDir } : {}),
    ...(opts.forForm ? { forForm: true } : {})
  })
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
 * Count protein-only hydrogens in a PDB (ligands / hetero H ignored).
 * @param {string} filePath
 * @returns {Promise<{ count: number, has_protein_hydrogens: boolean }>}
 */
export function getProteinHydrogenStatus(filePath) {
  return backendJson('/protein-hydrogen-status', { path: filePath })
}

/**
 * Detect ACE/NME/NMA terminal caps already present in a PDB.
 * @param {string} filePath
 * @returns {Promise<{ caps: string[], already_capped: boolean, stem_ends_with_capped: boolean }>}
 */
export function detectTerminalCaps(filePath) {
  return backendJson('/detect-terminal-caps', { path: filePath })
}

/**
 * @param {string} filePath
 * @param {string} ligandName
 * @param {number} charge
 * @param {number} multiplicity
 * @param {string | null} [outputDir] Builder output folder (ligand_params written under here)
 * @returns {Promise<{ success: boolean, message: string, frcmod: string, lib: string, mol2?: string }>}
 */
export function parametrizeLigand(
  filePath,
  ligandName,
  charge = 0,
  multiplicity = 1,
  outputDir = null
) {
  return backendJson('/parametrize-ligand', {
    path: filePath,
    ligandName,
    charge,
    multiplicity,
    ...(outputDir ? { outputDir } : {})
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
 * @param {string | null} [outputDir] Preferred Builder output folder to search first
 * @returns {Promise<{ parametrized: Record<string, { frcmod: string, lib: string, mol2: string|null }> }>}
 */
export function checkLigandParametrization(pdbPath, ligandNames, outputDir = null) {
  return backendJson('/check-ligand-parametrization', {
    pdbPath,
    ligandNames,
    ...(outputDir ? { outputDir } : {})
  })
}

/**
 * Run structural trajectory analysis (RMSD/RMSF/Distance/Rg/bilayer).
 * @param {{ topologyPath: string, trajectoryPaths: string[], analysisType: string, selection?: string, selection2?: string, referenceFrame?: number, align?: boolean, fileTimes?: Record<string, number>, fileStrides?: Record<string, number>, rmsfXaxisType?: string, leafletLipidSel?: string|null, leafletFilterSel?: string|null, nBins?: number, interpolate?: boolean, start?: number|null, stop?: number|null, step?: number|null }} payload
 * @returns {Promise<{ analysis_type: string, x: number[], y: number[], x_label: string, y_label: string, series_name: string, x_labels?: string[], stats?: Record<string, number>, mean_upper_leaflet?: number[], mean_lower_leaflet?: number[] }>}
 */
export function runStructuralAnalysis(payload) {
  return backendJson('/analysis-structural', payload)
}

/**
 * Count atoms matching MDAnalysis selection(s) on the analysis topology.
 * @param {{ topologyPath: string, trajectoryPaths?: string[], selection: string, selection2?: string|null }} payload
 * @returns {Promise<{ count: number, total_atoms: number, count2?: number }>}
 */
export function countAnalysisSelection(payload) {
  return backendJson('/analysis-count-selection', payload)
}

/**
 * Detect which engine/tool should fix PBC for the given inputs.
 * @param {{ topologyPath: string, trajectoryPaths?: string[], engine?: string }} payload
 * @returns {Promise<{ engine: string, method: string, reason: string, tpr: string|null, ndx: string|null, topology: string|null, warnings: string[], center_groups?: Array<{ name: string, index: number, n_atoms: number, recommended?: boolean, lipid_like?: boolean }>, recommended_center?: string|null, recommended_center_groups?: string[], recommended_output?: string|null, lipid_resnames?: string[], recommended_center_selection?: string, supported_output_formats?: string[] }>}
 */
export function detectPbcEngine(payload) {
  return backendJson('/tools-detect-pbc-engine', payload)
}

/**
 * List GROMACS index groups for centering.
 * @param {{ ndxPath?: string|null, tprPath?: string|null, gmxExecutable?: string|null }} payload
 * @returns {Promise<{ groups: Array<{ name: string, index: number, n_atoms: number, recommended?: boolean, lipid_like?: boolean }>, recommended: string, recommended_groups?: string[], source: string|null, warnings: string[] }>}
 */
export function listGromacsGroups(payload) {
  return backendJson('/tools-list-gromacs-groups', payload)
}

/**
 * Start an async Fix PBC job (returns immediately with job_dir).
 * @param {{ topologyPath: string, trajectoryPaths: string[], outputDir: string, engine?: string, centerSelection?: string, centerGroup?: string|null, outputGroup?: string|null, centerGroups?: string[]|null, outputGroups?: string[]|null, skipCluster?: boolean, tprPath?: string|null, ndxPath?: string|null, gmxExecutable?: string|null, cpptrajExecutable?: string|null, outputFormat?: 'dcd'|'xtc'|'nc'|'same', stride?: number, fileStrides?: Record<string, number>|null, jobName?: string|null }} payload
 * @returns {Promise<{ success: boolean, job_dir: string, engine: string, method: string, message: string, pid?: number, detect?: object }>}
 */
export function runFixPbc(payload) {
  return backendJson('/tools-fix-pbc', payload)
}

/**
 * Scan for Tools jobs (tools_job.json) under a directory.
 * @param {string} directory
 * @returns {Promise<{ jobs: Array<{ job_dir: string, name: string, type: string, engine?: string, method?: string, status: string, current_step: number, steps: string[], steps_completed: string[], error: string|null, start_time?: string, end_time?: string|null, outputs?: any[] }> }>}
 */
export function scanToolsJobs(directory) {
  return backendJson('/scan-tools-jobs', { directory })
}

/**
 * Scan for saved analysis sessions (analysis_session.json) under a working directory.
 * @param {string} directory
 * @returns {Promise<{ sessions: Array<{ session_path: string, output_dir: string, name: string, folder_name?: string, session_name?: string, saved_at: string, mode: string, set_count: number, analysis_summary: string }> }>}
 */
export function scanAnalysisSessions(directory) {
  return backendJson('/scan-analysis-sessions', { directory })
}

/**
 * Cancel a running Tools job.
 * @param {string} jobDir
 * @returns {Promise<{ success: boolean, job_dir: string, stopped: boolean, status: string, message: string, killed_process?: boolean }>}
 */
export function cancelToolsJob(jobDir) {
  return backendJson('/tools-cancel-job', { jobDir })
}

/**
 * Detect available energetic properties from log files.
 * @param {{ logPaths: string[], fileTimes?: Record<string, number>, engine?: 'namd'|'openmm'|'gromacs' }} payload
 * @returns {Promise<{ properties: string[] }>}
 */
export function getEnergeticProperties(payload) {
  return backendJson('/analysis-energetic-properties', payload)
}

/**
 * Run energetic analysis from MD engine log files.
 * @param {{ logPaths: string[], properties?: string[], fileTimes?: Record<string, number>, fileStrides?: Record<string, number>, timeUnits?: string, energyUnits?: string, pressureUnits?: string, temperatureUnits?: string, volumeUnits?: string, engine?: 'namd'|'openmm'|'gromacs'|'amber' }} payload
 * @returns {Promise<{ x: number[], x_label: string, series: Array<{ name: string, key: string, unit: string, y: number[] }>, statistics: Record<string, Record<string, number>> }>}
 */
export function runEnergeticAnalysis(payload) {
  return backendJson('/analysis-energetic', payload)
}

/**
 * Render publication PNG from energetic data + PlotSpec (matches Python API styling).
 * @param {{ data: object, plotSpec: object }} payload
 * @returns {Promise<Blob>}
 */
export async function renderAnalysisPlot(payload) {
  const url = `${BACKEND_BASE_URL}/analysis-render-plot`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keysToSnakeCase(payload))
  })
  if (!response.ok) {
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    throwFromFastApiBody(data, response)
  }
  return response.blob()
}

/**
 * Analyze a topology file and return structural summary.
 * @param {{ topologyPath: string }} payload
 * @returns {Promise<{ n_atoms: number, n_residues: number, n_segments: number, segments: Array<{ segid: string, n_residues: number, n_atoms: number }>, residue_types: string[], lipid_headgroup_atoms?: Array<{ name: string, atom_count: number }>, lipid_headgroup_selection?: string }>}
 */
export function analyzeTopology(payload) {
  return backendJson('/analyze-topology', payload)
}

/**
 * Detect phosphate/headgroup atom names in lipid residues from a topology file.
 * @param {{ topologyPath: string, trajectoryPaths?: string[] }} payload
 * @returns {Promise<{ lipid_headgroup_atoms: Array<{ name: string, atom_count: number }>, lipid_headgroup_selection: string }>}
 */
export function detectLipidHeadgroups(payload) {
  return backendJson('/detect-lipid-headgroups', payload)
}

/**
 * Expand columnar atom arrays from /get-structure into the object list the viewer expects.
 * @param {any} data
 * @returns {any}
 */
function normalizeStructurePayload(data) {
  if (!data || !data.atoms) return data
  if (Array.isArray(data.atoms)) return data
  if (data.atoms_format === 'columnar' || (data.atoms.x && Array.isArray(data.atoms.x))) {
    const cols = data.atoms
    const n = cols.x?.length ?? 0
    const atoms = new Array(n)
    for (let i = 0; i < n; i++) {
      atoms[i] = {
        x: cols.x[i],
        y: cols.y[i],
        z: cols.z[i],
        element: cols.element[i],
        name: cols.name[i],
        index: cols.index[i],
        res_name: cols.res_name[i],
        res_id: cols.res_id[i],
        chain_id: cols.chain_id[i]
      }
    }
    return { ...data, atoms, atoms_format: 'objects' }
  }
  return data
}

/**
 * @param {{ path: string, topology: string|null, selection: string|null, needs_bonds: boolean, needs_secondary_structure: boolean, save_dir?: string|null }} payload
 * @returns {Promise<{
 *   path: string,
 *   atoms: { x: number, y: number, z: number, element: string, name: string }[],
 *   bonds: [number, number][],
 *   topology_used?: string|null,
 *   bond_source?: string,
 *   residues: Array<{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }> }>}
 */
export async function getStructure(payload) {
  const data = await backendJson('/get-structure', payload)
  return normalizeStructurePayload(data)
}

/**
 * @param {string} filePath
 * @param {float} targetPh
 * @param {boolean} capProtein
 * @param {{ workingDir?: string|null, outputFolderName?: string|null }} [opts]
 * @returns {Promise<{ residues: object[], residue_renumbering_table: Record<string, number>, job_dir?: string, working_path?: string, capping_warning?: string|null }>}
 */
export async function runPropKa(filePath, targetPh, capProtein, opts = {}) {
  return backendJson('/run-propka', {
    path: filePath,
    targetPh,
    capProtein,
    workingDir: opts.workingDir ?? null,
    outputFolderName: opts.outputFolderName ?? null
  })
}

/**
 * @param {string} filePath
 * @param {number} maxDisulfideDistance
 * @param {{ workingDir?: string|null, outputFolderName?: string|null }} [opts]
 * @returns {Promise<{ disulfide_bonds: [[ [string, number], [string, number] ]], job_dir?: string, working_path?: string }>}
 */
export async function detectDisulfideBonds(filePath, maxDisulfideDistance, opts = {}) {
  return backendJson('/detect-disulfide-bonds', {
    path: filePath,
    maxDisulfideDistance,
    workingDir: opts.workingDir ?? null,
    outputFolderName: opts.outputFolderName ?? null
  })
}

/**
 * @param {{ path: string, outputPath: string, protonationStates: object, targetPh: number, disulfideBonds: [[ [string, number], [string, number] ]], removeProteinHydrogens?: boolean, workingDir?: string|null, outputFolderName?: string|null }} props
 * @returns {Promise<{ output: string, output_path?: string, job_dir?: string, working_path?: string, protein_hydrogens_removed?: number }>}
 */
export async function preparePDB(props) {
  return backendJson('/prepare-pdb', props)
}

/**
 * Best-effort ghost H geometry for Preparation viewer (approximate; not pdb4amber).
 * @param {{ path: string, residues: Array<{ chain?: string, res_id: number, residue?: string, initial_state: string, current_state: string }> }} payload
 * @returns {Promise<{ ghost_atoms: object[], removed_markers: object[] }>}
 */
export function previewProtonation(payload) {
  return backendJson('/preview-protonation', payload)
}

/**
 * @param {string} workingDir
 * @param {string} outputFolderName
 * @returns {Promise<{ output_dir: string }>}
 */
export function ensureOutputFolder(workingDir, outputFolderName) {
  return backendJson('/ensure-output-folder', { workingDir, outputFolderName })
}

/**
 * @param {{ workingDir: string, outputName: string, ensemble: string, programConfig: object, protocol: object, addComRestraint?: boolean, comSelection?: string, comRestraintK?: number, addRotationRestraint?: boolean, rotationRestraintK?: number, waterModel?: string|null }} props
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
 * Discover installed NAMD / GROMACS / OpenMM candidates for the engine picker.
 * @param {string} engine
 * @returns {Promise<{ engine: string, candidates: Array<{ id: string, label: string, executable: string, version?: string|null, variant?: string|null, source?: string, gmxrc?: string|null, available?: boolean }> }>}
 */
export async function listEngineExecutables(engine) {
  return backendJson('/list-engine-executables', { engine })
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
 * @returns {Promise<{ working_dir: string, engine: string, can_resume: boolean, resume_reason: string, resume_stage_index: number, resume_stage_name: string, resume_completed_stages: number }>}
 */
export async function getEquilibrationResumeInfo(props) {
  return backendJson('/equilibration-resume-info', props)
}

/**
 * @param {{ workingDir: string, engine: string }} props
 * @returns {Promise<{ started: boolean, pid: number, resume_stage_index: number, resume_stage_name: string }>}
 */
export async function continueEquilibration(props) {
  return backendJson('/continue-equilibration', props)
}

/**
 * @param {{ workingDir: string, engine: string }} props
 * @returns {Promise<{ status: 'empty' | 'running' | 'completed' | 'error' | 'not_started', stages: { name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, elapsed_time_seconds: number|null, is_minimization?: boolean, steps_completed?: number|null, total_steps?: number|null, minimization_converged_early?: boolean, output: string }[], output: string }>}
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

/** @param {{ profile: object, password?: string|null }} props */
export async function clusterConnect(props) {
  return backendJson('/cluster/connect', props)
}

/** @param {{ session_id: string }} props */
export async function clusterDisconnect(props) {
  return backendJson('/cluster/disconnect', props)
}

/** @param {{ session_id: string, profile: object, want_gpu?: boolean, engine?: string }} props */
export async function clusterProbe(props) {
  return backendJson('/cluster/probe', props)
}

/** @param {object} profile */
export async function clusterDefaultTemplate(profile) {
  return backendJson('/cluster/default-template', profile)
}

/** @param {object} props */
export async function clusterRenderScript(props) {
  return backendJson('/cluster/render-script', props)
}

/** @param {object} props */
export async function clusterUploadJob(props) {
  return backendJson('/cluster/upload-job', props)
}

/** @param {object} props */
export async function clusterSubmitJob(props) {
  return backendJson('/cluster/submit-job', props)
}

/**
 * Stream upload + sbatch progress (NDJSON).
 * @param {object} props
 * @param {(evt: {
 *   phase?: string,
 *   percent?: number|null,
 *   message?: string,
 *   bytes?: number,
 *   total_bytes?: number,
 *   error?: string,
 *   result?: object
 * }) => void} [onProgress]
 * @returns {Promise<object>} final submit result
 */
export async function clusterSubmitJobStream(props, onProgress) {
  const url = `${BACKEND_BASE_URL}/cluster/submit-job-stream`
  const emit = (evt) => {
    if (typeof onProgress === 'function') onProgress(evt)
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson'
      },
      body: JSON.stringify(keysToSnakeCase(props))
    })
  } catch (err) {
    console.error('[backendApi] submit stream failed', { url, err })
    throw err
  }

  if (!response.ok) {
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    throwFromFastApiBody(data, response)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Submit stream unavailable (empty response body)')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  /** @type {object|null} */
  let finalResult = null
  /** @type {string|null} */
  let streamError = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let evt
      try {
        evt = JSON.parse(trimmed)
      } catch {
        continue
      }
      emit(evt)
      if (evt?.phase === 'done') {
        finalResult = evt.result || { ok: true }
      } else if (evt?.phase === 'error') {
        streamError = evt.error || evt.message || 'Submit failed'
      }
    }
  }

  if (buffer.trim()) {
    try {
      const evt = JSON.parse(buffer.trim())
      emit(evt)
      if (evt?.phase === 'done') finalResult = evt.result || { ok: true }
      else if (evt?.phase === 'error') streamError = evt.error || evt.message || 'Submit failed'
    } catch {
      /* ignore trailing garbage */
    }
  }

  if (streamError) throw new Error(streamError)
  if (!finalResult) throw new Error('Submit finished without a result')
  return finalResult
}

/** @param {object} props */
export async function clusterJobStatus(props) {
  return backendJson('/cluster/job-status', props)
}

/** @param {object} props */
export async function clusterCancelJob(props) {
  return backendJson('/cluster/cancel-job', props)
}

/** @param {object} props */
export async function clusterPullJob(props) {
  return backendJson('/cluster/pull-job', props)
}

/**
 * Streamed pull with NDJSON progress events.
 * @param {object} props
 * @param {(evt: {
 *   phase?: string,
 *   percent?: number|null,
 *   message?: string,
 *   speed?: string,
 *   eta?: string,
 *   error?: string,
 *   result?: object
 * }) => void} [onProgress]
 * @returns {Promise<object>} final pull result
 */
/**
 * Live Pull with NDJSON progress. Also polls local folder size so the UI updates
 * even if middleware buffers the stream (files landing on disk still move the bar).
 * @param {{
 *   session_id?: string,
 *   sessionId?: string,
 *   local_dir?: string,
 *   localDir?: string,
 *   remote_dir?: string,
 *   remoteDir?: string,
 *   full?: boolean,
 *   profile?: object|null,
 *   job_id?: string|null,
 *   jobId?: string|null
 * }} props
 * @param {(evt: {
 *   phase?: string,
 *   percent?: number|null,
 *   message?: string,
 *   bytes?: number,
 *   total_bytes?: number,
 *   partial?: boolean,
 *   error?: string,
 *   result?: object
 * }) => void} [onProgress]
 * @returns {Promise<object>} final pull result
 */
export async function clusterPullJobStream(props, onProgress) {
  const url = `${BACKEND_BASE_URL}/cluster/pull-job-stream`
  const localDir = props.local_dir || props.localDir || ''
  /** @type {number} */
  let expectedBytes = 0
  /** @type {ReturnType<typeof setInterval>|null} */
  let pollTimer = null
  /** @type {number} */
  let lastPollPct = -1

  const stopLocalPoll = () => {
    if (pollTimer != null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const emit = (evt) => {
    if (typeof evt?.total_bytes === 'number' && evt.total_bytes > 0) {
      expectedBytes = evt.total_bytes
    }
    if (typeof onProgress === 'function') onProgress(evt)
  }

  const startLocalPoll = () => {
    if (!localDir || pollTimer != null) return
    pollTimer = setInterval(async () => {
      try {
        const info = await clusterLocalDirSize({ local_dir: localDir })
        const bytes = typeof info?.bytes === 'number' ? info.bytes : 0
        const formatted = info?.formatted || `${bytes} B`
        if (expectedBytes > 0) {
          const raw = Math.max(0, Math.min(99, Math.round((100 * bytes) / expectedBytes)))
          // Map onto overall Pull bar (sync ≈ 15–90), matching backend mapping.
          const pct = 15 + Math.round(raw * 0.75)
          if (pct === lastPollPct && raw !== 0) return
          lastPollPct = pct
          emit({
            phase: 'sync',
            percent: pct,
            bytes,
            total_bytes: expectedBytes,
            message: `Downloading… ${formatted} / ${formatBytesApprox(expectedBytes)} (${raw}%)`
          })
        } else if (bytes > 0) {
          emit({
            phase: 'sync',
            percent: null,
            bytes,
            message: `Downloading… ${formatted} on disk`
          })
        }
      } catch {
        /* ignore transient poll errors */
      }
    }, 500)
  }

  startLocalPoll()

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson'
      },
      body: JSON.stringify(keysToSnakeCase(props))
    })
  } catch (err) {
    stopLocalPoll()
    console.error('[backendApi] pull stream failed', { url, err })
    throw err
  }

  if (!response.ok) {
    stopLocalPoll()
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    throwFromFastApiBody(data, response)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    stopLocalPoll()
    throw new Error('Pull stream unavailable (empty response body)')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  /** @type {object|null} */
  let finalResult = null
  /** @type {string|null} */
  let streamError = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let evt
        try {
          evt = JSON.parse(trimmed)
        } catch {
          continue
        }
        emit(evt)
        if (evt?.phase === 'done') {
          finalResult = evt.result || { ok: true }
          stopLocalPoll()
          try {
            await reader.cancel()
          } catch {
            /* stream already closing */
          }
        } else if (evt?.phase === 'error') {
          streamError = evt.error || evt.message || 'Pull failed'
          stopLocalPoll()
          try {
            await reader.cancel()
          } catch {
            /* stream already closing */
          }
        }
      }
    }

    if (buffer.trim()) {
      try {
        const evt = JSON.parse(buffer.trim())
        emit(evt)
        if (evt?.phase === 'done') finalResult = evt.result || { ok: true }
        else if (evt?.phase === 'error') streamError = evt.error || evt.message || 'Pull failed'
      } catch {
        /* ignore trailing garbage */
      }
    }
  } finally {
    stopLocalPoll()
  }

  if (streamError) throw new Error(streamError)
  if (!finalResult) throw new Error('Pull finished without a result')
  return finalResult
}

/**
 * @param {{
 *   local_dir?: string,
 *   localDir?: string,
 *   session_id?: string|null,
 *   sessionId?: string|null,
 *   remote_dir?: string|null,
 *   remoteDir?: string|null,
 *   measure_remote?: boolean,
 *   measureRemote?: boolean
 * }} props
 * @returns {Promise<{
 *   local_bytes: number,
 *   remote_bytes: number|null,
 *   local_formatted: string,
 *   remote_formatted: string|null,
 *   ratio: number|null,
 *   remote_error?: string|null
 * }>}
 */
export async function clusterJobFolderSizes(props) {
  return backendJson('/cluster/job-folder-sizes', props)
}

/**
 * @param {{ local_dir?: string, localDir?: string, excludes?: string[] }} props
 * @returns {Promise<{ bytes: number, formatted: string, exists: boolean }>}
 */
export async function clusterLocalDirSize(props) {
  return backendJson('/cluster/local-dir-size', props)
}

/** @param {number} n */
function formatBytesApprox(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, Number(n) || 0)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  if (i === 0) return `${Math.round(v)} ${units[i]}`
  return `${v.toFixed(1)} ${units[i]}`
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
 * Write a PDB with updated coordinates (in-memory edits) using source as template.
 * @param {{ source: string, dest: string, indices: number[], xyz: number[], topology?: string|null }} payload
 * @returns {Promise<{ path: string, success: boolean, count: number }>}
 */
export function structureWriteCoords(payload) {
  return backendJson('/structure/write-coords', {
    source: payload.source,
    dest: payload.dest,
    indices: payload.indices,
    xyz: payload.xyz,
    topology: payload.topology ?? null
  })
}

/**
 * Rename chain for specific atoms by index list.
 * @param {{ path: string, indices: number[], newChain: string }} payload
 */
export function editRenameChainByIndices(payload) {
  return backendJson('/edit/rename-chain-by-indices', {
    path: payload.path,
    indices: payload.indices,
    new_chain: payload.newChain,
  })
}

/**
 * Rename residue name for specific atoms by index list.
 * @param {{ path: string, indices: number[], newName: string }} payload
 */
export function editRenameResiduesByIndices(payload) {
  return backendJson('/edit/rename-residues-by-indices', {
    path: payload.path,
    indices: payload.indices,
    new_name: payload.newName,
  })
}

/**
 * Renumber residues for specific atoms by index list.
 * @param {{ path: string, indices: number[], newStart?: number }} payload
 */
export function editRenumberResiduesByIndices(payload) {
  return backendJson('/edit/renumber-residues-by-indices', {
    path: payload.path,
    indices: payload.indices,
    new_start: payload.newStart ?? 1,
  })
}

/**
 * Select atoms by MDAnalysis selection string, return indices.
 * @param {{ path: string, selection: string }} payload
 * @returns {Promise<{ indices: number[], count: number }>}
 */
export function editSelectByString(payload) {
  return backendJson('/edit/select-by-string', payload)
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
 * Preview / compute a transform — positions only (no temp PDB).
 * @param {{ path: string, selection?: string|null, op: object }} payload
 * @returns {Promise<{ positions: number[][], indices?: number[], xyz?: number[], affected_count: number }>}
 */
export function transformPreview(payload) {
  return backendJson('/transform/preview', payload)
}

/**
 * Compute transform positions in memory (preferred over /transform/apply).
 * @param {{ path: string, selection?: string|null, op: object }} payload
 * @returns {Promise<{ positions: number[][], indices?: number[], xyz?: number[], affected_count: number }>}
 */
export function transformCompute(payload) {
  return backendJson('/transform/compute', payload)
}

/**
 * Apply a transform, save to temp PDB, return updated structure.
 * @deprecated Prefer transformCompute + in-memory commit; kept for legacy callers.
 * @param {{ path: string, selection?: string|null, op: object }} payload
 * @returns {Promise<{ path: string, atoms: object[], bonds: number[][] }>}
 */
export function transformApply(payload) {
  return backendJson('/transform/apply', payload)
}

/**
 * Start a MemPro orientation job asynchronously.
 * @param {object} payload
 * @returns {Promise<{ job_id: string, start_time: string }>}
 */
export function memproRun(payload) {
  return backendJson('/mempro/run', payload)
}

/**
 * Scan a working directory for a persisted MemPro job state file.
 * @param {string} workingDir
 * @returns {Promise<{ found: boolean, job_id?: string, status?: string, start_time?: string, results?: object[]|null, error?: string|null, pid?: number|null }>}
 */
export function memproScan(workingDir) {
  return backendJson(`/mempro/scan?working_dir=${encodeURIComponent(workingDir)}`)
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
 * Apply a MemPro orientation to the loaded structure (keeps ligands/water/etc.).
 * @param {{ pdb_path: string, source_path?: string|null }} payload
 * @returns {Promise<{ path: string, atoms: object[], bonds: number[][] }>}
 */
export function memproApply(payload) {
  return backendJson('/mempro/apply', payload)
}

// ── Packmol hydration ────────────────────────────────────────────────────────

/**
 * Check whether the PACKMOL executable is available.
 * @returns {Promise<{ available: boolean, version: string|null, resolved_path: string|null }>}
 */
export function packmolCheck() {
  return backendJson('/packmol/check')
}

/**
 * Estimate cavity free volume and suggested water count inside a box.
 * @param {{ path: string, boxMin: number[], boxMax: number[], soluteRadius?: number|null, exclusionMode?: string|null, gridSpacing?: number|null, atomIndices?: number[]|null }} payload
 */
export function packmolEstimateVolume(payload) {
  return backendJson('/packmol/estimate-volume', payload)
}

/**
 * Preview PACKMOL input text and job file layout (no subprocess).
 * @param {{ path: string, workingDir?: string|null, boxMin: number[], boxMax: number[], nWaters: number, soluteRadius?: number|null, exclusionMode?: string|null, tolerance?: number, nloop?: number, gridSpacing?: number|null }} payload
 */
export function packmolPreviewInp(payload) {
  return backendJson('/packmol/preview-inp', payload)
}

/**
 * Run PACKMOL cavity hydration into working_dir/output_folder_name.
 * @param {{ path: string, workingDir: string, outputFolderName: string, boxMin: number[], boxMax: number[], nWaters?: number|null, soluteRadius?: number|null, exclusionMode?: string|null, tolerance?: number, nloop?: number, gridSpacing?: number|null }} payload
 */
export function packmolHydrateCavity(payload) {
  return backendJson('/packmol/hydrate-cavity', payload)
}

/**
 * Run user-supplied PACKMOL input text.
 * @param {{ inpText: string, workingDir: string, outputFolderName: string, inpFilename?: string, path?: string|null }} payload
 */
export function packmolRunCustom(payload) {
  return backendJson('/packmol/run-custom', payload)
}

/**
 * List previous hydration output folders in a working directory.
 * @param {{ workingDir: string }} payload
 * @returns {Promise<{ jobs: Array<{ job_dir: string, name: string, type: string, created: string, output_pdb: string, output_pdb_name: string, output_exists: boolean, success: boolean, message: string, n_waters?: number, exclusion_mode?: string, volumes?: object, box_min?: number[], box_max?: number[] }> }>}
 */
export function packmolScanJobs(payload) {
  return backendJson('/packmol/scan-jobs', payload)
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
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Failed to fetch' || err instanceof TypeError) {
      throw new Error(
        `Could not reach the backend at ${path}. It may be busy, restarted, or the response was too large — try again or restart the backend.`
      )
    }
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
 * Recursively convert object keys from camelCase to snake_case.
 * Preserves basename keys inside file_times / file_strides maps.
 * @param {unknown} obj
 * @param {string} [parentKey]
 * @returns {unknown}
 */
function keysToSnakeCase(obj, parentKey = '') {
  if (Array.isArray(obj)) return obj.map((v) => keysToSnakeCase(v, parentKey))
  if (obj !== null && typeof obj === 'object') {
    const preserveKeys =
      parentKey === 'file_times' ||
      parentKey === 'fileTimes' ||
      parentKey === 'file_strides' ||
      parentKey === 'fileStrides'
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        preserveKeys ? k : toSnakeCase(k),
        keysToSnakeCase(v, preserveKeys ? k : toSnakeCase(k))
      ])
    )
  }
  return obj
}

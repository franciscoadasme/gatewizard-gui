/**
 * Shared reactive status for each page.
 * Pages write here when actions complete; App.svelte reads for the footer.
 * Using .svelte.js so $state runes work outside components.
 */

// ── 01 Visualize ─────────────────────────────────────────────────────────────
export const visualizeStatus = $state({
  /** Whether a structure is currently loading */
  loading: false,
  /** Whether a structure is loaded */
  loaded: false,
  /** Basename of the loaded file, e.g. "protein.pdb" */
  fileName: '',
  /** Number of active view layers */
  viewCount: 0,
  // ── MemPro orientation (persisted across app restarts) ──
  /** Active MemPro job id, or null */
  memproJobId: /** @type {string|null} */ (null),
  /** 'running' | 'done' | 'error' | null */
  memproStatus: /** @type {'running'|'done'|'error'|null} */ (null),
  /** ISO timestamp when the job was started, or null */
  memproStartedAt: /** @type {string|null} */ (null),
  /** Set to true to trigger the results dialog from the status bar */
  openMemproDialog: false,
  /** Packmol hydration job status */
  packmolStatus: /** @type {'running'|'done'|'error'|null} */ (null),
  packmolStartedAt: /** @type {string|null} */ (null),
  packmolMessage: '',
  openPackmolDialog: false,
})

// ── 02 Preparation ───────────────────────────────────────────────────────────
export const preparationStatus = $state({
  /** Whether PropKa has been run in this session */
  propkaDone: false,
  /** pH that was used for the last PropKa run */
  propkaPh: /** @type {number|null} */ (null),
  /** Whether PropKa is currently running */
  propkaRunning: false,
  /** Last PropKa error message, or null */
  propkaError: /** @type {string|null} */ (null),
  /** Whether the "Detect bonds" button was clicked at least once */
  bondsChecked: false,
  /** Number of disulfide bonds found in the last detection run */
  bondsCount: 0,
  /** Whether "Prepare PDB" completed successfully */
  prepareDone: false,
  /** Path of the output protonated file, if prepare succeeded */
  outputFile: '',
})

// ── 03 Builder ───────────────────────────────────────────────────────────────
export const builderStatus = $state({
  /** Total number of builder jobs in this session */
  jobCount: 0,
  runningCount: 0,
  completedCount: 0,
  errorCount: 0,
  /** Name of the most recent job */
  latestName: '',
  /** Status of the most recent job */
  latestStatus: '',
  /** Elapsed string for the most recent job */
  latestElapsed: '',
  /** Whether input files are being generated right now */
  generatingInput: false,
})

// ── 04 Equilibration ─────────────────────────────────────────────────────────
export const equilibrationPageStatus = $state({
  /** MD engine selected */
  engine: '',
  /** Output folder name */
  outputName: '',
  /** Overall equilibration status */
  status: /** @type {'not_started'|'empty'|'running'|'completed'|'error'|''} */ (''),
  /** Number of completed stages */
  stagesDone: 0,
  /** Total number of stages */
  stagesTotal: 0,
  /** Whether input files are being generated right now */
  generatingInput: false,
  /** ms timestamp when equilibration first entered 'running' state (null if not started or reset) */
  runStartedAt: /** @type {number|null} */ (null),
  /** Set to true when the user kills the run; reset when a new run starts */
  wasKilled: false,
})

// ── 05 Tools ─────────────────────────────────────────────────────────────────
export const toolsStatus = $state({
  /** Total Tools jobs in this session / scan */
  jobCount: 0,
  runningCount: 0,
  completedCount: 0,
  errorCount: 0,
  /** Active tool id for the latest launch, e.g. 'fix_pbc' */
  tool: '',
  /** Name of the most recent job */
  latestName: '',
  /** Status of the most recent job */
  latestStatus: '',
  /** Elapsed string for the most recent job */
  latestElapsed: '',
  /** Whether a launch request is in flight */
  launching: false,
  /** Last launch error message, or empty string */
  error: '',
})

// ── 06 Analysis ──────────────────────────────────────────────────────────────
export const analysisStatus = $state({
  /** Whether an analysis is currently running */
  running: false,
  /** 'structural' | 'energetic' */
  mode: '',
  /** Structural type (rmsd, rmsf, distance, radius_of_gyration, area_per_lipid, membrane_thickness) or '' */
  analysisType: '',
  /** Whether a result is available for the current type */
  resultAvailable: false,
  /** Last analysis error message, or empty string */
  error: '',
  /** Multi-set batch progress (inactive during single-set runs) */
  progress: {
    active: false,
    current: 0,
    total: 0,
    label: '',
    phase: 'running'
  }
})

// ── Global history log ────────────────────────────────────────────────────────
/**
 * @typedef {{ id: string, level: 'info'|'detail'|'verbose', page: string, label: string, detail: string, timestamp: Date }} HistoryEvent
 */
export const historyLog = $state(/** @type {HistoryEvent[]} */ ([]))

/**
 * Append a timestamped event to the global history log.
 * Call from any page to record an action at the appropriate detail level.
 *
 * Levels:
 *   'info'    — major actions (file open, structure edit, run start/stop)
 *   'detail'  — secondary actions (add/remove view, clear measurements)
 *   'verbose' — micro changes (label added, gizmo drag)
 *
 * @param {'info'|'detail'|'verbose'} level
 * @param {string} page   — page type matching pageTag(): 'view'|'prep'|'build'|'eq'|'tools'|'analysis'
 * @param {string} label  — short title shown in the log
 * @param {string} [detail] — optional longer description
 */
export function logEvent(level, page, label, detail = '') {
  historyLog.push({ id: crypto.randomUUID(), level, page, label, detail, timestamp: new Date() })
}

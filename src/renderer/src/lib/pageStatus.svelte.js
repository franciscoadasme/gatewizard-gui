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
})

// ── 02 Preparation ───────────────────────────────────────────────────────────
export const preparationStatus = $state({
  /** Whether PropKa has been run in this session */
  propkaDone: false,
  /** pH that was used for the last PropKa run */
  propkaPh: /** @type {number|null} */ (null),
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
})

// ── 04 Equilibration ─────────────────────────────────────────────────────────
export const equilibrationPageStatus = $state({
  /** MD engine selected */
  engine: '',
  /** Output directory name */
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
})

// ── 05 Analysis ──────────────────────────────────────────────────────────────
export const analysisStatus = $state({
  /** Whether an analysis is currently running */
  running: false,
  /** 'structural' | 'energetic' */
  mode: '',
  /** Structural type (rmsd, rmsf, distance, radius_of_gyration) or '' */
  analysisType: '',
  /** Whether a result is available for the current type */
  resultAvailable: false,
})

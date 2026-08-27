<script>
  import { onDestroy } from 'svelte'
  import Beaker from '../components/icons/Beaker.svelte'
  import Protein from '../components/icons/Protein.svelte'
  import TopologyInfoModal from '../components/TopologyInfoModal.svelte'
  import OutputPathFields from '../components/OutputPathFields.svelte'
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import FollowLog from '../components/FollowLog.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import {
    analyzeTopology,
    cancelToolsJob,
    countAnalysisSelection,
    detectPbcEngine,
    getJobLog,
    getJobStatus,
    listGromacsGroups,
    runFixPbc,
    scanToolsJobs
  } from '../lib/backendApi'
  import {
    compactDirPath,
    defaultToolsFolderName,
    normalizeDirPath,
    parentDirPath,
    uniqueDirList
  } from '../lib/outputFolders.js'
  import { logEvent, toolsStatus } from '../lib/pageStatus.svelte.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  const paneBackgroundStyle = $derived(
    `background-color: ${themeBackgroundHex(themeState.current)}`
  )

  /** @typedef {{ path: string, stride: string }} TrajRow */

  /** @type {Array<{ id: string, label: string, Icon: typeof Protein }>} */
  const TOOL_CATEGORIES = [
    { id: 'structural', label: 'Structural', Icon: Protein },
    { id: 'methods', label: 'Methods', Icon: Beaker }
  ]

  /** @type {Array<{ value: string, label: string, enabled: boolean, category: string }>} */
  const TOOL_CATALOG = [
    { value: 'fix_pbc', label: 'Fix PBC', enabled: true, category: 'structural' },
    { value: 'concat_trim', label: 'Concatenate / trim', enabled: false, category: 'structural' },
    { value: 'extract_frames', label: 'Extract frames', enabled: false, category: 'structural' },
    { value: 'align_traj', label: 'Align trajectory', enabled: false, category: 'structural' },
    { value: 'convert_format', label: 'Convert format', enabled: false, category: 'structural' },
    { value: 'free_energy', label: 'Free energy', enabled: false, category: 'methods' },
    { value: 'compel', label: 'Computational electrophysiology', enabled: false, category: 'methods' },
    { value: 'enhanced_sampling', label: 'Enhanced sampling setup', enabled: false, category: 'methods' }
  ]

  /**
   * @typedef {{
   *   jobDir: string
   *   name: string
   *   type: string
   *   engine: string
   *   method: string
   *   status: string
   *   currentStep: number
   *   steps: string[]
   *   stepsCompleted: string[]
   *   error: string|null
   *   startTime: string
   *   endTime: string|null
   *   elapsed: string
   *   outputs: any[]
   *   logLines: string[]
   *   showLog: boolean
   *   stopping?: boolean
   *   centerLabel?: string|null
   *   outputLabel?: string|null
   *   skipCluster?: boolean
   * }} ToolsJob
   */

  const LIPID_PRESET_NAMES = [
    'PA',
    'PC',
    'OL',
    'PE',
    'PS',
    'PG',
    'PI',
    'SM',
    'CHL',
    'CHOL',
    'POPC',
    'POPE',
    'POPS',
    'POPG',
    'DOPC',
    'DOPE',
    'DPPC',
    'DPPE',
    'MEMB',
    'Membrane',
    'membrane',
    'Lipid',
    'lipid',
    'LIPID',
    'Lipids',
    'lipids'
  ]

  /** Amber/NAMD/OpenMM Fix PBC default: protein + bilayer (matches API fallback). */
  const DEFAULT_MEMBRANE_CENTER =
    'protein or resname PA PC OL PE PS PG PI POPC POPE POPS DPPC DMPC DOPC DSPC CHL CHOL CHL1 SM'

  let toolCategory = $state('structural')
  let tool = $state('fix_pbc')
  let launching = $state(false)
  let outputFolderName = $state('')
  /** Parent directory for tool jobs; defaults to the top-bar working directory. */
  let outputParentDir = $state('')
  /** Extra folders to scan (job parents outside the working directory). */
  let extraScanRoots = $state(/** @type {string[]} */ ([]))
  let formError = $state('')
  let showTopoInfo = $state(false)
  let topoLoading = $state(false)
  /** @type {any} */
  let topoInfo = $state(null)

  /** @type {ToolsJob[]} */
  let jobs = $state([])
  /** @type {any} */
  let pollIntervalId = $state(null)
  /** @type {any} */
  let pruneIntervalId = $state(null)

  // Drag-to-reorder
  let dragIdx = $state(-1)
  let dragOverIdx = $state(-1)

  /** @type {{
   *   engine: string
   *   topologyPath: string
   *   tprPath: string
   *   ndxPath: string
   *   centerSelection: string
   *   selectedCenterGroups: string[]
   *   selectedOutputGroups: string[]
   *   centerGroupText: string
   *   outputGroupText: string
   *   skipCluster: boolean
   *   outputFormat: string
   *   trajectoryFiles: TrajRow[]
   *   detectInfo: null | {
   *     engine: string
   *     method: string
   *     reason: string
   *     tpr: string|null
   *     ndx: string|null
   *     warnings: string[]
   *     center_groups?: Array<{ name: string, index: number, n_atoms: number, recommended?: boolean, lipid_like?: boolean }>
   *     recommended_center?: string|null
   *     recommended_center_groups?: string[]
   *     recommended_output?: string|null
   *     recommended_center_selection?: string
   *     lipid_resnames?: string[]
   *     supported_output_formats?: string[]
   *   }
   *   centerGroups: Array<{ name: string, index: number, n_atoms: number, recommended?: boolean, lipid_like?: boolean }>
   * }} */
  let fixPbc = $state({
    engine: 'auto',
    topologyPath: '',
    tprPath: '',
    ndxPath: '',
    centerSelection: DEFAULT_MEMBRANE_CENTER,
    selectedCenterGroups: /** @type {string[]} */ ([]),
    selectedOutputGroups: /** @type {string[]} */ ([]),
    centerGroupText: '',
    outputGroupText: '',
    skipCluster: false,
    outputFormat: 'same',
    trajectoryFiles: /** @type {TrajRow[]} */ ([]),
    detectInfo: null,
    centerGroups: /** @type {Array<{ name: string, index: number, n_atoms: number, recommended?: boolean, lipid_like?: boolean }>} */ ([])
  })
  /** @type {number | null} */
  let centerSelectionAtomCount = $state(null)
  let centerSelectionCountLoading = $state(false)
  let centerSelectionCountError = $state('')
  let showMembraneSelectHelp = $state(false)

  const catalogInCategory = $derived(
    TOOL_CATALOG.filter((t) => t.category === toolCategory)
  )
  const activeTool = $derived(TOOL_CATALOG.find((t) => t.value === tool) ?? TOOL_CATALOG[0])
  const toolEnabled = $derived(activeTool?.enabled ?? false)
  const trajectoryPaths = $derived(fixPbc.trajectoryFiles.map((f) => f.path))
  const resolvedEngine = $derived(
    fixPbc.engine === 'auto' ? fixPbc.detectInfo?.engine || 'auto' : fixPbc.engine
  )
  const isGromacs = $derived(resolvedEngine === 'gromacs')
  const centerSummary = $derived(
    fixPbc.centerGroups.length > 0
      ? formatGroupSummary(fixPbc.selectedCenterGroups)
      : fixPbc.centerGroupText.trim()
  )
  const outputSummary = $derived(
    fixPbc.centerGroups.length > 0
      ? formatGroupSummary(fixPbc.selectedOutputGroups)
      : fixPbc.outputGroupText.trim()
  )
  const lipidPresetNames = $derived(
    fixPbc.centerGroups
      .filter(
        (g) =>
          g.lipid_like ||
          LIPID_PRESET_NAMES.includes(g.name) ||
          /^[A-Z]{2,4}$/.test(g.name)
      )
      .map((g) => g.name)
      .filter((n) => !['SOL', 'WAT', 'HOH', 'ION', 'NA', 'CL'].includes(n))
  )

  /** @param {string[]} names */
  function formatGroupSummary(names) {
    if (!names?.length) return ''
    return names.join(' + ')
  }

  /** True when the field still has the auto default (protein, or protein + detected lipids). */
  function isAutoCenterSelection(sel) {
    const s = String(sel || '').trim()
    if (!s || s.toLowerCase() === 'protein') return true
    return /^protein or resname /i.test(s)
  }

  function applyDetectedProteinMembraneSelection() {
    const rec = fixPbc.detectInfo?.recommended_center_selection
    const lipids = fixPbc.detectInfo?.lipid_resnames
    if (rec && rec !== 'protein') {
      fixPbc.centerSelection = rec
      return
    }
    if (lipids?.length) {
      fixPbc.centerSelection = `protein or resname ${lipids.join(' ')}`
      return
    }
    fixPbc.centerSelection = DEFAULT_MEMBRANE_CENTER
  }

  /**
   * @param {'center'|'output'} which
   * @param {string} name
   * @param {boolean} on
   */
  function toggleIndexGroup(which, name, on) {
    const key = which === 'center' ? 'selectedCenterGroups' : 'selectedOutputGroups'
    const cur = fixPbc[key]
    if (on) {
      if (!cur.includes(name)) fixPbc[key] = [...cur, name]
    } else {
      fixPbc[key] = cur.filter((n) => n !== name)
    }
  }

  function applyLipidsCenterPreset() {
    const lipids = lipidPresetNames
    if (!lipids.length) return
    const protein = fixPbc.centerGroups.find((g) =>
      ['Protein', 'Protein-H', 'SOLU'].includes(g.name)
    )?.name
    // Prefer split lipid parts over a lone MEMB if both exist
    const split = lipids.filter(
      (n) => !['MEMB', 'Membrane', 'membrane', 'Lipid', 'lipid', 'LIPID', 'Lipids', 'lipids'].includes(n)
    )
    const pick = split.length >= 2 ? split : lipids
    fixPbc.selectedCenterGroups = protein ? [protein, ...pick] : [...pick]
  }

  /** @param {string[]} names */
  function applyCenterDefaults(names) {
    if (!names?.length) return
    if (fixPbc.selectedCenterGroups.length === 0) {
      fixPbc.selectedCenterGroups = [...names]
    }
  }

  /** @param {string} categoryId */
  function selectToolCategory(categoryId) {
    if (toolCategory === categoryId) return
    toolCategory = categoryId
    const list = TOOL_CATALOG.filter((t) => t.category === categoryId)
    const preferred = list.find((t) => t.enabled) ?? list[0]
    if (preferred) tool = preferred.value
  }

  // GROMACS cannot write DCD/NetCDF — keep the UI honest.
  $effect(() => {
    if (!isGromacs) return
    if (fixPbc.outputFormat === 'dcd' || fixPbc.outputFormat === 'nc') {
      fixPbc.outputFormat = 'xtc'
    }
  })

  function resolveOutputFolderName() {
    if (outputFolderName.trim()) return outputFolderName.trim()
    return defaultToolsFolderName()
  }

  const resolvedOutputParent = $derived((outputParentDir.trim() || workingDir).trim())
  const canLaunch = $derived(resolvedOutputParent !== '' && toolEnabled && !launching)

  // Seed default once when a working directory first appears — do not refill
  // while the user clears/edits the field.
  let seededOutputFolderForDir = $state('')
  $effect(() => {
    const dir = workingDir || ''
    if (!dir) {
      seededOutputFolderForDir = ''
      return
    }
    if (seededOutputFolderForDir === dir) return
    seededOutputFolderForDir = dir
    if (!outputFolderName.trim()) {
      outputFolderName = defaultToolsFolderName()
    }
  })

  // Keep tool in sync if category changes externally
  $effect(() => {
    if (activeTool?.category && activeTool.category !== toolCategory) {
      toolCategory = activeTool.category
    }
  })

  // Re-detect engine when inputs change (incl. explicit GROMACS TPR / NDX)
  $effect(() => {
    const _eng = fixPbc.engine
    const _top = fixPbc.topologyPath
    const _trajs = trajectoryPaths
    const _tpr = fixPbc.tprPath
    const _ndx = fixPbc.ndxPath
    if (_top) {
      void refreshDetect()
    }
  })

  $effect(() => {
    toolsStatus.jobCount = jobs.length
    toolsStatus.runningCount = jobs.filter((j) => j.status === 'running').length
    toolsStatus.completedCount = jobs.filter((j) => j.status === 'completed').length
    toolsStatus.errorCount = jobs.filter((j) => j.status === 'error').length
    toolsStatus.tool = tool
    toolsStatus.launching = launching
    const latest = jobs[0]
    toolsStatus.latestName = latest?.name ?? ''
    toolsStatus.latestStatus = latest?.status ?? ''
    toolsStatus.latestElapsed = latest?.elapsed ?? ''
    toolsStatus.error = latest?.status === 'error' ? latest.error || '' : formError
  })

  // Reload Tools jobs when the working directory or output path changes.
  // Merge into the live list — never replace it, or a job started outside the
  // working directory is wiped by an in-flight scan that started before launch.
  $effect(() => {
    const roots = jobScanRoots()
    if (roots.length === 0) return
    let cancelled = false
    scanMergedToolsJobs()
      .then((found) => {
        if (cancelled) return
        jobs = mergeJobsFromScan(found, { dropMissing: false })
        if (jobs.some((j) => jobNeedsPoll(j))) startPolling()
        else stopPollingIfDone()
        if (jobs.length > 0) startPrunePolling()
        else stopPrunePolling()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  })

  onDestroy(() => {
    if (pollIntervalId) clearInterval(pollIntervalId)
    if (pruneIntervalId) clearInterval(pruneIntervalId)
  })

  /** @param {any} j */
  function mapScannedJob(j) {
    return {
      jobDir: jobDirKey(j.job_dir),
      name: j.name,
      type: j.type || 'fix_pbc',
      engine: j.engine || '',
      method: j.method || '',
      status: j.status || 'unknown',
      currentStep: j.current_step || 0,
      steps: j.steps || [],
      stepsCompleted: j.steps_completed || [],
      error: j.error || null,
      startTime: j.start_time || '',
      endTime: j.end_time || null,
      elapsed: formatElapsed(j.start_time, j.end_time),
      outputs: j.outputs || [],
      logLines: [],
      showLog: false,
      centerLabel: j.center_label || null,
      outputLabel: j.output_label || null,
      skipCluster: Boolean(j.skip_cluster)
    }
  }

  /** @param {string|undefined} startIso @param {string|null|undefined} endIso */
  function formatElapsed(startIso, endIso) {
    if (!startIso) return ''
    const start = new Date(startIso).getTime()
    const end = endIso ? new Date(endIso).getTime() : Date.now()
    const s = Math.max(0, Math.round((end - start) / 1000))
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`
    if (m > 0) return `${m}m ${s % 60}s`
    return `${s}s`
  }

  /** @param {string} path */
  function basename(path) {
    return path.split(/[/\\]/).pop() ?? path
  }

  /** @param {TrajRow[]} rows */
  function sortTrajRows(rows) {
    return [...rows].sort((a, b) =>
      basename(a.path).localeCompare(basename(b.path), undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    )
  }

  function startPolling() {
    if (pollIntervalId) return
    pollIntervalId = setInterval(() => {
      void pollAllJobs()
    }, 2000)
  }

  function stopPollingIfDone() {
    if (!jobs.some((j) => jobNeedsPoll(j))) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = null
      }
    }
    // Keep a slow prune loop while any cards remain (catch deleted folders).
    if (jobs.length > 0) startPrunePolling()
    else stopPrunePolling()
  }

  function startPrunePolling() {
    if (pruneIntervalId) return
    pruneIntervalId = setInterval(() => {
      void pruneMissingJobCards()
    }, 5000)
  }

  function stopPrunePolling() {
    if (pruneIntervalId) {
      clearInterval(pruneIntervalId)
      pruneIntervalId = null
    }
  }

  function jobDirKey(dir) {
    return normalizeDirPath(dir)
  }

  function jobLooksInterrupted(job) {
    return (
      job?.status === 'error' &&
      /worker process exited unexpectedly/i.test(String(job.error || ''))
    )
  }

  function jobNeedsPoll(job) {
    return job?.status === 'running' || jobLooksInterrupted(job)
  }

  function jobScanRoots() {
    return uniqueDirList(workingDir, outputParentDir, ...extraScanRoots)
  }

  function jobPathLabel(job) {
    const full = jobDirKey(job.jobDir)
    if (!full) return ''
    const compact = compactDirPath(full, workingDir)
    return compact && compact !== '.' ? compact : full
  }

  /**
   * Merge a disk scan into the live card list. Running jobs that the scan has
   * not seen yet (typical for output outside the working directory) stay put.
   * @param {any[]} found
   * @param {{ dropMissing?: boolean }} [opts]
   */
  function mergeJobsFromScan(found, { dropMissing = false } = {}) {
    const scanned = found.map((j) => mapScannedJob(j))
    const liveByKey = new Map(jobs.map((j) => [jobDirKey(j.jobDir), j]))
    const seen = new Set()
    /** @type {ToolsJob[]} */
    const next = []
    for (const s of scanned) {
      const key = jobDirKey(s.jobDir)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const live = liveByKey.get(key)
      if (!live) {
        next.push({ ...s, jobDir: key })
        continue
      }
      const interruptScan =
        s.status === 'error' &&
        /worker process exited unexpectedly/i.test(String(s.error || ''))
      const scanAhead =
        (s.stepsCompleted?.length || 0) > (live.stepsCompleted?.length || 0) ||
        (s.status === 'running' && live.status !== 'running') ||
        s.status === 'completed' ||
        s.status === 'cancelled' ||
        (s.status === 'error' && !interruptScan)
      next.push({
        ...(scanAhead && !(interruptScan && live.status === 'running') ? { ...live, ...s } : live),
        jobDir: key,
        logLines: live.logLines,
        showLog: live.showLog,
        stopping: live.stopping
      })
    }
    for (const live of jobs) {
      const key = jobDirKey(live.jobDir)
      if (seen.has(key)) continue
      if (live.status === 'running' || !dropMissing) {
        seen.add(key)
        next.push(live)
      }
    }
    next.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
    return next
  }

  async function scanMergedToolsJobs() {
    const roots = jobScanRoots()
    const lists = await Promise.all(
      roots.map((dir) =>
        scanToolsJobs(dir)
          .then((r) => r.jobs || [])
          .catch(() => [])
      )
    )
    const byDir = new Map()
    for (const j of lists.flat()) {
      const key = jobDirKey(j?.job_dir)
      if (key && !byDir.has(key)) byDir.set(key, { ...j, job_dir: key })
    }
    return [...byDir.values()]
  }

  /**
   * Drop Tools cards whose job folder was deleted on disk, and revive cards when
   * the same path is reused for a new running job (stale completed overlay).
   * Never drop a still-running card just because a scan missed its parent folder.
   */
  async function pruneMissingJobCards() {
    if (jobScanRoots().length === 0 || jobs.length === 0) return
    try {
      const found = await scanMergedToolsJobs()
      const byDir = new Map(found.map((j) => [jobDirKey(j.job_dir), j]))
      const kept = []
      let changed = false
      for (const job of jobs) {
        const key = jobDirKey(job.jobDir)
        const disk = byDir.get(key)
        if (!disk) {
          if (job.status === 'running') {
            kept.push(job)
            continue
          }
          logEvent(
            'warn',
            'tools',
            `Removed "${job.name}" from Tools`,
            job.jobDir || 'Folder no longer exists on disk'
          )
          changed = true
          continue
        }
        // Same path restarted, or a false "Interrupted" while the worker is still going.
        const diskRunning = disk.status === 'running'
        const diskSteps = disk.steps_completed || []
        const liveSteps = job.stepsCompleted || []
        const diskAhead = diskSteps.length > liveSteps.length || diskRunning && job.status !== 'running'
        if (diskAhead) {
          kept.push({
            ...job,
            ...mapScannedJob(disk),
            showLog: job.showLog,
            logLines: job.logLines,
            stopping: job.stopping
          })
          changed = true
          if (diskRunning || jobNeedsPoll(job)) startPolling()
          continue
        }
        kept.push(job)
      }
      if (changed) {
        jobs = kept
        stopPollingIfDone()
      }
    } catch {
      /* ignore scan failures */
    }
  }

  /** @param {number} index */
  async function cancelJob(index) {
    const job = jobs[index]
    if (!job || job.stopping) return
    if (!jobNeedsPoll(job)) return
    if (!confirm(`Cancel Fix PBC job "${job.name}"? This cannot be undone.`)) return
    try {
      jobs[index] = { ...job, stopping: true }
      jobs = [...jobs]
      await cancelToolsJob(job.jobDir)
      logEvent('info', 'tools', `Cancelled job: ${job.name}`, job.jobDir)
      try {
        const st = await getJobStatus(job.jobDir)
        jobs[index] = {
          ...jobs[index],
          status: st.status || 'cancelled',
          error: st.error ?? 'Cancelled by user',
          endTime: st.end_time ?? new Date().toISOString(),
          elapsed: formatElapsed(st.start_time || job.startTime, st.end_time),
          outputs: st.outputs || job.outputs,
          stopping: false
        }
      } catch {
        jobs[index] = {
          ...jobs[index],
          status: 'cancelled',
          error: 'Cancelled by user',
          endTime: new Date().toISOString(),
          stopping: false
        }
      }
      jobs = [...jobs]
      stopPollingIfDone()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      jobs[index] = { ...jobs[index], stopping: false }
      jobs = [...jobs]
    }
  }

  async function pollAllJobs() {
    let changed = false
    const running = jobs.filter((j) => jobNeedsPoll(j))
    for (const job of running) {
      const key = jobDirKey(job.jobDir)
      try {
        const st = await getJobStatus(job.jobDir)
        const i = jobs.findIndex((j) => jobDirKey(j.jobDir) === key)
        if (i < 0) continue
        const current = jobs[i]
        const outs = st.outputs || current.outputs
        const firstOk = (outs || []).find((o) => o?.center_label || o?.output_label)
        jobs[i] = {
          ...current,
          status: st.status || current.status,
          currentStep: st.current_step ?? current.currentStep,
          steps: st.steps?.length ? st.steps : current.steps,
          stepsCompleted:
            (st.steps_completed || []).length >= (current.stepsCompleted || []).length
              ? st.steps_completed || current.stepsCompleted
              : current.stepsCompleted,
          error: st.error !== undefined ? st.error : current.error,
          startTime: st.start_time || current.startTime,
          endTime: st.end_time ?? current.endTime,
          elapsed: formatElapsed(st.start_time || current.startTime, st.end_time),
          outputs: outs,
          engine: st.engine || current.engine,
          method: st.method || current.method,
          centerLabel: firstOk?.center_label || current.centerLabel || null,
          outputLabel: firstOk?.output_label || current.outputLabel || null
        }
        changed = true
        if (jobs[i].showLog) {
          const log = await getJobLog(job.jobDir, 'fix_pbc.log', 300)
          jobs[i] = { ...jobs[i], logLines: log.lines || [] }
        }
      } catch {
        /* keep previous */
      }
    }
    if (changed) jobs = [...jobs]
    void pruneMissingJobCards()
    stopPollingIfDone()
  }

  async function refreshCenterGroups() {
    const ndx = fixPbc.ndxPath || fixPbc.detectInfo?.ndx || ''
    const tpr = fixPbc.tprPath || fixPbc.detectInfo?.tpr || ''
    if (!ndx && !tpr) {
      fixPbc.centerGroups = []
      return
    }
    try {
      const res = await listGromacsGroups({
        ndxPath: ndx || null,
        tprPath: tpr || null
      })
      fixPbc.centerGroups = res.groups || []
      const rec =
        res.recommended_groups?.length
          ? res.recommended_groups
          : res.recommended
            ? [res.recommended]
            : []
      applyCenterDefaults(rec)
      if (fixPbc.selectedOutputGroups.length === 0) {
        const hasSystem = fixPbc.centerGroups.some((g) => g.name === 'System')
        fixPbc.selectedOutputGroups = [
          hasSystem ? 'System' : fixPbc.centerGroups[0]?.name || 'System'
        ]
      }
    } catch {
      /* keep previous groups */
    }
  }

  async function countCenterSelectionAtoms() {
    centerSelectionCountError = ''
    centerSelectionAtomCount = null
    if (!fixPbc.topologyPath) {
      centerSelectionCountError = 'Select a topology file first.'
      return
    }
    const sel = fixPbc.centerSelection.trim()
    if (!sel) {
      centerSelectionCountError = 'Enter a center selection / mask first.'
      return
    }
    centerSelectionCountLoading = true
    try {
      const result = await countAnalysisSelection({
        topologyPath: fixPbc.topologyPath,
        trajectoryPaths: fixPbc.trajectoryFiles.map((f) => f.path),
        selection: sel
      })
      centerSelectionAtomCount = result.count
      logEvent(
        'info',
        'tools',
        'Center selection atom count',
        `${sel} → ${result.count} atom(s)`
      )
    } catch (error) {
      centerSelectionCountError = error instanceof Error ? error.message : String(error)
    } finally {
      centerSelectionCountLoading = false
    }
  }

  $effect(() => {
    fixPbc.centerSelection
    fixPbc.topologyPath
    centerSelectionAtomCount = null
    centerSelectionCountError = ''
  })

  /** @returns {Record<string, number>} */
  function makeFileStrides() {
    /** @type {Record<string, number>} */
    const out = {}
    for (const row of fixPbc.trajectoryFiles) {
      out[row.path] = Math.min(999, Math.max(1, Math.floor(Number(row.stride) || 1)))
    }
    return out
  }

  async function refreshDetect() {
    if (!fixPbc.topologyPath) {
      fixPbc.detectInfo = null
      return
    }
    try {
      const info = await detectPbcEngine({
        topologyPath: fixPbc.topologyPath,
        trajectoryPaths: trajectoryPaths,
        engine: fixPbc.engine,
        tprPath: fixPbc.tprPath || null,
        ndxPath: fixPbc.ndxPath || null
      })
      fixPbc.detectInfo = info
      if (!fixPbc.tprPath && info.tpr) fixPbc.tprPath = info.tpr
      if (!fixPbc.ndxPath && info.ndx) fixPbc.ndxPath = info.ndx
      if (info.engine !== 'gromacs' && isAutoCenterSelection(fixPbc.centerSelection)) {
        const rec = String(info.recommended_center_selection || '').trim()
        if (rec && rec.toLowerCase() !== 'protein') {
          fixPbc.centerSelection = rec
        } else if (info.lipid_resnames?.length) {
          fixPbc.centerSelection = `protein or resname ${info.lipid_resnames.join(' ')}`
        } else if (!/^protein or resname /i.test(fixPbc.centerSelection)) {
          fixPbc.centerSelection = DEFAULT_MEMBRANE_CENTER
        }
      }
      if (info.center_groups?.length) {
        fixPbc.centerGroups = info.center_groups
        const rec =
          info.recommended_center_groups?.length
            ? info.recommended_center_groups
            : info.recommended_center
              ? [info.recommended_center]
              : []
        applyCenterDefaults(rec)
        if (fixPbc.selectedOutputGroups.length === 0) {
          if (info.recommended_output) {
            fixPbc.selectedOutputGroups = [info.recommended_output]
          } else {
            const hasSystem = fixPbc.centerGroups.some((g) => g.name === 'System')
            fixPbc.selectedOutputGroups = [
              hasSystem ? 'System' : fixPbc.centerGroups[0]?.name || 'System'
            ]
          }
        }
      } else if (info.engine === 'gromacs') {
        await refreshCenterGroups()
      }
      if (info.engine === 'gromacs' && (fixPbc.outputFormat === 'dcd' || fixPbc.outputFormat === 'nc')) {
        fixPbc.outputFormat = 'xtc'
      }
    } catch {
      fixPbc.detectInfo = null
    }
  }

  async function doAnalyzeTopology() {
    const path = fixPbc.topologyPath
    if (!path) {
      formError = 'Select a topology file first.'
      return
    }
    formError = ''
    topoLoading = true
    try {
      topoInfo = await analyzeTopology({ topologyPath: path })
      showTopoInfo = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      formError = msg
      logEvent('error', 'tools', 'Topology info failed', msg)
    } finally {
      topoLoading = false
    }
  }

  async function pickTopologyFile() {
    const pick = await window.api.openFileDialog(
      isGromacs ? 'Select Topology / TPR' : 'Select Topology File',
      [
        {
          name: 'Topology',
          extensions: ['pdb', 'psf', 'prmtop', 'parm7', 'gro', 'tpr', 'top']
        }
      ],
      workingDir || undefined
    )
    if (pick.canceled) return
    fixPbc.topologyPath = pick.filePath
    if (pick.filePath.toLowerCase().endsWith('.tpr')) {
      fixPbc.tprPath = pick.filePath
    }
    await refreshDetect()
  }

  async function pickTprFile() {
    const pick = await window.api.openFileDialog(
      'Select GROMACS TPR',
      [{ name: 'TPR', extensions: ['tpr'] }],
      workingDir || undefined
    )
    if (pick.canceled) return
    fixPbc.tprPath = pick.filePath
    if (!fixPbc.topologyPath) fixPbc.topologyPath = pick.filePath
    await refreshDetect()
    await refreshCenterGroups()
  }

  async function pickNdxFile() {
    const pick = await window.api.openFileDialog(
      'Select GROMACS Index',
      [{ name: 'Index', extensions: ['ndx'] }],
      workingDir || undefined
    )
    if (pick.canceled) return
    fixPbc.ndxPath = pick.filePath
    await refreshCenterGroups()
  }

  async function addTrajectoryFile() {
    const pick = await window.api.openFilesDialog(
      'Add Trajectory Files',
      [{ name: 'Trajectory', extensions: ['dcd', 'xtc', 'trr', 'nc', 'mdcrd'] }],
      workingDir || undefined
    )
    if (pick.canceled) return
    const existing = new Set(fixPbc.trajectoryFiles.map((f) => f.path))
    const added = pick.filePaths
      .filter((p) => !existing.has(p))
      .map((path) => ({ path, stride: '1' }))
    fixPbc.trajectoryFiles = sortTrajRows([...fixPbc.trajectoryFiles, ...added])
    await refreshDetect()
  }

  /** @param {number} index */
  function removeTrajectory(index) {
    fixPbc.trajectoryFiles = fixPbc.trajectoryFiles.filter((_, i) => i !== index)
    refreshDetect()
  }

  /** @param {number} index */
  function onDragStart(index) {
    dragIdx = index
  }

  /** @param {DragEvent} e @param {number} index */
  function onDragOver(e, index) {
    e.preventDefault()
    dragOverIdx = index
  }

  function onDragEnd() {
    dragIdx = -1
    dragOverIdx = -1
  }

  /** @param {DragEvent} e @param {number} index */
  function onDropTrajectory(e, index) {
    e.preventDefault()
    if (dragIdx === -1 || dragIdx === index) {
      onDragEnd()
      return
    }
    const arr = [...fixPbc.trajectoryFiles]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(index, 0, moved)
    fixPbc.trajectoryFiles = arr
    onDragEnd()
  }

  function onClearForm() {
    formError = ''
    fixPbc = {
      engine: 'auto',
      topologyPath: '',
      tprPath: '',
      ndxPath: '',
      centerSelection: DEFAULT_MEMBRANE_CENTER,
      selectedCenterGroups: [],
      selectedOutputGroups: [],
      centerGroupText: '',
      outputGroupText: '',
      skipCluster: false,
      outputFormat: 'same',
      trajectoryFiles: [],
      detectInfo: null,
      centerGroups: []
    }
    logEvent('detail', 'tools', 'Cleared Tools form')
  }

  /** @param {number} index */
  function removeJob(index) {
    const job = jobs[index]
    if (job?.status === 'running') return
    jobs = jobs.filter((_, i) => i !== index)
    stopPollingIfDone()
    // Also drop any other cards whose folders vanished while we were idle.
    void pruneMissingJobCards()
  }

  /** @param {number} index */
  async function refreshJobLog(index) {
    try {
      const { lines } = await getJobLog(jobs[index].jobDir, 'fix_pbc.log', 300)
      jobs[index] = { ...jobs[index], logLines: lines }
      jobs = [...jobs]
    } catch {
      /* ignore */
    }
  }

  /** @param {number} index */
  async function toggleJobLog(index) {
    const show = !jobs[index].showLog
    jobs[index] = { ...jobs[index], showLog: show }
    jobs = [...jobs]
    if (show) await refreshJobLog(index)
  }

  async function onLaunch() {
    if (!canLaunch || tool !== 'fix_pbc') return
    formError = ''
    try {
      launching = true
      if (!fixPbc.topologyPath) throw new Error('Select a topology or TPR file.')
      if (fixPbc.trajectoryFiles.length === 0) {
        throw new Error('Add at least one trajectory file.')
      }
      if (!resolvedOutputParent) throw new Error('Set a working directory or choose an output path.')

      await refreshDetect()
      const eng =
        fixPbc.engine === 'auto' ? fixPbc.detectInfo?.engine || 'auto' : fixPbc.engine
      if (eng === 'gromacs' && !fixPbc.tprPath && !fixPbc.topologyPath.endsWith('.tpr')) {
        throw new Error(
          'GROMACS Fix PBC requires a .tpr. Browse for the matching step*.tpr.'
        )
      }

      const folderName = resolveOutputFolderName()
      outputFolderName = folderName
      // Job folder is created directly under the working directory (Builder-style).
      // Concurrent runs with the same name get a numeric suffix (_2, _3, …).
      const paths = trajectoryPaths
      const fileStrides = makeFileStrides()

      const centerGroups =
        eng === 'gromacs'
          ? fixPbc.centerGroups.length > 0
            ? [...fixPbc.selectedCenterGroups]
            : fixPbc.centerGroupText.trim()
              ? [fixPbc.centerGroupText.trim()]
              : []
          : []
      const outputGroups =
        eng === 'gromacs'
          ? fixPbc.centerGroups.length > 0
            ? [...fixPbc.selectedOutputGroups]
            : fixPbc.outputGroupText.trim()
              ? [fixPbc.outputGroupText.trim()]
              : []
          : []
      const centerLabel =
        centerGroups.length > 1
          ? `GW_CENTER = ${centerGroups.join('+')}`
          : centerGroups[0] || null
      const outputLabel =
        outputGroups.length > 1
          ? `GW_OUTPUT = ${outputGroups.join('+')}`
          : outputGroups[0] || null

      const result = await runFixPbc({
        topologyPath: fixPbc.topologyPath,
        trajectoryPaths: paths,
        outputDir: resolvedOutputParent,
        jobName: folderName,
        engine: fixPbc.engine,
        centerSelection: fixPbc.centerSelection.trim() || DEFAULT_MEMBRANE_CENTER,
        centerGroup: centerGroups.length === 1 ? centerGroups[0] : null,
        outputGroup: outputGroups.length === 1 ? outputGroups[0] : null,
        centerGroups: centerGroups.length ? centerGroups : null,
        outputGroups: outputGroups.length ? outputGroups : null,
        skipCluster: eng === 'gromacs' ? fixPbc.skipCluster : false,
        tprPath: fixPbc.tprPath || null,
        ndxPath: fixPbc.ndxPath || null,
        stride: 1,
        fileStrides,
        outputFormat: /** @type {'dcd'|'xtc'|'nc'|'trr'|'same'} */ (
          isGromacs && (fixPbc.outputFormat === 'dcd' || fixPbc.outputFormat === 'nc')
            ? 'xtc'
            : fixPbc.outputFormat
        )
      })

      const jobDir = jobDirKey(result.job_dir)
      const parent = parentDirPath(jobDir) || jobDirKey(resolvedOutputParent)
      if (parent) extraScanRoots = uniqueDirList(...extraScanRoots, parent)
      /** @type {ToolsJob} */
      const newJob = {
        jobDir,
        name: basename(jobDir),
        type: 'fix_pbc',
        engine: result.engine || eng,
        method: result.method || '',
        status: 'running',
        currentStep: 0,
        steps: ['Detect engine', ...paths.map((p) => `Fix ${basename(p)}`), 'Finalize'],
        stepsCompleted: [],
        error: null,
        startTime: new Date().toISOString(),
        endTime: null,
        elapsed: '0s',
        outputs: [],
        logLines: [],
        showLog: false,
        centerLabel,
        outputLabel,
        skipCluster: eng === 'gromacs' ? fixPbc.skipCluster : false
      }
      // Replace any stale card for the same path (folder deleted + recreated).
      // Duplicate jobDir keys break Svelte keyed {#each} and freeze progress UI.
      jobs = [newJob, ...jobs.filter((j) => jobDirKey(j.jobDir) !== jobDir)]
      startPolling()
      startPrunePolling()
      logEvent(
        'info',
        'tools',
        `Started Fix PBC: ${newJob.name}`,
        `${newJob.engine} · ${newJob.method} · ${paths.length} traj`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      formError = msg
      logEvent('error', 'tools', 'Fix PBC launch failed', msg)
    } finally {
      launching = false
    }
  }
</script>

{#if showTopoInfo && topoInfo}
  <TopologyInfoModal topoInfo={topoInfo} onClose={() => (showTopoInfo = false)} />
{/if}

<div class="flex min-w-0 flex-1 divide-x divide-neutral-200 overflow-hidden select-none dark:divide-neutral-800">
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <h2 class="sidebar-heading">Tools</h2>
      <div class="flex items-center gap-1" role="tablist" aria-label="Tool categories">
        {#each TOOL_CATEGORIES as cat (cat.id)}
          {@const Icon = cat.Icon}
          {@const active = toolCategory === cat.id}
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={cat.label}
            title={cat.label}
            onclick={() => selectToolCategory(cat.id)}
            class="group relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border transition-colors
              {active
              ? 'border-neutral-400 bg-neutral-200 text-black dark:border-neutral-600 dark:bg-neutral-800 dark:text-white'
              : 'border-neutral-200 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200'}"
          >
            <Icon className="size-4 shrink-0" />
            <span class="truncate text-[11px] font-medium">{cat.label}</span>
          </button>
        {/each}
      </div>
      <Select size="sm" className="w-full" bind:value={tool}>
        {#each catalogInCategory as item (item.value)}
          <option value={item.value} disabled={!item.enabled}>
            {item.label}{item.enabled ? '' : ' (coming soon)'}
          </option>
        {/each}
      </Select>
      {#if !toolEnabled}
        <p class="sidebar-hint">Coming soon.</p>
      {/if}
    </div>

    <Divider />

    {#if tool === 'fix_pbc'}
      <div class="space-y-2">
        <h2 class="sidebar-heading">Engine</h2>
        <Select size="sm" className="w-full" bind:value={fixPbc.engine}>
          <option value="auto">Auto-detect</option>
          <option value="gromacs">GROMACS (gmx trjconv)</option>
          <option value="amber">Amber (cpptraj)</option>
          <option value="namd">NAMD (cpptraj)</option>
          <option value="openmm">OpenMM (cpptraj)</option>
          <option value="mdanalysis">MDAnalysis fallback</option>
        </Select>
        {#if fixPbc.detectInfo}
          <p class="sidebar-hint">
            {fixPbc.detectInfo.method} — {fixPbc.detectInfo.reason}
          </p>
          {#each fixPbc.detectInfo.warnings || [] as w (w)}
            <p class="gw-notice gw-notice-warning">{w}</p>
          {/each}
        {:else}
          <p class="sidebar-hint">
            GROMACS uses gmx trjconv; Amber/NAMD/OpenMM use cpptraj autoimage.
          </p>
        {/if}
      </div>

      <Divider />

      <div class="space-y-2">
        <h2 class="sidebar-heading">Input</h2>
        <div class="space-y-1">
          <p class="sidebar-label">{isGromacs ? 'Topology / TPR' : 'Topology file'}</p>
          <div class="flex gap-1">
            <Input
              size="sm"
              value={basename(fixPbc.topologyPath) || '—'}
              disabled
              className="min-w-0 flex-1"
            />
            <Button size="sm" variant="outline" onclick={pickTopologyFile}>Browse</Button>
            <Button
              size="sm"
              variant="outline"
              onclick={doAnalyzeTopology}
              disabled={!fixPbc.topologyPath || topoLoading}
              title="Topology info"
              className="px-2"
            >
              {#if topoLoading}
                <Spinner className="h-3.5 w-3.5" />
              {:else}
                <Protein className="size-3.5" title="Topology info" />
              {/if}
            </Button>
          </div>
        </div>

        {#if isGromacs || fixPbc.engine === 'gromacs' || fixPbc.engine === 'auto'}
          <div class="space-y-1">
            <p class="sidebar-label">GROMACS TPR</p>
            <div class="flex gap-1">
              <Input
                size="sm"
                value={basename(fixPbc.tprPath) || '—'}
                disabled
                className="min-w-0 flex-1"
              />
              <Button size="sm" variant="outline" onclick={pickTprFile}>Browse</Button>
            </div>
            <p class="sidebar-hint">Required for gmx trjconv (molecule definitions).</p>
          </div>
          <div class="space-y-1">
            <p class="sidebar-label">Index (optional)</p>
            <div class="flex gap-1">
              <Input
                size="sm"
                value={basename(fixPbc.ndxPath) || '—'}
                disabled
                className="min-w-0 flex-1"
              />
              <Button size="sm" variant="outline" onclick={pickNdxFile}>Browse</Button>
            </div>
            <p class="sidebar-hint">Uses SOLU_MEMB when present (GateWizard index).</p>
          </div>
        {/if}

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <p class="sidebar-label">Trajectory files</p>
            <Button size="sm" variant="outline" onclick={addTrajectoryFile}>+ Add</Button>
          </div>
          {#if fixPbc.trajectoryFiles.length === 0}
            <p class="sidebar-hint">No trajectory files selected.</p>
          {:else}
            <div class="space-y-0.5">
              <div class="flex items-center gap-1 px-1.5 text-[10px] text-neutral-500">
                <span class="min-w-0 flex-1">File</span>
                <span class="w-12 shrink-0 text-center" title="Use every Nth frame">Stride</span>
                <span class="w-4 shrink-0"></span>
              </div>
              {#each fixPbc.trajectoryFiles as file, i (file.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  ondragover={(e) => onDragOver(e, i)}
                  ondrop={(e) => onDropTrajectory(e, i)}
                  class="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-1 transition-opacity dark:border-neutral-800
                    {dragIdx === i ? 'opacity-40' : ''}
                    {dragOverIdx === i && dragIdx !== i ? 'border-amber-500 bg-amber-500/10' : ''}"
                >
                  <span
                    draggable="true"
                    ondragstart={() => onDragStart(i)}
                    ondragend={onDragEnd}
                    class="shrink-0 cursor-grab text-neutral-600 select-none active:cursor-grabbing"
                    title="Drag to reorder"
                    >⠿</span
                  >
                  <span
                    class="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300"
                    title={file.path}>{basename(file.path)}</span
                  >
                  <Input
                    size="sm"
                    blurOnEnter
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    placeholder="1"
                    bind:value={fixPbc.trajectoryFiles[i].stride}
                    className="w-12 shrink-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    title="Use every Nth frame (1–999)"
                  />
                  <button
                    class="shrink-0 px-1 text-red-500 hover:text-red-400"
                    onclick={() => removeTrajectory(i)}
                    title="Remove">✕</button
                  >
                </div>
              {/each}
            </div>
            <p class="sidebar-hint">Stride 1–999 (1 = all frames; 2, 5, 10… writes a smaller file).</p>
          {/if}
        </div>
      </div>

      <Divider />

      <div class="space-y-2">
        <h2 class="sidebar-heading">Options</h2>
        {#if isGromacs}
          <div class="space-y-2">
            <div class="space-y-1">
              <div class="flex items-center justify-between gap-1">
                <p class="sidebar-label">Center group(s)</p>
                <Button size="sm" variant="ghost" onclick={refreshCenterGroups}>Refresh</Button>
              </div>
              {#if fixPbc.centerGroups.length > 0}
                {#if centerSummary}
                  <p
                    class="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
                    title={centerSummary}
                  >
                    {centerSummary}
                    {#if fixPbc.selectedCenterGroups.length > 1}
                      <span class="text-neutral-500"> → GW_CENTER</span>
                    {/if}
                  </p>
                {/if}
                <div
                  class="max-h-40 space-y-1 overflow-y-auto rounded border p-2 dark:border-neutral-800"
                >
                  {#each fixPbc.centerGroups as g (g.name + String(g.index))}
                    {@const checked = fixPbc.selectedCenterGroups.includes(g.name)}
                    <label class="flex items-center gap-2 text-[11px]">
                      <Checkbox
                        size="sm"
                        name={`center-${g.name}`}
                        {checked}
                        onchange={(e) =>
                          toggleIndexGroup('center', g.name, e.currentTarget.checked)}
                      />
                      <span class="min-w-0 flex-1 truncate font-mono text-neutral-800 dark:text-neutral-300">
                        {g.index}: {g.name}
                      </span>
                      {#if g.n_atoms}
                        <span class="shrink-0 text-neutral-500">{g.n_atoms.toLocaleString()}</span>
                      {/if}
                      {#if g.recommended || g.name === 'SOLU_MEMB'}
                        <span class="shrink-0 text-amber-600 dark:text-amber-400">★</span>
                      {/if}
                    </label>
                  {/each}
                </div>
                <div class="flex flex-wrap gap-1">
                  {#if lipidPresetNames.length >= 2}
                    <Button size="sm" variant="outline" onclick={applyLipidsCenterPreset}>
                      Lipids ({lipidPresetNames.slice(0, 4).join('+')}{lipidPresetNames.length > 4
                        ? '…'
                        : ''})
                    </Button>
                  {/if}
                  {#if fixPbc.detectInfo?.recommended_center_groups?.length}
                    <Button
                      size="sm"
                      variant="outline"
                      onclick={() =>
                        (fixPbc.selectedCenterGroups = [
                          ...(fixPbc.detectInfo?.recommended_center_groups || [])
                        ])}
                    >
                      Recommended
                    </Button>
                  {/if}
                </div>
                <p class="sidebar-hint">
                  Prefer SOLU_MEMB when present. Otherwise check all lipid groups (+ Protein) for
                  thickness / APL. Multi-select merges into a temporary GW_CENTER index group.
                </p>
              {:else}
                <Input
                  size="sm"
                  bind:value={fixPbc.centerGroupText}
                  className="w-full"
                  placeholder="SOLU_MEMB or Protein"
                />
                <p class="sidebar-hint">
                  Select a TPR / index.ndx to multi-select groups, or type a group name.
                </p>
              {/if}
            </div>

            <div class="space-y-1">
              <p class="sidebar-label">Output group(s)</p>
              {#if fixPbc.centerGroups.length > 0}
                {#if outputSummary}
                  <p
                    class="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
                    title={outputSummary}
                  >
                    {outputSummary}
                    {#if fixPbc.selectedOutputGroups.length > 1}
                      <span class="text-neutral-500"> → GW_OUTPUT</span>
                    {/if}
                  </p>
                {/if}
                <div
                  class="max-h-32 space-y-1 overflow-y-auto rounded border p-2 dark:border-neutral-800"
                >
                  {#each fixPbc.centerGroups as g (g.name + String(g.index) + '-out')}
                    {@const checked = fixPbc.selectedOutputGroups.includes(g.name)}
                    <label class="flex items-center gap-2 text-[11px]">
                      <Checkbox
                        size="sm"
                        name={`output-${g.name}`}
                        {checked}
                        onchange={(e) =>
                          toggleIndexGroup('output', g.name, e.currentTarget.checked)}
                      />
                      <span class="min-w-0 flex-1 truncate font-mono text-neutral-800 dark:text-neutral-300">
                        {g.index}: {g.name}
                      </span>
                      {#if g.name === 'System'}
                        <span class="shrink-0 text-amber-600 dark:text-amber-400">★</span>
                      {/if}
                    </label>
                  {/each}
                </div>
                <p class="sidebar-hint">
                  Atoms written to the fixed trajectory. ★ System keeps the full system.
                </p>
              {:else}
                <Input
                  size="sm"
                  bind:value={fixPbc.outputGroupText}
                  className="w-full"
                  placeholder="System"
                />
                <p class="sidebar-hint">
                  Usually System. Select a TPR / index.ndx to pick from the list.
                </p>
              {/if}
            </div>

            <label class="flex items-center gap-2 text-[11px] text-neutral-700 dark:text-neutral-300">
              <Checkbox size="sm" name="skip-cluster" bind:checked={fixPbc.skipCluster} />
              Skip cluster step
            </label>
            <p class="sidebar-hint">
              Pipeline: whole → nojump
              {fixPbc.skipCluster ? '' : ' → cluster'}
              → mol -center -ur compact. Cluster helps many membranes but can amplify jumps when the
              center group is incomplete.
            </p>
          </div>
        {:else}
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-1">
              <p class="sidebar-label">Center selection / mask</p>
              <Button
                size="sm"
                variant="ghost"
                onclick={() => (showMembraneSelectHelp = !showMembraneSelectHelp)}
              >
                {showMembraneSelectHelp ? 'Hide tips' : 'Membrane tips'}
              </Button>
            </div>
            <div class="flex gap-1">
              <Input
                size="sm"
                bind:value={fixPbc.centerSelection}
                className="min-w-0 flex-1"
                placeholder={fixPbc.detectInfo?.recommended_center_selection ||
                  DEFAULT_MEMBRANE_CENTER}
              />
              <button
                type="button"
                class="shrink-0 rounded border border-neutral-700 px-2 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
                onclick={countCenterSelectionAtoms}
                disabled={centerSelectionCountLoading || !fixPbc.centerSelection.trim()}
                title="Count atoms in center selection"
              >
                {#if centerSelectionCountLoading}
                  <Spinner className="h-3.5 w-3.5" />
                {:else}
                  #
                {/if}
              </button>
            </div>
            {#if centerSelectionAtomCount != null}
              <p class="sidebar-hint">
                {centerSelectionAtomCount.toLocaleString()} atom{centerSelectionAtomCount === 1
                  ? ''
                  : 's'} selected
              </p>
            {/if}
            {#if centerSelectionCountError}
              <p class="sidebar-hint text-amber-600 dark:text-amber-400">
                {centerSelectionCountError}
              </p>
            {/if}
            {#if showMembraneSelectHelp}
              <div class="space-y-1 rounded border border-neutral-800 p-2 text-[11px] leading-snug text-neutral-400">
                <p class="font-medium text-neutral-300">How to center on the membrane</p>
                <p>
                  Type selections in <span class="text-neutral-300">MDAnalysis style</span> (the
                  <span class="text-neutral-300">#</span> counter uses MDA). For OpenMM/Amber, GateWizard
                  converts them to cpptraj masks automatically, e.g.
                  <code class="text-neutral-300">resname PA PC OL</code> →
                  <code class="text-neutral-300">:PA,PC,OL</code>.
                </p>
                <ul class="list-disc space-y-0.5 pl-4">
                  <li>
                    <code class="text-neutral-300">resname PA PC OL</code> — Amber POPC split residues
                    (PA/PC/OL); check your topology
                  </li>
                  <li>
                    <code class="text-neutral-300">resname POPC POPE</code> — CHARMM-style lipid names
                  </li>
                  <li>
                    <code class="text-neutral-300">name P31</code> — phosphate atoms (good bilayer
                    anchor)
                  </li>
                  <li>
                    <code class="text-neutral-300">protein or resname PA PC OL</code> — protein +
                    membrane (like GROMACS SOLU_MEMB)
                  </li>
                  <li>
                    Or paste Amber directly:
                    <code class="text-neutral-300">:PA,PC,OL</code> /
                    <code class="text-neutral-300">@P31</code>
                  </li>
                </ul>
                <p>
                  GateWizard converts MDA selections to cpptraj masks and uses membrane-safe
                  <code class="text-neutral-300">autoimage mode byvec moveanchor</code> (no
                  <code class="text-neutral-300">origin</code> — that parks the system on the box
                  corner). For protein + membrane, the protein half is the autoimage anchor; lipids
                  are kept whole with byvec/moveanchor, then
                  <code class="text-neutral-300">center</code>/<code class="text-neutral-300"
                    >image</code
                  >.
                </p>
                <p>
                  If the log shows
                  <code class="text-neutral-300">Not all arguments handled: [ PA PC OL ]</code>, the
                  mask was not converted — use <code class="text-neutral-300">:PA,PC,OL</code> or
                  update GateWizard and re-run.
                </p>
                <div class="flex flex-wrap gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() =>
                      (fixPbc.centerSelection = fixPbc.detectInfo?.lipid_resnames?.length
                        ? `resname ${fixPbc.detectInfo.lipid_resnames.join(' ')}`
                        : 'resname PA PC OL')}
                  >
                    Amber POPC parts
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() =>
                      (fixPbc.centerSelection = fixPbc.detectInfo?.lipid_resnames?.length
                        ? `:${fixPbc.detectInfo.lipid_resnames.join(',')}`
                        : ':PA,PC,OL')}
                  >
                    :PA,PC,OL
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() => (fixPbc.centerSelection = 'name P31')}
                  >
                    P31 only
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={applyDetectedProteinMembraneSelection}
                  >
                    Protein + membrane
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() => (fixPbc.centerSelection = 'protein')}
                  >
                    Protein
                  </Button>
                </div>
              </div>
            {:else}
              <p class="sidebar-hint">
                {#if fixPbc.detectInfo?.lipid_resnames?.length}
                  Default for Amber/NAMD/OpenMM: protein + detected bilayer
                  (<code>resname {fixPbc.detectInfo.lipid_resnames.join(' ')}</code>). Open
                  <span class="text-neutral-300">Membrane tips</span> for other masks.
                {:else}
                  Default for Amber/NAMD/OpenMM: protein + bilayer residue names. Open
                  <span class="text-neutral-300">Membrane tips</span> for other masks.
                {/if}
              </p>
            {/if}
          </div>
        {/if}
        <div class="space-y-1">
          <p class="sidebar-label">Output format</p>
          {#if isGromacs}
            <Select size="sm" className="w-full" bind:value={fixPbc.outputFormat}>
              <option value="xtc">XTC (recommended)</option>
              <option value="trr">TRR</option>
              <option value="same">Same as input (xtc/trr)</option>
            </Select>
            <p class="gw-notice gw-notice-warning">
              GROMACS <code>trjconv</code> cannot write DCD or NetCDF. Use XTC or TRR.
            </p>
          {:else}
            <Select size="sm" className="w-full" bind:value={fixPbc.outputFormat}>
              <option value="same">Engine default / same</option>
              <option value="dcd">DCD</option>
              <option value="xtc">XTC</option>
              <option value="nc">NetCDF (.nc)</option>
            </Select>
          {/if}
        </div>
      </div>

      <Divider />

      <OutputPathFields
        bind:parentDir={outputParentDir}
        bind:folderName={outputFolderName}
        workingDir={workingDir}
        folderPlaceholder="05_tools"
        folderLabel="Job folder name"
        extraHint=" (uses _2, _3… if the name already exists)"
        resolvedFolderName={resolveOutputFolderName()}
      />
    {:else}
      <p class="sidebar-hint">
        This utility is reserved for a future release. Choose Fix PBC to rewrite
        trajectories with engine-native PBC correction.
      </p>
    {/if}

    {#if resolvedOutputParent === ''}
      <p class="gw-notice gw-notice-warning">
        Set a <strong>Working Directory</strong> in the top bar, or browse an output path, to write tool output.
      </p>
    {/if}

    {#if formError}
      <p class="gw-notice gw-notice-error">{formError}</p>
    {/if}

    <Button className="w-full" onclick={onLaunch} disabled={!canLaunch}>
      {#if launching}
        <Spinner className="mr-1" />Launching...
      {:else}
        Start Fix PBC
      {/if}
    </Button>
    <Button className="w-full" variant="ghost" onclick={onClearForm}>Clear form</Button>
  </aside>

  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <h1 class="m-4 mb-2 text-xl font-semibold">Tools Jobs</h1>
    {#if jobs.length === 0}
      <p
        class="mx-4 mb-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
      >
        No tools jobs yet. Configure Fix PBC and click Start — you can launch more while others run.
      </p>
    {:else}
      <div class="mx-4 mb-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {#each jobs as job, ji (job.jobDir)}
          <div
            class="gw-notice rounded-lg p-3 {job.status === 'completed'
              ? 'gw-notice-success'
              : job.status === 'error' || job.status === 'cancelled'
                ? 'gw-notice-error'
                : job.status === 'running'
                  ? 'gw-notice-warning'
                  : 'gw-notice-info'}"
          >
            <!-- Header -->
            <div class="mb-2 flex items-center justify-between">
              <div class="flex min-w-0 items-center gap-2">
                {#if job.status === 'running'}
                  <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500"></span>
                {:else if job.status === 'completed'}
                  <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
                {:else if job.status === 'error' || job.status === 'cancelled'}
                  <span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
                {:else}
                  <span class="inline-block h-2 w-2 rounded-full bg-neutral-500"></span>
                {/if}
                <div class="min-w-0">
                  <span
                    class="block truncate font-semibold text-neutral-900 dark:text-neutral-200"
                    title={job.jobDir}>{job.name}</span
                  >
                  {#if job.jobDir}
                    <p
                      class="wrap-break-word sidebar-hint leading-snug"
                      title={job.jobDir}
                    >
                      {jobPathLabel(job)}
                    </p>
                  {/if}
                </div>
                {#if job.engine}
                  <span class="shrink-0 text-[10px] uppercase dark:text-neutral-500"
                    >{job.engine}</span
                  >
                {/if}
              </div>
              <div class="flex items-center gap-2">
                <span class="tabular-nums dark:text-neutral-500">{job.elapsed}</span>
                {#if jobNeedsPoll(job)}
                  <button
                    class="dark:text-neutral-500 dark:hover:text-red-400"
                    disabled={job.stopping}
                    onclick={() => cancelJob(ji)}
                    title="Cancel job"
                  >
                    {job.stopping ? 'Stopping…' : 'Cancel'}
                  </button>
                {:else}
                  <button
                    class="dark:text-neutral-600 dark:hover:text-neutral-300"
                    onclick={() => removeJob(ji)}
                    title="Remove">&times;</button
                  >
                {/if}
              </div>
            </div>

            <!-- Step progress bar (Builder-style) -->
            {#if job.steps.length > 0}
              <div class="mb-2">
                <div class="flex gap-1">
                  {#each job.steps as step, si (step + String(si))}
                    {@const done =
                      job.stepsCompleted.includes(step) ||
                      (job.status === 'completed' && si < job.steps.length)}
                    {@const active =
                      jobNeedsPoll(job) &&
                      !done &&
                      (si === 0 || job.stepsCompleted.includes(job.steps[si - 1]))}
                    <div class="min-w-0 flex-1">
                      <div
                        class="h-1.5 rounded-full transition-colors"
                        class:bg-green-600={done}
                        class:bg-yellow-500={active}
                        class:animate-pulse={active}
                        class:bg-neutral-700={!done && !active}
                      ></div>
                      <span
                        class="mt-0.5 block truncate text-center"
                        class:dark:text-green-400={done}
                        class:dark:text-yellow-400={active}
                        class:dark:text-neutral-600={!done && !active}
                        style="font-size: 0.6rem;"
                        title={step}
                      >
                        {step}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if job.method}
              <p class="mb-2 text-[11px] dark:text-neutral-500">{job.method}</p>
            {/if}
            {#if job.centerLabel || job.outputLabel}
              <p class="mb-2 text-[11px] dark:text-neutral-500">
                {#if job.centerLabel}
                  Center: {job.centerLabel}
                {/if}
                {#if job.centerLabel && job.outputLabel}
                  <span class="dark:text-neutral-700"> · </span>
                {/if}
                {#if job.outputLabel}
                  Output: {job.outputLabel}
                {/if}
                {#if job.skipCluster}
                  <span class="dark:text-neutral-700"> · </span>cluster skipped
                {/if}
              </p>
            {/if}

            <!-- Error message -->
            {#if job.error}
              <div class="mb-2 rounded bg-red-900/30 p-2 text-red-300">{job.error}</div>
            {/if}

            {#if job.outputs?.length}
              <div class="mb-2 space-y-0.5 text-[11px] dark:text-neutral-400">
                {#each job.outputs as out (out.input)}
                  <p class="wrap-break-word" title={out.output || out.input}>
                    {basename(out.input)}
                    {#if out.ok}
                      → {basename(out.output || '')}
                      <span class="dark:text-green-400">({out.n_frames} frames)</span>
                    {:else}
                      <span class="text-red-300"> failed</span>
                    {/if}
                  </p>
                {/each}
              </div>
            {/if}

            <!-- Log toggle -->
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => toggleJobLog(ji)}
            >
              {job.showLog ? '▾ Hide log' : '▸ Show log'}
            </button>

            {#if job.showLog}
              <div class="mt-1 flex items-center justify-end gap-1">
                <button
                  class="dark:text-neutral-600 dark:hover:text-neutral-300"
                  onclick={() => refreshJobLog(ji)}
                  title="Refresh"
                >
                  ↻
                </button>
              </div>
              <FollowLog lines={job.logLines} />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

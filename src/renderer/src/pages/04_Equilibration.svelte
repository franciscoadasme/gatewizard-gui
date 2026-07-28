<script>
  import { onDestroy, untrack } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import { equilibrationPageStatus, logEvent } from '../lib/pageStatus.svelte.js'
  import ConstraintEditor from '../components/ConstraintEditor.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import EquilibrationStage from '../components/EquilibrationStage.svelte'
  import EquilibrationStageStatus from '../components/EquilibrationStageStatus.svelte'
  import baseProtocol from '../../../../resources/protocols/base.json'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import {
    checkExecutable,
    generateEquilibration,
    continueEquilibration,
    getEquilibrationStatus,
    getOpenmmPlatforms,
    getProcessInfo,
    listEngineExecutables,
    runEquilibration,
    scanEquilibrationJobs,
    getEquilibrationJobSummary,
    stopEquilibration,
    getStructure
  } from '../lib/backendApi'
  import {
    defaultEquilibrationFolderName,
    outputFolderPath
  } from '../lib/outputFolders.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'

  /** @typedef {{ id: string, name: string, force_constant: number, selection: string }} Constraint */

  const paneBackgroundStyle = $derived(
    `background-color: ${themeBackgroundHex(themeState.current)}`
  )

  const engines = [
    { id: 'namd', label: 'NAMD' },
    { id: 'gromacs', label: 'GROMACS' },
    { id: 'openmm', label: 'OpenMM' },
    { id: 'amber', label: 'Amber' }
  ]

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  let autoMonitor = $state(true)
  let engine = $state('namd')
  let ensemble = $state('npt')
  let gpuDevice = $state(0)
  let inputDir = $state('')
  let outputName = $state('')
  let protocol = $state(prepareProtocolForRendering(baseProtocol))

  function resolveOutputFolderName() {
    if (outputName.trim()) return outputName.trim()
    return defaultEquilibrationFolderName(inputDir)
  }

  function syncOutputFolderName() {
    const resolved = resolveOutputFolderName()
    if (resolved && resolved !== outputName.trim()) {
      outputName = resolved
    }
    return resolved
  }

  $effect(() => {
    if (workingDir && inputDir && !outputName.trim()) {
      outputName = defaultEquilibrationFolderName(inputDir)
    }
  })

  let addComRestraint = $state(false)
  let comSelection = $state('name CA')
  let comRestraintK = $state(10)
  let addRotationRestraint = $state(false)
  let rotationRestraintK = $state(2000)
  let validatingComSelection = $state(false)
  let comSelectionValidation = $state(/** @type {{ ok: boolean, message: string } | null} */ (null))
  let checkingExecutable = $state(false)
  let executableCheck = $state(/** @type {{ ok: boolean, message: string } | null} */ (null))
  /** @type {Array<{ id: string, label: string, executable: string, version?: string|null, variant?: string|null, source?: string, gmxrc?: string|null, available?: boolean }>} */
  let engineCandidates = $state([])
  let loadingEngineCandidates = $state(false)
  /** Selected candidate id, or ``custom`` for free-text path */
  let engineCandidateId = $state('custom')
  /** GMXRC paired with the selected GROMACS candidate (if any) */
  let selectedGmxrc = $state(/** @type {string|null} */ (null))
  /**
   * Compute target written into run scripts (may differ from this machine).
   * @type {'auto' | 'CPU' | 'CUDA' | 'OpenCL' | 'Metal'}
   */
  let computeTarget = $state(/** @type {'auto' | 'CPU' | 'CUDA' | 'OpenCL' | 'Metal'} */ ('auto'))
  /** Targets detected on this machine after Check Executable / candidate scan */
  let availableCompute = $state(/** @type {string[]} */ ([]))
  let executableByEngine = $state({
    namd: 'namd3',
    gromacs: 'gmx',
    openmm: 'python',
    amber: 'pmemd'
  })
  /** @type {number | null} */
  let systemSize = $state(null)
  let loadingSystemSize = $state(false)
  let totalCpus = $state(4)
  let totalGpus = $state(1)
  let updateInterval = $state(5)

  const GPU_TARGETS = ['CUDA', 'OpenCL', 'Metal']
  const OPENMM_COMPUTE_TARGETS = /** @type {const} */ (['auto', 'CPU', 'CUDA', 'OpenCL', 'Metal'])
  const BINARY_COMPUTE_TARGETS = /** @type {const} */ (['auto', 'CPU', 'CUDA'])

  const computeTargetsForEngine = $derived(
    engine === 'openmm' ? OPENMM_COMPUTE_TARGETS : BINARY_COMPUTE_TARGETS
  )
  /** Scripts request GPU unless the user explicitly targets CPU. */
  const useGpu = $derived(computeTarget !== 'CPU')
  const openmmPlatform = $derived(
    engine === 'openmm' && computeTarget !== 'auto' ? computeTarget : null
  )

  // derived values
  const isEngineSupported = $derived(['namd', 'gromacs', 'openmm', 'amber'].includes(engine))
  const isProtocolValid = $derived(Array.isArray(protocol.stages) && protocol.stages.length > 0)
  const outputDir = $derived(outputFolderPath(workingDir, resolveOutputFolderName()))
  const formJob = $derived(jobs.find((j) => j.jobDir === outputDir))
  const formFolderStatus = $derived(formJob?.status ?? 'empty')
  const formFolderRunning = $derived(formJob?.status === 'running')
  const formFolderHasInputs = $derived(formFolderStatus !== 'empty')
  const canGenerateInput = $derived(
    workingDir !== '' &&
      inputDir !== '' &&
      isProtocolValid &&
      isEngineSupported &&
      !generatingInputFiles &&
      !formFolderRunning
  )
  const canStartEquilibration = $derived(
    workingDir !== '' &&
      formFolderStatus !== 'empty' &&
      formFolderStatus !== 'running' &&
      isEngineSupported &&
      !startingEquilibration
  )
  const watchedJobs = $derived(jobs.filter((j) => j.watched))
  const hasRunningWatched = $derived(watchedJobs.some((j) => j.status === 'running'))
  const selectedExecutable = $derived(executableByEngine[engine] ?? '')
  const resources = $derived({
    cpu_cores: totalCpus,
    gpu_id: gpuDevice,
    num_gpus: totalGpus,
    use_gpu: useGpu
  })

  /** @param {string} target */
  function isComputeAvailable(target) {
    if (target === 'auto') return true
    return availableCompute.includes(target)
  }

  /** @param {string | null | undefined} variant */
  function availableFromVariant(variant) {
    const list = ['CPU']
    if (variant && variant !== 'CPU' && !list.includes(variant)) {
      list.push(variant)
    }
    return list
  }

  function syncAvailableFromSelectedCandidate() {
    if (engine === 'openmm') return
    const hit = engineCandidates.find((c) => c.id === engineCandidateId)
    availableCompute = availableFromVariant(hit?.variant ?? null)
  }

  /** Other discovered installs that support a compute target the current executable does not. */
  function candidatesSupportingTarget(target) {
    if (target === 'auto' || engine === 'openmm') return []
    return engineCandidates.filter((c) => {
      if (c.id === engineCandidateId) return false
      return availableFromVariant(c.variant ?? null).includes(target)
    })
  }

  const selectedCandidateVariant = $derived(
    engineCandidates.find((c) => c.id === engineCandidateId)?.variant ?? null
  )
  const computeTargetAltCandidates = $derived(
    computeTarget !== 'auto' && !isComputeAvailable(computeTarget)
      ? candidatesSupportingTarget(computeTarget)
      : []
  )
  /** @typedef {{ name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, elapsed_time_seconds: number|null, is_minimization?: boolean, steps_completed?: number|null, total_steps?: number|null, minimization_converged_early?: boolean, output: string }} EqStageInfo */
  /** @typedef {{ jobDir: string, name: string, engine: string, variant: string|null, status: string, startTime: string, elapsed: string, stagesDone: number, stagesTotal: number, error: string|null, canRun: boolean, canResume: boolean, resumeReason: string, resumeStageName: string, resources: import('../lib/backendApi.js').EquilibrationJobResources | null, inputDir: string|null, ensemble: string|null, protocol: { name: string, description?: string, stages: object[] }|null, stages: EqStageInfo[], watched: boolean, showInfo: boolean, processInfo: { pid: number|null, running: boolean, command: string|null, start_time: string|null, working_dir: string, engine: string } | null, loadingProcessInfo: boolean, stopping: boolean, continuing: boolean, running: boolean, reloading: boolean, equilibrationOutput: string }} EquilibrationJob */

  // state
  /** @type {null | { stageIndex: number, constraintIndex: number, source: Constraint | null }} */
  let constraintEditor = $state(null)
  /** True after form folder status has been read from the backend (or input was just generated). */
  let statusSynced = $state(false)
  let generatingInputFiles = $state(false)
  let startingEquilibration = $state(false)
  /** @type {EquilibrationJob[]} */
  let jobs = $state([])
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollIntervalId = null

  // ── Sync to shared status bar store ──
  $effect(() => {
    const running = jobs.filter((j) => j.status === 'running')
    const primary = running[0] ?? jobs.find((j) => j.watched) ?? jobs[0]
    equilibrationPageStatus.engine = primary?.engine ?? engine
    equilibrationPageStatus.outputName = primary?.name ?? outputName
    equilibrationPageStatus.status = primary?.status ?? formFolderStatus
    equilibrationPageStatus.stagesDone = primary?.stagesDone ?? 0
    equilibrationPageStatus.stagesTotal = primary?.stagesTotal ?? 0
    equilibrationPageStatus.generatingInput = generatingInputFiles
    if (primary?.startTime) {
      equilibrationPageStatus.runStartedAt = new Date(primary.startTime).getTime()
    }
  })

  // output
  let showWorkingDirHint = $state(false)

  function formatJobElapsed(startIso, endIso = null) {
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

  function formatNs(value) {
    if (!Number.isFinite(value)) return '—'
    return value.toFixed(value > 1 ? 2 : 3)
  }

  /** @param {import('../lib/backendApi.js').EquilibrationJobResources | null | undefined} resources */
  function formatJobResources(resources) {
    if (!resources) return ''
    const cpuMin = resources.cpu_cores_min
    const cpuMax = resources.cpu_cores_max
    const parts = []

    if (Number.isFinite(cpuMin) && Number.isFinite(cpuMax)) {
      parts.push(cpuMin === cpuMax ? `${cpuMin} CPU` : `${cpuMin}–${cpuMax} CPU`)
    }

    if (resources.engine === 'openmm' && resources.platform) {
      const platform =
        resources.platform.toLowerCase() === 'auto'
          ? 'Platform auto'
          : resources.platform
      parts.push(platform)
      return parts.join(' · ')
    }

    if (resources.use_gpu === false || resources.use_gpu === null) {
      if (resources.platform) {
        parts.push(resources.platform)
      } else if (resources.engine === 'gromacs') {
        parts.push('CPU')
      }
      return parts.join(' · ')
    }

    const gpuMin = resources.gpu_id_min
    const gpuMax = resources.gpu_id_max
    const numGpus = resources.num_gpus ?? 1
    if (Number.isFinite(gpuMin) && Number.isFinite(gpuMax)) {
      const gpuLabel =
        gpuMin === gpuMax
          ? `GPU ${gpuMin}${numGpus > 1 ? ` × ${numGpus}` : ''}`
          : `GPU ${gpuMin}–${gpuMax}`
      parts.push(gpuLabel)
    } else if (resources.platform) {
      parts.push(resources.platform)
    } else {
      parts.push('GPU')
    }

    return parts.join(' · ')
  }

  /** @param {EqStageInfo[]} stages */
  function jobSimulatedTotals(stages) {
    let sim = 0
    let total = 0
    let hasSim = false
    let hasTotal = false
    for (const s of stages) {
      if (s.is_minimization) continue
      if (Number.isFinite(s.simulated_time)) {
        sim += /** @type {number} */ (s.simulated_time)
        hasSim = true
      }
      if (Number.isFinite(s.total_simulation_time)) {
        total += /** @type {number} */ (s.total_simulation_time)
        hasTotal = true
      }
    }
    return { sim: hasSim ? sim : null, total: hasTotal ? total : null }
  }

  /** @param {import('../lib/backendApi.js').EquilibrationJobSummary} summary */
  function jobFromScan(summary, /** @type {EquilibrationJob | undefined} */ existing) {
    return {
      jobDir: summary.job_dir,
      name: summary.name,
      engine: summary.engine,
      variant: summary.variant,
      status: summary.status || 'unknown',
      startTime: summary.start_time || '',
      elapsed: formatJobElapsed(summary.start_time),
      stagesDone: summary.stages_done ?? 0,
      stagesTotal: summary.stages_total ?? 0,
      error: summary.error || null,
      canRun: summary.can_run ?? false,
      canResume: summary.can_resume ?? false,
      resumeReason: summary.resume_reason || '',
      resumeStageName: summary.resume_stage_name || '',
      resources: summary.resources ?? null,
      inputDir: summary.input_dir || null,
      ensemble: summary.ensemble || null,
      protocol: summary.protocol || null,
      stages: existing?.stages ?? [],
      watched: existing?.watched ?? false,
      showInfo: existing?.showInfo ?? false,
      processInfo: existing?.processInfo ?? null,
      loadingProcessInfo: false,
      stopping: false,
      continuing: false,
      running: false,
      reloading: false,
      // Only keep stage error output while the job is still in error; Continue/resume
      // must not resurrect a stale failure log under a running card.
      equilibrationOutput:
        summary.status === 'error' ? (existing?.equilibrationOutput ?? '') : ''
    }
  }

  function applyAutoWatch(/** @type {EquilibrationJob[]} */ list) {
    const running = list.filter((j) => j.status === 'running')
    if (running.length > 0) {
      const runningDirs = new Set(running.map((r) => r.jobDir))
      return list.map((j) => ({ ...j, watched: runningDirs.has(j.jobDir) }))
    }
    if (list.length > 0 && !list.some((j) => j.watched)) {
      return list.map((j, i) => (i === 0 ? { ...j, watched: true } : j))
    }
    return list
  }

  async function rescanJobs() {
    if (!workingDir) return
    try {
      const { jobs: found } = await scanEquilibrationJobs(workingDir)
      const byDir = new Map(jobs.map((j) => [j.jobDir, j]))
      let merged = found.map((summary) => jobFromScan(summary, byDir.get(summary.job_dir)))
      merged = applyAutoWatch(merged)
      jobs = merged
      statusSynced = true
      if (merged.some((j) => j.watched && j.status === 'running')) {
        startPolling()
      }
      await pollWatchedJobs({ scheduleNext: false })
    } catch {
      /* backend unreachable */
    }
  }

  function startPolling() {
    if (pollIntervalId) return
    pollIntervalId = setInterval(pollWatchedJobs, updateInterval * 1000)
  }

  function stopPollingIfDone() {
    if (!jobs.some((j) => j.watched && j.status === 'running')) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = null
      }
    }
  }

  async function pollWatchedJobs({ scheduleNext = true } = {}) {
    for (let i = 0; i < jobs.length; i++) {
      if (!jobs[i].watched) continue
      await refreshJobDetail(i)
    }
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'running') {
        jobs[i] = { ...jobs[i], elapsed: formatJobElapsed(jobs[i].startTime) }
      }
    }
    stopPollingIfDone()
    if (scheduleNext && autoMonitor && hasRunningWatched) {
      startPolling()
    }
  }

  async function refreshJobDetail(/** @type {number} */ index) {
    const job = jobs[index]
    if (!job) return
    const prevStatus = job.status
    const jobDir = job.jobDir
    const jobName = job.name
    try {
      const { status, stages, run_start_time } = await getEquilibrationStatus({
        workingDir: job.jobDir,
        engine: job.engine
      })
      // Merge into the latest card state — concurrent Reload/Continue/poll must not
      // re-apply a stale snapshot (e.g. reloading: true) after the await.
      const current = jobs[index]
      if (!current || current.jobDir !== jobDir) return
      const equilibrationOutput =
        status === 'error'
          ? (stages.find((s) => s.status === 'error')?.output ?? '')
          : ''
      jobs[index] = {
        ...current,
        status,
        stages: stages.length > 0 ? stages : current.stages,
        stagesDone: stages.filter((s) => s.status === 'completed').length || current.stagesDone,
        stagesTotal: stages.length || current.stagesTotal,
        startTime: run_start_time || current.startTime,
        elapsed: formatJobElapsed(run_start_time || current.startTime),
        equilibrationOutput,
        error: status === 'error' ? current.error : null
      }
      if (prevStatus === 'running' && status !== 'running') {
        if (status === 'completed') {
          logEvent('info', 'eq', `Job completed: ${jobName}`, `Elapsed: ${jobs[index].elapsed}`)
        } else {
          logEvent('info', 'eq', `Job ${status}: ${jobName}`, jobs[index].error || '')
        }
      }
    } catch {
      /* skip cycle */
    }
  }

  function toggleJobWatch(/** @type {number} */ index) {
    jobs[index] = { ...jobs[index], watched: !jobs[index].watched }
    if (jobs[index].watched) {
      void refreshJobDetail(index)
      if (jobs[index].status === 'running') startPolling()
    } else {
      stopPollingIfDone()
    }
  }

  async function reloadJobCard(/** @type {number} */ index) {
    const job = jobs[index]
    if (!job || job.reloading) return
    const jobDir = job.jobDir
    jobs[index] = { ...job, reloading: true }
    try {
      const summary = await getEquilibrationJobSummary(job.jobDir, workingDir || undefined)
      const existing = jobs[index]
      if (!existing || existing.jobDir !== jobDir) return
      jobs[index] = { ...jobFromScan(summary, existing), reloading: true }
      if (jobs[index].watched) {
        await refreshJobDetail(index)
      }
      if (jobs[index].showInfo) {
        jobs[index] = { ...jobs[index], processInfo: null, loadingProcessInfo: true }
        try {
          const info = await getProcessInfo({
            workingDir: jobs[index].jobDir,
            engine: jobs[index].engine
          })
          jobs[index] = { ...jobs[index], processInfo: info, loadingProcessInfo: false }
        } catch {
          jobs[index] = { ...jobs[index], processInfo: null, loadingProcessInfo: false }
        }
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      if (jobs[index]?.jobDir === jobDir) {
        jobs[index] = { ...jobs[index], reloading: false }
      }
    }
  }

  /** @param {EquilibrationJob} job */
  function useJobInForm(job) {
    outputName = job.name
    engine = job.engine
    if (job.inputDir) {
      inputDir = job.inputDir
    }
    if (job.ensemble) {
      ensemble = job.ensemble.toLowerCase()
    }
    if (job.protocol?.stages?.length) {
      protocol = prepareProtocolForRendering(structuredClone(job.protocol))
    }
    statusSynced = true
  }

  function removeJob(/** @type {number} */ index) {
    if (jobs[index]?.status === 'running') return
    jobs = jobs.filter((_, i) => i !== index)
  }

  async function toggleJobProcessInfo(/** @type {number} */ index) {
    if (jobs[index].showInfo) {
      jobs[index] = { ...jobs[index], showInfo: false }
      return
    }
    jobs[index] = { ...jobs[index], showInfo: true, loadingProcessInfo: true }
    try {
      const info = await getProcessInfo({
        workingDir: jobs[index].jobDir,
        engine: jobs[index].engine
      })
      jobs[index] = { ...jobs[index], processInfo: info, loadingProcessInfo: false }
    } catch {
      jobs[index] = { ...jobs[index], processInfo: null, loadingProcessInfo: false }
    }
  }

  async function runJob(/** @type {number} */ index) {
    const job = jobs[index]
    if (!job || job.status === 'running') return
    try {
      const { status } = await getEquilibrationStatus({
        workingDir: job.jobDir,
        engine: job.engine
      })
      if (status === 'running') {
        alert('Equilibration is already running. Wait for it to finish.')
        return
      }
      if (
        ['completed', 'error'].includes(status) &&
        job.stagesDone > 0 &&
        !confirm(
          `Start equilibration in "${job.name}" from the beginning? Existing stage outputs will be overwritten.`
        )
      ) {
        return
      }

      jobs[index] = { ...job, running: true }
      equilibrationPageStatus.wasKilled = false
      await runEquilibration({ workingDir: job.jobDir, engine: job.engine })
      logEvent(
        'info',
        'eq',
        `Started equilibration: "${job.name}"`,
        `${job.engine.toUpperCase()} · ${job.jobDir}`
      )
      jobs[index] = { ...jobs[index], watched: true, running: false }
      startPolling()
      await rescanJobs()
      const idx = jobs.findIndex((j) => j.jobDir === job.jobDir)
      if (idx >= 0) await refreshJobDetail(idx)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
      jobs[index] = { ...jobs[index], running: false }
    }
  }

  function continueStageLabel(/** @type {EquilibrationJob} */ job) {
    const fromWatch = job.stages?.find((s) => s.status !== 'completed')
    if (fromWatch?.name && job.stages?.some((s) => s.status === 'completed')) {
      return fromWatch.name
    }
    return job.resumeStageName || 'the next stage'
  }

  async function continueJob(/** @type {number} */ index) {
    const job = jobs[index]
    if (!job || job.status === 'running' || !job.canResume) return
    const stageLabel = continueStageLabel(job)
    if (
      !confirm(
        `Continue equilibration in "${job.name}"?\n\nCompleted stages will be skipped. Any incomplete stage—including "${stageLabel}"—will restart from the beginning.`
      )
    )
      return
    try {
      jobs[index] = { ...job, continuing: true }
      await continueEquilibration({ workingDir: job.jobDir, engine: job.engine })
      equilibrationPageStatus.wasKilled = false
      logEvent(
        'info',
        'eq',
        `Continuing equilibration: "${job.name}"`,
        `${job.engine.toUpperCase()} · from ${stageLabel}`
      )
      jobs[index] = {
        ...jobs[index],
        watched: true,
        continuing: false,
        status: 'running',
        error: null,
        equilibrationOutput: ''
      }
      startPolling()
      await rescanJobs()
      const idx = jobs.findIndex((j) => j.jobDir === job.jobDir)
      if (idx >= 0) await refreshJobDetail(idx)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
      jobs[index] = { ...jobs[index], continuing: false }
    }
  }

  async function killJob(/** @type {number} */ index) {
    const job = jobs[index]
    if (!job || job.status !== 'running') return
    if (
      !confirm(
        `Stop the running ${job.engine.toUpperCase()} equilibration in "${job.name}"? This cannot be undone.`
      )
    )
      return
    try {
      jobs[index] = { ...job, stopping: true }
      await stopEquilibration({ workingDir: job.jobDir, engine: job.engine })
      equilibrationPageStatus.wasKilled = true
      logEvent('info', 'eq', `Killed equilibration: "${job.name}"`, `${job.engine.toUpperCase()} · ${job.jobDir}`)
      await refreshJobDetail(index)
      jobs[index] = { ...jobs[index], showInfo: false, stopping: false }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
      jobs[index] = { ...jobs[index], stopping: false }
    }
  }

  function jobNoticeClass(status) {
    if (status === 'completed') return 'gw-notice-success'
    if (status === 'error') return 'gw-notice-error'
    if (status === 'running') return 'gw-notice-warning'
    if (status === 'not_started') return 'gw-notice-info'
    return ''
  }

  $effect(() => {
    if (workingDir !== '') {
      showWorkingDirHint = false
      highlightWorkingDir(false)
    }
  })

  $effect(() => {
    if (!workingDir) {
      jobs = []
      return
    }
    void rescanJobs()
  })

  $effect(() => {
    if (!autoMonitor) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = null
      }
      return
    }
    if (hasRunningWatched) {
      startPolling()
    }
  })

  onDestroy(() => {
    if (pollIntervalId) {
      clearInterval(pollIntervalId)
      pollIntervalId = null
    }
  })

  $effect(() => {
    const dir = inputDir
    if (!dir) {
      systemSize = null
      loadingSystemSize = false
      return
    }
    loadingSystemSize = true
    systemSize = null
    let cancelled = false
    countMatchingAtoms('all').then((n) => {
      if (cancelled) return
      systemSize = n
      loadingSystemSize = false
    })
    return () => {
      cancelled = true
    }
  })

  /**
   * Count the number of atoms in the system.inpcrd file.
   * @param {string} selection - The selection to select atoms from.
   * @returns {Promise<number|null>} The number of selected atoms.
   */
  async function countMatchingAtoms(selection) {
    if (!inputDir) {
      return null
    }
    const payload = {
      path: `${inputDir}/system.inpcrd`,
      selection,
      topology: `${inputDir}/system.prmtop`
    }
    try {
      const { atoms } = await getStructure(payload)
      return atoms.length
    } catch (error) {
      // alert(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function validateComSelection() {
    if (!inputDir) {
      comSelectionValidation = { ok: false, message: 'Select an input directory first.' }
      return
    }

    const selection = comSelection.trim()
    if (!selection) {
      comSelectionValidation = { ok: false, message: 'Selection cannot be empty.' }
      return
    }

    validatingComSelection = true
    comSelectionValidation = null
    try {
      const { atoms } = await getStructure({
        path: `${inputDir}/system.inpcrd`,
        selection,
        topology: `${inputDir}/system.prmtop`
      })
      const n = atoms.length
      comSelectionValidation = {
        ok: n > 0,
        message: n > 0 ? `${n.toLocaleString()} atom(s) matched.` : 'Selection matched 0 atoms.'
      }
      logEvent('detail', 'eq', `COM selection: "${selection}"`, comSelectionValidation.message)
    } catch (error) {
      comSelectionValidation = {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      validatingComSelection = false
    }
  }

  async function generateInput() {
    try {
      syncOutputFolderName()
      const folderLabel = resolveOutputFolderName()
      if (formFolderRunning) {
        alert(
          `Equilibration is running in "${folderLabel}". Change the output folder name to generate inputs for another simulation.`
        )
        return
      }
      if (
        formFolderHasInputs &&
        !confirm(
          `Overwrite existing input files in "${folderLabel}"?\n\nThis will replace the current equilibration inputs in that folder.`
        )
      ) {
        return
      }

      generatingInputFiles = true
      let currentProtocol = $state.snapshot(protocol)
      currentProtocol.stages = currentProtocol.stages.map((stage) => ({ ...resources, ...stage }))
      await generateEquilibration({
        inputDir,
        outputDir,
        protocol: currentProtocol,
        ensemble,
        programConfig: {
          engine,
          executable: selectedExecutable,
          ...(engine === 'gromacs' && selectedGmxrc ? { gmxrc: selectedGmxrc } : {})
        },
        addComRestraint,
        comSelection,
        comRestraintK,
        addRotationRestraint,
        rotationRestraintK,
        ...(engine === 'openmm' && openmmPlatform !== null ? { openmmPlatform } : {})
      })
      statusSynced = true
      await rescanJobs()
      jobs = jobs.map((j) => (j.jobDir === outputDir ? { ...j, watched: true } : j))
      logEvent(
        'info',
        'eq',
        `Generated input: "${outputName}"`,
        `${engine.toUpperCase()} · ${outputDir}`
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      generatingInputFiles = false
    }
  }

  async function loadProtocol() {
    const { canceled, filePath } = await window.api.openFileDialog(
      'Select Protocol File',
      [{ name: 'JSON', extensions: ['json'] }],
      workingDir
    )
    if (canceled) {
      return
    }
    try {
      protocol = prepareProtocolForRendering(await window.api.readJson(filePath))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Prepare a freshly loaded protocol for use in the renderer:
   * generate stable constraint `id`s and resolve any `selection` that is an
   * alias (a key of the top-level `selections` record) to the underlying
   * selection text. Mutates and returns the input.
   * @template {{ stages?: Array<{ constraints?: Array<{ id?: string, selection?: string }> }>, selections?: Record<string, string> }} Protocol
   * @param {Protocol} p
   * @returns {Protocol}
   */
  function prepareProtocolForRendering(p) {
    const selections = p?.selections ?? {}
    for (const stage of p?.stages ?? []) {
      for (const c of stage.constraints ?? []) {
        if (!c.id) c.id = crypto.randomUUID()
        if (c.selection != null && selections[c.selection] != null) {
          c.selection = selections[c.selection]
        }
      }
    }
    return p
  }

  /**
   * Inverse of {@link prepareProtocolForRendering}: return a snapshot ready to be
   * persisted. Drops constraint `id`s and replaces each `selection` text with
   * its alias whenever an entry in the top-level `selections` record matches.
   */
  function prepareProtocolForSerialization(snapshot) {
    const aliasByText = new Map(
      Object.entries(snapshot.selections ?? {}).map(([alias, text]) => [text, alias])
    )
    for (const stage of snapshot.stages ?? []) {
      for (const c of stage.constraints ?? []) {
        delete c.id
        if (c.selection != null && aliasByText.has(c.selection)) {
          c.selection = aliasByText.get(c.selection)
        }
      }
    }
    return snapshot
  }

  async function saveProtocol() {
    const { canceled, filePath } = await window.api.saveFileDialog(
      'Save Protocol',
      [{ name: 'JSON', extensions: ['json'] }],
      workingDir
    )
    if (canceled) {
      return
    }
    try {
      let currentProtocol = $state.snapshot(protocol)
      currentProtocol.stages = currentProtocol.stages.map((stage) => ({ ...resources, ...stage }))
      await window.api.writeJson(
        filePath,
        prepareProtocolForSerialization($state.snapshot(protocol))
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  function highlightWorkingDir(on) {
    const el = document.getElementById('working-dir-input')
    if (!el) return
    if (on) {
      el.style.outline = '2px solid #facc15'
      el.style.outlineOffset = '2px'
    } else {
      el.style.outline = ''
      el.style.outlineOffset = ''
    }
  }

  function toggleWorkingDirHint(show) {
    if (workingDir !== '') return
    showWorkingDirHint = show
    highlightWorkingDir(show)
  }

  async function selectInputDir() {
    const { canceled, dirPath } = await window.api.openDirectoryDialog(
      'Select Input Directory',
      workingDir
    )
    if (canceled) {
      return
    }
    inputDir = dirPath
    outputName = defaultEquilibrationFolderName(dirPath)
  }

  async function refreshEngineCandidates() {
    loadingEngineCandidates = true
    try {
      const { candidates } = await listEngineExecutables(engine)
      engineCandidates = Array.isArray(candidates) ? candidates : []
      const match = engineCandidates.find(
        (c) => c.executable === selectedExecutable || c.executable.endsWith(`/${selectedExecutable}`)
      )
      if (match) {
        engineCandidateId = match.id
        selectedGmxrc = match.gmxrc ?? null
      } else if (engineCandidates.length > 0 && engineCandidateId === 'custom') {
        // Prefer first discovered install when still on defaults
        const defaults = { namd: 'namd3', gromacs: 'gmx', openmm: 'python', amber: 'pmemd' }
        if (selectedExecutable === defaults[engine]) {
          const first = engineCandidates[0]
          engineCandidateId = first.id
          executableByEngine[engine] = first.executable
          selectedGmxrc = first.gmxrc ?? null
        }
      }
      if (engine === 'openmm') {
        try {
          const { platforms } = await getOpenmmPlatforms()
          availableCompute = (platforms ?? [])
            .map((p) => p.name)
            .filter((name) => name && name !== 'Reference')
        } catch {
          availableCompute = availableCompute.length ? availableCompute : ['CPU']
        }
      } else {
        syncAvailableFromSelectedCandidate()
      }
    } catch {
      engineCandidates = []
      availableCompute = []
    } finally {
      loadingEngineCandidates = false
    }
  }

  $effect(() => {
    // Refresh when engine changes; drop OpenMM-only targets on NAMD/GROMACS
    void engine
    untrack(() => {
      if (engine !== 'openmm' && (computeTarget === 'OpenCL' || computeTarget === 'Metal')) {
        computeTarget = 'auto'
      }
    })
    void refreshEngineCandidates()
  })

  async function checkEngineExecutable() {
    if (!selectedExecutable.trim()) {
      executableCheck = { ok: false, message: 'Executable cannot be empty.' }
      return
    }
    checkingExecutable = true
    try {
      const result = await checkExecutable({ engine, executable: selectedExecutable })
      if (result.exists) {
        const version = result.version ? ` (${result.version})` : ''
        executableCheck = {
          ok: true,
          message: `Found: ${result.resolved_path}${version}`
        }
        logEvent('detail', 'eq', `Executable OK: ${engine.toUpperCase()}`, executableCheck.message)
        if (engine === 'openmm') {
          try {
            const { platforms } = await getOpenmmPlatforms()
            availableCompute = (platforms ?? [])
              .map((p) => p.name)
              .filter((name) => name && name !== 'Reference')
          } catch {
            availableCompute = ['CPU']
          }
        } else {
          const hit = engineCandidates.find(
            (c) => c.id === engineCandidateId || c.executable === selectedExecutable
          )
          availableCompute = availableFromVariant(hit?.variant ?? result.variant ?? null)
        }
      } else {
        executableCheck = {
          ok: false,
          message: `Executable not found: ${selectedExecutable}`
        }
      }
    } catch (error) {
      executableCheck = {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      checkingExecutable = false
    }
  }

  async function startEquilibration() {
    try {
      syncOutputFolderName()
      const folderLabel = resolveOutputFolderName()
      if (formFolderRunning) {
        alert(
          `Equilibration is already running in "${folderLabel}". Change the output folder name to start another simulation.`
        )
        return
      }
      if (formFolderStatus === 'empty') {
        return
      }
      if (
        ['completed', 'error'].includes(formFolderStatus) &&
        !confirm(
          `An equilibration in "${folderLabel}" has already finished. Start again from stage 1 and overwrite outputs?`
        )
      ) {
        return
      }

      startingEquilibration = true
      equilibrationPageStatus.wasKilled = false
      await runEquilibration({ workingDir: outputDir, engine })
      logEvent(
        'info',
        'eq',
        `Started equilibration: "${outputName}"`,
        `${engine.toUpperCase()} · ${outputDir}`
      )
      await rescanJobs()
      const idx = jobs.findIndex((j) => j.jobDir === outputDir)
      if (idx >= 0) {
        jobs = jobs.map((j, i) => (i === idx ? { ...j, watched: true } : j))
        startPolling()
        await refreshJobDetail(idx)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      startingEquilibration = false
    }
  }

  function acceptConstraint(/** @type {Constraint} */ draft) {
    if (!constraintEditor) return
    const { stageIndex, constraintIndex } = constraintEditor
    const stage = protocol.stages[stageIndex]
    if (constraintIndex < 0) {
      stage.constraints = [...stage.constraints, { ...draft }]
    } else {
      const next = [...stage.constraints]
      next[constraintIndex] = { ...draft }
      stage.constraints = next
    }
    dismissConstraintEditor()
  }

  function deleteConstraintFromEditor() {
    if (!constraintEditor || constraintEditor.constraintIndex < 0) return
    const { stageIndex, constraintIndex } = constraintEditor
    const stage = protocol.stages[stageIndex]
    stage.constraints = stage.constraints.filter((_, i) => i !== constraintIndex)
    dismissConstraintEditor()
  }

  function dismissConstraintEditor() {
    constraintEditor = null
  }

  /**
   * Open the constraint editor for adding a new constraint.
   * @param {number} stageIndex - The index of the stage to add the constraint to.
   */
  function openConstraintEditorForAdd(stageIndex) {
    constraintEditor = { stageIndex, constraintIndex: -1, source: null }
  }

  /**
   * Open the constraint editor for editing a specific constraint.
   * @param {number} stageIndex - The index of the stage to edit.
   * @param {number} constraintIndex - The index of the constraint to edit.
   */
  function openConstraintEditorForEdit(stageIndex, constraintIndex) {
    const c = protocol.stages[stageIndex].constraints[constraintIndex]
    constraintEditor = { stageIndex, constraintIndex, source: { ...c } }
  }

  function onClear() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId)
      pollIntervalId = null
    }
    inputDir = ''
    outputName = ''
    systemSize = null
    loadingSystemSize = false
    autoMonitor = true
    engine = 'namd'
    ensemble = 'npt'
    gpuDevice = 0
    totalCpus = 4
    totalGpus = 1
    updateInterval = 5
    addComRestraint = false
    comSelection = 'name CA'
    comRestraintK = 10
    addRotationRestraint = false
    rotationRestraintK = 2000
    validatingComSelection = false
    comSelectionValidation = null
    checkingExecutable = false
    executableCheck = null
    computeTarget = 'auto'
    availableCompute = []
    executableByEngine = { namd: 'namd3', gromacs: 'gmx', openmm: 'python', amber: 'pmemd' }
    engineCandidates = []
    engineCandidateId = 'custom'
    selectedGmxrc = null
    protocol = prepareProtocolForRendering(baseProtocol)
    constraintEditor = null
    statusSynced = false
    generatingInputFiles = false
    jobs = []
    showWorkingDirHint = false
    equilibrationPageStatus.engine = ''
    equilibrationPageStatus.outputName = ''
    equilibrationPageStatus.status = ''
    equilibrationPageStatus.stagesDone = 0
    equilibrationPageStatus.stagesTotal = 0
    equilibrationPageStatus.generatingInput = false
    equilibrationPageStatus.wasKilled = false
    equilibrationPageStatus.runStartedAt = null
  }
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-200 overflow-hidden select-none dark:divide-neutral-800">
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <h2 class="sidebar-heading">Input</h2>
      <div class="space-y-1">
        <p class="sidebar-label">Input directory</p>
        <p class="sidebar-hint">
          Must contain <code>.prmtop</code> and <code>.inpcrd</code> files.
        </p>
        {#if inputDir}
          <div class="w-full rounded-md border border-neutral-200 p-2 font-mono wrap-anywhere dark:border-neutral-800">
            {inputDir}
          </div>
          {#if loadingSystemSize}
            <p class="sidebar-hint mb-2 flex items-center gap-1.5">
              <Spinner className="size-3" />
              Loading system…
            </p>
          {:else if systemSize !== null}
            <p class="sidebar-hint mb-2">System size: {systemSize.toLocaleString()} atoms</p>
          {:else if inputDir}
            <p class="sidebar-hint mb-2 text-amber-600 dark:text-amber-400">
              Could not read system size (check .prmtop / .inpcrd)
            </p>
          {/if}
          <Button variant="outline" className="w-full" onclick={selectInputDir}
            >Select another directory...</Button
          >
        {:else}
          <Button variant="outline" className="w-full" onclick={selectInputDir}
            >Select a directory...</Button
          >
        {/if}
      </div>
      <div class="space-y-1">
        <p class="sidebar-label">Output folder</p>
        <Input type="text" size="sm" bind:value={outputName} className="w-full" placeholder="03_equilibration_input" />
        <p
          class="rounded-md border border-neutral-200 p-2 wrap-break-word sidebar-label dark:border-neutral-800"
        >
          {#if outputDir}
            {outputDir}
          {:else if workingDir}
            Files will be written under the working directory
          {:else}
            Set a working directory in the top bar
          {/if}
        </p>
      </div>
    </div>
    <Divider />
    <div class="space-y-2">
      <h2 class="sidebar-heading">Molecular Dynamics</h2>
      <div class="space-y-1">
        <p class="sidebar-label">Engine</p>
        <Select
          size="sm"
          className="w-full"
          bind:value={engine}
          onchange={() => {
            executableCheck = null
            availableCompute = []
            engineCandidateId = 'custom'
            selectedGmxrc = null
          }}
        >
          {#each engines as item (item.id)}
            <option value={item.id}>{item.label}</option>
          {/each}
        </Select>
        {#if engine === 'namd'}
          <p class="sidebar-hint">
            NAMD + OPC builds: waterModel tip4 is added automatically from the builder
            job (FlexibleWater prmtop).
          </p>
        {/if}
      </div>
      <div class="space-y-1">
        <p class="sidebar-label">Executable</p>
        {#if engineCandidates.length > 0}
          <Select
            size="sm"
            className="w-full"
            value={engineCandidateId}
            onchange={(e) => {
              const id = e.currentTarget.value
              engineCandidateId = id
              executableCheck = null
              if (id === 'custom') {
                selectedGmxrc = null
                if (engine !== 'openmm') availableCompute = ['CPU']
                return
              }
              const hit = engineCandidates.find((c) => c.id === id)
              if (hit) {
                executableByEngine[engine] = hit.executable
                selectedGmxrc = hit.gmxrc ?? null
                if (engine !== 'openmm') {
                  availableCompute = availableFromVariant(hit.variant ?? null)
                }
              }
            }}
          >
            {#each engineCandidates as c (c.id)}
              <option value={c.id}>{c.label}</option>
            {/each}
            <option value="custom">Custom path…</option>
          </Select>
        {/if}
        {#if engineCandidateId === 'custom' || engineCandidates.length === 0}
          <Input
            type="text"
            size="sm"
            value={selectedExecutable}
            oninput={(e) => {
              executableByEngine[engine] = e.target.value
              engineCandidateId = 'custom'
              selectedGmxrc = null
              executableCheck = null
              if (engine !== 'openmm') availableCompute = ['CPU']
            }}
            className="w-full"
            placeholder={engine === 'openmm' ? 'python' : engine === 'gromacs' ? 'gmx' : engine === 'amber' ? 'pmemd' : 'namd3'}
          />
        {/if}
        {#if selectedGmxrc}
          <p class="sidebar-hint break-all">GMXRC: {selectedGmxrc}</p>
        {/if}
        <div class="flex gap-1">
          <Button variant="outline" className="flex-1" onclick={checkEngineExecutable}>
            {#if checkingExecutable}
              <Spinner className="mr-1" />
              Checking…
            {:else}
              Check Executable
            {/if}
          </Button>
          <Button
            variant="outline"
            className="shrink-0"
            onclick={refreshEngineCandidates}
            disabled={loadingEngineCandidates}
            title="Rescan PATH / conda / GMXRC installs"
          >
            {loadingEngineCandidates ? '…' : '↻'}
          </Button>
        </div>
        {#if executableCheck}
          <p class={executableCheck.ok ? 'text-xs text-green-400' : 'text-xs text-red-400'}>
            {executableCheck.message}
          </p>
        {/if}
        <div class="space-y-1 pt-0.5">
          <p class="sidebar-label flex items-center gap-1">
            Compute target
            <span
              class="inline-flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-neutral-400 text-[9px] leading-none text-neutral-500 dark:border-neutral-500 dark:text-neutral-400"
              title="Written into the generated run scripts (GPU flags / OpenMM PLATFORM). A green dot means the currently selected executable supports that target. You can still choose CUDA/OpenCL for scripts even if this binary does not — pick a matching build from Executable, or run later on another machine."
              aria-label="About compute target: based on selected executable; scripts may still target unsupported options"
              role="img"
              >i</span
            >
          </p>
          <div class="flex flex-wrap gap-1">
            {#each computeTargetsForEngine as target (target)}
              {@const available = isComputeAvailable(target)}
              {@const selected = computeTarget === target}
              {@const isGpu = GPU_TARGETS.includes(target)}
              <button
                type="button"
                title={target === 'auto'
                  ? 'Auto-detect at run time'
                  : available
                    ? `Supported by the selected executable · select for scripts`
                    : `Not supported by the selected executable · still writable into scripts`}
                onclick={() => {
                  computeTarget = target
                }}
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors
                  {selected
                    ? isGpu
                      ? 'bg-green-700 text-green-100 ring-1 ring-green-400'
                      : target === 'CPU'
                        ? 'bg-blue-700 text-blue-100 ring-1 ring-blue-400'
                        : 'bg-neutral-700 text-neutral-100 ring-1 ring-neutral-400'
                    : available
                      ? isGpu
                        ? 'bg-green-900/80 text-green-300 hover:bg-green-800'
                        : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      : 'bg-zinc-800/60 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'}"
              >
                {#if available && target !== 'auto'}
                  <span
                    class="size-1.5 shrink-0 rounded-full {selected
                      ? 'bg-emerald-200'
                      : 'bg-emerald-400'}"
                    aria-hidden="true"
                  ></span>
                {/if}
                {target === 'auto' ? 'Auto' : target}{selected ? ' ✓' : ''}
              </button>
            {/each}
          </div>
          {#if computeTarget !== 'auto' && !isComputeAvailable(computeTarget)}
            <p class="text-xs text-amber-600 dark:text-amber-400">
              {#if computeTargetAltCandidates.length > 0}
                Not supported by this executable{#if selectedCandidateVariant}
                  ({selectedCandidateVariant}){/if} — select a {computeTarget} build from
                  Executable (e.g. {computeTargetAltCandidates[0].label}). Scripts will still
                  target {computeTarget}.
              {:else}
                Not supported by the selected executable{#if selectedCandidateVariant}
                  ({selectedCandidateVariant}){/if} — scripts will still target {computeTarget}
                  (e.g. for running later on another machine).
              {/if}
            </p>
          {:else if computeTarget === 'auto'}
            <p class="sidebar-hint">
              {engine === 'openmm'
                ? 'OpenMM picks the fastest platform at runtime.'
                : 'Scripts prefer GPU when the engine supports it.'}
            </p>
          {:else if availableCompute.length > 0}
            <p class="sidebar-hint">
              Selected executable supports: {availableCompute.join(', ')}
            </p>
          {/if}
        </div>
      </div>
      <div class="col-span-2 flex items-center gap-2">
        <Checkbox
          id="add-com-restraint"
          bind:checked={addComRestraint}
          onchange={() => {
            if (addComRestraint) addRotationRestraint = true
          }}
        />
        <label for="add-com-restraint" class="sidebar-label">Generate COM restraint during input generation</label>
      </div>
      {#if addComRestraint}
        <div class="space-y-1">
          <p class="sidebar-label">COM reference selection (MDAnalysis)</p>
          <Input
            type="text"
            size="sm"
            bind:value={comSelection}
            className="w-full"
            placeholder="name CA"
            oninput={() => {
              comSelectionValidation = null
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onclick={validateComSelection}
            disabled={validatingComSelection}
          >
            {#if validatingComSelection}
              <Spinner className="mr-1" />
              Validating selection...
            {:else}
              Validate Selection
            {/if}
          </Button>
          {#if comSelectionValidation}
            <p
              class={comSelectionValidation.ok ? 'text-xs text-green-400' : 'text-xs text-red-400'}
            >
              {comSelectionValidation.message}
            </p>
          {/if}
          <p class="sidebar-hint">
            Used to define COM translation target and optional rotation reference atoms.
          </p>
        </div>
        <div class="space-y-1">
          <p class="sidebar-label">COM translation k (kcal/mol/A^2)</p>
          <Input type="number" size="sm" min="0" step="0.1" bind:value={comRestraintK} className="w-full" />
        </div>
        <div class="col-span-2 flex items-center gap-2">
          <Checkbox id="add-rotation-restraint" bind:checked={addRotationRestraint} />
          <label for="add-rotation-restraint" class="sidebar-label">Also generate rotation restraint</label>
        </div>
        {#if addRotationRestraint}
          <div class="space-y-1">
            <p class="sidebar-label">Rotation k (kcal/mol/A^2)</p>
            <Input
              type="number"
              size="sm"
              min="0"
              step="1"
              bind:value={rotationRestraintK}
              className="w-full"
            />
          </div>
        {/if}
      {/if}
    </div>

    <Divider />

    <div class="grid grid-cols-[1fr_--spacing(15)] items-center gap-2">
      <h2 class="sidebar-heading col-span-2">Computational Resources</h2>
      <label for="cpu-cores" class="sidebar-label flex-1">CPU Cores</label>
      <Input id="cpu-cores" type="number" size="sm" bind:value={totalCpus} />

      {#if useGpu}
        <label for="gpu_id" class="sidebar-label">GPU ID</label>
        <Input id="gpu-id" type="number" size="sm" bind:value={gpuDevice} />

        <label for="num-gpus" class="sidebar-label">Number of GPUs</label>
        <Input id="num-gpus" type="number" size="sm" bind:value={totalGpus} />
      {/if}
    </div>

    <Divider />

    <div class="space-y-2">
      <div
        role="group"
        aria-label="Generate equilibration input files action"
        onmouseenter={() => toggleWorkingDirHint(true)}
        onmouseleave={() => toggleWorkingDirHint(false)}
      >
        <Button
          className="w-full"
          variant="outline"
          onclick={generateInput}
          disabled={!canGenerateInput}
          title={formFolderRunning
            ? 'Change the output folder — MD is running in the current one'
            : undefined}
        >
          {#if generatingInputFiles}
            <Spinner className="mr-1" />
            Generating...
          {:else}
            Generate Input Files
          {/if}
        </Button>
      </div>
      <div
        role="group"
        aria-label="Run equilibration action"
        onmouseenter={() => toggleWorkingDirHint(true)}
        onmouseleave={() => toggleWorkingDirHint(false)}
      >
        <Button
          className="w-full"
          onclick={startEquilibration}
          disabled={!canStartEquilibration}
          title={formFolderRunning
            ? 'Change the output folder — MD is running in the current one'
            : formFolderStatus === 'empty'
              ? 'Generate input files first'
              : undefined}
        >
          {#if startingEquilibration}
            <Spinner className="mr-1" />
            Starting…
          {:else}
            Run Equilibration
          {/if}
        </Button>
      </div>
      {#if formFolderRunning && workingDir !== ''}
        <div class="gw-notice gw-notice-warning">
          <p>MD is running in</p>
          <p class="mt-0.5 break-all font-semibold">{resolveOutputFolderName()}</p>
          <p class="mt-1">
            Change the <strong>Output folder</strong> name above to generate inputs or run another
            simulation.
          </p>
        </div>
      {/if}
      {#if formFolderStatus === 'empty' && workingDir !== ''}
        <p class="gw-notice gw-notice-warning">
          Input files have not been generated yet. Click <strong>Generate Input Files</strong> first.
        </p>
      {/if}
      {#if formFolderStatus === 'not_started' && workingDir !== '' && !formFolderRunning}
        <div class="gw-notice gw-notice-success">
          <p>✓ Input files are ready in</p>
          <p class="mt-0.5 break-all font-semibold">{resolveOutputFolderName()}</p>
          <p class="mt-1">Click <strong>Run Equilibration</strong> to proceed.</p>
        </div>
      {/if}
      {#if workingDir === '' && showWorkingDirHint}
        <p class="gw-notice gw-notice-warning">
          Set a <strong>Working Directory</strong> in the top bar to enable these actions.
        </p>
      {/if}
      <Button className="w-full" variant="ghost" onclick={onClear}>Clear</Button>
    </div>
  </aside>
  <div
    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <h1 class="m-4 mb-2 text-xl font-semibold">Equilibration protocol</h1>
    <div class="flex min-h-0 flex-1 flex-col space-y-4 overflow-auto px-4 pb-4">
      <div>
        {#if isProtocolValid}
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{protocol.name}</p>
        {/if}
        <p class="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
          {isProtocolValid ? protocol.description : 'Load a protocol to get started'}
        </p>
        <div class="flex items-center gap-2">
          <p class="text-sm">Ensemble:</p>
          <Select bind:value={ensemble}>
            <option value="npt">NPT</option>
            <option value="nvt">NVT</option>
            <option value="npat">NPAT</option>
            <option value="npgt">NPgT</option>
          </Select>
          <Button variant="outline" onclick={loadProtocol}>Load</Button>
          <Button variant="outline" onclick={saveProtocol}>Save</Button>
        </div>
      </div>
      {#if isProtocolValid}
        <div class="flex min-h-0 w-full flex-1 items-start gap-4 overflow-auto pb-2">
          {#each protocol.stages as _, i (protocol.stages[i].name)}
            <EquilibrationStage
              bind:stage={protocol.stages[i]}
              {ensemble}
              onAddConstraint={() => openConstraintEditorForAdd(i)}
              onEditConstraint={(ci) => openConstraintEditorForEdit(i, ci)}
            />
          {/each}
        </div>
      {:else}
        <Empty message="No protocol loaded" />
      {/if}
    </div>
    <div
      class="flex max-h-2/5 min-h-1/5 flex-col gap-2 overflow-y-auto border-t border-neutral-200 p-4 text-xs dark:border-neutral-800"
    >
      <h3 class="font-semibold uppercase">Progress</h3>
      <div class="flex flex-wrap items-center gap-2">
        <Checkbox name="auto-monitor" size="sm" bind:checked={autoMonitor} />
        <label for="auto-monitor">Update progress every</label>
        <Input
          type="number"
          name="update-interval"
          min="1"
          max="100"
          step="1"
          bind:value={updateInterval}
          size="sm"
          className="w-16"
        />
        <label for="update-interval">seconds</label>
        {#if hasRunningWatched && autoMonitor}
          <Spinner className="mr-1" />
        {/if}
        <Button variant="outline" size="sm" onclick={() => pollWatchedJobs({ scheduleNext: false })}>
          Refresh
        </Button>
      </div>

      <h4 class="mt-1 font-semibold text-neutral-800 dark:text-neutral-200">Equilibration Jobs</h4>
      {#if jobs.length === 0}
        <p
          class="flex items-center justify-center rounded-lg border border-dashed border-neutral-300 p-4 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
        >
          No equilibration runs found under the working directory. Generate input files or run an MD job to see it here.
        </p>
      {:else}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {#each jobs as job, ji (job.jobDir)}
            <div class="gw-notice flex min-w-0 flex-col rounded-lg p-3 {jobNoticeClass(job.status)}">
              <div class="mb-2 flex items-center justify-between gap-2">
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {#if job.status === 'running'}
                    <span class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-yellow-500"></span>
                  {:else if job.status === 'completed'}
                    <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500"></span>
                  {:else if job.status === 'error'}
                    <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
                  {:else if job.status === 'not_started'}
                    <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500"></span>
                  {:else}
                    <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-neutral-500"></span>
                  {/if}
                  <span
                    class="min-w-0 font-semibold text-neutral-900 wrap-break-word dark:text-neutral-200"
                    title={job.jobDir}>{job.name}</span
                  >
                  <span class="gw-chip shrink-0 uppercase">{job.engine}</span>
                  {#if job.ensemble}
                    <span class="gw-chip shrink-0 uppercase">{job.ensemble}</span>
                  {/if}
                  {#if job.variant}
                    <span class="gw-chip shrink-0">{job.variant}</span>
                  {/if}
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="tabular-nums dark:text-neutral-500">{job.elapsed}</span>
                  {#if job.status !== 'running'}
                    <button
                      class="dark:text-neutral-600 dark:hover:text-neutral-300"
                      onclick={() => removeJob(ji)}
                      title="Remove">&times;</button
                    >
                  {/if}
                </div>
              </div>

              {#if formatJobResources(job.resources)}
                <p class="mb-2 break-all text-xs text-neutral-500" title="Resources assigned in generated inputs">
                  {formatJobResources(job.resources)}
                </p>
              {/if}

              {#if job.stagesTotal > 0 && (job.stagesDone > 0 || job.status !== 'not_started')}
                <div class="mb-2 flex gap-1">
                  {#each Array(job.stagesTotal) as _, si (si)}
                    {@const done = si < job.stagesDone || job.status === 'completed'}
                    {@const active =
                      job.status === 'running' && !done && si === job.stagesDone}
                    <div class="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
                      <div
                        class="h-full transition-all duration-300 {done
                          ? 'bg-green-600'
                          : active
                            ? 'bg-blue-500'
                            : 'bg-transparent'}"
                        style="width: {done ? '100%' : active ? '50%' : '0%'}"
                      ></div>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if job.stagesTotal > 0}
                <p class="mb-2 text-neutral-500">
                  {#if job.status === 'running'}
                    {job.stagesDone}/{job.stagesTotal} stages · running
                  {:else if job.status === 'not_started' && job.stagesDone === 0 && !job.canResume}
                    {job.stagesTotal} stages · inputs ready — not started yet
                  {:else if job.canResume || job.status === 'error'}
                    {job.stagesDone}/{job.stagesTotal} stages · interrupted
                  {:else}
                    {job.stagesDone}/{job.stagesTotal} stages
                  {/if}
                </p>
              {/if}

              <div class="flex flex-wrap gap-2">
                <Button
                  variant={job.watched ? 'default' : 'outline'}
                  size="sm"
                  onclick={() => toggleJobWatch(ji)}
                >
                  {job.watched ? 'Watching' : 'Watch'}
                </Button>
                <Button variant="outline" size="sm" onclick={() => useJobInForm(job)}>
                  Use in form
                </Button>
                <Button variant="outline" size="sm" onclick={() => toggleJobProcessInfo(ji)}>
                  {job.showInfo ? 'Hide Info' : 'Info'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => reloadJobCard(ji)}
                  disabled={job.reloading}
                  title="Re-read job metadata from disk (e.g. after editing equilibration_resources.json)"
                >
                  {job.reloading ? 'Reloading…' : 'Reload'}
                </Button>
                {#if job.status === 'running'}
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() => killJob(ji)}
                    disabled={job.stopping}
                  >
                    {job.stopping ? 'Stopping…' : 'Kill MD'}
                  </Button>
                {:else if job.canResume && job.status !== 'completed'}
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() => continueJob(ji)}
                    disabled={job.continuing}
                    title={job.resumeReason || 'Skip completed stages; incomplete stages restart from the beginning'}
                  >
                    {job.continuing ? 'Starting…' : 'Continue'}
                  </Button>
                {:else if job.canRun}
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() => runJob(ji)}
                    disabled={job.running}
                    title="Run the full equilibration protocol from stage 1"
                  >
                    {job.running ? 'Starting…' : 'Run'}
                  </Button>
                {/if}
              </div>

              {#if job.showInfo}
                <div
                  class="mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {#if job.loadingProcessInfo}
                    <span class="text-neutral-400">Loading…</span>
                  {:else if job.processInfo}
                    <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <span class="text-neutral-500">Engine</span>
                      <span class="uppercase">{job.processInfo.engine}</span>
                      <span class="text-neutral-500">Directory</span>
                      <span class="truncate font-mono" title={job.processInfo.working_dir}
                        >{job.processInfo.working_dir}</span
                      >
                      <span class="text-neutral-500">PID</span>
                      <span>{job.processInfo.pid ?? '—'}</span>
                      <span class="text-neutral-500">Status</span>
                      <span class={job.processInfo.running ? 'text-green-400' : 'text-neutral-400'}
                        >{job.processInfo.running ? 'Running' : 'Not running'}</span
                      >
                      {#if job.processInfo.start_time}
                        <span class="text-neutral-500">Started</span>
                        <span>{new Date(job.processInfo.start_time).toLocaleString()}</span>
                      {/if}
                      {#if job.processInfo.command}
                        <span class="text-neutral-500">Command</span>
                        <span class="truncate font-mono text-neutral-300" title={job.processInfo.command}
                          >{job.processInfo.command}</span
                        >
                      {/if}
                    </div>
                  {:else}
                    <span class="text-neutral-400">No process information available.</span>
                  {/if}
                </div>
              {/if}

              {#if job.watched}
                <div
                  class="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-700"
                >
                  {#if job.stages.length > 0}
                    {@const totals = jobSimulatedTotals(job.stages)}
                    <p class="mb-2 text-neutral-500">
                      Simulated: {formatNs(totals.sim)} / {formatNs(totals.total)} ns
                    </p>
                    <div class="flex flex-col gap-1">
                      {#each job.stages as stage_info (stage_info.name)}
                        <EquilibrationStageStatus
                          {stage_info}
                          compact
                          tracking={job.status === 'running' && autoMonitor}
                        />
                      {/each}
                    </div>
                    {#if job.status === 'error' && job.equilibrationOutput}
                      <pre
                        class="mt-2 max-h-32 overflow-auto rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
                        >{job.equilibrationOutput}</pre
                      >
                    {/if}
                  {:else if job.status === 'not_started'}
                    <p class="text-neutral-500">Inputs ready — not started yet.</p>
                  {:else}
                    <p class="text-neutral-500">No stage detail yet.</p>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if constraintEditor}
    {#key `${constraintEditor.stageIndex}-${constraintEditor.constraintIndex}-${constraintEditor.source?.id ?? 'new'}`}
      <ConstraintEditor
        source={constraintEditor.source}
        onDismiss={dismissConstraintEditor}
        onAccept={acceptConstraint}
        onDelete={constraintEditor.constraintIndex >= 0 ? deleteConstraintFromEditor : undefined}
        onSelect={countMatchingAtoms}
      />
    {/key}
  {/if}
</div>

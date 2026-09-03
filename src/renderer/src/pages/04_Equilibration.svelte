<script>
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import { equilibrationPageStatus, logEvent } from '../lib/pageStatus.svelte.js'
  import ConstraintEditor from '../components/ConstraintEditor.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import EquilibrationStage from '../components/EquilibrationStage.svelte'
  import EquilibrationStageStatus from '../components/EquilibrationStageStatus.svelte'
  import RunOnClusterDialog from '../components/RunOnClusterDialog.svelte'
  import PullSyncRing from '../components/PullSyncRing.svelte'
  import baseProtocol from '../../../../resources/protocols/base.json'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import ResetIcon from '../components/icons/Reset.svelte'
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
    getStructure,
    clusterJobStatus,
    clusterCancelPull,
    clusterPullJobStream,
    clusterJobFolderSizes,
    listEquilibrationJobFiles,
    getEquilibrationJobLog
  } from '../lib/backendApi'
  import { loadClusterProfiles } from '../lib/clusterProfiles.js'
  import { clusterProfilesStore } from '../lib/clusterProfilesStore.svelte.js'
  import {
    connectSharedCluster,
    disconnectSharedCluster,
    getClusterSession,
    sharedProfilePlain
  } from '../lib/clusterSession.svelte.js'
  import { formatClusterConnectError } from '../lib/clusterConnectError.js'
  import {
    canonicalizeSlurmState,
    isSlurmActiveState,
    isSlurmPendingState,
    isSlurmRunningState,
    partialPullConfirmMessage,
    isSlurmTerminalState
  } from '../lib/slurmState.js'
  import OutputPathFields from '../components/OutputPathFields.svelte'
  import {
    defaultEquilibrationFolderName,
    outputFolderPath,
    parentDirPath,
    uniqueDirList
  } from '../lib/outputFolders.js'
  import {
    extractPullSpeedFromMessage,
    formatByteSize,
    formatPullStatusLine,
    formatPullTransferText,
    isPullCancelledError,
    jobPullDisplayPercent,
    mergePullLocalBytes,
    pullEventPercent
  } from '../lib/clusterPullProgress.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'
  import { formEnsembleValue } from '../lib/ensemble.js'
  import { syncProtocolToSidebarEnsemble } from '../lib/equilibrationStageFields.js'
  import { summarizeProtocolStage } from '../lib/equilibrationProtocolSummary.js'

  const clusterSession = getClusterSession()

  /** Shown when Equilibration → Connect is disabled (no cluster profiles yet). */
  const CLUSTER_CONNECT_DISABLED_HINT =
    'Add a cluster profile in Settings (gear icon) → Clusters to connect to remote HPC systems.'

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

  /** Engine-specific default compute profiles (sidebar + per-stage cards). */
  const ENGINE_RESOURCE_PROFILES = {
    gromacs: {
      sidebar: { totalCpus: 6, totalGpus: 1, gpuId: 0, computeTarget: /** @type {const} */ ('auto') },
      minimization: { cpu_cores: 6, gpu_id: 0, num_gpus: 0, use_gpu: false },
      md: { cpu_cores: 6, gpu_id: 0, num_gpus: 1, use_gpu: true },
      production: { cpu_cores: 6, gpu_id: 0, num_gpus: 1, use_gpu: true }
    },
    amber: {
      // MD/production on GPU (pmemd.cuda); first packing barostat forced to CPU below.
      sidebar: { totalCpus: 6, totalGpus: 1, gpuId: 0, computeTarget: /** @type {const} */ ('auto') },
      minimization: { cpu_cores: 6, gpu_id: 0, num_gpus: 0, use_gpu: false },
      md: { cpu_cores: 1, gpu_id: 0, num_gpus: 1, use_gpu: true },
      production: { cpu_cores: 1, gpu_id: 0, num_gpus: 1, use_gpu: true }
    },
    namd: {
      sidebar: { totalCpus: 6, totalGpus: 1, gpuId: 0, computeTarget: /** @type {const} */ ('auto') },
      minimization: { cpu_cores: 6, gpu_id: 0, num_gpus: 0, use_gpu: false },
      md: { cpu_cores: 6, gpu_id: 0, num_gpus: 1, use_gpu: true },
      production: { cpu_cores: 6, gpu_id: 0, num_gpus: 1, use_gpu: true }
    },
    openmm: {
      // OpenMM uses a single host thread; GPU for minimization + all MD stages.
      sidebar: { totalCpus: 1, totalGpus: 1, gpuId: 0, computeTarget: /** @type {const} */ ('auto') },
      minimization: { cpu_cores: 1, gpu_id: 0, num_gpus: 1, use_gpu: true },
      md: { cpu_cores: 1, gpu_id: 0, num_gpus: 1, use_gpu: true },
      production: { cpu_cores: 1, gpu_id: 0, num_gpus: 1, use_gpu: true }
    }
  }

  /**
   * Amber: first packing barostat (NPT/NPAT/NPgT) defaults to CPU×6 pmemd;
   * later MD stages stay on GPU. Matches API resolve_all_stage_resources.
   * @param {object} p
   */
  function applyAmberFirstBarostatCpuDefault(p) {
    if (!p?.stages) return
    for (const stage of p.stages) {
      const kind = String(stage.stage_kind || '').toLowerCase()
      const name = String(stage.name || '').toLowerCase()
      if (kind === 'minimization' || name === 'minimization') continue
      if (kind === 'production' || name === 'production') continue
      const ens = String(stage.ensemble || '').trim().toLowerCase()
      if (!['npt', 'npat', 'npgt'].includes(ens)) continue
      stage.cpu_cores = Math.max(Number(stage.cpu_cores) || 1, 6)
      stage.use_gpu = false
      stage.num_gpus = 0
      stage.resources_inherit = false
      break
    }
  }

  /** @param {string} eng */
  function applyEngineResourceDefaults(eng) {
    const profile = ENGINE_RESOURCE_PROFILES[eng] ?? ENGINE_RESOURCE_PROFILES.namd
    totalCpus = profile.sidebar.totalCpus
    totalGpus = profile.sidebar.totalGpus
    gpuDevice = profile.sidebar.gpuId ?? 0
    computeTarget = profile.sidebar.computeTarget
    protocol.compute_defaults = {
      cpu_cores: eng === 'amber' ? profile.md.cpu_cores : profile.sidebar.totalCpus,
      gpu_id: gpuDevice,
      num_gpus: profile.sidebar.totalGpus,
      use_gpu: profile.sidebar.computeTarget !== 'CPU',
      compute_target: computeTarget
    }
    for (const stage of protocol.stages ?? []) {
      const kind = String(stage.stage_kind || '').toLowerCase()
      const name = String(stage.name || '').toLowerCase()
      const isMini =
        kind === 'minimization' || name === 'minimization' || name === 'energy minimization'
      const isProd = kind === 'production' || name === 'production'
      const res = isMini ? profile.minimization : isProd ? profile.production : profile.md
      stage.cpu_cores = res.cpu_cores
      stage.gpu_id = res.gpu_id
      stage.num_gpus = res.num_gpus
      stage.use_gpu = res.use_gpu
      stage.resources_inherit = false
    }
    if (eng === 'amber') applyAmberFirstBarostatCpuDefault(protocol)
    // After Use in form, Production must re-bind to the sidebar ensemble
    // and engine-specific fields (margin, γ, …) must be available for the new engine.
    syncProtocolToSidebarEnsemble(protocol, ensemble, eng)
    protocolFormKey += 1
  }

  /** Re-bind production stages to the sidebar ensemble and remount cards. */
  function onSidebarEnsembleChange() {
    syncProtocolToSidebarEnsemble(protocol, ensemble, engine)
    // Remount so Ensemble fields and pressure/γ visibility refresh for the new target
    protocolFormKey += 1
  }

  onMount(() => {
    applyEngineResourceDefaults(engine)
  })

  /** @type {{ workingDir?: string, pageActive?: boolean }} */
  let { workingDir = '', pageActive = false } = $props()

  /** Max parallel equilibration-job API calls after a directory scan. */
  const JOBS_PREFETCH_CONCURRENCY = 3

  /**
   * Run async tasks with a concurrency limit.
   * @param {Array<() => Promise<unknown>>} tasks
   * @param {number} [limit]
   */
  async function runWithConcurrency(tasks, limit = JOBS_PREFETCH_CONCURRENCY) {
    if (!tasks.length) return
    const queue = [...tasks]
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const task = queue.shift()
        if (task) await task()
      }
    })
    await Promise.all(workers)
  }

  // form fields
  let autoMonitor = $state(false)
  let engine = $state('namd')
  let ensemble = $state('npt')
  let gpuDevice = $state(0)
  let inputDir = $state('')
  let outputName = $state('')
  /** Parent directory for equilibration output; defaults to the top-bar working directory. */
  let outputParentDir = $state('')
  let computeTarget = $state(/** @type {'auto' | 'CPU' | 'CUDA' | 'OpenCL' | 'Metal'} */ ('auto'))
  let totalCpus = $state(1)
  let totalGpus = $state(1)
  let protocol = $state(prepareProtocolForRendering(structuredClone(baseProtocol)))
  /** Bumped when loading a job into the form so stage cards remount with new values. */
  let protocolFormKey = $state(0)
  /** Protocol stage cards expanded; when false, show compact step summary strip. */
  let protocolSectionExpanded = $state(true)

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

  const suggestedOutputFolderName = $derived(
    inputDir ? defaultEquilibrationFolderName(inputDir) : '03_equilibration'
  )

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
  /** NAMD GPU-resident (GPUresident); default on when using GPU */
  let gpuResident = $state(true)
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
  /** True when the input structure has protein atoms; null until counted. */
  let hasProtein = $state(/** @type {boolean | null} */ (null))
  let loadingSystemSize = $state(false)
  /** Bumped whenever inputDir is (re)assigned so the size loader re-runs for the same path. */
  let inputDirRevision = $state(0)
  let updateInterval = $state(60)
  /** @type {'all' | 'local' | 'remote'} */
  let progressFilter = $state(/** @type {'all' | 'local' | 'remote'} */ ('all'))
  /** @type {'all' | 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'ready'} */
  let progressStatusFilter = $state(
    /** @type {'all' | 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'ready'} */ (
      'all'
    )
  )
  /** Order Progress cards by job folder generation time (directory mtime). */
  let progressSortOrder = $state(/** @type {'newest' | 'oldest'} */ ('newest'))
  /** @type {{ jobDir: string, jobName: string, engine: string, cpus: number, gpus: number, execution: object|null } | null} */
  let clusterDialogJob = $state(null)
  /** Progress-strip cluster connect */
  /** @type {any[]} */
  let progressClusterProfiles = $state([])
  let progressClusterProfileId = $state('')
  let progressClusterPassword = $state('')

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
  const resolvedOutputParent = $derived((outputParentDir.trim() || workingDir).trim())
  const outputDir = $derived(outputFolderPath(resolvedOutputParent, resolveOutputFolderName()))
  const formJob = $derived(jobs.find((j) => j.jobDir === outputDir))
  const formFolderStatus = $derived(formJob?.status ?? 'empty')
  const formFolderRunning = $derived(formJob?.status === 'running')
  const formFolderHasInputs = $derived(formFolderStatus !== 'empty')
  const canGenerateInput = $derived(
    resolvedOutputParent !== '' &&
      inputDir !== '' &&
      isProtocolValid &&
      isEngineSupported &&
      !generatingInputFiles &&
      !formFolderRunning
  )
  const canStartEquilibration = $derived(
    resolvedOutputParent !== '' &&
      formFolderStatus !== 'empty' &&
      formFolderStatus !== 'running' &&
      isEngineSupported &&
      !startingEquilibration
  )
  const selectedExecutable = $derived(executableByEngine[engine] ?? '')
  const computeDefaults = $derived({
    cpu_cores: totalCpus,
    gpu_id: gpuDevice,
    num_gpus: totalGpus,
    use_gpu: useGpu,
    compute_target: computeTarget
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
  /** @typedef {{ name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, elapsed_time_seconds: number|null, is_minimization?: boolean, steps_completed?: number|null, total_steps?: number|null, minimization_converged_early?: boolean, output: string, cpu_cores?: number|null, num_gpus?: number|null }} EqStageInfo */
  /** @typedef {{ jobDir: string, name: string, engine: string, variant: string|null, status: string, startTime: string, dirMtime?: number, elapsed: string, stagesDone: number, stagesTotal: number, error: string|null, canRun: boolean, canResume: boolean, resumeReason: string, resumeStageName: string, resources: import('../lib/backendApi.js').EquilibrationJobResources | null, inputDir: string|null, ensemble: string|null, protocol: { name: string, description?: string, stages: object[] }|null, gpuResident?: boolean|null, execution: object|null, stages: EqStageInfo[], watched: boolean, showStages: boolean, showInfo: boolean, processInfo: { pid: number|null, running: boolean, command: string|null, start_time: string|null, working_dir: string, engine: string } | null, loadingProcessInfo: boolean, stopping: boolean, continuing: boolean, running: boolean, reloading: boolean, pulling: boolean, pullProgress: { percent: number|null, message: string, phase: string, speed?: string|null } | null, syncSizes: { localBytes: number|null, remoteBytes: number|null, localFormatted: string, remoteFormatted: string, loading: boolean } | null, selectedLog: string|null, logMode: 'head'|'tail', logLines: number, logLinesEditing: boolean, logFiles: string[], logView: { lines: string[], exists: boolean, loading: boolean, mode: string, lineCount: number } | null, loadingStages: boolean, syncingRemoteStages: boolean, equilibrationOutput: string }} EquilibrationJob */

  // state
  /** @type {null | { stageIndex: number, constraintIndex: number, source: Constraint | null }} */
  let constraintEditor = $state(null)
  /** True after form folder status has been read from the backend (or input was just generated). */
  let statusSynced = $state(false)
  let generatingInputFiles = $state(false)
  let startingEquilibration = $state(false)
  /** True while scanning the working directory for equilibration job folders. */
  let loadingJobs = $state(false)
  /** Job dir currently loading into the left-hand form via Use in form. */
  let usingInFormDir = $state(/** @type {string | null} */ (null))
  /** Last job successfully loaded into the form (persistent card highlight). */
  let formSourceJobDir = $state(/** @type {string | null} */ (null))
  /** @type {EquilibrationJob[]} */
  let jobs = $state([])
  /** @type {Map<string, AbortController>} */
  const pullAbortByJobDir = new Map()
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollIntervalId = null
  /** Guards overlapping directory scans when the working directory changes quickly. */
  let jobsScanGeneration = 0

  /** @param {unknown} raw */
  function normalizeEngineId(raw) {
    const e = String(raw || '')
      .trim()
      .toLowerCase()
    return ['namd', 'gromacs', 'openmm', 'amber'].includes(e) ? e : ''
  }

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
    if (!Number.isFinite(start)) return ''
    const end = endIso ? new Date(endIso).getTime() : Date.now()
    const s = Math.max(0, Math.round((end - start) / 1000))
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`
    if (m > 0) return `${m}m ${s % 60}s`
    return `${s}s`
  }

  /** Generation / start timestamp for the card header (not wall-clock elapsed). */
  function formatJobGenerated(startIso) {
    if (!startIso) return ''
    const d = new Date(startIso)
    if (!Number.isFinite(d.getTime())) return ''
    try {
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return d.toISOString().slice(0, 16).replace('T', ' ')
    }
  }

  /** Local generate time, or cluster submit time for remote jobs without a local stamp. */
  /** @param {EquilibrationJob} job */
  function jobGeneratedIso(job) {
    return job.startTime || String(job.execution?.submitted_at || '').trim() || ''
  }

  /** Sum of per-stage MD elapsed seconds from logs (actual compute time, not calendar since generate). */
  function formatStagesMdElapsed(stages) {
    if (!stages?.length) return ''
    let total = 0
    let any = false
    for (const s of stages) {
      if (Number.isFinite(s.elapsed_time_seconds) && s.elapsed_time_seconds > 0) {
        total += s.elapsed_time_seconds
        any = true
      }
    }
    if (!any) return ''
    const sec = Math.round(total)
    const m = Math.floor(sec / 60)
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}h ${m % 60}m ${sec % 60}s`
    if (m > 0) return `${m}m ${sec % 60}s`
    return `${sec}s`
  }

  function formatNs(value) {
    if (!Number.isFinite(value)) return '—'
    return value.toFixed(value > 1 ? 2 : 3)
  }

  /** @param {import('../lib/backendApi.js').EquilibrationJobResources | null | undefined} resources */
  function formatJobResources(resources) {
    if (!resources) return ''
    if (resources.summary) return resources.summary
    const slurm = resources.slurm
    if (slurm?.cpu_cores != null) {
      const gpuPart =
        slurm.use_gpu && slurm.num_gpus ? ` · GPU×${slurm.num_gpus}` : ''
      return `Slurm CPU×${slurm.cpu_cores}${gpuPart}`
    }

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

  /** Card resource line: prefer cluster submit / Slurm allocation when remote. */
  /** @param {EquilibrationJob} job */
  function formatJobCardResources(job) {
    const exec = job.execution
    if (exec?.mode === 'remote') {
      const parts = []
      // Never fall back to local equilibration_resources.json for remote CPUs —
      // that file is the generate-time default (often 6), not the sbatch request.
      const cpus = Number(exec.allocated_cpus) || Number(exec.resources?.cpus) || 0
      if (cpus > 0) parts.push(`${cpus} CPU`)
      const gpus = Number(exec.resources?.gpus) || 0
      const gpuLabel = String(exec.node_gpu_label || '').trim()
      if (gpus > 0 && gpuLabel) {
        parts.push(gpus > 1 ? `${gpus}× ${gpuLabel}` : gpuLabel)
      } else if (gpus > 0) {
        parts.push(gpus === 1 ? '1 GPU' : `${gpus} GPU`)
      } else if (gpuLabel) {
        parts.push(gpuLabel)
      }
      const node = String(exec.node_list || '').split(',')[0].trim()
      if (node) parts.push(`node ${node}`)
      if (parts.length) return parts.join(' · ')
      return formatJobResources(job.resources)
    }
    return formatJobResources(job.resources)
  }

  /** @param {EquilibrationJob} job */
  function remoteSchedulerRunning(job) {
    return isSlurmActiveState(job.execution?.last_remote_state)
  }

  /** @param {EquilibrationJob} job */
  function remoteSchedulerPending(job) {
    return (
      job.execution?.mode === 'remote' && isSlurmPendingState(job.execution?.last_remote_state)
    )
  }

  /** @param {EquilibrationJob} job */
  function remoteSchedulerRunningOnly(job) {
    return (
      job.execution?.mode === 'remote' && isSlurmRunningState(job.execution?.last_remote_state)
    )
  }

  /** @param {EquilibrationJob} job */
  function remoteSchedulerStatusClass(job) {
    if (remoteSchedulerPending(job)) return 'text-amber-600 dark:text-amber-400'
    if (remoteSchedulerRunningOnly(job)) return 'text-green-400'
    return 'text-neutral-400'
  }

  /** Protocol stage placeholders when cluster logs are not local yet. */
  /** @param {EquilibrationJob} job @returns {EqStageInfo[]} */
  function protocolPlaceholderStages(job) {
    const defs = job.protocol?.stages
    if (!Array.isArray(defs) || !defs.length) return []
    return defs.map((s, i) => {
      const res = resolveStageResourceChips(job, String(s.name || 'Stage'), i)
      const kind = inferProtocolStageKind(s)
      const isMin = kind === 'minimization'
      const minSteps = isMin ? Number(s.minimize_steps) || Number(s.steps) || null : null
      const timeNs = Number(s.time_ns)
      return {
        name: String(s.name || 'Stage'),
        status: /** @type {'not_started'} */ ('not_started'),
        simulated_time: null,
        total_simulation_time:
          !isMin && Number.isFinite(timeNs) && timeNs > 0 ? timeNs : null,
        performance: null,
        elapsed_time_seconds: null,
        is_minimization: isMin,
        steps_completed: null,
        total_steps: isMin && minSteps > 0 ? minSteps : null,
        output: '',
        cpu_cores: res?.cpu_cores ?? null,
        num_gpus: res?.num_gpus ?? null
      }
    })
  }

  /** @param {EquilibrationJob} job @param {string} stageName @param {number} [_index] */
  function findProtocolStageDef(job, stageName, _index = -1) {
    const defs = job.protocol?.stages
    if (!Array.isArray(defs) || !defs.length) return null
    const key = normalizeStageKey(stageName)
    return defs.find((s) => normalizeStageKey(s?.name) === key) ?? null
  }

  /** Sum of planned MD time (ns) across all non-minimization protocol stages. */
  /** @param {EquilibrationJob} job */
  function protocolPlannedMdNs(job) {
    const defs = job.protocol?.stages
    if (!Array.isArray(defs) || !defs.length) return null
    let total = 0
    let any = false
    for (const def of defs) {
      if (inferProtocolStageKind(def) === 'minimization') continue
      const timeNs = Number(def.time_ns)
      if (Number.isFinite(timeNs) && timeNs > 0) {
        total += timeNs
        any = true
      }
    }
    return any ? total : null
  }

  /** Merge live log stages with the full protocol outline (intended times for pending stages). */
  /** @param {EquilibrationJob} job @param {EqStageInfo[]} liveStages */
  function mergeLiveStagesWithProtocolOutline(job, liveStages) {
    const outline = protocolPlaceholderStages(job)
    if (!outline.length) return liveStages
    if (!liveStages?.length) return outline
    const liveByKey = new Map()
    for (const s of liveStages) {
      if (!s) continue
      liveByKey.set(normalizeStageKey(s.name), s)
    }
    /** @type {EqStageInfo[]} */
    const merged = []
    const usedLiveKeys = new Set()
    for (const placeholder of outline) {
      const key = normalizeStageKey(placeholder.name)
      // Match by name only — never by index. Protocol often starts with Minimization
      // while OpenMM/NAMD live progress starts at Equilibration 1; index fallback
      // duplicated Eq1 and broke the keyed {#each} on stage name.
      const live = liveByKey.get(key) ?? null
      if (!live) {
        merged.push(placeholder)
        continue
      }
      usedLiveKeys.add(key)
      merged.push({
        ...placeholder,
        ...live,
        // Keep protocol display name so keys stay unique and match the outline.
        name: placeholder.name,
        total_simulation_time:
          live.total_simulation_time ?? placeholder.total_simulation_time,
        total_steps: live.total_steps ?? placeholder.total_steps,
        is_minimization: live.is_minimization ?? placeholder.is_minimization,
        cpu_cores: live.cpu_cores ?? placeholder.cpu_cores,
        num_gpus: live.num_gpus ?? placeholder.num_gpus
      })
    }
    // Append any live stages that are not in the protocol outline.
    for (const s of liveStages) {
      if (!s) continue
      const key = normalizeStageKey(s.name)
      if (usedLiveKeys.has(key)) continue
      merged.push(s)
    }
    return merged
  }

  /** Fill protocol planned time/steps and resource chips on stage rows for display. */
  /** @param {EquilibrationJob} job @param {EqStageInfo[]} stages */
  function enrichStagesForDisplay(job, stages) {
    return stages.map((s, i) => {
      let next = { ...s }
      const def = findProtocolStageDef(job, s.name, i)
      if (next.cpu_cores == null || next.num_gpus == null) {
        const res = resolveStageResourceChips(job, s.name, i)
        if (res) {
          if (next.cpu_cores == null) next.cpu_cores = res.cpu_cores
          if (next.num_gpus == null) next.num_gpus = res.num_gpus
        }
      }
      if (def) {
        const kind = inferProtocolStageKind(def)
        if (kind === 'minimization') {
          next.is_minimization = true
          if (next.total_steps == null) {
            const steps = Number(def.minimize_steps) || Number(def.steps)
            if (steps > 0) next.total_steps = steps
          }
        } else if (next.total_simulation_time == null) {
          const timeNs = Number(def.time_ns)
          if (Number.isFinite(timeNs) && timeNs > 0) next.total_simulation_time = timeNs
        }
      }
      return next
    })
  }

  /** @param {string|null|undefined} name */
  function normalizeStageKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[_\s-]+/g, ' ')
      .trim()
  }

  /** @param {Record<string, any>} stage */
  function inferProtocolStageKind(stage) {
    const explicit = String(stage?.stage_kind || '')
      .trim()
      .toLowerCase()
    if (explicit === 'minimization' || explicit === 'production' || explicit === 'equilibration') {
      return explicit
    }
    const name = normalizeStageKey(stage?.name)
    if (name === 'minimization' || name === 'energy minimization') return 'minimization'
    if (name === 'production') return 'production'
    return 'equilibration'
  }

  /**
   * Planned CPU/GPU for a stage from the job protocol (not live Slurm use).
   * Resolves ``resources_inherit`` from protocol.compute_defaults — equilibration
   * stages in base.json omit cpu_cores/num_gpus on purpose.
   * @param {EquilibrationJob} job
   * @param {string} stageName
   * @param {number} index
   * @returns {{ cpu_cores: number, num_gpus: number } | null}
   */
  function resolveStageResourceChips(job, stageName, index) {
    const defs = job.protocol?.stages
    if (!Array.isArray(defs) || !defs.length) return null
    const key = normalizeStageKey(stageName)
    const def =
      defs.find((s) => normalizeStageKey(s?.name) === key) ||
      (index >= 0 && index < defs.length ? defs[index] : null)
    if (!def || typeof def !== 'object') return null

    const defaults =
      job.protocol?.compute_defaults && typeof job.protocol.compute_defaults === 'object'
        ? job.protocol.compute_defaults
        : {}
    const kind = inferProtocolStageKind(def)
    const hasExplicit = ['cpu_cores', 'gpu_id', 'num_gpus', 'use_gpu'].some(
      (k) => def[k] != null
    )
    let inherit = def.resources_inherit
    if (inherit == null) {
      inherit = kind === 'equilibration' && !hasExplicit
    }

    let cpus =
      def.cpu_cores != null && Number.isFinite(Number(def.cpu_cores))
        ? Math.max(0, Math.round(Number(def.cpu_cores)))
        : null
    let useGpu = typeof def.use_gpu === 'boolean' ? def.use_gpu : null
    let gpus =
      def.num_gpus != null && Number.isFinite(Number(def.num_gpus))
        ? Math.max(0, Math.round(Number(def.num_gpus)))
        : null

    if (kind === 'minimization') {
      // Non-OpenMM minimization is CPU-only in GateWizard.
      if ((job.engine || '').toLowerCase() !== 'openmm') {
        useGpu = false
        gpus = 0
      }
      if (cpus == null) {
        cpus =
          Number(defaults.cpu_cores) > 0
            ? Math.round(Number(defaults.cpu_cores))
            : Number(job.resources?.cpu_cores_max) > 0
              ? Math.round(Number(job.resources.cpu_cores_max))
              : 6
      }
    } else if (inherit || cpus == null || useGpu == null || gpus == null) {
      if (cpus == null) {
        cpus =
          Number(defaults.cpu_cores) > 0
            ? Math.round(Number(defaults.cpu_cores))
            : Number(job.resources?.cpu_cores_max) > 0
              ? Math.round(Number(job.resources.cpu_cores_max))
              : Number(job.resources?.cpu_cores_min) > 0
                ? Math.round(Number(job.resources.cpu_cores_min))
                : 1
      }
      if (useGpu == null) {
        useGpu =
          typeof defaults.use_gpu === 'boolean'
            ? defaults.use_gpu
            : typeof job.resources?.use_gpu === 'boolean'
              ? job.resources.use_gpu
              : true
      }
      if (gpus == null) {
        if (!useGpu) gpus = 0
        else if (Number(defaults.num_gpus) > 0) gpus = Math.round(Number(defaults.num_gpus))
        else if (Number(job.resources?.num_gpus) > 0) gpus = Math.round(Number(job.resources.num_gpus))
        else gpus = 1
      }
    }

    if (useGpu === false) gpus = 0
    else if (gpus == null) gpus = 1

    return {
      cpu_cores: cpus ?? 0,
      num_gpus: gpus ?? 0
    }
  }

  /** Stages from logs when present; otherwise protocol outline for remote cards. */
  /** @param {EquilibrationJob} job @returns {EqStageInfo[]} */
  function jobDisplayStages(job) {
    const merged = job.stages?.length
      ? mergeLiveStagesWithProtocolOutline(job, job.stages)
      : protocolPlaceholderStages(job)
    return enrichStagesForDisplay(job, merged)
  }

  /**
   * Progress-list status bucket for filtering (local + remote Slurm).
   * @param {EquilibrationJob} job
   * @returns {'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'ready'}
   */
  function jobProgressStatus(job) {
    const remote = job.execution?.mode === 'remote'
    const rs = job.execution?.last_remote_state
    if (remote && rs) {
      const canon = canonicalizeSlurmState(rs)
      if (isSlurmPendingState(rs)) return 'pending'
      if (canon === 'CANCELLED') return 'cancelled'
      if (canon === 'COMPLETED' || remoteJobFinishedLocally(job)) return 'completed'
      if (
        ['FAILED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY', 'PREEMPTED', 'BOOT_FAIL'].includes(
          canon
        )
      ) {
        return 'failed'
      }
      if (isSlurmActiveState(rs)) return 'running'
    }
    if (job.status === 'running') return 'running'
    if (job.status === 'completed') return 'completed'
    if (job.status === 'error') return 'failed'
    return 'ready'
  }

  function jobHasBatchScript(job) {
    return Boolean(job?.hasBatchScript || job?.execution?.batch_script)
  }

  function jobCanSyncCluster(job) {
    return job?.execution?.mode === 'remote' || jobHasBatchScript(job)
  }

  /** @param {'all' | 'local' | 'remote'} loc @param {typeof progressStatusFilter} st */
  function progressFilterEmptyLabel(loc, st) {
    const parts = []
    if (loc !== 'all') parts.push(loc)
    if (st !== 'all') {
      const labels = {
        pending: 'pending',
        running: 'running',
        completed: 'completed',
        cancelled: 'cancelled',
        failed: 'failed',
        ready: 'ready'
      }
      parts.push(labels[st] || st)
    }
    return parts.length ? parts.join(' · ') : 'matching'
  }

  /** Max CPU/GPU across protocol stages (Slurm allocation). */
  /** @param {EquilibrationJob} job */
  function jobProtocolSlurmAllocation(job) {
    const defs = job.protocol?.stages
    if (!Array.isArray(defs) || !defs.length) return null
    let maxCpus = 0
    let maxGpus = 0
    for (let i = 0; i < defs.length; i++) {
      const res = resolveStageResourceChips(job, defs[i]?.name, i)
      if (!res) continue
      if (res.cpu_cores > 0) maxCpus = Math.max(maxCpus, res.cpu_cores)
      if (res.num_gpus > 0) maxGpus = Math.max(maxGpus, res.num_gpus)
    }
    if (maxCpus <= 0 && maxGpus <= 0) return null
    return {
      cpus: Math.max(1, maxCpus || 1),
      gpus: Math.max(0, maxGpus)
    }
  }

  /** @param {EquilibrationJob} job */
  function jobClusterCpus(job) {
    const fromExec =
      Number(job.execution?.allocated_cpus) || Number(job.execution?.resources?.cpus) || 0
    if (fromExec > 0) return fromExec
    const slurm = job.resources?.slurm
    if (slurm?.cpu_cores != null) return Number(slurm.cpu_cores) || totalCpus
    const r = job.resources
    if (r?.cpu_cores_max != null) return Number(r.cpu_cores_max) || totalCpus
    if (r?.cpu_cores_min != null) return Number(r.cpu_cores_min) || totalCpus
    const fromProtocol = jobProtocolSlurmAllocation(job)
    if (fromProtocol?.cpus) return fromProtocol.cpus
    return totalCpus
  }

  /** @param {EquilibrationJob} job */
  function jobClusterGpus(job) {
    const fromExec = Number(job.execution?.resources?.gpus)
    if (Number.isFinite(fromExec) && fromExec >= 0 && job.execution?.mode === 'remote') {
      return fromExec
    }
    const slurm = job.resources?.slurm
    if (slurm?.num_gpus != null) return Number(slurm.num_gpus) || 0
    const r = job.resources
    if (r?.use_gpu === false) return 0
    if (r?.num_gpus != null) return Number(r.num_gpus) || 0
    const fromProtocol = jobProtocolSlurmAllocation(job)
    if (fromProtocol) return fromProtocol.gpus
    return useGpu ? totalGpus : 0
  }

  /** @param {EquilibrationJob} job */
  function remoteJobFinishedLocally(job) {
    return (
      job.execution?.mode === 'remote' &&
      canonicalizeSlurmState(job.execution?.last_remote_state) === 'COMPLETED'
    )
  }

  /**
   * Slurm COMPLETED but local stage logs still incomplete (typical after a partial Pull).
   * Watching must keep light-syncing until local stages catch up.
   * @param {EquilibrationJob} job
   */
  function remoteNeedsLogCatchUp(job) {
    return (
      job.execution?.mode === 'remote' &&
      remoteJobFinishedLocally(job) &&
      !localStagesComplete(job)
    )
  }

  /** @param {EquilibrationJob} job */
  function remoteJobTerminal(job) {
    return isSlurmTerminalState(job.execution?.last_remote_state)
  }

  /** @param {EquilibrationJob} job */
  function localStagesComplete(job) {
    if (!job.stages?.length) return job.stagesTotal > 0 && job.stagesDone >= job.stagesTotal
    return job.stages.every((s) => s.status === 'completed')
  }

  /** @param {string} jobDir */
  function jobIndexByDir(jobDir) {
    return jobs.findIndex((j) => j.jobDir === jobDir)
  }

  /** @param {EquilibrationJob} job @param {EqStageInfo[]} stages @param {string} rawStatus */
  function mergeJobStages(job, stages, rawStatus) {
    let status = rawStatus
    let displayStages = stages.length > 0 ? stages : job.stages
    const remoteActive =
      job.execution?.mode === 'remote' &&
      Boolean(job.execution?.last_remote_state) &&
      isSlurmActiveState(job.execution.last_remote_state)
    if (remoteActive) {
      // Live remote: do not show a previous attempt's red stage errors.
      displayStages = displayStages.map((s) =>
        s.status === 'error' ? { ...s, status: 'not_started', output: '' } : s
      )
      status = 'running'
    } else if (remoteJobFinishedLocally(job)) {
      // COMPLETED remotely but local logs may still be catching up. NAMD mid-run
      // "WRITING … RESTART/DCD" lines are not failures.
      displayStages = displayStages.map((s) => {
        if (s.status !== 'error') return s
        const fail =
          /fatal error|error in stage|stub library|cuda driver:\s*0\.0|gpu detection failed/i.test(
            s.output || ''
          )
        return fail ? s : { ...s, status: 'running' }
      })
      if (
        displayStages.length === 0 ||
        displayStages.every((s) => s.status === 'completed')
      ) {
        status = 'completed'
      } else if (displayStages.some((s) => s.status === 'error')) {
        status = 'error'
      } else {
        status = 'running'
      }
    }
    return {
      status,
      stages: displayStages,
      stagesDone: displayStages.length
        ? displayStages.filter((s) => s.status === 'completed').length
        : job.stagesDone,
      stagesTotal: displayStages.length || job.stagesTotal
    }
  }

  /** @param {number} index @param {{ localOnly?: boolean }} [opts] */
  async function loadJobStages(index, { localOnly = false } = {}) {
    const job = jobs[index]
    if (!job || job.loadingStages) return
    jobs[index] = { ...job, loadingStages: true }
    try {
      const { status: rawStatus, stages, run_start_time } = await getEquilibrationStatus({
        workingDir: job.jobDir,
        engine: job.engine
      })
      const current = jobs[index]
      if (!current || current.jobDir !== job.jobDir) return
      const merged = mergeJobStages(current, stages, rawStatus)
      const allDone =
        merged.stages.length > 0 && merged.stages.every((s) => s.status === 'completed')
      const status =
        remoteJobFinishedLocally(current) && allDone ? 'completed' : merged.status
      jobs[index] = {
        ...current,
        ...merged,
        status,
        startTime: run_start_time || current.startTime,
        elapsed: formatJobElapsed(run_start_time || current.startTime),
        error: status === 'completed' ? null : current.error,
        equilibrationOutput: status === 'completed' ? '' : current.equilibrationOutput,
        canResume: status === 'completed' || status === 'running' ? false : current.canResume,
        canRun: status === 'running' ? false : current.canRun
      }
    } catch {
      /* keep card summary if local read fails */
    } finally {
      const current = jobs[index]
      if (current?.jobDir === job.jobDir) {
        jobs[index] = { ...current, loadingStages: false }
      }
    }
  }

  /**
   * Prefetch stage logs so header Runtime is available without opening Stages.
   * Local jobs: always. Remote: only when a shared cluster session is connected
   * (may light-sync logs via refreshJobDetail when the job is still live).
   * @param {number} index
   */
  async function ensureJobRuntimeLoaded(index) {
    const job = jobs[index]
    if (!job) return
    // One-shot: skip if already loading, already have stage payload, or runtime known.
    if (job.loadingStages || job.stages?.length || formatStagesMdElapsed(job.stages)) return
    const remote = jobCanSyncCluster(job)
    // Wait until cluster inventory probe finishes — log sync contends with sinfo.
    if (remote && !clusterSession.inventoryReady) return
    if (
      remote &&
      !remoteJobFinishedLocally(job) &&
      (job.execution?.scheduler_job_id || jobHasBatchScript(job))
    ) {
      // Prefetch: Slurm state only. Watching poll pulls logs later.
      await refreshJobDetail(index, { pullLogs: false })
      return
    }
    await loadJobStages(index)
  }

  /** Prefetch runtimes for every card that is allowed to load them now. */
  function prefetchJobRuntimes() {
    const tasks = []
    for (let i = 0; i < jobs.length; i++) {
      const index = i
      tasks.push(() => ensureJobRuntimeLoaded(index))
    }
    void runWithConcurrency(tasks)
  }

  /** List log files for every job card (capped parallelism). */
  function prefetchJobLogFiles() {
    const tasks = []
    for (let i = 0; i < jobs.length; i++) {
      const index = i
      tasks.push(() => refreshJobLogFiles(index))
    }
    void runWithConcurrency(tasks)
  }

  /** @param {EquilibrationJob} job */
  function openClusterDialog(job) {
    // Prefer this card's protocol / saved resources; fall back to left-panel defaults.
    clusterDialogJob = {
      jobDir: job.jobDir,
      jobName: job.name,
      engine: job.engine || engine,
      cpus: Math.max(1, jobClusterCpus(job) || 1),
      gpus: Math.max(0, jobClusterGpus(job)),
      execution: job.execution || null
    }
  }

  /** @param {string} jobDir @param {object|null|undefined} execution */
  function applyJobExecution(jobDir, execution) {
    if (!jobDir || !execution || typeof execution !== 'object') return
    const i = jobs.findIndex((j) => j.jobDir === jobDir)
    if (i < 0) return
    const current = jobs[i]
    const remoteActive = isSlurmActiveState(execution.last_remote_state)
    const nextExec = { ...(current.execution || {}), ...execution, mode: 'remote' }
    jobs[i] = {
      ...current,
      execution: nextExec,
      submitting: Boolean(execution.submitting),
      error: remoteActive ? null : current.error,
      status: remoteActive ? 'running' : current.status,
      canResume: remoteActive ? false : current.canResume,
      canRun: remoteActive ? false : current.canRun,
      startTime: String(nextExec.submitted_at || current.startTime || '').trim() || current.startTime
    }
    if (clusterDialogJob?.jobDir === jobDir) {
      clusterDialogJob = { ...clusterDialogJob, execution: nextExec }
    }
    if (remoteActive) {
      void loadJobStages(i)
    }
  }

  /**
   * @param {object|null|undefined} execution
   * @param {EquilibrationJob['syncSizes']} [existing]
   * @returns {EquilibrationJob['syncSizes']}
   */
  function syncSizesFromExecution(execution, existing = null) {
    const localBytes =
      Number(execution?.local_bytes) > 0
        ? Number(execution.local_bytes)
        : (existing?.localBytes ?? null)
    const remoteBytes =
      Number(execution?.remote_bytes) > 0
        ? Number(execution.remote_bytes)
        : (existing?.remoteBytes ?? null)
    if (localBytes == null && remoteBytes == null && !existing) return null
    return {
      localBytes,
      remoteBytes,
      localFormatted: existing?.localFormatted || formatBytesLabel(localBytes),
      remoteFormatted: existing?.remoteFormatted || formatBytesLabel(remoteBytes),
      loading: false
    }
  }

  /** @param {number|null|undefined} n */
  function formatBytesLabel(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = Math.max(0, Number(n))
    let i = 0
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024
      i += 1
    }
    if (i === 0) return `${Math.round(v)} ${units[i]}`
    return `${v.toFixed(1)} ${units[i]}`
  }

  /**
   * Refresh local (+ remote when connected) folder sizes for the sync ring.
   * @param {number} index
   * @param {{ measureRemote?: boolean }} [opts]
   */
  async function refreshJobSyncSizes(index, opts = {}) {
    const job = jobs[index]
    if (!job?.jobDir) return
    const measureRemote =
      opts.measureRemote !== false &&
      job.execution?.mode === 'remote' &&
      !!job.execution?.remote_path &&
      !!clusterSession.sessionId

    jobs[index] = {
      ...job,
      syncSizes: {
        localBytes: job.syncSizes?.localBytes ?? null,
        remoteBytes: job.syncSizes?.remoteBytes ?? null,
        localFormatted: job.syncSizes?.localFormatted || '—',
        remoteFormatted: job.syncSizes?.remoteFormatted || '—',
        loading: true
      }
    }
    try {
      const res = await clusterJobFolderSizes({
        local_dir: job.jobDir,
        session_id: measureRemote ? clusterSession.sessionId : null,
        remote_dir: measureRemote ? job.execution?.remote_path : null,
        measure_remote: measureRemote
      })
      const current = jobs[index]
      if (!current || current.jobDir !== job.jobDir) return
      const localBytes = res.local_bytes ?? null
      const remoteBytes =
        res.remote_bytes != null && Number(res.remote_bytes) > 0
          ? Number(res.remote_bytes)
          : (current.syncSizes?.remoteBytes ?? null)
      jobs[index] = {
        ...current,
        execution: {
          ...(current.execution || {}),
          ...(localBytes != null ? { local_bytes: localBytes } : {}),
          ...(remoteBytes != null ? { remote_bytes: remoteBytes } : {})
        },
        syncSizes: {
          localBytes,
          remoteBytes,
          localFormatted: res.local_formatted || formatBytesLabel(localBytes),
          remoteFormatted: res.remote_formatted || formatBytesLabel(remoteBytes),
          loading: false
        }
      }
    } catch {
      const current = jobs[index]
      if (current?.jobDir === job.jobDir && current.syncSizes) {
        jobs[index] = {
          ...current,
          syncSizes: { ...current.syncSizes, loading: false }
        }
      }
    }
  }

  const LOG_LINE_PRESETS = [50, 100, 200, 500, 1000]
  /** Soft ceiling so a huge paste cannot freeze the renderer; head/tail still stream from disk. */
  const LOG_LINES_MAX = 100_000
  const LOG_LINES_DEFAULT = 50

  function clampLogLines(n) {
    const v = Math.floor(Number(n))
    if (!Number.isFinite(v) || v < 1) return LOG_LINES_DEFAULT
    return Math.min(LOG_LINES_MAX, v)
  }

  /** @param {number} index */
  async function refreshJobLogFiles(index) {
    const job = jobs[index]
    if (!job?.jobDir) return
    jobs[index] = {
      ...job,
      logView: {
        lines: job.logView?.lines || [],
        exists: job.logView?.exists ?? false,
        loading: true,
        mode: job.logView?.mode || (job.logMode === 'head' ? 'head' : 'tail'),
        lineCount: job.logView?.lineCount || clampLogLines(job.logLines)
      }
    }
    try {
      const res = await listEquilibrationJobFiles(job.jobDir)
      const files = (res.files || []).map((f) => f.path)
      const current = jobs[index]
      if (!current || current.jobDir !== job.jobDir) return
      let selectedLog = current.selectedLog
      if (selectedLog && !files.includes(selectedLog)) selectedLog = null
      if (!selectedLog && files.length) selectedLog = files[0]
      jobs[index] = { ...current, logFiles: files, selectedLog }
      if (selectedLog) {
        await refreshJobLogView(index)
      } else {
        jobs[index] = {
          ...jobs[index],
          logView: {
            lines: [],
            exists: false,
            loading: false,
            mode: current.logMode === 'head' ? 'head' : 'tail',
            lineCount: clampLogLines(current.logLines)
          }
        }
      }
    } catch {
      const current = jobs[index]
      if (current?.jobDir === job.jobDir && current.logView?.loading) {
        jobs[index] = {
          ...current,
          logView: { ...current.logView, loading: false }
        }
      }
    }
  }

  /** @param {number} index */
  async function refreshJobLogView(index) {
    const job = jobs[index]
    if (!job?.jobDir || !job.selectedLog) return
    const mode = job.logMode === 'head' ? 'head' : 'tail'
    const lines = clampLogLines(job.logLines)
    jobs[index] = {
      ...job,
      logView: {
        lines: job.logView?.lines || [],
        exists: job.logView?.exists ?? false,
        loading: true,
        mode,
        lineCount: lines
      }
    }
    try {
      const res = await getEquilibrationJobLog({
        jobDir: job.jobDir,
        relPath: job.selectedLog,
        mode,
        lines
      })
      const current = jobs[index]
      if (!current || current.jobDir !== job.jobDir) return
      jobs[index] = {
        ...current,
        logView: {
          lines: res.lines || [],
          exists: !!res.exists,
          loading: false,
          mode: res.mode || mode,
          lineCount: res.line_count || lines
        }
      }
    } catch {
      const current = jobs[index]
      if (current?.jobDir === job.jobDir) {
        jobs[index] = {
          ...current,
          logView: {
            lines: [],
            exists: false,
            loading: false,
            mode,
            lineCount: lines
          }
        }
      }
    }
  }

  /**
   * @param {number} index
   * @param {{ selectedLog?: string|null, logMode?: 'head'|'tail', logLines?: number, logLinesEditing?: boolean }} patch
   */
  async function updateJobLogOptions(index, patch) {
    const job = jobs[index]
    if (!job) return
    const next = {
      ...job,
      ...(patch.selectedLog !== undefined ? { selectedLog: patch.selectedLog } : {}),
      ...(patch.logMode !== undefined ? { logMode: patch.logMode } : {}),
      ...(patch.logLines !== undefined ? { logLines: clampLogLines(patch.logLines) } : {}),
      ...(patch.logLinesEditing !== undefined ? { logLinesEditing: !!patch.logLinesEditing } : {})
    }
    jobs[index] = next
    if (next.selectedLog && patch.logLinesEditing !== true) await refreshJobLogView(index)
  }

  /** @param {number} index */
  async function cancelPullRemoteJob(index) {
    const job = jobs[index]
    if (!job?.pulling) return
    const ac = pullAbortByJobDir.get(job.jobDir)
    if (ac) {
      ac.abort()
      return
    }
    try {
      await clusterCancelPull({ local_dir: job.jobDir })
    } catch {
      /* best effort */
    }
    jobs[index] = { ...job, pulling: false, pullProgress: null }
    void refreshJobSyncSizes(index, { measureRemote: false })
    logEvent('detail', 'eq', 'Pull cancelled', job.jobDir)
  }

  /** @param {number} index */
  async function pullRemoteJob(index) {
    const job = jobs[index]
    if (!job?.execution?.mode || job.execution.mode !== 'remote') return
    const remotePath = job.execution.remote_path
    if (!remotePath) return
    if (job.pulling) return
    const jobDir = job.jobDir

    const remoteState = job.execution?.last_remote_state
    if (isSlurmActiveState(remoteState) && !confirm(partialPullConfirmMessage(remoteState))) {
      return
    }

    /** @param {(cur: EquilibrationJob) => EquilibrationJob} updater */
    const patchByDir = (updater) => {
      const i = jobIndexByDir(jobDir)
      if (i < 0) return -1
      jobs[i] = updater(jobs[i])
      return i
    }

    jobs[index] = {
      ...job,
      pulling: true,
      pullProgress: {
        percent: 0,
        message: isSlurmActiveState(remoteState)
          ? `Partial pull (job still ${canonicalizeSlurmState(remoteState)})…`
          : 'Starting pull…',
        phase: 'resolve'
      },
      error: null
    }
    try {
      let sessionId = clusterSession.sessionId
      const profiles = await loadClusterProfiles()
      const profile =
        profiles.find((p) => p.id && p.id === job.execution.cluster_id) ||
        profiles.find((p) => p.name && p.name === job.execution.cluster_name) ||
        profiles[0]
      if (!sessionId) {
        if (!profile?.identity_file && !profile?.host) {
          patchByDir((cur) => ({ ...cur, pulling: false, pullProgress: null }))
          openClusterDialog(job)
          return
        }
        await connectSharedCluster(profile)
        sessionId = clusterSession.sessionId
      }
      if (!sessionId) {
        patchByDir((cur) => ({ ...cur, pulling: false, pullProgress: null }))
        openClusterDialog(job)
        return
      }
      const ac = new AbortController()
      pullAbortByJobDir.set(jobDir, ac)
      const res = await clusterPullJobStream(
        {
          session_id: sessionId,
          local_dir: jobDir,
          remote_dir: remotePath,
          full: true,
          profile: sharedProfilePlain() || (profile ? JSON.parse(JSON.stringify(profile)) : null),
          job_id: job.execution.scheduler_job_id || null
        },
        (evt) => {
          const i = jobIndexByDir(jobDir)
          if (i < 0) return
          const current = jobs[i]
          const cancelled = evt.phase === 'cancelled'
          const done = evt.phase === 'done'
          const msg = evt.message || current.pullProgress?.message || 'Pulling…'
          const nextSync = {
            ...(current.syncSizes || {
              localBytes: null,
              remoteBytes: null,
              localFormatted: '—',
              remoteFormatted: '—',
              loading: false
            })
          }
          if (typeof evt.bytes === 'number' && evt.bytes >= 0 && evt.phase === 'sync') {
            const merged = mergePullLocalBytes(nextSync.localBytes, evt.bytes)
            nextSync.localBytes = merged
            nextSync.localFormatted = formatByteSize(merged, { fine: true })
          }
          if (typeof evt.total_bytes === 'number' && evt.total_bytes > 0) {
            nextSync.remoteBytes = evt.total_bytes
            nextSync.remoteFormatted = formatByteSize(evt.total_bytes, { fine: true })
          }
          const pct = pullEventPercent(
            {
              ...evt,
              bytes: nextSync.localBytes ?? evt.bytes,
              total_bytes: nextSync.remoteBytes ?? evt.total_bytes
            },
            current.pullProgress?.percent ?? null
          )
          const speed =
            evt.speed ||
            extractPullSpeedFromMessage(msg) ||
            current.pullProgress?.speed ||
            null
          const liveMsg =
            typeof nextSync.localBytes === 'number' && nextSync.localBytes >= 0
              ? formatPullTransferText(
                  nextSync.localBytes,
                  nextSync.remoteBytes || 0,
                  nextSync.localFormatted,
                  typeof speed === 'string' ? speed : null
                )
              : msg
          // Unlock Pull as soon as the transfer reports done — do not wait for
          // stream close / stage reload, which can stall behind another card's rsync.
          jobs[i] = {
            ...current,
            pulling: done || cancelled ? false : current.pulling,
            pullProgress: cancelled
              ? null
              : {
                  percent: done ? 100 : pct,
                  message: done || cancelled ? msg : liveMsg,
                  phase: evt.phase || current.pullProgress?.phase || 'sync',
                  speed: typeof speed === 'string' ? speed : null
                },
            syncSizes: nextSync
          }
        },
        { signal: ac.signal }
      )
      const i = jobIndexByDir(jobDir)
      if (i < 0) return
      const current = jobs[i]
      const stillActive = isSlurmActiveState(
        res.remote_state || res.execution?.last_remote_state || remoteState
      )
      const localBytes =
        typeof res.local_bytes === 'number' ? res.local_bytes : current.syncSizes?.localBytes
      const remoteBytes =
        typeof res.remote_bytes === 'number' && res.remote_bytes > 0
          ? res.remote_bytes
          : current.syncSizes?.remoteBytes
      jobs[i] = {
        ...current,
        pulling: false,
        execution: {
          ...(current.execution || {}),
          ...(res.execution || {}),
          mode: 'remote',
          scheduler_job_id:
            res.execution?.scheduler_job_id ||
            current.execution?.scheduler_job_id ||
            job.execution.scheduler_job_id,
          remote_path: res.execution?.remote_path || remotePath,
          last_remote_state:
            res.execution?.last_remote_state ||
            res.remote_state ||
            current.execution?.last_remote_state,
          ...(localBytes != null ? { local_bytes: localBytes } : {}),
          ...(remoteBytes != null ? { remote_bytes: remoteBytes } : {})
        },
        syncSizes: {
          localBytes: localBytes ?? null,
          remoteBytes: remoteBytes ?? null,
          localFormatted: res.local_formatted || formatBytesLabel(localBytes),
          remoteFormatted: res.remote_formatted || formatBytesLabel(remoteBytes),
          loading: false
        },
        pullProgress: {
          percent: 100,
          message: stillActive
            ? 'Partial pull complete — pull again when the job finishes for full results'
            : 'Pull complete',
          phase: 'done'
        },
        showStages: true
      }
      // Local refresh for this card; kick Watching so other cards do not wait
      // for the next poll interval after a long Pull.
      const refreshIndex = i
      void loadJobStages(refreshIndex)
      void refreshJobSyncSizes(refreshIndex, { measureRemote: false })
      void refreshJobLogFiles(refreshIndex)
      void pollWatchedJobs({ scheduleNext: false })
      window.setTimeout(() => {
        const later = jobIndexByDir(jobDir)
        if (later < 0) return
        if (!jobs[later].pulling && jobs[later].pullProgress?.phase === 'done') {
          jobs[later] = { ...jobs[later], pullProgress: null }
        }
      }, 1600)
    } catch (err) {
      const ac = pullAbortByJobDir.get(jobDir)
      if (isPullCancelledError(err, ac?.signal)) {
        patchByDir((cur) => ({
          ...cur,
          pulling: false,
          pullProgress: {
            percent: cur.pullProgress?.percent ?? null,
            message: 'Pull cancelled',
            phase: 'cancelled'
          },
          error: null
        }))
        const i = jobIndexByDir(jobDir)
        if (i >= 0) void refreshJobSyncSizes(i, { measureRemote: false })
        logEvent('detail', 'eq', 'Pull cancelled', jobDir)
        window.setTimeout(() => {
          const later = jobIndexByDir(jobDir)
          if (later < 0) return
          if (jobs[later].pullProgress?.phase === 'cancelled') {
            jobs[later] = { ...jobs[later], pullProgress: null }
          }
        }, 2000)
        return
      }
      patchByDir((cur) => ({
        ...cur,
        error: err instanceof Error ? err.message : String(err),
        pulling: false,
        pullProgress: null
      }))
    } finally {
      pullAbortByJobDir.delete(jobDir)
      patchByDir((cur) => (cur.pulling ? { ...cur, pulling: false } : cur))
    }
  }

  const filteredJobs = $derived(
    jobs
      .filter((job) => {
        if (progressFilter !== 'all') {
          const remote = job.execution?.mode === 'remote'
          if (progressFilter === 'remote' ? !remote : remote) return false
        }
        if (progressStatusFilter !== 'all' && jobProgressStatus(job) !== progressStatusFilter) {
          return false
        }
        return true
      })
      .slice()
      .sort((a, b) => {
        const am = typeof a.dirMtime === 'number' ? a.dirMtime : 0
        const bm = typeof b.dirMtime === 'number' ? b.dirMtime : 0
        return progressSortOrder === 'oldest' ? am - bm : bm - am
      })
  )

  /**
   * @param {EqStageInfo[]} stages
   * @param {EquilibrationJob} [job]
   */
  function jobSimulatedTotals(stages, job) {
    let sim = 0
    let hasSim = false
    for (const s of stages) {
      if (s.is_minimization) continue
      if (Number.isFinite(s.simulated_time)) {
        sim += /** @type {number} */ (s.simulated_time)
        hasSim = true
      }
    }
    const protocolTotal = job ? protocolPlannedMdNs(job) : null
    if (protocolTotal != null) {
      return { sim: hasSim ? sim : null, total: protocolTotal }
    }
    let fallbackTotal = 0
    let hasFallback = false
    for (const s of stages) {
      if (s.is_minimization) continue
      if (Number.isFinite(s.total_simulation_time)) {
        fallbackTotal += /** @type {number} */ (s.total_simulation_time)
        hasFallback = true
      }
    }
    return {
      sim: hasSim ? sim : null,
      total: hasFallback ? fallbackTotal : null
    }
  }

  /** @param {import('../lib/backendApi.js').EquilibrationJobSummary} summary */
  function jobFromScan(summary, /** @type {EquilibrationJob | undefined} */ existing) {
    const remoteActive =
      summary.execution?.mode === 'remote' && isSlurmActiveState(summary.execution?.last_remote_state)
    return {
      jobDir: summary.job_dir,
      name: summary.name,
      engine: summary.engine,
      variant: summary.variant,
      status: remoteActive ? 'running' : summary.status || 'unknown',
      startTime: summary.start_time || String(summary.execution?.submitted_at || '').trim() || '',
      dirMtime: typeof summary.dir_mtime === 'number' ? summary.dir_mtime : (existing?.dirMtime ?? 0),
      elapsed: formatJobElapsed(summary.start_time),
      stagesDone: summary.stages_done ?? 0,
      stagesTotal: summary.stages_total ?? 0,
      error: remoteActive ? null : summary.error || null,
      canRun: remoteActive ? false : (summary.can_run ?? false),
      canResume: remoteActive ? false : (summary.can_resume ?? false),
      resumeReason: summary.resume_reason || '',
      resumeStageName: summary.resume_stage_name || '',
      resources: summary.resources ?? null,
      inputDir: summary.input_dir || null,
      ensemble: summary.ensemble || null,
      protocol: summary.protocol || null,
      gpuResident:
        typeof summary.gpu_resident === 'boolean'
          ? summary.gpu_resident
          : (existing?.gpuResident ?? null),
      execution: summary.execution ?? existing?.execution ?? null,
      hasBatchScript: Boolean(summary.has_batch_script || existing?.hasBatchScript),
      stages: existing?.stages ?? [],
      watched: existing?.watched ?? false,
      showStages: existing?.showStages ?? false,
      showInfo: existing?.showInfo ?? false,
      processInfo: existing?.processInfo ?? null,
      loadingProcessInfo: false,
      stopping: false,
      continuing: false,
      running: false,
      reloading: false,
      pulling: existing?.pulling ?? false,
      pullProgress: existing?.pullProgress ?? null,
      syncSizes: syncSizesFromExecution(summary.execution, existing?.syncSizes),
      selectedLog: existing?.selectedLog ?? null,
      logMode: existing?.logMode ?? 'tail',
      logLines: existing?.logLines ?? LOG_LINES_DEFAULT,
      logLinesEditing: existing?.logLinesEditing ?? false,
      logFiles: existing?.logFiles ?? [],
      logView: existing?.logView ?? null,
      loadingStages: existing?.loadingStages ?? false,
      syncingRemoteStages: existing?.syncingRemoteStages ?? false,
      submitting: existing?.submitting ?? false,
      // Only keep stage error output while the job is still in error; Continue/resume
      // must not resurrect a stale failure log under a running card.
      equilibrationOutput:
        !remoteActive && summary.status === 'error'
          ? summary.error || existing?.equilibrationOutput || ''
          : ''
    }
  }

  /** Oldest by startTime, else first in list. */
  function oldestJobIndex(/** @type {EquilibrationJob[]} */ list = jobs) {
    if (!list.length) return -1
    let best = 0
    let bestTs = Number.POSITIVE_INFINITY
    for (let i = 0; i < list.length; i++) {
      const t = list[i].startTime ? new Date(list[i].startTime).getTime() : Number.POSITIVE_INFINITY
      if (Number.isFinite(t) && t < bestTs) {
        bestTs = t
        best = i
      }
    }
    if (!Number.isFinite(bestTs) || bestTs === Number.POSITIVE_INFINITY) return 0
    return best
  }

  /** Ensure at least one job is watched (oldest). Returns true if a watch was set. */
  function watchOldestJob() {
    if (jobs.some((j) => j.watched)) return false
    const idx = oldestJobIndex(jobs)
    if (idx < 0) return false
    jobs = jobs.map((j, i) =>
      i === idx ? { ...j, watched: true, showStages: j.status === 'running' ? true : j.showStages } : j
    )
    return true
  }

  function stopPolling() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId)
      pollIntervalId = null
    }
  }

  function restartPolling() {
    stopPolling()
    if (autoMonitor && jobs.some((j) => j.watched)) {
      pollIntervalId = setInterval(pollWatchedJobs, Math.max(1, Number(updateInterval) || 60) * 1000)
    }
  }

  async function rescanJobs() {
    const roots = uniqueDirList(workingDir, outputParentDir)
    if (roots.length === 0) return
    const gen = ++jobsScanGeneration
    loadingJobs = true
    try {
      const results = await Promise.all(roots.map((dir) => scanEquilibrationJobs(dir)))
      if (gen !== jobsScanGeneration) return
      const stillRoots = uniqueDirList(workingDir, outputParentDir)
      if (
        stillRoots.length !== roots.length ||
        stillRoots.some((d, i) => d !== roots[i])
      ) {
        return
      }
      /** @type {Map<string, any>} */
      const foundByDir = new Map()
      for (const { jobs: found } of results) {
        for (const summary of found) {
          if (!foundByDir.has(summary.job_dir)) foundByDir.set(summary.job_dir, summary)
        }
      }
      const byDir = new Map(jobs.map((j) => [j.jobDir, j]))
      // Preserve existing watched flags; do not auto-watch on open.
      jobs = [...foundByDir.values()]
        .sort((a, b) => Number(b.dir_mtime || 0) - Number(a.dir_mtime || 0))
        .map((summary) => jobFromScan(summary, byDir.get(summary.job_dir)))
      statusSynced = true
      void refreshRemoteCardSizes()
      prefetchJobRuntimes()
      prefetchJobLogFiles()
      if (autoMonitor && jobs.some((j) => j.watched)) {
        restartPolling()
        await pollWatchedJobs({ scheduleNext: false })
      }
    } catch {
      /* backend unreachable */
    } finally {
      if (gen === jobsScanGeneration) loadingJobs = false
    }
  }

  /** Light local size for all remote cards; remote du only when SSH session is up. */
  async function refreshRemoteCardSizes() {
    const idxs = jobs
      .map((j, i) => (j.execution?.mode === 'remote' ? i : -1))
      .filter((i) => i >= 0)
    await Promise.all(
      idxs.map((i) =>
        refreshJobSyncSizes(i, {
          measureRemote: !!clusterSession.sessionId && !!jobs[i]?.execution?.remote_path
        })
      )
    )
  }

  function startPolling() {
    if (!autoMonitor) return
    if (pollIntervalId) return
    pollIntervalId = setInterval(pollWatchedJobs, Math.max(1, Number(updateInterval) || 60) * 1000)
  }

  function stopPollingIfDone() {
    if (!autoMonitor || !jobs.some((j) => j.watched)) {
      stopPolling()
    }
  }

  async function pollWatchedJobs({ scheduleNext = true } = {}) {
    // Progress Connect (probe/connect) still contends with sinfo; skip remote
    // I/O then. Pull uses a separate SSH ControlMaster, so other cards keep
    // Watching — local parse always, log sync on the watch mux.
    const pauseRemoteSync = clusterSession.connecting || clusterSession.probing
    for (let i = 0; i < jobs.length; i++) {
      if (!jobs[i].watched) continue
      // Do not poll/pull while Cluster → Submit is uploading (avoids a second sbatch race).
      if (jobs[i].submitting) continue
      if (jobs[i].pulling) continue
      // Slurm COMPLETED + local stages caught up: re-read local only.
      // COMPLETED but stale local logs (partial Pull): keep light remote sync.
      // Live remote: refreshJobDetail polls Slurm + light log sync.
      if (remoteJobFinishedLocally(jobs[i]) && !remoteNeedsLogCatchUp(jobs[i])) {
        await loadJobStages(i)
        if (jobs[i].logMode === 'tail' && jobs[i].selectedLog) {
          await refreshJobLogView(i)
        }
        continue
      }
      if (pauseRemoteSync && jobs[i].execution?.mode === 'remote') {
        await loadJobStages(i)
        if (jobs[i].logMode === 'tail' && jobs[i].selectedLog) {
          await refreshJobLogView(i)
        }
        continue
      }
      await refreshJobDetail(i)
      if (jobs[i].logMode === 'tail' && jobs[i].selectedLog) {
        await refreshJobLogView(i)
      }
    }
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'running') {
        jobs[i] = { ...jobs[i], elapsed: formatJobElapsed(jobs[i].startTime) }
      }
    }
    stopPollingIfDone()
    if (scheduleNext && autoMonitor && jobs.some((j) => j.watched)) {
      startPolling()
    }
  }

  /** @param {number} index @param {{ localOnly?: boolean, pullLogs?: boolean }} [opts] */
  async function refreshJobDetail(index, { localOnly = false, pullLogs = true } = {}) {
    const job = jobs[index]
    if (!job) return
    const prevStatus = job.status
    const jobDir = job.jobDir
    const jobName = job.name
    const finishedRemote = remoteJobFinishedLocally(job)
    const needsCatchUp = remoteNeedsLogCatchUp(job)
    const pollCluster =
      !localOnly &&
      (!finishedRemote || needsCatchUp) &&
      jobCanSyncCluster(job) &&
      (Boolean(job.execution?.scheduler_job_id) || jobHasBatchScript(job))
    const willPullLogs =
      pollCluster &&
      pullLogs &&
      (job.watched || needsCatchUp) &&
      !isSlurmPendingState(job.execution?.last_remote_state) &&
      !job.pulling

    if (willPullLogs) {
      jobs[index] = { ...jobs[index], syncingRemoteStages: true }
    }

    try {
    // Remote Watching: poll Slurm (auto-connect via SSH key on the profile).
    // Also catch-up after COMPLETED when local stage logs are still incomplete.
    if (pollCluster) {
      try {
        const profiles = await loadClusterProfiles()
        const profile =
          profiles.find((p) => p.id && p.id === job.execution?.cluster_id) ||
          profiles.find((p) => p.name && p.name === job.execution?.cluster_name) ||
          profiles[0]
        if (profile?.identity_file || profile?.host || clusterSession.sessionId) {
          const live = jobs[index]
          if (!live || live.jobDir !== jobDir) return
          const schedulerJobId = live.execution?.scheduler_job_id
          if (!schedulerJobId && !jobHasBatchScript(live)) return
          const remote = await clusterJobStatus({
            session_id: clusterSession.sessionId || null,
            profile: sharedProfilePlain() || JSON.parse(JSON.stringify(profile)),
            job_id: schedulerJobId || null,
            local_dir: job.jobDir,
            remote_dir: job.execution?.remote_path || null,
            // Watching / catch-up: light log sync. Prefetch may pass pullLogs:false.
            pull_logs: willPullLogs
          })
          const current0 = jobs[index]
          if (!current0 || current0.jobDir !== jobDir) return
          const resolvedJobId =
            remote.execution?.scheduler_job_id ||
            current0.execution?.scheduler_job_id ||
            schedulerJobId
          const nextExec = {
            ...(current0.execution || {}),
            ...(remote.execution || {}),
            mode: 'remote',
            cluster_id: remote.execution?.cluster_id || profile.id || current0.execution?.cluster_id,
            cluster_name:
              remote.execution?.cluster_name || profile.name || current0.execution?.cluster_name,
            scheduler_job_id: resolvedJobId,
            last_remote_state:
              remote.execution?.last_remote_state ||
              remote.state ||
              current0.execution?.last_remote_state,
            remote_path: remote.execution?.remote_path || current0.execution?.remote_path,
            allocated_cpus:
              remote.execution?.allocated_cpus || current0.execution?.allocated_cpus,
            resources: remote.execution?.resources || current0.execution?.resources,
            node_list: remote.execution?.node_list || current0.execution?.node_list,
            node_gpu_label:
              remote.execution?.node_gpu_label || current0.execution?.node_gpu_label
          }
          const remoteActive0 = isSlurmActiveState(nextExec.last_remote_state)
          let error = current0.error
          if (remoteActive0) {
            error = null
          } else if (remote.pulled?.failure) {
            error = remote.pulled.failure_source
              ? `${remote.pulled.failure} (${remote.pulled.failure_source})`
              : remote.pulled.failure
          } else if (nextExec.last_error) {
            error = String(nextExec.last_error)
          }
          jobs[index] = {
            ...current0,
            execution: nextExec,
            error,
            status: remoteActive0 ? 'running' : current0.status,
            canResume: remoteActive0 ? false : current0.canResume,
            canRun: remoteActive0 ? false : current0.canRun
          }
        }
      } catch {
        /* keep local overlay if SSH fails this cycle */
      }
    }

    try {
      const { status: rawStatus, stages, run_start_time } = await getEquilibrationStatus({
        workingDir: job.jobDir,
        engine: job.engine
      })
      // Merge into the latest card state — concurrent Reload/Continue/poll must not
      // re-apply a stale snapshot (e.g. reloading: true) after the await.
      const current = jobs[index]
      if (!current || current.jobDir !== jobDir) return
      const merged = mergeJobStages(current, stages, rawStatus)
      let status = merged.status
      const stageErr =
        stages.find((s) => s.status === 'error')?.output ||
        stages.map((s) => s.output || '').join('\n')
      const failLine =
        stageErr
          .split('\n')
          .find((l) =>
            /fatal error|error in stage|stub library|cuda driver:\s*0\.0|gpu detection failed/i.test(
              l
            )
          ) || ''
      let error =
        status === 'error'
          ? (current.error || failLine || null)
          : null
      if (current.execution?.mode === 'remote' && current.execution?.last_remote_state) {
        const rs = String(current.execution.last_remote_state)
        if (isSlurmActiveState(rs)) {
          status = 'running'
          error = null
        } else if (isSlurmTerminalState(rs) && canonicalizeSlurmState(rs) !== 'COMPLETED') {
          status = 'error'
          error =
            error ||
            current.execution.last_error ||
            current.error ||
            `Remote job ${canonicalizeSlurmState(rs)}`
        } else if (remoteJobFinishedLocally(current) && merged.stages.length > 0) {
          status = merged.stages.every((s) => s.status === 'completed') ? 'completed' : status
          if (status === 'completed') error = null
        }
      }
      const equilibrationOutput = status === 'error' && failLine ? stageErr || error || '' : ''
      jobs[index] = {
        ...current,
        status,
        stages: merged.stages,
        stagesDone: merged.stagesDone,
        stagesTotal: merged.stagesTotal,
        startTime: run_start_time || current.startTime,
        elapsed: formatJobElapsed(run_start_time || current.startTime),
        equilibrationOutput,
        error,
        canResume: status === 'running' && current.execution?.mode === 'remote' ? false : current.canResume,
        canRun: status === 'running' ? false : current.canRun
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
    } finally {
      const current = jobs[index]
      if (current?.jobDir === jobDir && current.syncingRemoteStages) {
        jobs[index] = { ...current, syncingRemoteStages: false }
      }
    }
  }

  function toggleJobWatch(/** @type {number} */ index) {
    const turningOn = !jobs[index].watched
    const job = jobs[index]
    const isRemote = job.execution?.mode === 'remote'
    jobs[index] = {
      ...job,
      watched: turningOn,
      showStages:
        turningOn && (job.status === 'running' || isRemote) ? true : job.showStages
    }
    if (turningOn) {
      if (isRemote && !clusterSession.sessionId) {
        logEvent(
          'info',
          'eq',
          'Cluster not connected',
          `Watching "${job.name}" — connect in the Progress toolbar to poll Slurm status and sync remote stage logs.`
        )
      }
      autoMonitor = true
      void refreshJobDetail(index)
      restartPolling()
    } else if (!jobs.some((j) => j.watched)) {
      autoMonitor = false
      stopPolling()
    } else {
      stopPollingIfDone()
    }
  }

  async function toggleJobStages(/** @type {number} */ index) {
    const turningOn = !jobs[index].showStages
    jobs[index] = { ...jobs[index], showStages: turningOn }
    if (turningOn && jobs[index].stages.length === 0) {
      await loadJobStages(index)
    }
  }

  /** Refresh Slurm state in equilibration_job.json before re-reading the card. */
  async function syncRemoteExecutionMetadata(/** @type {number} */ index) {
    const job = jobs[index]
    if (!jobCanSyncCluster(job)) return
    const schedulerJobId = job.execution?.scheduler_job_id
    try {
      const profiles = await loadClusterProfiles()
      const profile =
        profiles.find((p) => p.id && p.id === job.execution?.cluster_id) ||
        profiles.find((p) => p.name && p.name === job.execution?.cluster_name) ||
        profiles[0]
      if (!clusterSession.sessionId && !profile?.identity_file) return
      const remote = await clusterJobStatus({
        session_id: clusterSession.sessionId || null,
        profile: sharedProfilePlain() || (profile ? JSON.parse(JSON.stringify(profile)) : null),
        job_id: schedulerJobId || null,
        local_dir: job.jobDir,
        remote_dir: job.execution?.remote_path || null,
        pull_logs: false
      })
      applyJobExecution(job.jobDir, {
        ...(remote.execution || {}),
        mode: 'remote',
        scheduler_job_id: remote.execution?.scheduler_job_id || schedulerJobId,
        last_remote_state:
          remote.execution?.last_remote_state || remote.state || job.execution?.last_remote_state
      })
    } catch {
      /* cluster unreachable */
    }
  }

  /** True when Reload/summary fails because the job folder was deleted or emptied. */
  function isMissingJobFolderError(error) {
    const msg = error instanceof Error ? error.message : String(error)
    return (
      /Not a directory:/i.test(msg) ||
      /Not an equilibration job folder:/i.test(msg) ||
      /Job directory not found/i.test(msg) ||
      /Directory not found:/i.test(msg)
    )
  }

  /** Drop a stale Progress card (folder removed from disk). */
  function dismissMissingJobCard(jobDir, jobName) {
    if (formSourceJobDir === jobDir) formSourceJobDir = null
    if (clusterDialogJob?.jobDir === jobDir) clusterDialogJob = null
    const wasWatched = jobs.some((j) => j.jobDir === jobDir && j.watched)
    jobs = jobs.filter((j) => j.jobDir !== jobDir)
    if (wasWatched && !jobs.some((j) => j.watched)) stopPollingIfDone()
    logEvent(
      'warn',
      'eq',
      `Removed "${jobName || 'job'}" from Progress`,
      'Folder no longer exists on disk'
    )
  }

  async function reloadJobCard(/** @type {number} */ index) {
    const job = jobs[index]
    if (!job || job.reloading) return
    const jobDir = job.jobDir
    const jobName = job.name
    jobs[index] = { ...job, reloading: true }
    try {
      if (jobCanSyncCluster(job)) {
        await syncRemoteExecutionMetadata(index)
      }
      const summary = await getEquilibrationJobSummary(job.jobDir, workingDir || undefined)
      const existing = jobs[index]
      if (!existing || existing.jobDir !== jobDir) return
      jobs[index] = { ...jobFromScan(summary, existing), reloading: true }
      const finishedRemote = remoteJobFinishedLocally(jobs[index])
      if (jobs[index].watched || jobs[index].showStages || finishedRemote) {
        if (finishedRemote && !remoteNeedsLogCatchUp(jobs[index])) {
          await loadJobStages(index)
        } else {
          await refreshJobDetail(index)
        }
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
      if (isMissingJobFolderError(error)) {
        dismissMissingJobCard(jobDir, jobName)
        return
      }
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      if (jobs[index]?.jobDir === jobDir) {
        jobs[index] = { ...jobs[index], reloading: false }
        void refreshJobSyncSizes(index, {
          measureRemote: !!clusterSession.sessionId && !!jobs[index]?.execution?.remote_path
        })
        void refreshJobLogFiles(index)
      }
    }
  }

  /**
   * Plain deep copy — job.protocol lives on a $state card and structuredClone
   * throws DataCloneError on Svelte proxies (Use in form then never updates stages).
   * @param {unknown} value
   */
  function plainClone(value) {
    try {
      return $state.snapshot(value)
    } catch {
      try {
        return JSON.parse(JSON.stringify(value))
      } catch {
        return null
      }
    }
  }

  /**
   * Assign input directory and force the system-size loader to refresh even when
   * the path string is unchanged (Use in form / re-select same folder).
   * @param {string | null | undefined} dirPath
   */
  function setInputDirectory(dirPath) {
    const next = String(dirPath ?? '').trim()
    inputDir = next
    inputDirRevision += 1
  }

  /**
   * Expand inherited / missing per-stage compute fields so every card is editable.
   * @param {object} p
   */
  function materializeStageResources(p) {
    const defaults = {
      cpu_cores: 1,
      gpu_id: 0,
      num_gpus: 1,
      use_gpu: true,
      ...(p?.compute_defaults ?? {})
    }
    for (const stage of p?.stages ?? []) {
      const kind = String(stage.stage_kind || '').toLowerCase()
      const name = String(stage.name || '').toLowerCase()
      const isMini =
        kind === 'minimization' || name === 'minimization' || name === 'energy minimization'
      if (isMini) {
        if (engine === 'openmm') {
          if (stage.cpu_cores == null) stage.cpu_cores = 1
          if (stage.use_gpu == null) stage.use_gpu = true
          if (stage.num_gpus == null) stage.num_gpus = stage.use_gpu ? 1 : 0
          if (stage.gpu_id == null) stage.gpu_id = 0
          stage.resources_inherit = false
          continue
        }
        if (stage.cpu_cores == null) stage.cpu_cores = 6
        stage.use_gpu = false
        stage.num_gpus = 0
        stage.resources_inherit = false
        continue
      }
      const hasExplicit =
        stage.resources_inherit === false &&
        stage.cpu_cores != null &&
        stage.use_gpu != null
      if (hasExplicit) continue
      stage.cpu_cores = defaults.cpu_cores ?? 1
      stage.gpu_id = defaults.gpu_id ?? 0
      stage.num_gpus = defaults.num_gpus ?? 1
      stage.use_gpu = defaults.use_gpu ?? true
      stage.resources_inherit = false
    }
  }

  /**
   * Apply sidebar defaults to all equilibration / production stages.
   */
  function applySidebarDefaultsToMdStages() {
    protocol.compute_defaults = { ...computeDefaults }
    const defaults = protocol.compute_defaults
    for (const stage of protocol.stages ?? []) {
      const kind = String(stage.stage_kind || '').toLowerCase()
      const name = String(stage.name || '').toLowerCase()
      if (kind === 'minimization' || name === 'minimization') continue
      stage.cpu_cores = defaults.cpu_cores ?? 1
      stage.gpu_id = defaults.gpu_id ?? 0
      stage.num_gpus = defaults.num_gpus ?? 1
      stage.use_gpu = defaults.use_gpu ?? true
      stage.resources_inherit = false
    }
    if (engine === 'amber') applyAmberFirstBarostatCpuDefault(protocol)
    protocolFormKey += 1
  }

  /** @type {HTMLDivElement | null} */
  let protocolStagesScrollEl = $state(null)
  /** @type {HTMLDivElement | null} */
  let protocolStagesTopScrollEl = $state(null)
  let protocolStagesScrollWidth = $state(0)
  let protocolCanScrollLeft = $state(false)
  let protocolCanScrollRight = $state(false)
  let protocolScrollSyncLock = false

  /**
   * Expand the protocol cards and scroll the given stage into view in the strip.
   * @param {number} index
   */
  async function expandProtocolSectionToStage(index) {
    protocolSectionExpanded = true
    await tick()
    // The strip mounts after expand; poll a few frames until bind:this + layout are ready.
    let scrolled = false
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      if (scrollProtocolStripToStage(index, { behavior: 'smooth' })) {
        scrolled = true
        break
      }
    }
    if (!scrolled) return
    // Overflow arrows add px-10 after the first scroll; remeasure and snap again so the
    // last card (Production) is fully visible, not clipped by the right control.
    await tick()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    syncProtocolScrollWidth()
    await tick()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    scrollProtocolStripToStage(index, { behavior: 'auto' })
  }

  /**
   * @param {number} index
   * @param {{ behavior?: ScrollBehavior }} [opts]
   * @returns {boolean} true when the stage card was found and scrolled
   */
  function scrollProtocolStripToStage(index, opts = {}) {
    const behavior = opts.behavior ?? 'smooth'
    const scrollEl = protocolStagesScrollEl
    if (!scrollEl) return false
    const card = scrollEl.querySelector(`[data-eq-stage-index="${index}"]`)
    if (!(card instanceof HTMLElement)) return false
    syncProtocolScrollWidth()
    const cardRect = card.getBoundingClientRect()
    const scrollRect = scrollEl.getBoundingClientRect()
    if (cardRect.width < 1 || scrollRect.width < 1) return false

    const max = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
    const cardLeft = scrollEl.scrollLeft + (cardRect.left - scrollRect.left)
    // Scroll range that keeps the whole card inside the viewport.
    const minToShow = cardLeft + cardRect.width - scrollEl.clientWidth
    const maxToShow = cardLeft
    const center = cardLeft - (scrollEl.clientWidth - cardRect.width) / 2
    let next = Math.min(maxToShow, Math.max(minToShow, center))
    next = Math.max(0, Math.min(max, next))

    const stageCount = scrollEl.querySelectorAll('[data-eq-stage-index]').length
    // Last stage: always go to the end so Production is not left partially clipped.
    if (stageCount > 0 && index >= stageCount - 1) {
      next = max
    }

    const top = protocolStagesTopScrollEl
    protocolScrollSyncLock = true
    scrollEl.scrollTo({ left: next, behavior })
    top?.scrollTo({ left: next, behavior })
    updateProtocolScrollButtons()
    const unlock = () => {
      protocolScrollSyncLock = false
      updateProtocolScrollButtons()
      scrollEl.removeEventListener('scrollend', unlock)
      top?.removeEventListener('scrollend', unlock)
    }
    if (behavior === 'smooth') {
      scrollEl.addEventListener('scrollend', unlock, { once: true })
      top?.addEventListener('scrollend', unlock, { once: true })
      setTimeout(unlock, 400)
    } else {
      queueMicrotask(unlock)
    }
    return true
  }

  function updateProtocolScrollButtons() {
    const el = protocolStagesScrollEl
    if (!el) {
      protocolCanScrollLeft = false
      protocolCanScrollRight = false
      return
    }
    const max = el.scrollWidth - el.clientWidth
    protocolCanScrollLeft = max > 1 && el.scrollLeft > 1
    protocolCanScrollRight = max > 1 && el.scrollLeft < max - 1
  }

  function syncProtocolScrollWidth() {
    const el = protocolStagesScrollEl
    if (!el) {
      protocolStagesScrollWidth = 0
      return
    }
    protocolStagesScrollWidth = el.scrollWidth
    updateProtocolScrollButtons()
  }

  /**
   * Keep the top and bottom horizontal scrollbars in sync.
   * Writing scrollLeft on the peer fires a scroll event; keep the lock through that
   * microtask so we do not ping-pong and cancel in-progress scroll animations.
   * @param {'top' | 'bottom'} source
   */
  function syncProtocolScrollbars(source) {
    if (protocolScrollSyncLock) return
    const top = protocolStagesTopScrollEl
    const bottom = protocolStagesScrollEl
    if (!top || !bottom) return
    protocolScrollSyncLock = true
    if (source === 'top') bottom.scrollLeft = top.scrollLeft
    else top.scrollLeft = bottom.scrollLeft
    updateProtocolScrollButtons()
    queueMicrotask(() => {
      protocolScrollSyncLock = false
    })
  }

  /**
   * @param {-1 | 1} dir
   */
  function scrollProtocolStages(dir) {
    const el = protocolStagesScrollEl
    const top = protocolStagesTopScrollEl
    if (!el) return
    // One stage card + flex gap-4 (16px).
    const card = el.firstElementChild
    const gapPx = 16
    const cardWidth =
      card instanceof HTMLElement ? Math.round(card.getBoundingClientRect().width) : 320
    const step = Math.max(cardWidth + gapPx, 320)
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    const next = Math.max(0, Math.min(max, el.scrollLeft + dir * step))
    // Set both rails under the sync lock so peer scroll events cannot cancel the jump.
    protocolScrollSyncLock = true
    el.scrollTo({ left: next, behavior: 'smooth' })
    top?.scrollTo({ left: next, behavior: 'smooth' })
    updateProtocolScrollButtons()
    const unlock = () => {
      protocolScrollSyncLock = false
      updateProtocolScrollButtons()
      el.removeEventListener('scrollend', unlock)
      top?.removeEventListener('scrollend', unlock)
    }
    el.addEventListener('scrollend', unlock, { once: true })
    top?.addEventListener('scrollend', unlock, { once: true })
    // Fallback if scrollend is unavailable / already at target.
    setTimeout(unlock, 400)
  }

  $effect(() => {
    // Refresh overflow / dual-scrollbar width when stages remount or count changes.
    void protocolFormKey
    void (protocol.stages?.length ?? 0)
    const el = protocolStagesScrollEl
    const top = protocolStagesTopScrollEl
    if (!el) return
    const onBottomScroll = () => syncProtocolScrollbars('bottom')
    const onTopScroll = () => syncProtocolScrollbars('top')
    el.addEventListener('scroll', onBottomScroll, { passive: true })
    top?.addEventListener('scroll', onTopScroll, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncProtocolScrollWidth) : null
    ro?.observe(el)
    const frame = requestAnimationFrame(syncProtocolScrollWidth)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onBottomScroll)
      top?.removeEventListener('scroll', onTopScroll)
      ro?.disconnect()
    }
  })

  /**
   * Ensure recovered protocol stages have fields the stage editor expects.
   * @param {Record<string, unknown>} stage
   */
  function fillStageDefaults(stage) {
    const s = { ...stage }
    if (s.description == null) s.description = ''
    if (s.pressure == null) s.pressure = 1.0
    if (s.dcd_freq == null) s.dcd_freq = 5000
    if (s.timestep == null || Number(s.timestep) <= 0) s.timestep = 2.0
    if (s.temperature == null) s.temperature = 303.15
    if (s.time_ns == null) s.time_ns = 0
    if (s.steps == null) s.steps = 0
    if (!Array.isArray(s.constraints)) s.constraints = []
    return s
  }

  /**
   * Merge job protocol with default selection aliases so constraint editors work.
   * @param {object | null | undefined} raw
   */
  function protocolFromJobMetadata(raw) {
    if (!raw || !Array.isArray(raw.stages) || raw.stages.length === 0) return null
    const cloned = plainClone(raw)
    if (!cloned || !Array.isArray(cloned.stages)) return null
    cloned.selections = {
      ...(baseProtocol.selections ?? {}),
      ...(cloned.selections ?? {})
    }
    cloned.stages = cloned.stages.map((stage) => fillStageDefaults(stage))
    // Ensure constraints are GUI list-shaped (API may still send dicts for older jobs)
    for (const stage of cloned.stages) {
      const c = stage?.constraints
      if (c && !Array.isArray(c) && typeof c === 'object') {
        stage.constraints = Object.entries(c).map(([key, force]) => ({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
          force_constant: Number(force),
          selection: key
        }))
      }
      // Keep Time (ns) ↔ Steps consistent (production often has only one side filled).
      const ts = Number(stage.timestep) || 0
      const steps = Number(stage.steps) || 0
      const timeNs = Number(stage.time_ns) || 0
      if (ts > 0 && steps > 0 && timeNs <= 0) {
        stage.time_ns = Number(((steps * ts) / 1_000_000).toPrecision(9))
      } else if (ts > 0 && timeNs > 0 && steps <= 0) {
        stage.steps = Math.round((timeNs * 1_000_000) / ts)
      }
    }
    return prepareProtocolForRendering(cloned)
  }

  /**
   * Apply CPU/GPU / compute-target fields from job resources or first protocol stage.
   * @param {EquilibrationJob} job
   * @param {object | null} appliedProtocol
   */
  function applyJobResourcesToForm(job, appliedProtocol) {
    const res = job.resources ?? null

    const defaults = res?.compute_defaults
    if (defaults && typeof defaults === 'object') {
      if (typeof defaults.cpu_cores === 'number' && defaults.cpu_cores > 0) {
        totalCpus = defaults.cpu_cores
      }
      if (typeof defaults.gpu_id === 'number' && defaults.gpu_id >= 0) {
        gpuDevice = defaults.gpu_id
      }
      if (typeof defaults.num_gpus === 'number' && defaults.num_gpus >= 0) {
        totalGpus = defaults.num_gpus
      }
      if (typeof defaults.use_gpu === 'boolean') {
        computeTarget = defaults.use_gpu ? computeTarget : 'CPU'
      }
    }

    if (appliedProtocol?.stages?.length && res?.stages?.length) {
      for (let i = 0; i < appliedProtocol.stages.length; i++) {
        const saved = res.stages[i]
        if (!saved || typeof saved !== 'object') continue
        const stage = appliedProtocol.stages[i]
        for (const key of ['cpu_cores', 'gpu_id', 'num_gpus', 'use_gpu', 'resources_inherit', 'stage_kind']) {
          if (saved[key] != null) stage[key] = saved[key]
        }
      }
    }

    if (appliedProtocol && res?.compute_defaults) {
      appliedProtocol.compute_defaults = { ...res.compute_defaults }
    }

    const stage0 = appliedProtocol?.stages?.[0] ?? null
    const cpu =
      (typeof res?.cpu_cores_max === 'number' ? res.cpu_cores_max : null) ??
      (typeof res?.cpu_cores_min === 'number' ? res.cpu_cores_min : null) ??
      (typeof stage0?.cpu_cores === 'number' && stage0.cpu_cores > 0 ? stage0.cpu_cores : null)
    if (typeof cpu === 'number' && cpu > 0) totalCpus = cpu

    const gpuId =
      (typeof res?.gpu_id_min === 'number' ? res.gpu_id_min : null) ??
      (typeof stage0?.gpu_id === 'number' ? stage0.gpu_id : null)
    if (typeof gpuId === 'number' && gpuId >= 0) gpuDevice = gpuId

    const numGpus =
      (typeof res?.num_gpus === 'number' ? res.num_gpus : null) ??
      (typeof stage0?.num_gpus === 'number' && stage0.num_gpus > 0 ? stage0.num_gpus : null)
    if (typeof numGpus === 'number' && numGpus > 0) totalGpus = numGpus

    const useGpuFlag =
      typeof res?.use_gpu === 'boolean'
        ? res.use_gpu
        : typeof stage0?.use_gpu === 'boolean'
          ? stage0.use_gpu
          : null
    if (useGpuFlag === false) {
      computeTarget = 'CPU'
    } else if (job.variant && GPU_TARGETS.includes(job.variant)) {
      computeTarget = /** @type {'CUDA' | 'OpenCL' | 'Metal'} */ (job.variant)
    } else if (useGpuFlag === true && GPU_TARGETS.includes('CUDA')) {
      computeTarget = 'CUDA'
    }
  }

  /**
   * @param {EquilibrationJob} job
   * @param {{
   *   protocol?: EquilibrationJob['protocol'],
   *   inputDir?: string|null,
   *   ensemble?: string|null,
   *   resources?: EquilibrationJob['resources'],
   *   variant?: string|null,
   *   engine?: string|null,
   *   gpuResident?: boolean|null,
   * }} fields
   */
  function applyLoadedJobToForm(job, fields) {
    outputName = job.name
    const parent = parentDirPath(job.jobDir)
    if (parent) outputParentDir = parent
    const nextEngine = normalizeEngineId(fields.engine) || normalizeEngineId(job.engine)
    if (nextEngine && nextEngine !== engine) {
      engine = nextEngine
      engineCandidateId = 'custom'
      executableCheck = null
      availableCompute = []
      selectedGmxrc = null
    } else if (nextEngine) {
      engine = nextEngine
    }
    if (fields.inputDir != null && String(fields.inputDir).trim()) {
      setInputDirectory(fields.inputDir)
    }
    if (fields.ensemble) ensemble = formEnsembleValue(fields.ensemble)
    if (typeof fields.gpuResident === 'boolean') {
      gpuResident = fields.gpuResident
    } else if (typeof /** @type {any} */ (job).gpuResident === 'boolean') {
      gpuResident = /** @type {any} */ (job).gpuResident
    }

    const applied = protocolFromJobMetadata(fields.protocol ?? null)
    if (applied) {
      // Job metadata may store a concrete Production ensemble; bind that
      // stage back to the sidebar so later engine/ensemble switches stay in sync.
      syncProtocolToSidebarEnsemble(applied, ensemble, nextEngine || engine)
      protocol = applied
      protocolFormKey += 1
      logEvent(
        'info',
        'eq',
        `Loaded form from ${job.name}`,
        nextEngine
          ? `${nextEngine.toUpperCase()} · ${applied.stages.length} stages restored`
          : `${applied.stages.length} protocol stages restored`
      )
    } else {
      logEvent(
        'warn',
        'eq',
        `Loaded ${job.name} without protocol stages`,
        'Re-generate inputs or restore protocol_summary.json / equilibration_job.json protocol'
      )
    }

    applyJobResourcesToForm(
      {
        ...job,
        resources: fields.resources ?? job.resources,
        variant: fields.variant ?? job.variant,
        engine: nextEngine || job.engine
      },
      applied
    )
    formSourceJobDir = job.jobDir
    statusSynced = true
    queueMicrotask(() => {
      document.getElementById('eq-protocol-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    })
  }

  /** @param {unknown} protocol */
  function protocolLooksComplete(protocol) {
    const stages = /** @type {{ name?: string, time_ns?: number, steps?: number }[]} */ (
      protocol && typeof protocol === 'object' && Array.isArray(/** @type {any} */ (protocol).stages)
        ? /** @type {any} */ (protocol).stages
        : null
    )
    if (!stages?.length) return false
    const prod = stages.find((s) => /production/i.test(String(s?.name || '')))
    if (!prod) return false
    return Number(prod.time_ns) > 0 || Number(prod.steps) > 0
  }

  /** @param {EquilibrationJob} job */
  async function useJobInForm(job) {
    // Local disk only — never needs Connect & probe / SSH.
    usingInFormDir = job.jobDir
    const dir = job.jobDir
    formSourceJobDir = dir

    try {
      // Apply identity fields while we recover metadata from local job files.
      const nextEngine = normalizeEngineId(job.engine)
      if (nextEngine) {
        if (nextEngine !== engine) {
          engine = nextEngine
          engineCandidateId = 'custom'
          executableCheck = null
          availableCompute = []
          selectedGmxrc = null
        } else {
          engine = nextEngine
        }
      }
      outputName = job.name
      if (job.inputDir) setInputDirectory(job.inputDir)
      if (job.ensemble) ensemble = formEnsembleValue(job.ensemble)

      const summary = await Promise.race([
        getEquilibrationJobSummary(dir, workingDir || undefined, { forForm: true }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Job summary timed out')), 8000)
        })
      ])
      if (formSourceJobDir !== dir) return
      applyLoadedJobToForm(job, {
        protocol: summary.protocol?.stages?.length ? summary.protocol : job.protocol,
        inputDir: summary.input_dir ?? job.inputDir,
        ensemble: summary.ensemble ?? job.ensemble,
        resources: summary.resources?.num_gpus != null || summary.resources?.cpu_cores_max != null
          ? summary.resources
          : job.resources,
        variant: summary.variant ?? job.variant,
        engine: summary.engine ?? job.engine,
        gpuResident:
          typeof summary.gpu_resident === 'boolean'
            ? summary.gpu_resident
            : /** @type {any} */ (job).gpuResident
      })
    } catch (err) {
      try {
        applyLoadedJobToForm(job, {
          protocol: job.protocol,
          inputDir: job.inputDir,
          ensemble: job.ensemble,
          resources: job.resources,
          variant: job.variant,
          engine: job.engine,
          gpuResident: /** @type {any} */ (job).gpuResident
        })
      } catch (applyErr) {
        logEvent(
          'error',
          'eq',
          `Use in form failed for ${job.name}`,
          applyErr instanceof Error ? applyErr.message : String(applyErr)
        )
      }
      if (String(err?.message || err).includes('timed out')) {
        logEvent(
          'warn',
          'eq',
          `Use in form: local folder read timed out for ${job.name}`,
          'No cluster connection required — try again, or Pull if inputs are missing locally'
        )
      }
    } finally {
      if (usingInFormDir === dir) usingInFormDir = null
    }
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
    void refreshJobLogFiles(index)
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
      jobs[index] = { ...jobs[index], watched: true, showStages: true, running: false }
      autoMonitor = true
      restartPolling()
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
        showStages: true,
        continuing: false,
        status: 'running',
        error: null,
        equilibrationOutput: ''
      }
      autoMonitor = true
      restartPolling()
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
    if (resolvedOutputParent !== '') {
      showWorkingDirHint = false
      highlightWorkingDir(false)
    }
  })

  /** Last scan roots we scanned — avoid wiping Use-in-form state on spurious effect re-runs. */
  let lastScannedRootsKey = ''
  /** True when scan roots changed while another tab was active; scan runs on first visit. */
  let jobsScanPending = false

  $effect(() => {
    const roots = uniqueDirList(workingDir, outputParentDir)
    const rootsKey = roots.join('\0')
    const active = pageActive
    if (!rootsKey) {
      jobs = []
      loadingJobs = false
      usingInFormDir = null
      formSourceJobDir = null
      jobsScanGeneration += 1
      lastScannedRootsKey = ''
      jobsScanPending = false
      return
    }
    if (!active) {
      if (rootsKey !== lastScannedRootsKey) {
        jobsScanPending = true
        jobsScanGeneration += 1
        if (lastScannedRootsKey) {
          jobs = []
          formSourceJobDir = null
          usingInFormDir = null
        }
      }
      return
    }
    if (rootsKey === lastScannedRootsKey && !jobsScanPending) return
    jobsScanPending = false
    lastScannedRootsKey = rootsKey
    // Clear previous directory cards immediately so the Progress pane shows Loading…
    jobs = []
    formSourceJobDir = null
    usingInFormDir = null
    loadingJobs = true
    void rescanJobs()
  })

  $effect(() => {
    if (!autoMonitor) {
      stopPolling()
      return
    }
    // Ticking Update progress with nothing watched → watch oldest so polling has a target.
    if (!jobs.some((j) => j.watched)) {
      watchOldestJob()
    }
    if (jobs.some((j) => j.watched)) {
      startPolling()
    }
  })

  // Restart interval when the period changes while monitoring.
  $effect(() => {
    const _sec = updateInterval
    if (!autoMonitor || !pollIntervalId) return
    untrack(() => restartPolling())
  })

  $effect(() => {
    void clusterProfilesStore.revision
    if (!pageActive) return
    void loadClusterProfiles()
      .then((list) => {
        progressClusterProfiles = list
        if (!progressClusterProfileId && list.length) {
          progressClusterProfileId = list[0].id
        } else if (
          progressClusterProfileId &&
          list.length &&
          !list.some((p) => p.id === progressClusterProfileId)
        ) {
          progressClusterProfileId = list[0].id
        }
      })
      .catch(() => {})
  })

  onDestroy(() => {
    stopPolling()
  })

  async function connectProgressCluster() {
    const profile = progressClusterProfiles.find((p) => p.id === progressClusterProfileId)
    if (!profile) {
      logEvent('error', 'eq', 'Select a cluster profile first')
      return
    }
    try {
      await connectSharedCluster(profile, progressClusterPassword)
      progressClusterPassword = ''
      logEvent('info', 'eq', `Cluster connected: ${profile.name || profile.host}`)
      void refreshRemoteCardSizes()
      prefetchJobRuntimes()
    } catch (err) {
      const msg = formatClusterConnectError(err, profile)
      logEvent('error', 'eq', msg)
    }
  }

  async function disconnectProgressCluster() {
    await disconnectSharedCluster()
    logEvent('info', 'eq', 'Cluster disconnected')
  }

  // When inventory probe finishes (Progress Connect, Pull auto-connect, or cluster dialog),
  // load remote card runtimes without requiring Stages to be opened. Wait for probe so
  // per-job log sync does not contend with sinfo / module avail.
  let remoteRuntimePrefetchKey = ''
  $effect(() => {
    const ready = clusterSession.inventoryReady
    const sid = clusterSession.sessionId || ''
    const remoteDirs = jobs
      .filter((j) => jobCanSyncCluster(j))
      .map((j) => j.jobDir)
      .join('|')
    if (!ready || !sid || !remoteDirs) return
    const key = `${sid}:${remoteDirs}`
    if (key === remoteRuntimePrefetchKey) return
    remoteRuntimePrefetchKey = key
    untrack(() => {
      const tasks = []
      for (let i = 0; i < jobs.length; i++) {
        if (jobCanSyncCluster(jobs[i])) {
          const index = i
          tasks.push(() => ensureJobRuntimeLoaded(index))
        }
      }
      void runWithConcurrency(tasks)
    })
  })

  $effect(() => {
    const dir = inputDir
    void inputDirRevision
    if (!dir) {
      systemSize = null
      hasProtein = null
      loadingSystemSize = false
      return
    }
    loadingSystemSize = true
    systemSize = null
    let cancelled = false
    Promise.all([countMatchingAtoms(dir, 'all'), countMatchingAtoms(dir, 'protein')])
      .then(([nAll, nProt]) => {
        if (cancelled) return
        systemSize = nAll
        if (nProt === null) {
          hasProtein = null
          return
        }
        applyProteinPresence(nProt > 0)
      })
      .finally(() => {
        if (!cancelled) loadingSystemSize = false
      })
    return () => {
      cancelled = true
    }
  })

  /**
   * Count atoms in the builder system files under {@link dir}.
   * @param {string} dir - Builder input directory (absolute path).
   * @param {string} selection - MDAnalysis selection or named alias.
   * @returns {Promise<number|null>} The number of selected atoms.
   */
  async function countMatchingAtoms(dir, selection) {
    if (!dir) {
      return null
    }
    const payload = {
      path: `${dir}/system.inpcrd`,
      selection,
      topology: `${dir}/system.prmtop`
    }
    try {
      const { atoms } = await getStructure(payload)
      return atoms.length
    } catch {
      return null
    }
  }

  /**
   * @param {{ name?: string, selection?: string }} c
   */
  function isProteinProtocolConstraint(c) {
    const key = String(c?.selection || c?.name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
    if (key === 'protein_backbone' || key === 'protein_sidechain') return true
    const name = String(c?.name || '').trim().toLowerCase()
    if (name === 'protein backbone' || name === 'protein sidechain') return true
    const sel = String(c?.selection || '').trim().toLowerCase()
    return sel === 'protein and backbone' || sel === 'protein and not backbone'
  }

  function restoreProteinConstraintsFromBase() {
    const baseStages = baseProtocol.stages ?? []
    const selections = {
      ...(baseProtocol.selections ?? {}),
      ...(protocol.selections ?? {})
    }
    for (let i = 0; i < (protocol.stages ?? []).length; i++) {
      const baseCons = baseStages[i]?.constraints ?? []
      const protCons = baseCons.filter((c) => isProteinProtocolConstraint(c))
      if (!protCons.length) continue
      const existing = protocol.stages[i].constraints ?? []
      const withoutProt = existing.filter((c) => !isProteinProtocolConstraint(c))
      protocol.stages[i].constraints = [
        ...protCons.map((c) => {
          const copy = { ...c, id: crypto.randomUUID() }
          if (copy.selection != null && selections[copy.selection] != null) {
            copy.selection = selections[copy.selection]
          }
          return copy
        }),
        ...withoutProt
      ]
    }
  }

  /**
   * Omit protein backbone/sidechain rows when the loaded system has no protein.
   * Restore them from the default protocol when switching back to a protein system.
   * @param {boolean} proteinPresent
   */
  function applyProteinPresence(proteinPresent) {
    const prev = hasProtein
    if (!proteinPresent) {
      let stripped = false
      for (const stage of protocol.stages ?? []) {
        if (!Array.isArray(stage.constraints)) continue
        const next = stage.constraints.filter((c) => !isProteinProtocolConstraint(c))
        if (next.length !== stage.constraints.length) {
          stage.constraints = next
          stripped = true
        }
      }
      addComRestraint = false
      addRotationRestraint = false
      if (stripped) protocolFormKey += 1
    } else if (prev === false) {
      restoreProteinConstraintsFromBase()
      protocolFormKey += 1
    }
    hasProtein = proteinPresent
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
      currentProtocol.compute_defaults = { ...computeDefaults }
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
        ...(engine === 'openmm' && openmmPlatform !== null ? { openmmPlatform } : {}),
        ...(engine === 'namd' && useGpu ? { gpuResident } : {})
      })
      protocol = prepareProtocolForRendering(currentProtocol)
      statusSynced = true
      await rescanJobs()
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
      protocolFormKey += 1
      if (hasProtein === false) applyProteinPresence(false)
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
    if (p?.compute_defaults && typeof p.compute_defaults === 'object') {
      const d = p.compute_defaults
      if (typeof d.cpu_cores === 'number' && d.cpu_cores > 0) totalCpus = d.cpu_cores
      if (typeof d.gpu_id === 'number' && d.gpu_id >= 0) gpuDevice = d.gpu_id
      if (typeof d.num_gpus === 'number' && d.num_gpus > 0) totalGpus = d.num_gpus
      if (d.use_gpu === false) computeTarget = 'CPU'
    }
    materializeStageResources(p)
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
      currentProtocol.compute_defaults = { ...computeDefaults }
      await window.api.writeJson(filePath, prepareProtocolForSerialization(currentProtocol))
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
    if (resolvedOutputParent !== '') return
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
    setInputDirectory(dirPath)
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
        jobs = jobs.map((j, i) =>
          i === idx ? { ...j, watched: true, showStages: true } : j
        )
        autoMonitor = true
        restartPolling()
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

  function onClearForm() {
    setInputDirectory('')
    outputName = ''
    outputParentDir = ''
    formSourceJobDir = null
    engine = 'namd'
    ensemble = 'npt'
    gpuDevice = 0
    totalCpus = 1
    totalGpus = 1
    updateInterval = 60
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
    gpuResident = true
    availableCompute = []
    executableByEngine = { namd: 'namd3', gromacs: 'gmx', openmm: 'python', amber: 'pmemd' }
    engineCandidates = []
    engineCandidateId = 'custom'
    selectedGmxrc = null
    hasProtein = null
    protocol = prepareProtocolForRendering(structuredClone(baseProtocol))
    applyEngineResourceDefaults('namd')
    protocolFormKey += 1
    constraintEditor = null
    statusSynced = false
    generatingInputFiles = false
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
            {#if hasProtein === false}
              <p class="sidebar-hint mb-2">
                No protein detected — protein restraints omitted from the protocol.
              </p>
            {/if}
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
    </div>
    <Divider />
    <div class="space-y-2">
      <h2 class="sidebar-heading">Molecular Dynamics</h2>
      <div class="space-y-1" id="eq-engine-select">
        <p class="sidebar-label">Engine</p>
        {#key engine}
          <Select
            size="sm"
            className="w-full"
            bind:value={engine}
            onchange={() => {
              executableCheck = null
              availableCompute = []
              engineCandidateId = 'custom'
              selectedGmxrc = null
              // Re-applies engine resource defaults, re-binds Production to
              // sidebar ensemble, and fills engine-specific stage fields.
              applyEngineResourceDefaults(engine)
            }}
          >
            {#each engines as item (item.id)}
              <option value={item.id}>{item.label}</option>
            {/each}
          </Select>
        {/key}
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
        {#if engine === 'namd' && useGpu}
          <div class="space-y-1 pt-1">
            <div class="flex items-center gap-2">
              <Checkbox id="gpu-resident" bind:checked={gpuResident} />
              <label for="gpu-resident" class="sidebar-label">GPU-resident mode</label>
            </div>
            <p class="sidebar-hint">
              Adds GPUresident to the production stage only. Equilibration keeps
              reassignFreq/reassignTemp for stability.
            </p>
          </div>
        {/if}
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
      <h2 class="sidebar-heading col-span-2">Default compute resources</h2>
      <label for="cpu-cores" class="sidebar-label flex-1">CPU Cores</label>
      <Input id="cpu-cores" type="number" size="sm" bind:value={totalCpus} />

      {#if useGpu}
        <label for="gpu_id" class="sidebar-label">GPU ID</label>
        <Input id="gpu-id" type="number" size="sm" bind:value={gpuDevice} />

        <label for="num-gpus" class="sidebar-label">Number of GPUs</label>
        <Input id="num-gpus" type="number" size="sm" bind:value={totalGpus} />
      {/if}
      <p class="sidebar-hint col-span-2">
        Defaults for new / inherited stages. Edit each card directly, or apply in bulk:
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="col-span-2 w-full"
        onclick={applySidebarDefaultsToMdStages}
        disabled={!isProtocolValid}
      >
        Apply defaults to MD stages
      </Button>
    </div>

    <Divider />

    <OutputPathFields
      bind:parentDir={outputParentDir}
      bind:folderName={outputName}
      workingDir={workingDir}
      folderPlaceholder={suggestedOutputFolderName}
      resolvedFolderName={resolveOutputFolderName()}
    />
    {#if !outputName.trim() && inputDir}
      <p class="sidebar-hint">
        Empty uses <span class="font-mono">{suggestedOutputFolderName}</span> when generating inputs
      </p>
    {/if}

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
            Run locally
          {/if}
        </Button>
      </div>
      {#if formFolderRunning && resolvedOutputParent !== ''}
        <div class="gw-notice gw-notice-warning">
          <p>MD is running in</p>
          <p class="mt-0.5 break-all font-semibold">{resolveOutputFolderName()}</p>
          <p class="mt-1">
            Change the <strong>Output folder</strong> name to generate inputs or run another
            simulation.
          </p>
        </div>
      {/if}
      {#if formFolderStatus === 'empty' && resolvedOutputParent !== ''}
        <p class="gw-notice gw-notice-warning">
          Input files have not been generated yet. Click <strong>Generate Input Files</strong> first.
        </p>
      {/if}
      {#if formFolderStatus === 'not_started' && resolvedOutputParent !== '' && !formFolderRunning}
        <div class="gw-notice gw-notice-success">
          <p>✓ Input files are ready in</p>
          <p class="mt-0.5 break-all font-semibold">{resolveOutputFolderName()}</p>
          <p class="mt-1">
            Click <strong>Run locally</strong>, or open the job card and choose
            <strong>Run on cluster…</strong>
          </p>
        </div>
      {/if}
      {#if resolvedOutputParent === '' && showWorkingDirHint}
        <p class="gw-notice gw-notice-warning">
          Set a <strong>Working Directory</strong> in the top bar, or browse an output path, to enable
          these actions.
        </p>
      {/if}
      <Button className="w-full" variant="ghost" onclick={onClearForm}>Clear form</Button>
    </div>
  </aside>
  <div
    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-6">
      <div class="gw-notice gw-notice-warning">
        <p class="font-semibold">TESTING PROTOCOLS, NOT FOR PRODUCTION</p>
        <p class="mt-1">
          Equilibration thermalizes under NVT, scaffolds under NVT, then packs under NPgT (γ=0) for 50 ns of MD (Eq1–6).
          Production is the first stage that uses the selected ensemble. Protocols are still under active testing. Use for
          development and validation only.
        </p>
      </div>
      <button
        type="button"
        id="eq-protocol-panel"
        class="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={protocolSectionExpanded}
        aria-controls="eq-protocol-stages"
        onclick={() => (protocolSectionExpanded = !protocolSectionExpanded)}
      >
        <h1 class="text-xl font-semibold">Equilibration protocol</h1>
        <span class="text-sm text-neutral-500" aria-hidden="true"
          >{protocolSectionExpanded ? '▾' : '▸'}</span
        >
      </button>
      <div>
        {#if isProtocolValid}
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {protocol.name}
            <span class="ml-2 font-normal text-neutral-500">({protocol.stages.length} stages)</span>
          </p>
        {/if}
        <p class="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
          {isProtocolValid ? protocol.description : 'Load a protocol to get started'}
        </p>
        <div class="flex items-center gap-2">
          <p class="text-sm">Ensemble:</p>
          <Select bind:value={ensemble} onchange={onSidebarEnsembleChange}>
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
        <div id="eq-protocol-stages">
          {#if protocolSectionExpanded}
            {@const protocolStagesOverflow = protocolCanScrollLeft || protocolCanScrollRight}
            <div class="relative {protocolStagesOverflow ? 'px-10' : ''}">
              {#if protocolCanScrollLeft}
                <button
                  type="button"
                  class="absolute left-0 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-300 bg-white/95 text-neutral-800 shadow-md hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  title="Scroll stages left"
                  aria-label="Scroll stages left"
                  onclick={() => scrollProtocolStages(-1)}
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              {/if}
              {#if protocolCanScrollRight}
                <button
                  type="button"
                  class="absolute right-0 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-300 bg-white/95 text-neutral-800 shadow-md hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  title="Scroll stages right"
                  aria-label="Scroll stages right"
                  onclick={() => scrollProtocolStages(1)}
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              {/if}
              <!-- Top horizontal scrollbar (synced with the stage strip below). -->
              <div
                bind:this={protocolStagesTopScrollEl}
                class="mb-1 overflow-x-auto overflow-y-hidden {protocolStagesOverflow
                  ? ''
                  : 'invisible mb-0 h-0'}"
                aria-hidden="true"
              >
                <div style="width: {protocolStagesScrollWidth}px; height: 1px;"></div>
              </div>
              <div
                bind:this={protocolStagesScrollEl}
                class="flex w-full items-start gap-4 overflow-x-auto pb-2"
              >
                {#key protocolFormKey}
                  {#each protocol.stages as _, i (protocol.stages[i].name + '-' + i)}
                    <div data-eq-stage-index={i} class="shrink-0">
                      <EquilibrationStage
                        bind:stage={protocol.stages[i]}
                        {ensemble}
                        {engine}
                        onAddConstraint={() => openConstraintEditorForAdd(i)}
                        onEditConstraint={(ci) => openConstraintEditorForEdit(i, ci)}
                      />
                    </div>
                  {/each}
                {/key}
              </div>
            </div>
          {:else}
            <div
              class="flex w-full items-stretch gap-2 overflow-x-auto pb-2"
              aria-label="Protocol stage summary"
            >
              {#each protocol.stages as stage, i (stage.name + '-summary-' + i)}
                {@const summary = summarizeProtocolStage(stage, ensemble)}
                <button
                  type="button"
                  class="flex min-w-[9.5rem] shrink-0 flex-col gap-0.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-left text-neutral-900 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
                  title="Expand and show {summary.name}"
                  aria-label="Expand protocol and show {summary.name}"
                  onclick={() => expandProtocolSectionToStage(i)}
                >
                  <span class="truncate text-sm font-semibold">{summary.name}</span>
                  <span class="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
                    {summary.durationLabel}
                    {#if summary.ensembleLabel !== '—'}
                      <span class="text-neutral-400"> · </span>{summary.ensembleLabel}
                    {/if}
                  </span>
                  <span
                    class="w-fit rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                    >{summary.resourceLabel}</span
                  >
                  {#if summary.restraintLabel}
                    <span class="text-[10px] text-neutral-500 dark:text-neutral-400"
                      >{summary.restraintLabel}</span
                    >
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <Empty message="No protocol loaded" />
      {/if}

      <div
        class="flex flex-col gap-2 border-t border-neutral-200 pt-4 text-xs dark:border-neutral-800"
      >
        <h3 class="font-semibold uppercase">Progress</h3>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
          <Checkbox name="auto-monitor" size="sm" bind:checked={autoMonitor} />
          <label for="auto-monitor" class="text-neutral-600 dark:text-neutral-400" title="Auto-update watched jobs"
            >Auto</label
          >
          <Input
            type="number"
            name="update-interval"
            min="1"
            max="600"
            step="1"
            bind:value={updateInterval}
            size="sm"
            className="w-12"
            title="Update interval (seconds)"
          />
          <span class="text-neutral-500">s</span>
          {#if jobs.some((j) => j.watched) && autoMonitor}
            <Spinner className="size-3.5" label="Updating watched jobs" />
          {/if}
          <button
            type="button"
            class="inline-flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            onclick={() => pollWatchedJobs({ scheduleNext: false })}
            disabled={!jobs.some((j) => j.watched)}
            title="Refresh watched jobs"
            aria-label="Refresh watched jobs"
          >
            <ResetIcon className="size-3.5 fill-current" />
          </button>

          <span class="hidden h-4 w-px shrink-0 bg-neutral-300 sm:inline dark:bg-neutral-700" aria-hidden="true"></span>

          <label for="progress-sort-order" class="text-neutral-500">Order</label>
          <select
            id="progress-sort-order"
            class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
            value={progressSortOrder}
            onchange={(e) =>
              (progressSortOrder = /** @type {'newest' | 'oldest'} */ (e.currentTarget.value))}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>

          <label for="progress-location-filter" class="text-neutral-500">Location</label>
          <select
            id="progress-location-filter"
            class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
            value={progressFilter}
            onchange={(e) =>
              (progressFilter = /** @type {'all' | 'local' | 'remote'} */ (
                e.currentTarget.value
              ))}
          >
            <option value="all">All</option>
            <option value="local">Local</option>
            <option value="remote">Remote</option>
          </select>

          <label for="progress-status-filter" class="text-neutral-500">Status</label>
          <select
            id="progress-status-filter"
            class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
            value={progressStatusFilter}
            onchange={(e) =>
              (progressStatusFilter = /** @type {typeof progressStatusFilter} */ (
                e.currentTarget.value
              ))}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="failed">Failed</option>
            <option value="ready">Ready</option>
          </select>

          <span class="hidden h-4 w-px shrink-0 bg-neutral-300 sm:inline dark:bg-neutral-700" aria-hidden="true"></span>
          <span class="font-medium text-neutral-600 dark:text-neutral-400">Cluster</span>
          {#if progressClusterProfiles.length > 0}
            <select
              class="max-w-[9rem] rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
              value={progressClusterProfileId}
              disabled={clusterSession.connecting || clusterSession.connected}
              onchange={(e) => (progressClusterProfileId = e.currentTarget.value)}
            >
              {#each progressClusterProfiles as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
            {#if !clusterSession.connected}
              <Input
                type="password"
                size="sm"
                placeholder="Password"
                bind:value={progressClusterPassword}
                className="w-24"
                disabled={clusterSession.connecting}
              />
              <Button
                variant="outline"
                size="sm"
                onclick={connectProgressCluster}
                disabled={clusterSession.connecting || !progressClusterProfileId}
              >
                {#if clusterSession.connecting}
                  <Spinner className="mr-1 size-3" />
                {/if}
                Connect
              </Button>
            {:else}
              <span
                class="max-w-[8rem] truncate text-green-600 dark:text-green-400"
                title={clusterSession.connectedAt}
              >
                {clusterSession.profile?.name || clusterSession.profile?.host}
              </span>
              <Button variant="outline" size="sm" onclick={disconnectProgressCluster}>
                Disconnect
              </Button>
            {/if}
          {:else}
            <span
              class="inline-flex cursor-not-allowed"
              title={CLUSTER_CONNECT_DISABLED_HINT}
              aria-label={CLUSTER_CONNECT_DISABLED_HINT}
            >
              <Button variant="outline" size="sm" disabled className="pointer-events-none">
                Connect
              </Button>
            </span>
          {/if}

          {#if clusterSession.statusMessage && progressClusterProfiles.length > 0}
            <p
              class="basis-full truncate text-[11px] leading-snug {clusterSession.statusError
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-neutral-500'}"
              title={clusterSession.statusMessage}
            >
              {clusterSession.statusMessage}
            </p>
          {/if}
        </div>

        <h4 class="flex items-center gap-2 font-semibold text-neutral-800 dark:text-neutral-200">
          Equilibration Jobs
          {#if loadingJobs}
            <Spinner className="size-3.5" />
          {/if}
        </h4>
        {#if loadingJobs && jobs.length === 0}
          <p
            class="flex items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 p-4 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
          >
            <Spinner className="size-4" />
            Loading equilibration jobs…
          </p>
        {:else if filteredJobs.length === 0}
          <p
            class="flex items-center justify-center rounded-lg border border-dashed border-neutral-300 p-4 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
          >
            {#if jobs.length === 0}
              No equilibration runs found under the working directory. Generate input files or run an
              MD job to see it here.
            {:else}
              No {progressFilterEmptyLabel(progressFilter, progressStatusFilter)} jobs in this list.
            {/if}
          </p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each filteredJobs as job (job.jobDir)}
              {@const jobIndex = jobs.findIndex((j) => j.jobDir === job.jobDir)}
              {@const loadingIntoForm = usingInFormDir === job.jobDir}
              {@const isFormSource = formSourceJobDir === job.jobDir}
              {@const generatedIso = jobGeneratedIso(job)}
              {@const remotePending = remoteSchedulerPending(job)}
              {@const displayStages = jobDisplayStages(job)}
              <div
                class="gw-notice flex min-w-0 flex-col rounded-lg p-2.5 transition-shadow {jobNoticeClass(
                  job.status
                )} {loadingIntoForm
                  ? 'ring-2 ring-sky-500 ring-offset-1 ring-offset-white dark:ring-offset-neutral-950'
                  : isFormSource
                    ? 'ring-2 ring-emerald-500/80 ring-offset-1 ring-offset-white dark:ring-offset-neutral-950'
                    : ''}"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                      {#if job.status === 'running'}
                        {#if remotePending}
                          <span
                            class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400"
                            title="Pending in cluster queue"
                          ></span>
                        {:else}
                          <span
                            class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-yellow-500"
                          ></span>
                        {/if}
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
                      {#if loadingIntoForm}
                        <span
                          class="inline-flex shrink-0 items-center gap-1 rounded border border-sky-500 bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white"
                        >
                          <Spinner className="size-3" />
                          Loading into form…
                        </span>
                      {:else if isFormSource}
                        <span
                          class="inline-flex shrink-0 items-center rounded border border-emerald-600 bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white"
                        >
                          In form
                        </span>
                      {/if}
                      {#if job.execution?.mode === 'remote'}
                        <span
                          class="gw-chip shrink-0"
                          title={job.execution.remote_path || job.execution.cluster_name || 'Remote'}
                        >
                          Remote{#if job.execution.scheduler_job_id}
                            · {job.execution.scheduler_job_id}{/if}
                          {#if job.execution.node_list}
                            · {String(job.execution.node_list).split(',')[0]}{/if}
                          {#if job.execution.last_remote_state}
                            · {job.execution.last_remote_state}{/if}
                        </span>
                      {:else}
                        <span class="gw-chip shrink-0">Local</span>
                      {/if}
                      {#if job.variant}
                        <span class="gw-chip shrink-0">{job.variant}</span>
                      {/if}
                    </div>
                    {#if formatJobCardResources(job)}
                      <p
                        class="mt-1 truncate text-neutral-500"
                        title={formatJobCardResources(job)}
                      >
                        {formatJobCardResources(job)}
                      </p>
                    {/if}
                  </div>
                  <div class="grid shrink-0 grid-cols-[7.75rem_minmax(7rem,auto)_auto] items-start gap-x-2">
                    {#if job.execution?.mode === 'remote' || job.syncSizes}
                      <div class="flex w-[7.75rem] flex-col items-start gap-0.5">
                        <PullSyncRing
                          localBytes={job.syncSizes?.localBytes}
                          remoteBytes={job.syncSizes?.remoteBytes}
                          localLabel={job.syncSizes?.localFormatted || ''}
                          remoteLabel={job.syncSizes?.remoteFormatted || ''}
                          loading={!!job.syncSizes?.loading}
                          pulling={job.pulling}
                          compact
                        />
                        {#if job.execution?.mode === 'remote' && !job.syncSizes?.remoteBytes && clusterSession.sessionId && job.execution?.remote_path && !job.syncSizes?.loading && jobIndex >= 0}
                          <button
                            type="button"
                            class="text-left text-[9px] leading-tight text-sky-600 hover:underline dark:text-sky-400"
                            onclick={() => refreshJobSyncSizes(jobIndex, { measureRemote: true })}
                            title="Measure remote folder size on the cluster"
                          >
                            Measure remote
                          </button>
                        {/if}
                      </div>
                    {:else}
                      <span aria-hidden="true"></span>
                    {/if}
                    <div class="flex min-w-[7rem] flex-col items-end gap-0.5 pt-0.5 text-right">
                      {#if generatedIso}
                        <span
                          class="text-[10px] tabular-nums text-neutral-500"
                          title={job.execution?.mode === 'remote' && !job.startTime
                            ? 'When this job was submitted to the cluster'
                            : 'When this job folder / inputs were generated'}
                          >{formatJobGenerated(generatedIso)}</span
                        >
                      {/if}
                      {#if formatStagesMdElapsed(job.stages)}
                        <span
                          class="text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300"
                          title="Sum of stage runtimes from MD logs (restarts do not double-count wall calendar time)"
                          >Runtime {formatStagesMdElapsed(job.stages)}</span
                        >
                      {:else if job.loadingStages}
                        <span
                          class="text-[10px] text-neutral-500"
                          title="Reading stage runtimes from logs…"
                          >Runtime …</span
                        >
                      {:else if job.stages?.length}
                        <span
                          class="text-[10px] text-neutral-500"
                          title="Stage logs do not report runtimes yet"
                          >Runtime —</span
                        >
                      {:else if
                        job.execution?.mode === 'remote' &&
                        !clusterSession.sessionId &&
                        (job.stagesDone > 0 ||
                          job.status === 'running' ||
                          job.status === 'completed')}
                        <span
                          class="text-[10px] text-neutral-500"
                          title="Connect to the cluster to load stage runtimes"
                          >Runtime —</span
                        >
                      {:else if job.stagesDone > 0 || job.status === 'running' || job.status === 'completed'}
                        <span
                          class="text-[10px] text-neutral-500"
                          title="Stage runtimes not available yet"
                          >Runtime —</span
                        >
                      {/if}
                    </div>
                    {#if job.status !== 'running' && jobIndex >= 0}
                      <button
                        class="pt-0.5 dark:text-neutral-600 dark:hover:text-neutral-300"
                        onclick={() => removeJob(jobIndex)}
                        title="Remove">&times;</button
                      >
                    {/if}
                  </div>
                </div>

                {#if job.error}
                  <p class="mt-1 truncate text-xs text-red-600 dark:text-red-400" title={job.error}>
                    {job.error.length > 160 ? job.error.slice(0, 160) + '…' : job.error}
                  </p>
                {/if}

                {#if job.watched && job.execution?.mode === 'remote' && !clusterSession.sessionId}
                  <p
                    class="mt-1 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200"
                  >
                    <span
                      class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400"
                      aria-hidden="true"
                    ></span>
                    <span
                      >Cluster not connected — use <strong>Connect</strong> in the Progress toolbar
                      to poll Slurm status and sync remote stage logs.</span
                    >
                  </p>
                {/if}

                {#if job.stagesTotal > 0 && (job.stagesDone > 0 || job.status !== 'not_started' || remotePending)}
                  <div class="mt-1.5 flex gap-0.5">
                    {#each Array(job.stagesTotal) as _, si (si)}
                      {@const done = si < job.stagesDone || job.status === 'completed'}
                      {@const active =
                        job.status === 'running' &&
                        !remotePending &&
                        !done &&
                        si === job.stagesDone}
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
                  <p class="mt-1 {remotePending ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500'}">
                    {#if remotePending}
                      {job.stagesDone}/{job.stagesTotal} · pending in queue
                    {:else if job.status === 'running'}
                      {job.stagesDone}/{job.stagesTotal} · running
                    {:else if job.status === 'not_started' && job.stagesDone === 0 && !job.canResume}
                      {job.stagesTotal} stages · ready
                    {:else if remoteNeedsLogCatchUp(job)}
                      {job.stagesDone}/{job.stagesTotal} · catching up logs
                    {:else if job.canResume || job.status === 'error'}
                      {job.stagesDone}/{job.stagesTotal} · interrupted
                    {:else}
                      {job.stagesDone}/{job.stagesTotal} stages
                    {/if}
                  </p>
                {/if}

                {#if job.showStages || job.showInfo}
                  <div
                    class="mt-2 grid grid-cols-1 gap-3 {job.showStages && job.showInfo
                      ? 'lg:grid-cols-2'
                      : ''}"
                  >
                    {#if job.showStages}
                      <div class="min-w-0">
                        <div class="border-t border-neutral-200 pt-2 dark:border-neutral-700 lg:border-t-0 lg:pt-0">
                          {#if remotePending && job.execution?.mode === 'remote'}
                            <p
                              class="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200"
                            >
                              <span
                                class="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400"
                                aria-hidden="true"
                              ></span>
                              <span>
                                Job pending in the cluster queue ({canonicalizeSlurmState(
                                  job.execution?.last_remote_state
                                ) || 'PENDING'}) — MD has not started yet. Stages below are from
                                the protocol outline.
                              </span>
                            </p>
                          {/if}
                          {#if job.syncingRemoteStages && job.execution?.mode === 'remote'}
                            <p class="mb-2 flex items-center gap-1.5 text-xs text-neutral-500">
                              <Spinner className="size-3.5 shrink-0" label="Syncing stage logs" />
                              {#if remoteNeedsLogCatchUp(job)}
                                Catching up stage logs after remote COMPLETED (lightweight sync)…
                              {:else}
                                Syncing stage logs from the cluster (lightweight)… keep Watching on,
                                or click Pull for a full download.
                              {/if}
                            </p>
                          {:else if job.loadingStages && displayStages.length === 0}
                            <p class="mb-2 flex items-center gap-1.5 text-xs text-neutral-500">
                              <Spinner className="size-3" />
                              Loading stage detail from local files…
                            </p>
                          {:else if job.loadingStages && displayStages.length > 0}
                            <p class="mb-2 flex items-center gap-1.5 text-xs text-neutral-500">
                              <Spinner className="size-3" label="Refreshing stages" />
                              Refreshing stage progress…
                            </p>
                          {/if}
                          {#if displayStages.length > 0}
                            {@const totals = jobSimulatedTotals(displayStages, job)}
                            <div class="mb-1.5 space-y-0.5 text-neutral-500">
                              <p>Simulated: {formatNs(totals.sim)} ns</p>
                              <p>Protocol total: {formatNs(totals.total)} ns</p>
                            </div>
                            <div class="flex flex-col gap-1">
                              {#each displayStages as stage_info, stageIdx (`${stageIdx}-${stage_info.name}`)}
                                <EquilibrationStageStatus
                                  {stage_info}
                                  compact
                                  tracking={job.status === 'running' &&
                                    !remotePending &&
                                    autoMonitor &&
                                    job.watched &&
                                    job.stages.length > 0}
                                />
                              {/each}
                            </div>
                            {#if job.status === 'error' && job.equilibrationOutput}
                              <pre
                                class="mt-2 max-h-24 overflow-auto rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
                                >{job.equilibrationOutput}</pre
                              >
                            {/if}
                          {:else if job.loadingStages || job.syncingRemoteStages}
                            <!-- spinner already shown above -->
                          {:else if job.status === 'not_started'}
                            <p class="text-neutral-500">Inputs ready — not started yet.</p>
                          {:else if remoteJobFinishedLocally(job) || job.status === 'completed'}
                            <p class="text-neutral-500">
                              Stage logs not found locally — try Pull, then Reload.
                            </p>
                          {:else if job.execution?.mode === 'remote' && job.watched}
                            <p class="flex items-center gap-1.5 text-neutral-500">
                              <Spinner className="size-3" label="Waiting for stage logs" />
                              Waiting for stage logs from the cluster…
                            </p>
                          {:else}
                            <p class="text-neutral-500">
                              {job.watched
                                ? 'No stage detail yet — waiting for next refresh.'
                                : 'Watch the job to load stage detail.'}
                            </p>
                          {/if}
                        </div>
                      </div>
                    {/if}

                    {#if job.showInfo}
                      <div
                        class="min-w-0 space-y-2 border-t border-neutral-200 pt-2 dark:border-neutral-700 {job.showStages
                          ? 'lg:border-t-0 lg:border-l lg:pt-0 lg:pl-3'
                          : ''}"
                      >
                        <div
                          class="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
                        >
                          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                            <span class="text-neutral-500">Engine</span>
                            <span class="uppercase">{job.engine}</span>
                            <span class="text-neutral-500">Directory</span>
                            <span class="truncate font-mono" title={job.jobDir}>{job.jobDir}</span>
                            {#if generatedIso}
                              <span class="text-neutral-500">Generated</span>
                              <span class="tabular-nums">{formatJobGenerated(generatedIso)}</span>
                            {/if}
                            {#if formatStagesMdElapsed(job.stages)}
                              <span class="text-neutral-500">Runtime</span>
                              <span
                                class="tabular-nums"
                                title="Sum of stage runtimes from MD logs"
                                >{formatStagesMdElapsed(job.stages)}</span
                              >
                            {/if}
                            {#if job.execution?.mode === 'remote'}
                              <span class="text-neutral-500">Status</span>
                              <span class={remoteSchedulerStatusClass(job)}
                                >{job.execution.last_remote_state || job.status}</span
                              >
                              <span class="text-neutral-500">Remote</span>
                              <span
                                class="truncate font-mono"
                                title={job.execution.remote_path || ''}
                                >{job.execution.remote_path || '—'}</span
                              >
                              {#if job.execution.node_list}
                                <span class="text-neutral-500">Node</span>
                                <span>{String(job.execution.node_list).split(',')[0]}</span>
                              {/if}
                              {#if job.execution.node_gpu_label || Number(job.execution.resources?.gpus) > 0}
                                <span class="text-neutral-500">GPU</span>
                                <span
                                  >{job.execution.node_gpu_label ||
                                    `${job.execution.resources?.gpus || 1} GPU`}</span
                                >
                              {/if}
                              {#if Number(job.execution.allocated_cpus) || Number(job.execution.resources?.cpus)}
                                <span class="text-neutral-500">CPUs</span>
                                <span
                                  >{job.execution.allocated_cpus ||
                                    job.execution.resources?.cpus}</span
                                >
                              {/if}
                            {:else if job.loadingProcessInfo}
                              <span class="text-neutral-500">Status</span>
                              <span class="text-neutral-400">Loading…</span>
                            {:else if job.processInfo}
                              <span class="text-neutral-500">PID</span>
                              <span>{job.processInfo.pid ?? '—'}</span>
                              <span class="text-neutral-500">Status</span>
                              <span
                                class={job.processInfo.running
                                  ? 'text-green-400'
                                  : 'text-neutral-400'}
                                >{job.processInfo.running ? 'Running' : 'Not running'}</span
                              >
                            {/if}
                          </div>
                        </div>

                        <div class="space-y-1">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-[11px] font-medium text-neutral-500">Logs</span>
                            <select
                              class="max-w-[11rem] min-w-[7rem] truncate rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
                              value={job.selectedLog || ''}
                              disabled={jobIndex < 0 || !job.logFiles?.length}
                              onchange={(e) =>
                                jobIndex >= 0 &&
                                updateJobLogOptions(jobIndex, {
                                  selectedLog:
                                    /** @type {HTMLSelectElement} */ (e.currentTarget).value || null
                                })}
                            >
                              {#if !job.logFiles?.length}
                                <option value="">No log files</option>
                              {:else}
                                {#each job.logFiles as path (path)}
                                  <option value={path}>{path}</option>
                                {/each}
                              {/if}
                            </select>
                            <div
                              class="inline-flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-800"
                              role="group"
                              aria-label="Log view mode"
                            >
                              <button
                                type="button"
                                class="px-2.5 py-1 text-[11px] font-medium {job.logMode === 'head'
                                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                                  : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900'}"
                                aria-pressed={job.logMode === 'head'}
                                disabled={jobIndex < 0}
                                onclick={() =>
                                  jobIndex >= 0 &&
                                  updateJobLogOptions(jobIndex, { logMode: 'head' })}
                              >
                                Head
                              </button>
                              <button
                                type="button"
                                class="border-l border-neutral-300 px-2.5 py-1 text-[11px] font-medium dark:border-neutral-800 {job.logMode ===
                                'tail'
                                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                                  : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900'}"
                                aria-pressed={job.logMode === 'tail'}
                                disabled={jobIndex < 0}
                                onclick={() =>
                                  jobIndex >= 0 &&
                                  updateJobLogOptions(jobIndex, { logMode: 'tail' })}
                              >
                                Tail
                              </button>
                            </div>
                            {#if job.logLinesEditing || !LOG_LINE_PRESETS.includes(Number(job.logLines))}
                              <input
                                type="number"
                                min="1"
                                max={LOG_LINES_MAX}
                                step="1"
                                class="w-[7.5rem] rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] tabular-nums text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
                                value={job.logLines || LOG_LINES_DEFAULT}
                                disabled={jobIndex < 0}
                                title={`Custom line count (1–${LOG_LINES_MAX.toLocaleString()}). Enter a preset (${LOG_LINE_PRESETS.join(', ')}) to return to the list.`}
                                {@attach (node) => {
                                  if (!job.logLinesEditing) return
                                  queueMicrotask(() => {
                                    /** @type {HTMLInputElement} */ (node).focus()
                                    /** @type {HTMLInputElement} */ (node).select()
                                  })
                                }}
                                onkeydown={(e) => {
                                  if (e.key === 'Escape' && jobIndex >= 0) {
                                    // Escape: if value is still a preset, leave edit mode; else keep custom input.
                                    void updateJobLogOptions(jobIndex, { logLinesEditing: false })
                                  }
                                  if (e.key === 'Enter' && jobIndex >= 0) {
                                    e.currentTarget.blur()
                                  }
                                }}
                                onblur={(e) => {
                                  if (jobIndex < 0) return
                                  const n = clampLogLines(
                                    /** @type {HTMLInputElement} */ (e.currentTarget).value
                                  )
                                  void updateJobLogOptions(jobIndex, {
                                    logLines: n,
                                    logLinesEditing: false
                                  })
                                }}
                              />
                            {:else}
                              <select
                                class="w-[7.5rem] rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-900 [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600"
                                value={String(job.logLines)}
                                disabled={jobIndex < 0}
                                title="Number of lines"
                                onchange={(e) => {
                                  if (jobIndex < 0) return
                                  const v = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                                  if (v === 'custom') {
                                    void updateJobLogOptions(jobIndex, { logLinesEditing: true })
                                    return
                                  }
                                  void updateJobLogOptions(jobIndex, {
                                    logLines: Number(v),
                                    logLinesEditing: false
                                  })
                                }}
                              >
                                {#each LOG_LINE_PRESETS as n (n)}
                                  <option value={String(n)}>{n} lines</option>
                                {/each}
                                <option value="custom">Custom…</option>
                              </select>
                            {/if}
                            {#if jobIndex >= 0}
                              <button
                                type="button"
                                class="inline-flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-wait disabled:opacity-70 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                                onclick={() => refreshJobLogFiles(jobIndex)}
                                disabled={!!job.logView?.loading}
                                title={job.logView?.loading
                                  ? 'Refreshing log file list and view…'
                                  : 'Refresh log file list and view'}
                                aria-label={job.logView?.loading
                                  ? 'Refreshing log'
                                  : 'Refresh log file list and view'}
                                aria-busy={!!job.logView?.loading}
                              >
                                {#if job.logView?.loading}
                                  <Spinner className="size-3.5" label="Refreshing log" />
                                {:else}
                                  <ResetIcon className="size-3.5 fill-current" />
                                {/if}
                              </button>
                            {/if}
                          </div>
                          <p class="flex items-center gap-1.5 text-[10px] text-neutral-500">
                            <span>
                              Showing {job.logMode === 'head' ? 'head' : 'tail'} · {job.logLines ||
                                LOG_LINES_DEFAULT} lines
                            </span>
                            {#if job.logView?.loading}
                              <Spinner className="size-3 text-neutral-400" label="Loading log" />
                            {/if}
                          </p>
                          <div class="relative">
                            {#if job.logView?.loading}
                              <div
                                class="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded bg-white/90 p-0.5 dark:bg-neutral-950/90"
                                aria-hidden="true"
                              >
                                <Spinner className="size-3.5 text-neutral-500 dark:text-neutral-400" />
                              </div>
                            {/if}
                            <pre
                              class="max-h-40 overflow-auto rounded-md border border-neutral-200 bg-white p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 {job.logView
                                ?.loading
                                ? 'opacity-70'
                                : ''}"
                              >{#if !job.selectedLog}Select a log file…
{:else if job.logView?.loading && !job.logView?.lines?.length}Loading {job.logMode === 'head' ? 'head' : 'tail'}…
{:else if job.logView && !job.logView.exists && !job.logView.loading}File not found locally.
{:else if job.logView?.lines?.length}{job.logView.lines.join('\n')}
{:else if job.logView && !job.logView.loading}(empty)
{:else}Loading…{/if}</pre
                            >
                          </div>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if job.pullProgress}
                  {@const pullPct = jobPullDisplayPercent(job)}
                  {@const pullStatus = formatPullStatusLine({
                    message: job.pullProgress.message,
                    bytes: job.syncSizes?.localBytes,
                    totalBytes: job.syncSizes?.remoteBytes,
                    speed: job.pullProgress.speed,
                    localFormatted: job.syncSizes?.localFormatted,
                    remoteFormatted: job.syncSizes?.remoteFormatted
                  })}
                  {@const pullActive =
                    job.pulling ||
                    job.pullProgress.phase === 'sync' ||
                    job.pullProgress.phase === 'finalize' ||
                    job.pullProgress.phase === 'resolve'}
                  <div class="mt-2 space-y-1">
                    {#if pullStatus}
                      <p
                        class="flex items-center gap-1.5 truncate text-[11px] text-neutral-500"
                        title={job.pullProgress.message}
                      >
                        {#if pullActive}
                          <Spinner className="size-3 shrink-0" label="Downloading" />
                        {/if}
                        <span class="truncate">{pullStatus}</span>
                      </p>
                    {/if}
                    <div
                      class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={pullPct ?? undefined}
                      aria-label="Pull progress"
                    >
                      <div
                        class="h-full rounded-full bg-sky-500 transition-[width] duration-200 ease-out dark:bg-sky-400"
                        class:animate-pulse={pullPct == null}
                        style:width="{pullPct != null ? Math.max(2, pullPct) : 35}%"
                      ></div>
                    </div>
                  </div>
                {/if}

                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  {#if jobIndex >= 0}
                    <Button
                      variant={job.watched ? 'default' : 'outline'}
                      size="sm"
                      onclick={() => toggleJobWatch(jobIndex)}
                    >
                      {job.watched ? 'Watching' : 'Watch'}
                    </Button>
                    {#if job.execution?.mode === 'remote' && job.execution?.remote_path}
                      {#if job.pulling}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => cancelPullRemoteJob(jobIndex)}
                        >
                          Cancel pull
                        </Button>
                      {:else}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => pullRemoteJob(jobIndex)}
                          title={remoteSchedulerRunning(job)
                            ? 'Job still running — Pull downloads a partial snapshot only (confirm before start)'
                            : 'Download results from the cluster (Watching does not pull — use this button)'}
                        >
                          {#if remoteSchedulerRunning(job)}
                            Pull (partial)
                          {:else}
                            Pull
                          {/if}
                        </Button>
                      {/if}
                    {/if}
                    {#if job.canRun || job.status === 'not_started' || job.execution?.mode === 'remote' || job.status === 'error' || job.canResume}
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => openClusterDialog(job)}
                        title={clusterSession.connected
                          ? 'Manage / submit using the shared cluster connection'
                          : job.execution?.mode === 'remote'
                            ? 'Status / Pull / Cancel — connect in Progress strip for faster access'
                            : 'Upload and submit with sbatch'}
                      >
                        {job.execution?.mode === 'remote'
                          ? remoteJobTerminal(job)
                            ? 'Resubmit…'
                            : 'Cluster…'
                          : 'Run on cluster…'}
                      </Button>
                    {/if}
                    <Button
                      variant={job.showStages ? 'default' : 'outline'}
                      size="sm"
                      onclick={() => toggleJobStages(jobIndex)}
                      title={job.showStages ? 'Hide stage progress' : 'Show stage progress'}
                    >
                      Stages
                    </Button>
                    <Button
                      variant={job.showInfo ? 'default' : 'outline'}
                      size="sm"
                      onclick={() => toggleJobProcessInfo(jobIndex)}
                      title={job.showInfo ? 'Hide job info and logs' : 'Show job info and logs'}
                    >
                      Details
                    </Button>
                    <Button
                      variant={isFormSource ? 'default' : 'outline'}
                      size="sm"
                      onclick={() => useJobInForm(job)}
                      disabled={!!usingInFormDir}
                      title="Load this job’s engine, protocol, and resources into the form"
                    >
                      {#if loadingIntoForm}
                        <Spinner className="mr-1 size-3" />
                        Loading…
                      {:else if isFormSource}
                        In form
                      {:else}
                        Use in form
                      {/if}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => reloadJobCard(jobIndex)}
                      disabled={job.reloading}
                      title="Re-read job metadata from disk"
                    >
                      {job.reloading ? '…' : 'Reload'}
                    </Button>
                    {#if job.status === 'running' && job.execution?.mode !== 'remote'}
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => killJob(jobIndex)}
                        disabled={job.stopping}
                      >
                        {job.stopping ? 'Stopping…' : 'Kill MD'}
                      </Button>
                    {:else}
                      {#if job.canResume && job.status !== 'completed'}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => continueJob(jobIndex)}
                          disabled={job.continuing}
                          title={job.resumeReason || 'Continue locally'}
                        >
                          {job.continuing ? 'Starting…' : 'Continue'}
                        </Button>
                      {/if}
                      {#if job.canRun}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => runJob(jobIndex)}
                          disabled={job.running}
                          title="Run locally from stage 1"
                        >
                          {job.running ? 'Starting…' : 'Run locally'}
                        </Button>
                      {/if}
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if clusterDialogJob}
    <RunOnClusterDialog
      open={true}
      engine={clusterDialogJob.engine}
      jobDir={clusterDialogJob.jobDir}
      jobName={clusterDialogJob.jobName}
      cpus={clusterDialogJob.cpus}
      gpus={clusterDialogJob.gpus}
      execution={clusterDialogJob.execution}
      onClose={() => {
        clusterDialogJob = null
      }}
      onMessage={(msg, isError = false) => {
        logEvent(isError ? 'error' : 'info', 'eq', msg)
      }}
      onExecutionUpdated={(execution) => {
        if (clusterDialogJob?.jobDir) applyJobExecution(clusterDialogJob.jobDir, execution)
        void rescanJobs()
      }}
    />
  {/if}

  {#if constraintEditor}
    {#key `${constraintEditor.stageIndex}-${constraintEditor.constraintIndex}-${constraintEditor.source?.id ?? 'new'}`}
      <ConstraintEditor
        source={constraintEditor.source}
        onDismiss={dismissConstraintEditor}
        onAccept={acceptConstraint}
        onDelete={constraintEditor.constraintIndex >= 0 ? deleteConstraintFromEditor : undefined}
        onSelect={(sel) => countMatchingAtoms(inputDir, sel)}
        hasInputDir={Boolean(inputDir)}
      />
    {/key}
  {/if}
</div>

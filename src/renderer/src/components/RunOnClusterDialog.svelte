<script>
  import { untrack } from 'svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Spinner from './ui/Spinner.svelte'
  import { loadClusterProfiles } from '../lib/clusterProfiles.js'
  import {
    adoptSharedSession,
    getClusterSession,
    sharedProfilePlain
  } from '../lib/clusterSession.svelte.js'
  import {
    clusterCancelJob,
    clusterConnect,
    clusterDisconnect,
    clusterJobStatus,
    clusterProbe,
    clusterPullJobStream,
    clusterRenderScript,
    clusterSubmitJobStream
  } from '../lib/backendApi'
  import { isSlurmActiveState, isSlurmTerminalState, partialPullConfirmMessage } from '../lib/slurmState.js'

  /**
   * Guided dialog: connect → pick resources → upload & sbatch for one job card.
   * @type {{
   *   open?: boolean,
   *   engine?: string,
   *   jobDir?: string,
   *   jobName?: string,
   *   cpus?: number,
   *   gpus?: number,
   *   execution?: object|null,
   *   onClose?: () => void,
   *   onMessage?: (msg: string, isError?: boolean) => void,
   *   onExecutionUpdated?: (execution: object|null) => void
   * }}
   */
  let {
    open = false,
    engine = 'namd',
    jobDir = '',
    jobName = '',
    cpus = 8,
    gpus = 1,
    execution = null,
    onClose = () => {},
    onMessage = () => {},
    onExecutionUpdated = () => {}
  } = $props()

  const shared = getClusterSession()

  /** @type {any[]} */
  let profiles = $state([])
  let profileId = $state('')
  let password = $state('')
  /** @type {string|null} */
  let sessionId = $state(null)
  /** True when sessionId came from the Progress-strip shared connection. */
  let usingSharedSession = $state(false)
  let busy = $state(false)
  let submitting = $state(false)
  /** @type {number|null} */
  let submitPercent = $state(null)
  let submitPhase = $state('')
  let pulling = $state(false)
  /** @type {number|null} */
  let pullPercent = $state(null)
  let showDetails = $state(false)
  let remotePath = $state('')
  let remotePathTouched = $state(false)
  let partition = $state('')
  let timeLimit = $state('24:00:00')
  let dialogCpus = $state(8)
  let dialogGpus = $state(0)
  /** Slurm GRES GPU type (e.g. 3090); empty = any. */
  let gpuType = $state('')
  /** @type {string[]} */
  let moduleOptions = $state([])
  /** @type {string[]} */
  let cudaModuleOptions = $state([])
  let selectedModule = $state('')
  let cudaModule = $state('')
  let scriptPreview = $state('')
  /** Snapshot from last Generate / Preview — used by Reload original. */
  let scriptOriginal = $state('')
  /** When true, Upload & submit sends scriptPreview instead of regenerating. */
  let useEditedScript = $state(false)
  let showScript = $state(false)
  let remoteState = $state('')
  let schedulerJobId = $state('')
  /** @type {any} */
  let probe = $state(null)
  /** @type {any[]} */
  let partitionOptions = $state([])
  /** @type {any[]} */
  let nodeOptions = $state([])
  let nodelist = $state('')
  let statusMessage = $state('')
  let statusError = $state(false)
  let showRawProbe = $state(false)
  /** @type {string[]} */
  let probeErrors = $state([])
  let localPathWarning = $state('')
  /** True only after a probe response is applied (avoids yellow flash mid-connect). */
  let probeReady = $state(false)
  let timeDays = $state(0)
  let timeHours = $state(24)
  let timeMinutes = $state(0)

  const selected = $derived(profiles.find((p) => p.id === profileId) || null)
  const isManage = $derived(!!(execution?.mode === 'remote' && execution?.scheduler_job_id))
  const remoteTerminal = $derived(isSlurmTerminalState(remoteState))
  const remoteActive = $derived(isSlurmActiveState(remoteState))
  /** Allow a new sbatch when there is no job yet, or the previous remote job finished. */
  const canSubmit = $derived(!schedulerJobId || remoteTerminal)
  const hasDiscoveredModules = $derived(moduleOptions.length > 0)
  const hasDiscoveredPartitions = $derived(partitionOptions.length > 0)
  const nodesForPartition = $derived(
    nodeOptions.filter((n) => {
      if (!partition.trim()) return true
      return String(n.partition || '').replace(/\*$/, '') === partition.replace(/\*$/, '')
    })
  )
  const hasDiscoveredNodes = $derived(nodesForPartition.length > 0)
  const timeLimitHuman = $derived(formatTimeLimitHuman(timeLimit))
  /** Named GPU types from probed node GRES (selected node, else partition union). */
  const availableGpuTypes = $derived.by(() => {
    /** @type {Map<string, number>} */
    const merged = new Map()
    const want = String(nodelist || '')
      .split(',')[0]
      .trim()
      .toLowerCase()
    const nodes = want
      ? nodesForPartition.filter((n) => String(n.name || '').toLowerCase() === want)
      : nodesForPartition
    for (const n of nodes) {
      for (const item of parseGpuTypesFromGres(n.gres || '')) {
        const prev = merged.get(item.type) || 0
        if (item.count > prev) merged.set(item.type, item.count)
      }
    }
    return [...merged.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, count]) => ({ type, count }))
  })
  const showGpuTypeSelect = $derived(dialogGpus > 0 && availableGpuTypes.length > 0)

  // Seed form once when the dialog opens (do not fight path edits on later prop updates).
  $effect(() => {
    if (!open) return
    untrack(() => {
      // Always prefer left-panel / caller CPUs·GPUs (not stale last-submit resources).
      dialogCpus = Math.max(1, Number(cpus) || 8)
      dialogGpus = Math.max(0, Number(gpus) || 0)
      gpuType = String(execution?.resources?.gpu_type || '').trim()
      remotePathTouched = false
      statusMessage = ''
      statusError = false
      showRawProbe = false
      showDetails = false
      probeErrors = []
      pulling = false
      submitting = false
      submitPercent = null
      submitPhase = ''
      moduleOptions = []
      cudaModuleOptions = []
      partitionOptions = []
      nodeOptions = []
      nodelist = ''
      selectedModule = ''
      cudaModule = ''
      partition = ''
      timeLimit = '24:00:00'
      syncTimePartsFromLimit()
      scriptPreview = ''
      scriptOriginal = ''
      useEditedScript = false
      showScript = false
      localPathWarning = ''

      // Reuse Progress-strip shared SSH session when available.
      if (shared.sessionId && shared.profile) {
        sessionId = shared.sessionId
        usingSharedSession = true
        profileId = shared.profile.id || profileId
        probe = shared.probe
        applyProbeToForm(shared.probe, dialogGpus > 0)
        probeReady = !!shared.probe
        if (shared.probe) {
          setStatus(`Using shared connection to ${shared.profile.name || shared.profile.host}`)
        } else if (shared.probing || shared.connecting) {
          setStatus('Progress is probing cluster inventory…')
        } else {
          setStatus(`Using shared connection to ${shared.profile.name || shared.profile.host}`)
        }
      } else if (shared.connecting || shared.probing) {
        // Connect in progress: sessionId not published until probe finishes.
        sessionId = null
        usingSharedSession = true
        profileId = shared.profile?.id || profileId
        probe = null
        probeReady = false
        setStatus('Progress is probing cluster inventory…')
      } else {
        sessionId = null
        usingSharedSession = false
        probe = null
        probeReady = false
      }

      if (execution?.mode === 'remote') {
        schedulerJobId = execution.scheduler_job_id || ''
        remoteState = execution.last_remote_state || ''
        partition = execution.partition || partition
        nodelist = execution.nodelist || nodelist
        timeLimit = execution.time_limit || '24:00:00'
        syncTimePartsFromLimit()
        if (execution.remote_path) {
          remotePath = execution.remote_path
          remotePathTouched = true
        }
        const mods = Array.isArray(execution.modules) ? execution.modules : []
        if (mods.length) {
          selectedModule = mods.find((m) => !/cuda/i.test(String(m))) || mods[0]
          cudaModule = mods.find((m) => /cuda/i.test(String(m))) || ''
        }
      } else {
        schedulerJobId = ''
        remoteState = ''
      }
      void refreshProfiles({
        syncPath: !remotePathTouched,
        syncTimeLimit: !(execution?.mode === 'remote' && execution?.time_limit)
      })
    })
  })

  // Drop GPU type when the selected node/partition no longer offers it.
  $effect(() => {
    if (!gpuType) return
    if (dialogGpus <= 0) {
      gpuType = ''
      return
    }
    if (availableGpuTypes.length && !availableGpuTypes.some((t) => t.type === gpuType)) {
      gpuType = ''
    }
  })

  // When Progress Connect finishes probing (or adopts a session), fill Resources.
  $effect(() => {
    if (!open) return
    const sharedProbe = shared.probe
    const sharedSid = shared.sessionId
    const isProbing = shared.probing || shared.connecting
    untrack(() => {
      if (sharedSid && shared.profile) {
        sessionId = sharedSid
        usingSharedSession = true
        profileId = shared.profile.id || profileId
        if (sharedProbe) {
          probe = sharedProbe
          applyProbeToForm(sharedProbe, dialogGpus > 0)
          probeReady = true
          setStatus(`Using shared connection to ${shared.profile.name || shared.profile.host}`)
        } else if (isProbing) {
          probeReady = false
          setStatus('Progress is probing cluster inventory…')
        }
      } else if (isProbing && shared.profile) {
        usingSharedSession = true
        profileId = shared.profile.id || profileId
        probeReady = false
        setStatus('Progress is probing cluster inventory…')
      }
    })
  })

  // Seed Resources from cached last_probe while a live probe is still running.
  $effect(() => {
    if (!open || probeReady) return
    const cached = selected?.last_probe || shared.profile?.last_probe
    if (!cached) return
    untrack(() => {
      if (probeReady) return
      applyProbeToForm(cached, dialogGpus > 0)
      // Cached inventory is good enough to pick partitions; mark ready for dropdowns.
      probe = cached
      probeReady = true
      if (shared.probing || shared.connecting) {
        setStatus('Using cached inventory — refreshing from cluster…')
      }
    })
  })

  /** @param {any} probed @param {boolean} wantGpu */
  function applyProbeToForm(probed, wantGpu) {
    if (!probed) return
    const root = probed.probe || probed
    const wrapped = {
      suggested_modules: probed.suggested_modules || {},
      suggested_partitions: probed.suggested_partitions,
      suggested_nodes: probed.suggested_nodes,
      probe: root
    }
    moduleOptions = collectEngineModules(wrapped, engine)
    cudaModuleOptions = (wrapped.suggested_modules?.cuda || root?.engine_modules?.cuda || [])
      .map((/** @type {any} */ m) => m.full_name || m)
      .filter(Boolean)
    if (moduleOptions.length && !moduleOptions.includes(selectedModule)) {
      selectedModule = moduleOptions[0]
    }
    if (wantGpu && cudaModuleOptions.length && (!cudaModule || !cudaModuleOptions.includes(cudaModule))) {
      cudaModule = cudaModuleOptions[0]
    }
    const parts = wrapped.suggested_partitions || root?.partitions || []
    partitionOptions = parts
    if (parts.length) {
      const names = parts.map((/** @type {any} */ p) => p.name || p)
      if (!partition.trim() || !names.includes(partition)) {
        partition = parts[0].name || parts[0]
      }
    }
    nodeOptions = wrapped.suggested_nodes || root?.nodes || []
  }

  $effect(() => {
    const profile = profiles.find((p) => p.id === profileId)
    const folder = jobFolderName()
    if (!open || !profile || remotePathTouched) return
    const next = buildRemotePath(profile, folder)
    if (next && next !== remotePath) remotePath = next
  })

  function jobFolderName() {
    if (jobName?.trim()) return jobName.trim()
    if (jobDir) return jobDir.split(/[/\\]/).pop() || 'equilibration'
    return 'equilibration'
  }

  /**
   * @param {string} template
   * @param {any} profile
   */
  function expandPathTemplate(template, profile) {
    const user = String(profile?.username || '').trim()
    let out = String(template || '')
    if (user) {
      out = out.replaceAll('$USER', user).replaceAll('${USER}', user)
      out = out.replaceAll('$HOME', `/home/${user}`).replaceAll('${HOME}', `/home/${user}`)
      out = out
        .replaceAll('$DATA_DIR', `/data/${user}`)
        .replaceAll('${DATA_DIR}', `/data/${user}`)
      out = out
        .replaceAll('$SCRATCH_DIR', `/scratch/${user}`)
        .replaceAll('${SCRATCH_DIR}', `/scratch/${user}`)
    }
    return out.replace(/\/$/, '')
  }

  /**
   * @param {any} profile
   * @param {string} folder
   */
  function buildRemotePath(profile, folder) {
    const root = expandPathTemplate(profile?.submit_root || '', profile)
    if (!root) return ''
    const name = (folder || 'equilibration').replace(/^\/+|\/+$/g, '')
    return `${root}/${name}`
  }

  function plainProfile(profile) {
    return JSON.parse(JSON.stringify(profile))
  }

  /**
   * @param {{ syncPath?: boolean, syncTimeLimit?: boolean }} [opts]
   */
  async function refreshProfiles(opts = {}) {
    const { syncPath = false, syncTimeLimit = false } = opts
    profiles = await loadClusterProfiles()
    if (!profileId && profiles.length) profileId = profiles[0].id
    if (!profiles.some((p) => p.id === profileId) && profiles.length) {
      profileId = profiles[0].id
      remotePathTouched = false
    }
    const profile = profiles.find((p) => p.id === profileId)
    if (syncPath && !remotePathTouched && profile) {
      remotePath = buildRemotePath(profile, jobFolderName())
    }
    if (syncTimeLimit && profile) {
      applyProfileDefaultTimeLimit(profile)
    }
  }

  /** @param {any} profile */
  function applyProfileDefaultTimeLimit(profile) {
    const raw = String(profile?.default_time_limit || '').trim()
    timeLimit = raw || '24:00:00'
    syncTimePartsFromLimit()
  }

  function onRemotePathInput(value) {
    remotePath = value
    remotePathTouched = true
  }

  function onProfileChange(id) {
    profileId = id
    remotePathTouched = false
    const profile = profiles.find((p) => p.id === id)
    if (profile) {
      remotePath = buildRemotePath(profile, jobFolderName())
      // New submits pick up the profile default; leave managed jobs on their saved limit.
      if (!isManage) applyProfileDefaultTimeLimit(profile)
    }
  }

  function selectedModules() {
    const picks = []
    if (cudaModule.trim()) picks.push(cudaModule.trim())
    if (selectedModule.trim()) picks.push(selectedModule.trim())
    return [...new Set(picks)]
  }

  /** @param {any[]} nodes @param {string} part */
  function preferGpuNodes(nodes, part) {
    const p = (part || '').replace(/\*$/, '')
    return [...nodes]
      .filter((n) => !p || String(n.partition || '').replace(/\*$/, '') === p)
      .sort((a, b) => (b.gpus || 0) - (a.gpus || 0))
  }

  /**
   * Named GPU types from a Slurm GRES string (``gpu:2080ti:2,gpu:3090:1``).
   * Untyped ``gpu:2`` yields no named types.
   * @param {string} gres
   * @returns {Array<{ type: string, count: number }>}
   */
  function parseGpuTypesFromGres(gres) {
    const raw = String(gres || '').trim()
    if (!raw || raw === '(null)' || raw.toLowerCase() === 'n/a') return []
    /** @type {Array<{ type: string, count: number }>} */
    const out = []
    for (const chunk of raw.split(',')) {
      const bits = chunk
        .trim()
        .split(':')
        .map((b) => b.trim())
        .filter(Boolean)
      if (bits.length < 3 || !/^gpu$/i.test(bits[0])) continue
      const type = bits[1]
      const count = parseInt(bits[2], 10)
      // TYPE may be numeric (3090); untyped gpu:N is len===2 and already skipped.
      if (!type || !/^[A-Za-z0-9_+\-.]+$/.test(type) || !Number.isFinite(count) || count <= 0) {
        continue
      }
      out.push({ type, count })
    }
    return out
  }

  function setStatus(msg, isError = false) {
    statusMessage = msg
    statusError = isError
    onMessage(msg, isError)
  }

  /** Parse Slurm time: ``M``, ``MM:SS``, ``HH:MM:SS``, ``D-HH:MM:SS``. */
  function parseTimeLimit(text) {
    const raw = String(text || '').trim()
    if (!raw) return { days: 0, hours: 24, minutes: 0 }
    const dayMatch = raw.match(/^(\d+)-(.+)$/)
    let days = 0
    let rest = raw
    if (dayMatch) {
      days = Math.max(0, parseInt(dayMatch[1], 10) || 0)
      rest = dayMatch[2]
    }
    const parts = rest.split(':').map((p) => parseInt(p, 10) || 0)
    let hours = 0
    let minutes = 0
    if (parts.length === 1) {
      minutes = parts[0]
    } else if (parts.length === 2) {
      hours = parts[0]
      minutes = parts[1]
    } else {
      hours = parts[0]
      minutes = parts[1]
    }
    // Normalize overflow
    hours += Math.floor(minutes / 60)
    minutes = minutes % 60
    days += Math.floor(hours / 24)
    hours = hours % 24
    return { days, hours, minutes }
  }

  function formatTimeLimitValue(days, hours, minutes) {
    const d = Math.max(0, Math.floor(Number(days) || 0))
    const h = Math.max(0, Math.min(23, Math.floor(Number(hours) || 0)))
    const m = Math.max(0, Math.min(59, Math.floor(Number(minutes) || 0)))
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    if (d > 0) return `${d}-${hh}:${mm}:00`
    return `${hh}:${mm}:00`
  }

  function formatTimeLimitHuman(text) {
    const { days, hours, minutes } = parseTimeLimit(text)
    const bits = []
    if (days) bits.push(`${days} day${days === 1 ? '' : 's'}`)
    if (hours) bits.push(`${hours} hour${hours === 1 ? '' : 's'}`)
    if (minutes) bits.push(`${minutes} min`)
    if (!bits.length) return '0 min'
    return bits.join(' ')
  }

  function syncTimePartsFromLimit() {
    const p = parseTimeLimit(timeLimit)
    timeDays = p.days
    timeHours = p.hours
    timeMinutes = p.minutes
  }

  function applyTimeParts() {
    timeLimit = formatTimeLimitValue(timeDays, timeHours, timeMinutes)
  }

  function bumpTime(unit, delta) {
    let totalMin =
      Math.max(0, Number(timeDays) || 0) * 24 * 60 +
      Math.max(0, Number(timeHours) || 0) * 60 +
      Math.max(0, Number(timeMinutes) || 0)
    if (unit === 'days') totalMin += delta * 24 * 60
    else if (unit === 'hours') totalMin += delta * 60
    else if (unit === 'minutes') totalMin += delta
    totalMin = Math.max(0, totalMin)
    timeDays = Math.floor(totalMin / (24 * 60))
    timeHours = Math.floor((totalMin % (24 * 60)) / 60)
    timeMinutes = totalMin % 60
    applyTimeParts()
  }

  /**
   * Prefer suggested list; fall back to engine_modules / full module list from probe.
   * @param {any} probed
   * @param {string} eng
   */
  function collectEngineModules(probed, eng) {
    const fromSuggested = (probed.suggested_modules?.[eng] || [])
      .map((/** @type {any} */ m) => m.full_name)
      .filter(Boolean)
    if (fromSuggested.length) return fromSuggested

    const fromEngine = (probed.probe?.engine_modules?.[eng] || [])
      .map((/** @type {any} */ m) => m.full_name)
      .filter(Boolean)
    if (fromEngine.length) return fromEngine

    const engLower = String(eng || '').toLowerCase()
    return (probed.probe?.modules || [])
      .map((/** @type {any} */ m) => m.full_name || '')
      .filter((name) => name && name.toLowerCase().includes(engLower))
  }

  async function connect() {
    busy = true
    probeReady = false
    probeErrors = []
    try {
      await refreshProfiles({ syncPath: !remotePathTouched })
      const profile = profiles.find((p) => p.id === profileId)
      if (!profile) {
        setStatus('No cluster profile selected. Add one in Settings → Clusters.', true)
        return
      }
      if (!profile.host?.trim() || !profile.username?.trim()) {
        setStatus('Profile is missing host or username (Settings → Clusters).', true)
        return
      }
      if (!remotePathTouched || !remotePath.trim()) {
        remotePath = buildRemotePath(profile, jobFolderName())
        remotePathTouched = false
      }

      if (sessionId) await clusterDisconnect({ session_id: sessionId }).catch(() => {})
      const res = await clusterConnect({
        profile: plainProfile(profile),
        password: password || null
      })
      sessionId = res.session_id
      usingSharedSession = true
      password = ''

      const wantGpu = dialogGpus > 0
      const probed = await clusterProbe({
        session_id: sessionId,
        profile: plainProfile(profile),
        want_gpu: wantGpu,
        engine
      })
      probe = probed.probe
      probeErrors = probed.errors || probed.probe?.errors || []
      applyProbeToForm(probed, wantGpu)

      if (dialogGpus > 0 && nodeOptions.length) {
        const gpuNodes = preferGpuNodes(nodeOptions, partition)
        if (gpuNodes.length && (!nodelist || !gpuNodes.some((n) => n.name === nodelist))) {
          const best = gpuNodes.find((n) => (n.gpus || 0) > 0)
          if (best) nodelist = best.name
        }
      }

      adoptSharedSession({
        sessionId,
        profile: plainProfile(profile),
        probe: probed
      })

      const modCount = probed.probe?.modules?.length || 0
      const partCount = partitionOptions.length
      const nodeCount = nodeOptions.length
      const gpuNodeCount = nodeOptions.filter((n) => (n.gpus || 0) > 0).length
      const summary = `Connected · ${modCount} modules, ${partCount} partitions, ${nodeCount} nodes (${gpuNodeCount} GPU)`
      if (dialogGpus > 0 && gpuNodeCount === 0) {
        setStatus(`${summary}. No GPU GRES nodes — pick a GPU node or set GPUs=0.`, true)
      } else if (probeErrors.length) {
        setStatus(`${summary}. ${probeErrors[0]}`, true)
      } else {
        setStatus(summary)
      }
      probeReady = true
    } catch (err) {
      probeReady = false
      setStatus(err instanceof Error ? err.message : String(err), true)
    } finally {
      busy = false
    }
  }

  async function previewScript() {
    await refreshProfiles({ syncPath: false })
    const profile = profiles.find((p) => p.id === profileId)
    if (!profile) return
    busy = true
    try {
      const res = await clusterRenderScript({
        profile: plainProfile(profile),
        job_name: jobFolderName(),
        job_folder_name: jobFolderName(),
        cpus: dialogCpus,
        gpus: dialogGpus,
        gpu_type: dialogGpus > 0 ? gpuType.trim() : '',
        time_limit: timeLimit,
        partition,
        nodelist: nodelist.trim(),
        modules: selectedModules()
      })
      scriptOriginal = res.script
      scriptPreview = res.script
      useEditedScript = true
      showScript = true
      await checkLocalRunScriptPaths()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true)
    } finally {
      busy = false
    }
  }

  function reloadOriginalScript() {
    if (!scriptOriginal.trim()) {
      setStatus('No original script yet — click Preview / regenerate first.', true)
      return
    }
    scriptPreview = scriptOriginal
    useEditedScript = true
    setStatus('Restored original generated run_equilibration.slurm')
  }

  function onScriptEdited() {
    useEditedScript = true
  }

  /** Warn if the script Slurm will launch embeds a Windows/WSL path. */
  async function checkLocalRunScriptPaths() {
    localPathWarning = ''
    if (!jobDir || !window.api?.readText) return
    try {
      const base = jobDir.replace(/[/\\]+$/, '')
      let text = ''
      let label = 'run_equilibration_cluster.sh'
      try {
        text = await window.api.readText(`${base}/run_equilibration_cluster.sh`)
      } catch {
        label = 'run_equilibration.sh'
        text = await window.api.readText(`${base}/run_equilibration.sh`)
      }
      if (typeof text !== 'string') return
      if (/\/mnt\/[cd]\//i.test(text) || /[A-Za-z]:\\/.test(text)) {
        localPathWarning =
          `${label} still points at a local Windows/WSL executable (e.g. /mnt/c/...). ` +
          'Regenerate inputs to create run_equilibration_cluster.sh with namd3/gmx from modules.'
      } else if (label === 'run_equilibration.sh') {
        localPathWarning =
          'No run_equilibration_cluster.sh yet — regenerate inputs so Slurm uses a module-friendly runner.'
      }
    } catch {
      // optional check
    }
  }

  async function submit() {
    if (submitting || busy) return
    submitting = true
    busy = true
    submitPercent = 2
    submitPhase = 'prepare'
    onExecutionUpdated({
      ...(execution || {}),
      mode: execution?.mode || 'remote',
      submitting: true
    })
    try {
      await refreshProfiles({ syncPath: false })
      const profile = profiles.find((p) => p.id === profileId)
      if (!profile || !sessionId || !jobDir) {
        setStatus('Connect and ensure the local job folder exists.', true)
        return
      }
      if (!remotePath.trim()) {
        setStatus('Remote submit path is empty.', true)
        return
      }
      if (!selectedModule.trim()) {
        setStatus('Select an MD software module (or enter one after Connect & probe).', true)
        return
      }
      if (!partition.trim()) {
        setStatus('Select or enter a Slurm partition.', true)
        return
      }
      await checkLocalRunScriptPaths()
      if (localPathWarning) {
        setStatus(localPathWarning, true)
      }
      setStatus('Preparing batch script…')
      let scriptText = null
      if (useEditedScript && scriptPreview.trim()) {
        scriptText = scriptPreview
      } else {
        const rendered = await clusterRenderScript({
          profile: plainProfile(profile),
          job_name: jobFolderName(),
          job_folder_name: jobFolderName(),
          cpus: dialogCpus,
          gpus: dialogGpus,
          gpu_type: dialogGpus > 0 ? gpuType.trim() : '',
          time_limit: timeLimit,
          partition,
          nodelist: nodelist.trim(),
          modules: selectedModules()
        })
        scriptOriginal = rendered.script
        scriptPreview = rendered.script
        scriptText = rendered.script
      }
      submitPercent = 8
      setStatus('Uploading job folder…')
      const res = await clusterSubmitJobStream(
        {
          session_id: sessionId,
          profile: plainProfile(profile),
          local_dir: jobDir,
          remote_dir: remotePath.trim(),
          job_name: jobFolderName(),
          job_folder_name: jobFolderName(),
          cpus: dialogCpus,
          gpus: dialogGpus,
          gpu_type: dialogGpus > 0 ? gpuType.trim() : '',
          time_limit: timeLimit,
          partition,
          nodelist: nodelist.trim(),
          modules: selectedModules(),
          script_text: scriptText,
          upload_first: true
        },
        (evt) => {
          if (typeof evt?.percent === 'number') {
            submitPercent = Math.max(0, Math.min(100, evt.percent))
          }
          if (evt?.phase) submitPhase = String(evt.phase)
          if (evt?.message) setStatus(String(evt.message), evt.phase === 'error')
        }
      )
      schedulerJobId = res.job_id
      remoteState = 'PENDING'
      submitPercent = 100
      onExecutionUpdated({ ...(res.execution || {}), submitting: false })
      const resume = res.cluster_resume
      const resumeNote =
        resume?.enabled && resume.stage_name
          ? ` — continuing after ${resume.completed_stages}/${resume.total_stages} stages (${resume.stage_name})`
          : resume?.enabled
            ? ` — continuing after ${resume.completed_stages}/${resume.total_stages} stages`
            : ''
      setStatus(
        `Submitted Slurm job ${res.job_id} (sbatch → bash run_equilibration_cluster.sh)${resumeNote}`
      )
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true)
      onExecutionUpdated({
        ...(execution || {}),
        mode: execution?.mode || 'remote',
        submitting: false
      })
    } finally {
      busy = false
      submitting = false
    }
  }

  async function refreshStatus() {
    if (!schedulerJobId) {
      setStatus('No Slurm job id yet.', true)
      return
    }
    await refreshProfiles({ syncPath: false })
    const profile = profiles.find((p) => p.id === profileId)
    if (!sessionId && !profile?.identity_file) {
      setStatus('Connect & probe first, or set an SSH key on the profile for auto status.', true)
      return
    }
    busy = true
    try {
      const res = await clusterJobStatus({
        session_id: sessionId || null,
        profile: profile ? plainProfile(profile) : null,
        job_id: schedulerJobId,
        local_dir: jobDir || null,
        remote_dir: remotePath.trim() || null,
        pull_logs: true
      })
      if (res.session_id && !sessionId) sessionId = res.session_id
      remoteState = res.state || remoteState
      const nextExec = {
        ...(execution || {}),
        ...(res.execution || {}),
        mode: 'remote',
        scheduler_job_id: res.execution?.scheduler_job_id || schedulerJobId,
        last_remote_state: remoteState,
        remote_path: remotePath.trim() || execution?.remote_path
      }
      onExecutionUpdated(nextExec)
      const pulled = res.pulled
      if (pulled?.skipped) {
        setStatus(`Remote state: ${remoteState || 'unknown'} — ${pulled.reason}`)
      } else if (pulled?.ok === false) {
        setStatus(
          `Remote state: ${remoteState || 'unknown'}; pull issue: ${pulled.stderr || 'unknown'}`,
          true
        )
      } else if (pulled?.failure) {
        setStatus(
          `Remote state: ${remoteState || 'unknown'}; engine error in ${pulled.failure_source || 'logs'}: ${pulled.failure}`,
          true
        )
      } else {
        setStatus(`Remote state: ${remoteState || 'unknown'}`)
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true)
    } finally {
      busy = false
    }
  }

  async function cancel() {
    if (!sessionId || !schedulerJobId) return
    busy = true
    try {
      await clusterCancelJob({
        session_id: sessionId,
        job_id: schedulerJobId,
        local_dir: jobDir || null
      })
      remoteState = 'CANCELLED'
      onExecutionUpdated({
        ...(execution || {}),
        mode: 'remote',
        scheduler_job_id: schedulerJobId,
        last_remote_state: 'CANCELLED'
      })
      setStatus(`Cancelled job ${schedulerJobId}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true)
    } finally {
      busy = false
    }
  }

  async function pull() {
    if (!sessionId || !jobDir || !remotePath.trim()) {
      setStatus('Connect and set the remote path first.', true)
      return
    }
    if (pulling) return
    if (remoteActive && !confirm(partialPullConfirmMessage(remoteState))) {
      return
    }
    pulling = true
    pullPercent = 0
    setStatus(
      remoteActive
        ? `Partial pull (job still ${String(remoteState || 'active').toUpperCase()})…`
        : 'Pulling… resolving remote path'
    )
    try {
      const profile = profiles.find((p) => p.id === profileId) || sharedProfilePlain()
      const res = await clusterPullJobStream(
        {
          session_id: sessionId,
          local_dir: jobDir,
          remote_dir: remotePath.trim(),
          full: true,
          profile: profile ? JSON.parse(JSON.stringify(profile)) : null,
          job_id: schedulerJobId || execution?.scheduler_job_id || null
        },
        (evt) => {
          if (typeof evt.percent === 'number' && Number.isFinite(evt.percent)) {
            pullPercent = Math.max(0, Math.min(100, evt.percent))
          }
          if (evt.message) setStatus(evt.message)
        }
      )
      const nextExec = {
        ...(execution || {}),
        ...(res.execution || {}),
        mode: 'remote',
        scheduler_job_id: schedulerJobId || res.execution?.scheduler_job_id || execution?.scheduler_job_id,
        remote_path: remotePath.trim() || execution?.remote_path
      }
      if (res.remote_state) remoteState = res.remote_state
      onExecutionUpdated(nextExec)
      pullPercent = 100
      if (res.failure) {
        setStatus(
          `Pulled — engine error in ${res.failure_source || 'logs'}: ${res.failure}`,
          true
        )
      } else if (res.partial || isSlurmActiveState(remoteState)) {
        const mid = res.midrun ? ` (${res.midrun})` : ''
        setStatus(
          `Partial pull complete${mid} — job still ${remoteState || 'running'}; pull again when finished for full results`
        )
      } else if (res.midrun) {
        setStatus(`Pulled (${res.midrun})`)
      } else {
        setStatus('Pulled remote job files')
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true)
    } finally {
      pulling = false
      pullPercent = null
    }
  }

  function closeDialog() {
    // Never block Close on Pull / disconnect. Shared sessions stay open for Watching.
    const sid = sessionId
    const wasShared = usingSharedSession
    sessionId = null
    usingSharedSession = false
    onClose()
    if (sid && !wasShared) {
      void clusterDisconnect({ session_id: sid }).catch(() => {})
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="run-on-cluster-title"
  >
    <div
      class="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div class="flex items-center justify-between border-b px-4 py-3 dark:border-neutral-800">
        <div>
          <h3 id="run-on-cluster-title" class="text-sm font-semibold">
            {isManage && !remoteTerminal
              ? 'Remote job'
              : remoteTerminal
                ? 'Resubmit on cluster'
                : 'Run on cluster'}
          </h3>
          <p class="text-xs text-neutral-500">{jobFolderName()}</p>
        </div>
        <button
          type="button"
          class="text-lg leading-none text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
          onclick={closeDialog}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {#if profiles.length === 0}
          <p class="text-amber-600 dark:text-amber-400">
            No cluster profiles. Add one in Settings → Clusters.
          </p>
        {:else}
          <ol class="list-decimal space-y-3 pl-4 text-xs text-neutral-600 dark:text-neutral-400">
            <li class="space-y-2 marker:font-semibold">
              <span class="font-medium text-neutral-800 dark:text-neutral-200">Profile & connect</span>
              <label class="mt-1 block space-y-0.5">
                <span class="sidebar-label">Profile</span>
                <select
                  class="sidebar-control w-full"
                  value={profileId}
                  onchange={(e) => onProfileChange(e.currentTarget.value)}
                >
                  {#each profiles as p (p.id)}
                    <option value={p.id}>{p.name}</option>
                  {/each}
                </select>
              </label>
              <label class="block space-y-0.5">
                <span class="sidebar-label">Password (optional, session only)</span>
                <Input
                  type="password"
                  size="sm"
                  bind:value={password}
                  autocomplete="off"
                  className="w-full"
                />
              </label>
              {#if usingSharedSession && (sessionId || shared.connecting || shared.probing)}
                <p class="text-[11px] text-green-600 dark:text-green-400">
                  {#if shared.probing || shared.connecting}
                    <Spinner className="mr-1 inline-block" />
                    Probing cluster inventory…
                  {:else}
                    Using Progress-strip connection
                    {#if shared.profile}
                      · {shared.profile.name || shared.profile.host}{/if}
                  {/if}
                </p>
              {:else}
                <Button size="sm" disabled={busy || !selected} onclick={connect}>
                  {#if busy}<Spinner className="mr-1" />{/if}
                  Connect & probe
                </Button>
              {/if}
            </li>

            <li class="space-y-2 marker:font-semibold">
              <span class="font-medium text-neutral-800 dark:text-neutral-200">Resources</span>
              <label class="block space-y-0.5">
                <span class="sidebar-label" title="Defaults to Settings → Clusters submit root + job folder"
                  >Remote path</span
                >
                <Input
                  size="sm"
                  bind:value={remotePath}
                  oninput={() => (remotePathTouched = true)}
                  className="w-full font-mono text-[11px]"
                  spellcheck="false"
                />
                {#if selected && buildRemotePath(selected, jobFolderName()) && buildRemotePath(selected, jobFolderName()) !== remotePath.trim()}
                  <button
                    type="button"
                    class="text-[11px] text-blue-600 underline dark:text-blue-400"
                    onclick={() => {
                      remotePath = buildRemotePath(selected, jobFolderName())
                      remotePathTouched = true
                    }}
                  >
                    Use profile default ({buildRemotePath(selected, jobFolderName())})
                  </button>
                {/if}
              </label>
              <div class="space-y-2">
                <label class="block space-y-0.5">
                  <span class="sidebar-label">Partition</span>
                  {#if hasDiscoveredPartitions}
                    <select class="sidebar-control w-full" bind:value={partition}>
                      {#each partitionOptions as p (p.name || p)}
                        <option value={p.name || p}>
                          {p.name || p}{#if p.max_gpus}
                            · {p.max_gpus} GPU{/if}{#if p.cpus_per_node}
                            · {p.cpus_per_node} CPU{/if}
                        </option>
                      {/each}
                    </select>
                  {:else}
                    <Input
                      size="sm"
                      bind:value={partition}
                      className="w-full"
                      placeholder="Connect & probe, or type e.g. gpu"
                    />
                  {/if}
                </label>

                <!-- Time limit: own row (not nested labels) so touch near ± does not misfire -->
                <div class="space-y-0.5">
                  <span class="sidebar-label">Time limit</span>
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div class="flex items-center gap-1">
                      <span class="w-8 shrink-0 text-[10px] text-neutral-500">Days</span>
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md border border-neutral-300 bg-transparent text-sm leading-none text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200"
                        disabled={busy}
                        onclick={() => bumpTime('days', -1)}
                        aria-label="Decrease days"
                        title="-1 day">−</button
                      >
                      <input
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        class="sidebar-control h-7 w-12 shrink-0 px-1 text-center tabular-nums"
                        disabled={busy}
                        value={timeDays}
                        oninput={(e) => {
                          timeDays = Math.max(0, parseInt(e.currentTarget.value, 10) || 0)
                          applyTimeParts()
                        }}
                      />
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md border border-neutral-300 bg-transparent text-sm leading-none text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200"
                        disabled={busy}
                        onclick={() => bumpTime('days', 1)}
                        aria-label="Increase days"
                        title="+1 day">+</button
                      >
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-8 shrink-0 text-[10px] text-neutral-500">Hours</span>
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md border border-neutral-300 bg-transparent text-sm leading-none text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200"
                        disabled={busy}
                        onclick={() => bumpTime('hours', -1)}
                        aria-label="Decrease hours"
                        title="-1 hour">−</button
                      >
                      <input
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        class="sidebar-control h-7 w-12 shrink-0 px-1 text-center tabular-nums"
                        disabled={busy}
                        value={timeHours}
                        oninput={(e) => {
                          timeHours = Math.max(
                            0,
                            Math.min(23, parseInt(e.currentTarget.value, 10) || 0)
                          )
                          applyTimeParts()
                        }}
                      />
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md border border-neutral-300 bg-transparent text-sm leading-none text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200"
                        disabled={busy}
                        onclick={() => bumpTime('hours', 1)}
                        aria-label="Increase hours"
                        title="+1 hour">+</button
                      >
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-10 shrink-0 text-[10px] text-neutral-500">Minutes</span>
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md border border-neutral-300 bg-transparent text-sm leading-none text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200"
                        disabled={busy}
                        onclick={() => bumpTime('minutes', -15)}
                        aria-label="Decrease minutes"
                        title="-15 min">−</button
                      >
                      <input
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        class="sidebar-control h-7 w-12 shrink-0 px-1 text-center tabular-nums"
                        disabled={busy}
                        value={timeMinutes}
                        oninput={(e) => {
                          timeMinutes = Math.max(
                            0,
                            Math.min(59, parseInt(e.currentTarget.value, 10) || 0)
                          )
                          applyTimeParts()
                        }}
                      />
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md border border-neutral-300 bg-transparent text-sm leading-none text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200"
                        disabled={busy}
                        onclick={() => bumpTime('minutes', 15)}
                        aria-label="Increase minutes"
                        title="+15 min">+</button
                      >
                    </div>
                    <input
                      type="text"
                      class="sidebar-control ml-auto h-7 min-w-[7.5rem] flex-1 basis-[7.5rem] px-2 font-mono text-[11px] tabular-nums"
                      bind:value={timeLimit}
                      oninput={() => syncTimePartsFromLimit()}
                      disabled={busy}
                      placeholder="D-HH:MM:SS"
                      spellcheck="false"
                      title={timeLimitHuman ? `Slurm · ${timeLimitHuman}` : 'Slurm time limit'}
                      aria-label="Slurm time limit"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <label class="block space-y-0.5">
                    <span class="sidebar-label">CPUs (#SBATCH)</span>
                    <Input type="number" size="sm" bind:value={dialogCpus} className="w-full" />
                  </label>
                  <label class="block space-y-0.5">
                    <span class="sidebar-label">GPUs (#SBATCH)</span>
                    <Input type="number" size="sm" bind:value={dialogGpus} className="w-full" />
                  </label>
                </div>
              </div>
              <label class="block space-y-0.5">
                <span class="sidebar-label">Node (optional #SBATCH --nodelist)</span>
                {#if hasDiscoveredNodes}
                  <select class="sidebar-control w-full font-mono text-[11px]" bind:value={nodelist}>
                    <option value="">(any — Slurm chooses)</option>
                    {#each nodesForPartition as n (n.name + '|' + n.partition)}
                      <option value={n.name}>
                        {n.name} · {n.state || '?'} · {n.gpus || 0} GPU{#if n.cpus}
                          · {n.cpus} CPU{/if}{#if n.gres}
                          · {n.gres}{/if}
                      </option>
                    {/each}
                  </select>
                {:else}
                  <Input
                    size="sm"
                    bind:value={nodelist}
                    className="w-full font-mono text-[11px]"
                    placeholder="Connect & probe, or type e.g. gpu01"
                  />
                {/if}
                <span
                  class="text-[10px] text-neutral-500"
                  title="When GPUs > 0, pick a node that reports GPU GRES. CPU-only nodes fail CUDA jobs."
                  >?</span
                >
              </label>
              {#if showGpuTypeSelect}
                <label class="block space-y-0.5">
                  <span class="sidebar-label">GPU type (#SBATCH --gres)</span>
                  <select class="sidebar-control w-full font-mono text-[11px]" bind:value={gpuType}>
                    <option value="">Any — scheduler picks</option>
                    {#each availableGpuTypes as t (t.type)}
                      <option value={t.type}>{t.type} ×{t.count}</option>
                    {/each}
                  </select>
                  <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
                    Slurm GRES type (e.g. 3090). Any keeps --gpus=N; a type writes --gres=gpu:TYPE:N.
                  </p>
                </label>
              {/if}
              <label class="block space-y-0.5">
                <span class="sidebar-label">MD module ({engine})</span>
                {#if hasDiscoveredModules}
                  <select class="sidebar-control w-full font-mono text-[11px]" bind:value={selectedModule}>
                    {#each moduleOptions as m (m)}
                      <option value={m}>{m}</option>
                    {/each}
                  </select>
                {:else}
                  <Input
                    size="sm"
                    bind:value={selectedModule}
                    className="w-full font-mono text-[11px]"
                    placeholder="Connect & probe to list modules, or type e.g. md/namd/3.0b6+cuda"
                  />
                {/if}
              </label>
              {#if dialogGpus > 0}
                <label class="block space-y-0.5">
                  <span class="sidebar-label">CUDA module (optional)</span>
                  {#if cudaModuleOptions.length}
                    <select class="sidebar-control w-full font-mono text-[11px]" bind:value={cudaModule}>
                      <option value="">(none)</option>
                      {#each cudaModuleOptions as m (m)}
                        <option value={m}>{m}</option>
                      {/each}
                    </select>
                  {:else}
                    <Input
                      size="sm"
                      bind:value={cudaModule}
                      className="w-full font-mono text-[11px]"
                      placeholder="e.g. cuda/12.3.2"
                    />
                  {/if}
                </label>
              {/if}

              {#if sessionId && probeReady}
                <button
                  type="button"
                  class="text-[11px] text-neutral-500 underline hover:text-neutral-300"
                  onclick={() => (showDetails = !showDetails)}
                >
                  {showDetails ? 'Hide' : 'Show'} probe details
                </button>
                {#if showDetails}
                  <div
                    class="rounded border border-neutral-200 bg-neutral-50 p-2 text-[11px] dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    <p class="text-neutral-500">
                      {probe?.modules?.length || 0} modules · {partitionOptions.length} partitions ·
                      {nodeOptions.length} nodes
                    </p>
                    {#if probeErrors.length}
                      <ul class="mt-1 list-disc pl-4 text-amber-600 dark:text-amber-400">
                        {#each probeErrors as err (err)}
                          <li>{err}</li>
                        {/each}
                      </ul>
                    {/if}
                    <button
                      type="button"
                      class="mt-1 text-neutral-500 underline"
                      onclick={() => (showRawProbe = !showRawProbe)}
                    >
                      {showRawProbe ? 'Hide' : 'Show'} raw sinfo
                    </button>
                    {#if showRawProbe}
                      <pre
                        class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-neutral-400"
                        >{(probe?.raw_module_avail || '') +
                          '\n---\n' +
                          (probe?.raw_sinfo || '')}</pre
                      >
                    {/if}
                  </div>
                {/if}
              {/if}
            </li>

            <li class="space-y-2 marker:font-semibold">
              <span
                class="font-medium text-neutral-800 dark:text-neutral-200"
                title="sbatch run_equilibration.slurm → bash run_equilibration_cluster.sh"
                >Submit</span
              >
              {#if localPathWarning}
                <p class="text-xs text-amber-600 dark:text-amber-400">{localPathWarning}</p>
              {/if}
              <div class="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !selected}
                  onclick={previewScript}
                >
                  {showScript ? 'Regenerate script' : 'Edit / preview script'}
                </Button>
                {#if useEditedScript && scriptOriginal}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !scriptOriginal}
                    onclick={reloadOriginalScript}
                    title="Restore the last generated script text"
                  >
                    Reload original
                  </Button>
                {/if}
                {#if canSubmit}
                  <Button
                    size="sm"
                    disabled={busy || submitting || !sessionId || !jobDir}
                    onclick={submit}
                  >
                    {#if submitting}<Spinner className="mr-1" />{/if}
                    {#if submitting}
                      {submitPercent != null
                        ? `Uploading… ${Math.round(submitPercent)}%`
                        : 'Uploading…'}
                    {:else if schedulerJobId && remoteTerminal}
                      Upload & resubmit
                    {:else}
                      Upload & submit
                    {/if}
                  </Button>
                {/if}
              </div>
              {#if useEditedScript}
                <p class="text-[10px] text-green-600 dark:text-green-400">
                  Using edited run_equilibration.slurm for the next submit
                  {#if scriptPreview !== scriptOriginal}
                    (modified){/if}
                </p>
              {/if}
            </li>
          </ol>

          {#if schedulerJobId}
            <div class="rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <p class="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
                Slurm job {schedulerJobId}
                {#if remoteState}
                  · {remoteState}{/if}
                {#if remoteTerminal}
                  <span class="text-amber-600 dark:text-amber-400">
                    — finished; resubmit continues from the last completed stage when checkpoints are present (Pull first if needed)</span
                  >
                {/if}
              </p>
              <div class="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || (!sessionId && !selected?.identity_file)}
                  onclick={refreshStatus}
                >
                  Status
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || pulling || !sessionId}
                  onclick={pull}
                  title={remoteActive
                    ? 'Job still running — downloads a partial snapshot only'
                    : 'Download results from the cluster'}
                >
                  {#if pulling}<Spinner className="mr-1" />{/if}
                  {pulling
                    ? pullPercent != null
                      ? `Pulling… ${Math.round(pullPercent)}%`
                      : 'Pulling…'
                    : remoteActive
                      ? 'Pull (partial)'
                      : 'Pull results'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || pulling || !sessionId || remoteTerminal}
                  onclick={cancel}
                >
                  Cancel
                </Button>
              </div>
            </div>
          {/if}
        {/if}

        {#if statusMessage}
          <p class={statusError ? 'text-xs text-red-500' : 'text-xs text-neutral-500'}>
            {statusMessage}
          </p>
        {/if}
        {#if submitting}
          <div class="space-y-1">
            <p class="text-[11px] text-neutral-500">
              {submitPhase === 'sbatch'
                ? 'Submitting to Slurm…'
                : submitPhase === 'verify'
                  ? 'Verifying remote files…'
                  : submitPhase === 'archive'
                    ? 'Archiving previous outputs…'
                    : 'Uploading to the cluster…'}
              {#if submitPercent != null}
                <span class="tabular-nums"> {Math.round(submitPercent)}%</span>
              {/if}
            </p>
            <div
              class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={submitPercent ?? 0}
              aria-label="Submit progress"
            >
              <div
                class="h-full rounded-full bg-sky-500 transition-[width] duration-200 ease-out dark:bg-sky-400"
                style:width="{Math.max(4, submitPercent ?? 4)}%"
              ></div>
            </div>
          </div>
        {/if}
        {#if pulling && pullPercent != null}
          <div
            class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={pullPercent}
            aria-label="Pull progress"
          >
            <div
              class="h-full rounded-full bg-sky-500 transition-[width] duration-200 ease-out dark:bg-sky-400"
              style:width="{Math.max(2, pullPercent)}%"
            ></div>
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-2 dark:border-neutral-800">
        <Button variant="outline" onclick={closeDialog} title="Close without waiting for Pull">
          Close
        </Button>
      </div>
    </div>
  </div>
{/if}

{#if showScript}
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" role="dialog">
    <div
      class="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div class="flex items-center justify-between border-b px-3 py-2 dark:border-neutral-800">
        <h4 class="text-sm font-semibold">run_equilibration.slurm (editable)</h4>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" onclick={reloadOriginalScript}>Reload original</Button>
          <Button
            size="sm"
            variant="outline"
            onclick={() => {
              useEditedScript = true
              showScript = false
            }}
          >
            Keep edits &amp; close
          </Button>
        </div>
      </div>
      <textarea
        class="min-h-[18rem] flex-1 bg-neutral-50 p-3 font-mono text-[11px] dark:bg-neutral-950"
        bind:value={scriptPreview}
        oninput={onScriptEdited}
      ></textarea>
      <div class="flex justify-end gap-2 border-t px-3 py-2 dark:border-neutral-800">
        <Button
          variant="outline"
          onclick={() => {
            useEditedScript = true
            showScript = false
          }}
        >
          Done
        </Button>
      </div>
    </div>
  </div>
{/if}

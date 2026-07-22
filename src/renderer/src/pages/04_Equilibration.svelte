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
    getEquilibrationStatus,
    getOpenmmPlatforms,
    getProcessInfo,
    listEngineExecutables,
    runEquilibration,
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
    { id: 'openmm', label: 'OpenMM' }
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
    openmm: 'python'
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
  const canGenerateInput = $derived(
    workingDir !== '' &&
      inputDir !== '' &&
      isProtocolValid &&
      isEngineSupported &&
      !generatingInputFiles
  )
  const canStartEquilibration = $derived(
    workingDir !== '' &&
      equilibrationStatus !== 'empty' &&
      isEngineSupported &&
      !equilibrationRunning
  )
  const isEngineSupported = $derived(['namd', 'gromacs', 'openmm'].includes(engine))
  const isProtocolValid = $derived(Array.isArray(protocol.stages) && protocol.stages.length > 0)
  const outputDir = $derived(outputFolderPath(workingDir, resolveOutputFolderName()))
  const equilibrationRunning = $derived(equilibrationStatus === 'running')
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
  // state
  /** @type {null | { stageIndex: number, constraintIndex: number, source: Constraint | null }} */
  let constraintEditor = $state(null)
  /** @type {'not_started' | 'empty' | 'running' | 'completed' | 'error'} */
  let equilibrationStatus = $state('not_started')
  /** True after status has been read from the backend (or input was just generated). */
  let statusSynced = $state(false)
  let generatingInputFiles = $state(false)
  /** @type {Array<{ name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, elapsed_time_seconds: number|null, output: string }>} */
  let stageStatuses = $state([])
  /** @type {number|undefined} */
  let updateTimeoutId = undefined
  let showProcessInfo = $state(false)
  /** @type {{ pid: number|null, running: boolean, command: string|null, start_time: string|null, working_dir: string, engine: string } | null} */
  let processInfo = $state(null)
  let loadingProcessInfo = $state(false)
  let stopping = $state(false)

  // ── Sync to shared status bar store ──
  $effect(() => {
    equilibrationPageStatus.engine = engine
    equilibrationPageStatus.outputName = outputName
    equilibrationPageStatus.status = equilibrationStatus
    equilibrationPageStatus.stagesDone = stageStatuses.filter(
      (s) => s.status === 'completed'
    ).length
    equilibrationPageStatus.stagesTotal = stageStatuses.length
    equilibrationPageStatus.generatingInput = generatingInputFiles
  })

  // output
  let equilibrationOutput = $state('')
  let showWorkingDirHint = $state(false)

  $effect(() => {
    if (workingDir !== '') {
      showWorkingDirHint = false
      highlightWorkingDir(false)
    }
  })

  $effect(() => {
    unscheduleUpdate()
    if (outputDir === '') return
    updateProgress()
  })

  $effect(() => {
    unscheduleUpdate()
    if (!autoMonitor) {
      return
    }
    const running = untrack(() => equilibrationRunning)
    if (!running) {
      return
    }
    updateProgress()
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

  onDestroy(unscheduleUpdate)

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
      const { status } = await getEquilibrationStatus({ workingDir: outputDir, engine })
      if (status === 'running') {
        alert('Equilibration is running. Wait for it to finish.')
        return
      }
      if (
        ['not_started', 'completed', 'error'].includes(status) &&
        !confirm('Overwrite existing equilibration?')
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
      if (equilibrationStatus === 'empty') {
        equilibrationStatus = 'not_started'
      }
      statusSynced = true
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
        const defaults = { namd: 'namd3', gromacs: 'gmx', openmm: 'python' }
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
      // TODO: write protocol and compare existing protocol with new one so to enable run button, otherwise disable it
      // as it already run
      const payload = { workingDir: outputDir, engine }
      const { status, ...rest } = await getEquilibrationStatus(payload)
      equilibrationStatus = status
      if (status === 'running') {
        alert('Equilibration is already running. Wait for it to finish.')
        return
      } else if (status === 'empty') {
        // Shouldn't happen (button is disabled), but guard anyway
        return
      } else if (
        ['completed', 'error'].includes(status) &&
        !confirm('An existing equilibration has finished. Overwrite it?')
      ) {
        return
      }

      equilibrationOutput = ''
      equilibrationPageStatus.wasKilled = false
      await runEquilibration({ workingDir: outputDir, engine })
      equilibrationStatus = 'running'
      logEvent(
        'info',
        'eq',
        `Started equilibration: "${outputName}"`,
        `${engine.toUpperCase()} · ${outputDir}`
      )
      setTimeout(updateProgress, 1000)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
      equilibrationStatus = 'not_started'
    }
  }

  async function toggleProcessInfo() {
    if (showProcessInfo) {
      showProcessInfo = false
      return
    }
    loadingProcessInfo = true
    showProcessInfo = true
    try {
      processInfo = await getProcessInfo({ workingDir: outputDir, engine })
    } catch (error) {
      processInfo = null
    } finally {
      loadingProcessInfo = false
    }
  }

  async function killEquilibration() {
    if (
      !confirm(
        `Stop the running ${engine.toUpperCase()} equilibration in "${outputName}"? This cannot be undone.`
      )
    )
      return
    try {
      stopping = true
      unscheduleUpdate()
      await stopEquilibration({ workingDir: outputDir, engine })
      equilibrationPageStatus.wasKilled = true
      logEvent(
        'info',
        'eq',
        `Killed equilibration: "${outputName}"`,
        `${engine.toUpperCase()} · ${outputDir}`
      )
      // Refresh status immediately after killing (no further polling)
      await updateProgress({ scheduleNext: false })
      showProcessInfo = false
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      stopping = false
    }
  }

  function unscheduleUpdate() {
    clearTimeout(updateTimeoutId)
    updateTimeoutId = undefined
  }

  async function updateProgress({ scheduleNext = true } = {}) {
    let status = 'not_started'
    let stages = []
    let output = ''
    let run_start_time = null
    try {
      const payload = { workingDir: outputDir, engine }
      ;({ status, stages, output, run_start_time } = await getEquilibrationStatus(payload))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }

    equilibrationStatus = status
    statusSynced = true
    if (status === 'empty') {
      equilibrationOutput = ''
      stageStatuses = []
      return
    }

    // Keep historical progress visible after restart/stop when backend returns
    // status=not_started but still provides stage snapshots.
    if (status === 'not_started' && stages.length === 0) {
      equilibrationOutput = ''
      stageStatuses = []
      return
    }

    if (status === 'error') {
      equilibrationOutput = stages.find((stage) => stage.status === 'error')?.output ?? ''
    }
    stageStatuses = stages

    // Persist start time from the backend so elapsed survives app restart
    if (run_start_time) {
      equilibrationPageStatus.runStartedAt = new Date(run_start_time).getTime()
    } else if (status === 'empty' || status === 'not_started') {
      equilibrationPageStatus.runStartedAt = null
    }

    if (scheduleNext && autoMonitor && status !== 'empty') {
      clearTimeout(updateTimeoutId)
      updateTimeoutId = setTimeout(updateProgress, updateInterval * 1000)
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
    unscheduleUpdate()
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
    executableByEngine = { namd: 'namd3', gromacs: 'gmx', openmm: 'python' }
    engineCandidates = []
    engineCandidateId = 'custom'
    selectedGmxrc = null
    protocol = prepareProtocolForRendering(baseProtocol)
    constraintEditor = null
    equilibrationStatus = 'not_started'
    statusSynced = false
    generatingInputFiles = false
    stageStatuses = []
    showProcessInfo = false
    processInfo = null
    loadingProcessInfo = false
    stopping = false
    equilibrationOutput = ''
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
            placeholder={engine === 'openmm' ? 'python' : engine === 'gromacs' ? 'gmx' : 'namd3'}
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
              title="Written into the generated run scripts (GPU flags / OpenMM PLATFORM). You can choose a target that is not available on this PC — e.g. prepare inputs here and run later on a CUDA machine. A green dot on a chip means that target was detected locally."
              aria-label="About compute target: written into run scripts; may differ from this machine"
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
                    ? `Available on this PC · select for scripts`
                    : `Not detected here · still writable into scripts`}
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
              Not detected on this PC — scripts will still target {computeTarget}.
            </p>
          {:else if computeTarget === 'auto'}
            <p class="sidebar-hint">
              {engine === 'openmm'
                ? 'OpenMM picks the fastest platform at runtime.'
                : 'Scripts prefer GPU when the engine supports it.'}
            </p>
          {:else if availableCompute.length > 0}
            <p class="sidebar-hint">Available here: {availableCompute.join(', ')}</p>
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
        <Button className="w-full" onclick={startEquilibration} disabled={!canStartEquilibration}>
          {#if equilibrationRunning}
            <Spinner className="mr-1" />
            Running...
          {:else}
            Run Equilibration
          {/if}
        </Button>
      </div>
      {#if equilibrationStatus === 'empty' && workingDir !== ''}
        <p class="gw-notice gw-notice-warning">
          Input files have not been generated yet. Click <strong>Generate Input Files</strong> first.
        </p>
      {/if}
      {#if equilibrationStatus === 'not_started' && statusSynced && workingDir !== ''}
        <div class="gw-notice gw-notice-success">
          <p>✓ Input files are ready.</p>
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
      <div class="flex items-center gap-2">
        <Checkbox name="auto-monitor" size="sm" bind:checked={autoMonitor} />
        <label for="auto-monitor">Update progress every</label>
        <Input
          type="number"
          name="update-interval"
          min="1"
          max="100"
          step="1"
          value={updateInterval}
          size="sm"
          className="w-16"
        />
        <label for="update-interval">seconds</label>
        {#if equilibrationRunning && autoMonitor}
          <Spinner className="mr-1" />
        {/if}
        <Button variant="outline" size="sm" onclick={() => updateProgress({ scheduleNext: false })}>
          Refresh
        </Button>
        <Button variant="outline" size="sm" onclick={toggleProcessInfo}>
          {showProcessInfo ? 'Hide Info' : 'Process Information'}
        </Button>
        {#if equilibrationRunning}
          <Button variant="outline" size="sm" onclick={killEquilibration} disabled={stopping}>
            {stopping ? 'Stopping…' : 'Kill MD'}
          </Button>
        {/if}
      </div>
      {#if showProcessInfo}
        <div class="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
          {#if loadingProcessInfo}
            <span class="text-neutral-400">Loading…</span>
          {:else if processInfo}
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span class="text-neutral-500">Engine</span>
              <span class="uppercase">{processInfo.engine}</span>
              <span class="text-neutral-500">Directory</span>
              <span class="truncate font-mono" title={processInfo.working_dir}
                >{processInfo.working_dir}</span
              >
              <span class="text-neutral-500">PID</span>
              <span>{processInfo.pid ?? '—'}</span>
              <span class="text-neutral-500">Status</span>
              <span class={processInfo.running ? 'text-green-400' : 'text-neutral-400'}
                >{processInfo.running ? 'Running' : 'Not running'}</span
              >
              {#if processInfo.start_time}
                <span class="text-neutral-500">Started</span>
                <span>{new Date(processInfo.start_time).toLocaleString()}</span>
              {/if}
              {#if processInfo.command}
                <span class="text-neutral-500">Command</span>
                <span class="truncate font-mono text-neutral-300" title={processInfo.command}
                  >{processInfo.command}</span
                >
              {/if}
            </div>
          {:else}
            <span class="text-neutral-400">No process information available.</span>
          {/if}
        </div>
      {/if}
      {#if ['running', 'completed', 'error'].includes(equilibrationStatus) || stageStatuses.length > 0}
        <div class="grid grid-cols-[auto_1fr] gap-2">
          {#each stageStatuses as stage_info (stage_info.name)}
            <EquilibrationStageStatus {stage_info} tracking={equilibrationRunning && autoMonitor} />
          {/each}
        </div>
        {#if equilibrationOutput}
          <pre class="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">{equilibrationOutput}</pre>
        {/if}
      {:else if equilibrationStatus === 'empty'}
        <Empty message="No equilibration files found. Generate input files first." />
      {:else}
        <Empty message="Start an equilibration to see progress." />
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

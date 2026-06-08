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
    runEquilibration,
    stopEquilibration,
    getStructure
  } from '../lib/backendApi'

  /** @typedef {{ id: string, name: string, force_constant: number, selection: string }} Constraint */

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
  let outputName = $state('equilibration')
  let protocol = $state(prepareProtocolForRendering(baseProtocol))
  let addComRestraint = $state(false)
  let comSelection = $state('name CA')
  let comRestraintK = $state(10)
  let addRotationRestraint = $state(false)
  let rotationRestraintK = $state(2000)
  let validatingComSelection = $state(false)
  let comSelectionValidation = $state(/** @type {{ ok: boolean, message: string } | null} */ (null))
  let checkingExecutable = $state(false)
  let executableCheck = $state(/** @type {{ ok: boolean, message: string } | null} */ (null))
  /** @type {{ name: string, speed: number }[] | null} */
  let openmmPlatforms = $state(null)
  /** @type {string | null} null = auto-detect */
  let openmmPlatform = $state(null)
  let executableByEngine = $state({
    namd: 'namd3',
    gromacs: 'gmx',
    openmm: 'python'
  })
  /** @type {number | null} */
  let systemSize = $state(null)
  let totalCpus = $state(4)
  let totalGpus = $state(1)
  let updateInterval = $state(5)
  let useGpu = $state(true)

  const GPU_PLATFORMS = ['CUDA', 'OpenCL', 'Metal']

  $effect(() => {
    if (!useGpu) {
      // Force CPU when GPU acceleration is disabled
      if (openmmPlatform === null || GPU_PLATFORMS.includes(openmmPlatform)) {
        openmmPlatform = 'CPU'
      }
    } else {
      // Restore auto-detect if we had force-set to CPU
      if (openmmPlatform === 'CPU') {
        openmmPlatform = null
      }
    }
  })

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
  const outputDir = $derived([workingDir, outputName].join('/'))
  const equilibrationRunning = $derived(equilibrationStatus === 'running')
  const selectedExecutable = $derived(executableByEngine[engine] ?? '')
  const resources = $derived({
    cpu_cores: totalCpus,
    gpu_id: gpuDevice,
    num_gpus: totalGpus,
    use_gpu: useGpu
  })

  // state
  /** @type {null | { stageIndex: number, constraintIndex: number, source: Constraint | null }} */
  let constraintEditor = $state(null)
  /** @type {'not_started' | 'empty' | 'running' | 'completed' | 'error'} */
  let equilibrationStatus = $state('not_started')
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
    countMatchingAtoms('all').then((n) => {
      systemSize = n
    })
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
          executable: selectedExecutable
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
  }

  async function checkEngineExecutable() {
    if (!selectedExecutable.trim()) {
      executableCheck = { ok: false, message: 'Executable cannot be empty.' }
      return
    }
    checkingExecutable = true
    openmmPlatforms = null
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
            openmmPlatforms = platforms ?? []
            // Auto-select best available GPU platform, or CPU if GPU disabled
            if (!useGpu) {
              openmmPlatform = 'CPU'
            } else if (openmmPlatform === null) {
              const best = (platforms ?? []).find((p) => GPU_PLATFORMS.includes(p.name))
              openmmPlatform = best ? best.name : null
            }
          } catch {
            openmmPlatforms = []
          }
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
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800 overflow-hidden select-none">
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <div class="space-y-1">
        <p class="text-xs">Input directory:</p>
        <p class="text-xs text-neutral-500">
          Must contain <code>.prmtop</code> and <code>.inpcrd</code> files.
        </p>
        {#if inputDir}
          <div class="w-full rounded-md border border-neutral-800 p-2 font-mono wrap-anywhere">
            {inputDir}
          </div>
          {#if systemSize !== null}
            <p class="mb-2 text-xs">System size: {systemSize.toLocaleString()} atoms</p>
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
        <p class="text-xs">Output directory:</p>
        <Input type="text" bind:value={outputName} className="w-full" placeholder="equilibration" />
      </div>
    </div>
    <Divider />
    <div class="space-y-2">
      <h2 class="font-semibold">Molecular Dynamics</h2>
      <div class="space-y-1">
        <p class="text-xs">Engine:</p>
        <Select
          className="w-full"
          bind:value={engine}
          onchange={() => {
            executableCheck = null
            openmmPlatforms = null
          }}
        >
          {#each engines as item (item.id)}
            <option value={item.id}>{item.label}</option>
          {/each}
        </Select>
        {#if engine === 'namd'}
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            NAMD + OPC builds: waterModel tip4 is added automatically from the builder
            job (FlexibleWater prmtop).
          </p>
        {/if}
      </div>
      <div class="space-y-1">
        <p class="text-xs">Executable:</p>
        <Input
          type="text"
          value={selectedExecutable}
          oninput={(e) => {
            executableByEngine[engine] = e.target.value
            executableCheck = null
            openmmPlatforms = null
            openmmPlatform = null
          }}
          className="w-full"
          placeholder={engine === 'openmm' ? 'python' : engine === 'gromacs' ? 'gmx' : 'namd3'}
        />
        <Button variant="outline" className="w-full" onclick={checkEngineExecutable}>
          {#if checkingExecutable}
            <Spinner className="mr-1" />
            Checking executable...
          {:else}
            Check Executable
          {/if}
        </Button>
        {#if executableCheck}
          <p class={executableCheck.ok ? 'text-xs text-green-400' : 'text-xs text-red-400'}>
            {executableCheck.message}
          </p>
        {/if}
        {#if engine === 'openmm' && openmmPlatforms !== null}
          <div class="space-y-1 pt-0.5">
            <p class="text-xs text-zinc-400">Platform:</p>
            <div class="flex flex-wrap gap-1">
              {#each openmmPlatforms.filter((p) => p.name !== 'Reference') as p}
                {@const isGpu = GPU_PLATFORMS.includes(p.name)}
                {@const isDisabled = isGpu && !useGpu}
                {@const isSelected =
                  openmmPlatform === p.name || (openmmPlatform === null && isGpu)}
                <button
                  type="button"
                  disabled={isDisabled}
                  onclick={() => {
                    openmmPlatform = openmmPlatform === p.name ? null : p.name
                  }}
                  class="rounded px-1.5 py-0.5 text-xs font-medium transition-colors
                    {isDisabled
                    ? 'cursor-not-allowed bg-zinc-800 text-zinc-500 opacity-40'
                    : isSelected
                      ? isGpu
                        ? 'bg-green-700 text-green-100 ring-1 ring-green-400'
                        : 'bg-blue-700 text-blue-100 ring-1 ring-blue-400'
                      : isGpu
                        ? 'bg-green-900 text-green-300 hover:bg-green-800'
                        : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}"
                  >{p.name}{isSelected ? ' ✓' : ''}</button
                >
              {/each}
              {#if openmmPlatforms.filter((p) => p.name !== 'Reference').length === 0}
                <span class="text-xs text-zinc-400">No platforms detected</span>
              {/if}
            </div>
            {#if openmmPlatform === null}
              <p class="text-xs text-zinc-500">Auto-detect (fastest available)</p>
            {:else}
              <p class="text-xs text-zinc-400">
                Selected: <span class="text-zinc-200">{openmmPlatform}</span>
              </p>
            {/if}
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
        <label for="add-com-restraint">Generate COM restraint during input generation</label>
      </div>
      {#if addComRestraint}
        <div class="space-y-1">
          <p class="text-xs">COM reference selection (MDAnalysis):</p>
          <Input
            type="text"
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
          <p class="text-[11px] text-neutral-500">
            Used to define COM translation target and optional rotation reference atoms.
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-xs">COM translation k (kcal/mol/A^2):</p>
          <Input type="number" min="0" step="0.1" bind:value={comRestraintK} className="w-full" />
        </div>
        <div class="col-span-2 flex items-center gap-2">
          <Checkbox id="add-rotation-restraint" bind:checked={addRotationRestraint} />
          <label for="add-rotation-restraint">Also generate rotation restraint</label>
        </div>
        {#if addRotationRestraint}
          <div class="space-y-1">
            <p class="text-xs">Rotation k (kcal/mol/A^2):</p>
            <Input
              type="number"
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
      <h2 class="col-span-2 font-semibold">Computational Resources</h2>
      <label for="cpu-cores" class="flex-1">CPU Cores:</label>
      <Input id="cpu-cores" type="number" size="sm" bind:value={totalCpus} />

      <div class="col-span-2 flex items-center gap-2">
        <Checkbox id="use-gpu" bind:checked={useGpu} />
        <label for="use-gpu">Enable GPU acceleration</label>
      </div>

      {#if useGpu}
        <label for="gpu_id">GPU ID:</label>
        <Input id="gpu-id" type="number" size="sm" bind:value={gpuDevice} />

        <label for="num-gpus">Number of GPUs:</label>
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
        <p
          class="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400"
        >
          Input files have not been generated yet. Click <strong>Generate Input Files</strong> first.
        </p>
      {/if}
      {#if workingDir === '' && showWorkingDirHint}
        <p
          class="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400"
        >
          Set a <strong>Working Directory</strong> in the top bar to enable these actions.
        </p>
      {/if}
    </div>
  </aside>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1 flex-col space-y-4 p-4">
      <div>
        <h3 class="font-semibold">{isProtocolValid ? protocol.name : 'Protocol'}</h3>
        <p class="mb-2 text-sm text-neutral-500">
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
      class="flex max-h-2/5 min-h-1/5 flex-col gap-2 overflow-y-auto border-t p-4 text-xs dark:border-neutral-800"
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
        <div class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs">
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
          <pre class="rounded-md border border-neutral-800 p-2 text-xs">{equilibrationOutput}</pre>
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

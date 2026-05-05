<script>
  import { onDestroy, untrack } from 'svelte'
  import Button from '../components/ui/Button.svelte'
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
    generateEquilibration,
    getEquilibrationStatus,
    runEquilibration,
    selectAtoms
  } from '../lib/backendApi'

  /** @typedef {{ id: string, name: string, force_constant: number, selection: string }} Constraint */

  /** @type {Record<string, { default: import('svelte').Component, label?: string }>} */
  const engineModules = import.meta.glob('./equilibration/engines/*.svelte', { eager: true })
  const engines = Object.entries(engineModules)
    .map(([path, mod]) => {
      const name = path.split('/').pop().replace('.svelte', '')
      return {
        id: name.toLowerCase(),
        label: mod.label ?? name,
        Component: mod.default
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  let autoMonitor = $state(true)
  let engine = $state('namd')
  let ensemble = $state('nvt')
  let gpuDevice = $state(0)
  let inputDir = $state('')
  let outputName = $state('equilibration')
  let protocol = $state(prepareProtocolForRendering(baseProtocol))
  /** @type {number | null} */
  let systemSize = $state(null)
  let totalCpus = $state(4)
  let totalGpus = $state(1)
  let updateInterval = $state(5)
  let useGpu = $state(true)

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
  const CurrentEngine = $derived(engines.find((e) => e.id === engine)?.Component)
  const isEngineSupported = $derived(['namd'].includes(engine))
  const isProtocolValid = $derived(Array.isArray(protocol.stages) && protocol.stages.length > 0)
  const outputDir = $derived([workingDir, outputName].join('/'))
  const equilibrationRunning = $derived(equilibrationStatus === 'running')
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
  /** @type {Array<{ name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, output: string }>} */
  let stageStatuses = $state([])
  /** @type {number|undefined} */
  let updateTimeoutId = undefined

  // output
  let equilibrationOutput = $state('')

  $effect(() => {
    unscheduleUpdate()
    if (workingDir === '') return
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
      return
    }
    systemSize = null
    const payload = {
      path: `${dir}/system.inpcrd`,
      selection: 'all',
      topology: `${dir}/system.prmtop`
    }
    selectAtoms(payload).then(({ atoms }) => {
      systemSize = atoms.length
    })
  })

  onDestroy(unscheduleUpdate)

  async function generateInput() {
    try {
      if (equilibrationRunning) {
        alert('Equilibration is running. Wait for it to finish.')
        return
      }
      if (
        ['not_started', 'completed', 'error'].includes(equilibrationStatus) &&
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
          engine: 'namd',
          executable: 'namd3'
        }
      })
      if (equilibrationStatus === 'empty') {
        equilibrationStatus = 'not_started'
      }
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
        alert('Generate input files first.')
        return
      } else if (
        ['completed', 'error'].includes(status) &&
        !confirm('An existing equilibration has finished. Overwrite it?')
      ) {
        return
      }

      equilibrationOutput = ''
      await runEquilibration({ workingDir: outputDir, engine })
      equilibrationStatus = 'running'
      setTimeout(updateProgress, 1000)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
      equilibrationStatus = 'not_started'
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
    try {
      const payload = { workingDir: outputDir, engine }
      ;({ status, stages, output } = await getEquilibrationStatus(payload))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }

    equilibrationStatus = status
    if (['not_started', 'empty'].includes(status)) {
      equilibrationOutput = ''
      stageStatuses = []
      return
    }

    if (status === 'error') {
      equilibrationOutput = stages.find((stage) => stage.status === 'error')?.output ?? ''
    }
    stageStatuses = stages

    if (scheduleNext && autoMonitor && equilibrationRunning) {
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

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800 select-none">
  <aside class="w-70 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
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
        <Input type="text" value={outputName} className="w-full" disabled />
      </div>
    </div>
    <Divider />
    <div class="space-y-2">
      <h2 class="font-semibold">Molecular Dynamics</h2>
      <div class="space-y-1">
        <p class="text-xs">Engine:</p>
        <Select className="w-full" bind:value={engine}>
          {#each engines as engine (engine.id)}
            <option value={engine.id}>{engine.label}</option>
          {/each}
        </Select>
      </div>
      {#if CurrentEngine}
        <CurrentEngine />
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
      <Button className="w-full" onclick={startEquilibration} disabled={!canStartEquilibration}>
        {#if equilibrationRunning}
          <Spinner className="mr-1" />
          Running...
        {:else}
          Run Equilibration
        {/if}
      </Button>
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
        <Button variant="outline" size="sm">Process Information</Button>
      </div>
      {#if ['running', 'completed', 'error'].includes(equilibrationStatus)}
        <div class="grid grid-cols-[auto_1fr] gap-2">
          {#each stageStatuses as stage_info (stage_info.name)}
            <EquilibrationStageStatus {stage_info} />
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
      />
    {/key}
  {/if}
</div>

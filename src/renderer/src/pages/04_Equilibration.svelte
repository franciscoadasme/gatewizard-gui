<script>
  import { untrack } from 'svelte'
  import Button from '../components/ui/Button.svelte'
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
    runEquilibration
  } from '../lib/backendApi'

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
  let inputDir = $state('')
  let outputName = $state('equilibration')
  let protocol = $state(prepareProtocolForRendering(baseProtocol))
  let updateInterval = $state(5)

  // derived values
  const CurrentEngine = $derived(engines.find((e) => e.id === engine)?.Component)
  const isProtocolValid = $derived(Array.isArray(protocol.stages) && protocol.stages.length > 0)
  const outputDir = $derived([workingDir, outputName].join('/'))

  // state
  /** @type {boolean} */
  let equilibrationRunning = $state(false)
  /** @type {Array<{ name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, output: string }>} */
  let stageStatuses = $state([])

  // output
  let equilibrationOutput = $state('')

  $effect(() => {
    if (!autoMonitor) {
      return
    }
    const running = untrack(() => equilibrationRunning)
    const ms = untrack(() => updateInterval) * 1000
    if (!running) {
      return
    }
    setTimeout(updateProgress, ms)
  })

  async function generateInput() {
    try {
      await generateEquilibration({
        inputDir,
        outputDir,
        protocol,
        ensemble,
        programConfig: {
          engine: 'namd',
          executable: 'namd3'
        }
      })
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
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
      if (status === 'running') {
        alert('Equilibration is already running. Wait for it to finish.')
        return
      }
      equilibrationOutput = ''
      await runEquilibration({ workingDir: outputDir, engine })
      equilibrationRunning = true
      setTimeout(updateProgress, 1000)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
      equilibrationRunning = false
    }
  }

  async function updateProgress({ scheduleNext = true } = {}) {
    try {
      const payload = { workingDir: outputDir, engine }
      const { status, stages, output } = await getEquilibrationStatus(payload)
      if (status === 'not_started') {
        equilibrationRunning = false
        equilibrationOutput = ''
        stageStatuses = []
        return
      }

      equilibrationRunning = status === 'running'
      if (status === 'error') {
        equilibrationOutput = stages.find((stage) => stage.status === 'error')?.output ?? ''
      }
      stageStatuses = stages

      if (scheduleNext && autoMonitor && equilibrationRunning) {
        setTimeout(updateProgress, updateInterval * 1000)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
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
          <Input type="text" value={inputDir} className="w-full" disabled />
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
    <div class="space-y-2">
      <Button className="w-full" onclick={startEquilibration} disabled={equilibrationRunning}>
        {#if equilibrationRunning}
          <Spinner className="mr-1" />
          Running...
        {:else}
          Run Equilibration
        {/if}
      </Button>
      <!-- TODO: add spinner while generating input files -->
      <Button
        className="w-full"
        variant="outline"
        onclick={generateInput}
        disabled={workingDir === '' || inputDir === '' || !isProtocolValid}
        >Generate Input Files</Button
      >
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
            <EquilibrationStage bind:stage={protocol.stages[i]} {ensemble} />
          {/each}
        </div>
      {:else}
        <Empty message="No protocol loaded" />
      {/if}
    </div>
    <div
      class="max-h-2/5 min-h-1/5 space-y-2 overflow-y-auto border-t p-4 text-xs dark:border-neutral-800"
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
        <Button variant="outline" size="sm" onclick={() => updateProgress({ scheduleNext: false })}>
          Refresh
        </Button>
        <Button variant="outline" size="sm">Process Information</Button>
      </div>
      <div class="grid grid-cols-[auto_1fr] gap-2">
        {#each stageStatuses as stage_info (stage_info.name)}
          <EquilibrationStageStatus {stage_info} />
        {/each}
      </div>
      {#if equilibrationOutput}
        <pre class="rounded-md border border-neutral-800 p-2 text-xs">{equilibrationOutput}</pre>
      {/if}
    </div>
  </div>
</div>

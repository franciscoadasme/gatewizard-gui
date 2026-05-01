<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import LineChart from '../components/LineChart.svelte'
  import {
    getEnergeticProperties,
    runEnergeticAnalysis,
    runStructuralAnalysis
  } from '../lib/backendApi'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  let mode = $state('structural')
  let running = $state(false)

  // Structural analysis state
  let topologyPath = $state('')
  /** @type {Array<{ path: string, timeNs: string }>} */
  let trajectoryFiles = $state([])
  let structuralType = $state('rmsd')
  let selection = $state('protein and backbone')
  let selection2 = $state('protein and resid 50')
  let referenceFrame = $state('0')
  let align = $state(true)

  // Energetic analysis state
  /** @type {Array<{ path: string, timeNs: string }>} */
  let logFiles = $state([])
  /** @type {string[]} */
  let availableProperties = $state([])
  /** @type {string[]} */
  let selectedProperties = $state([])
  let timeUnits = $state('ns')
  let energyUnits = $state('kcal/mol')
  let pressureUnits = $state('atm')
  let temperatureUnits = $state('K')
  let volumeUnits = $state('Å³')

  // Output
  /** @type {Array<{ name: string, x: number[], y: number[] }>} */
  let chartSeries = $state([])
  let chartXLabel = $state('X')
  let chartYLabel = $state('Y')
  let chartTitle = $state('')
  let lastError = $state('')
  /** @type {Record<string, number> | null} */
  let primaryStats = $state(null)

  function basename(path) {
    return path.split(/[\\/]/).pop() || path
  }

  function makeFileTimes(items) {
    const map = {}
    for (const item of items) {
      const value = Number(item.timeNs)
      if (Number.isFinite(value) && value > 0) {
        map[basename(item.path)] = value
      }
    }
    return map
  }

  async function pickTopologyFile() {
    const result = await window.api.openFileDialog(
      'Select Topology File',
      [
        { name: 'Topology', extensions: ['pdb', 'psf', 'prmtop', 'parm7', 'gro'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      workingDir || undefined
    )
    if (!result.canceled) topologyPath = result.filePath
  }

  async function addTrajectoryFile() {
    const result = await window.api.openFilesDialog(
      'Add Trajectory Files',
      [{ name: 'Trajectory', extensions: ['dcd', 'xtc', 'trr', 'nc', 'mdcrd'] }],
      workingDir || undefined
    )
    if (result.canceled) return
    const existing = new Set(trajectoryFiles.map((f) => f.path))
    const newFiles = result.filePaths
      .filter((p) => !existing.has(p))
      .map((p) => ({ path: p, timeNs: '' }))
    trajectoryFiles = [...trajectoryFiles, ...newFiles]
  }

  function removeTrajectory(index) {
    trajectoryFiles = trajectoryFiles.filter((_, i) => i !== index)
  }

  async function addLogFile() {
    const result = await window.api.openFilesDialog(
      'Add NAMD Log Files',
      [{ name: 'NAMD Logs', extensions: ['log'] }],
      workingDir || undefined
    )
    if (result.canceled) return
    const existing = new Set(logFiles.map((f) => f.path))
    const newFiles = result.filePaths
      .filter((p) => !existing.has(p))
      .map((p) => ({ path: p, timeNs: '' }))
    logFiles = [...logFiles, ...newFiles]
  }

  function removeLog(index) {
    logFiles = logFiles.filter((_, i) => i !== index)
  }

  async function detectEnergeticColumns() {
    if (logFiles.length === 0) {
      alert('Add at least one log file first.')
      return
    }
    try {
      running = true
      lastError = ''
      const fileTimes = makeFileTimes(logFiles)
      const { properties } = await getEnergeticProperties({
        logPaths: logFiles.map((f) => f.path),
        fileTimes
      })
      availableProperties = properties || []
      selectedProperties = [...availableProperties]
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      running = false
    }
  }

  function toggleProperty(prop, checked) {
    if (checked) {
      if (!selectedProperties.includes(prop)) selectedProperties = [...selectedProperties, prop]
      return
    }
    selectedProperties = selectedProperties.filter((p) => p !== prop)
  }

  async function runAnalysis() {
    try {
      running = true
      lastError = ''
      chartSeries = []
      primaryStats = null

      if (mode === 'structural') {
        if (!topologyPath) throw new Error('Select a topology file.')
        if (trajectoryFiles.length === 0) throw new Error('Add at least one trajectory file.')
        if (structuralType === 'distance' && (!selection || !selection2)) {
          throw new Error('Distance analysis requires two atom selections.')
        }

        const fileTimes = makeFileTimes(trajectoryFiles)
        const result = await runStructuralAnalysis({
          topologyPath,
          trajectoryPaths: trajectoryFiles.map((f) => f.path),
          analysisType: structuralType,
          selection,
          selection2,
          referenceFrame: Number(referenceFrame || 0),
          align,
          fileTimes
        })

        chartSeries = [
          {
            name: result.series_name,
            x: result.x || [],
            y: result.y || []
          }
        ]
        chartTitle = `${(result.analysis_type || structuralType).toUpperCase()} Analysis`
        chartXLabel = result.x_label || 'X'
        chartYLabel = result.y_label || 'Y'
        primaryStats = result.stats || null
      } else {
        if (logFiles.length === 0) throw new Error('Add at least one NAMD log file.')
        if (selectedProperties.length === 0) throw new Error('Select at least one property.')

        const fileTimes = makeFileTimes(logFiles)
        const result = await runEnergeticAnalysis({
          logPaths: logFiles.map((f) => f.path),
          properties: selectedProperties,
          fileTimes,
          timeUnits,
          energyUnits,
          pressureUnits,
          temperatureUnits,
          volumeUnits
        })

        chartSeries = (result.series || []).map((s) => ({
          name: `${s.name} (${s.unit || ''})`.replace(/ \(\)$/, ''),
          x: result.x || [],
          y: s.y || []
        }))
        chartTitle = 'NAMD Energetic Analysis'
        chartXLabel = result.x_label || 'Time'
        chartYLabel = 'Value'
        const first = result.series?.[0]?.key
        primaryStats = first && result.statistics ? result.statistics[first] || null : null
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      running = false
    }
  }
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800 select-none">
  <aside class="w-80 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <h2 class="font-semibold">Analysis Mode</h2>
      <Select className="w-full" bind:value={mode}>
        <option value="structural">Structural</option>
        <option value="energetic">Energetic (NAMD Logs)</option>
      </Select>
    </div>

    <Divider />

    {#if mode === 'structural'}
      <div class="space-y-2">
        <h2 class="font-semibold">Structural Input</h2>
        <div class="space-y-1">
          <p class="text-neutral-500">Topology file</p>
          <Input value={topologyPath} disabled className="w-full" />
          <Button variant="outline" className="w-full" onclick={pickTopologyFile}
            >Select topology</Button
          >
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <p class="text-neutral-500">Trajectory files</p>
            <Button size="sm" variant="outline" onclick={addTrajectoryFile}>+ Add</Button>
          </div>
          {#if trajectoryFiles.length === 0}
            <p class="text-neutral-600">No trajectory files selected.</p>
          {:else}
            <div class="space-y-0.5">
              {#each trajectoryFiles as file, i (file.path)}
                <div
                  class="flex items-center gap-1 rounded border px-1.5 py-1 dark:border-neutral-800"
                >
                  <span class="min-w-0 flex-1 truncate text-neutral-300" title={file.path}
                    >{basename(file.path)}</span
                  >
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    bind:value={trajectoryFiles[i].timeNs}
                    className="w-14 shrink-0"
                  />
                  <span class="shrink-0 text-neutral-500">ns</span>
                  <button
                    class="shrink-0 px-1 text-red-500 hover:text-red-400"
                    onclick={() => removeTrajectory(i)}
                    title="Remove">✕</button
                  >
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <Divider />

      <div class="space-y-2">
        <h2 class="font-semibold">Structural Options</h2>
        <Select className="w-full" bind:value={structuralType}>
          <option value="rmsd">RMSD</option>
          <option value="rmsf">RMSF</option>
          <option value="distance">Distance</option>
          <option value="radius_of_gyration">Radius of Gyration</option>
        </Select>
        <Input bind:value={selection} placeholder="Selection 1 (MDAnalysis)" className="w-full" />

        {#if structuralType === 'distance'}
          <Input
            bind:value={selection2}
            placeholder="Selection 2 (MDAnalysis)"
            className="w-full"
          />
        {/if}

        {#if structuralType === 'rmsd'}
          <div class="flex items-center gap-2">
            <span class="text-neutral-500">Reference frame</span>
            <Input size="sm" type="number" min="0" bind:value={referenceFrame} className="w-20" />
          </div>
          <div class="flex items-center gap-2">
            <Checkbox name="align-rmsd" bind:checked={align} />
            <label for="align-rmsd">Align before RMSD</label>
          </div>
        {/if}
      </div>
    {:else}
      <div class="space-y-2">
        <h2 class="font-semibold">Energetic Input</h2>
        <div class="flex items-center justify-between">
          <p class="text-neutral-500">NAMD log files</p>
          <Button size="sm" variant="outline" onclick={addLogFile}>+ Add</Button>
        </div>

        {#if logFiles.length === 0}
          <p class="text-neutral-600">No log files selected.</p>
        {:else}
          <div class="space-y-0.5">
            {#each logFiles as file, i (file.path)}
              <div
                class="flex items-center gap-1 rounded border px-1.5 py-1 dark:border-neutral-800"
              >
                <span class="min-w-0 flex-1 truncate text-neutral-300" title={file.path}
                  >{basename(file.path)}</span
                >
                <Input
                  size="sm"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="0"
                  bind:value={logFiles[i].timeNs}
                  className="w-14 shrink-0"
                />
                <span class="shrink-0 text-neutral-500">ns</span>
                <button
                  class="shrink-0 px-1 text-red-500 hover:text-red-400"
                  onclick={() => removeLog(i)}
                  title="Remove">✕</button
                >
              </div>
            {/each}
          </div>
        {/if}

        <Button
          variant="outline"
          className="w-full"
          onclick={detectEnergeticColumns}
          disabled={running}>Detect Properties</Button
        >
      </div>

      <Divider />

      <div class="space-y-2">
        <h2 class="font-semibold">Energetic Options</h2>
        <div class="grid grid-cols-2 gap-1">
          <Select bind:value={timeUnits}>
            <option value="ns">Time: ns</option>
            <option value="ps">Time: ps</option>
            <option value="µs">Time: µs</option>
          </Select>
          <Select bind:value={energyUnits}>
            <option value="kcal/mol">Energy: kcal/mol</option>
            <option value="kJ/mol">Energy: kJ/mol</option>
          </Select>
          <Select bind:value={pressureUnits}>
            <option value="atm">Pressure: atm</option>
            <option value="bar">Pressure: bar</option>
            <option value="kPa">Pressure: kPa</option>
            <option value="MPa">Pressure: MPa</option>
          </Select>
          <Select bind:value={temperatureUnits}>
            <option value="K">Temp: K</option>
            <option value="°C">Temp: °C</option>
            <option value="°F">Temp: °F</option>
          </Select>
        </div>

        <Select bind:value={volumeUnits}>
          <option value="Å³">Volume: Å³</option>
          <option value="nm³">Volume: nm³</option>
          <option value="mL">Volume: mL</option>
          <option value="L">Volume: L</option>
        </Select>

        <div class="space-y-1 rounded-md border p-2 dark:border-neutral-800">
          <p class="font-medium">Properties</p>
          {#if availableProperties.length === 0}
            <p class="text-neutral-600">Detect properties after adding log files.</p>
          {:else}
            {#each availableProperties as prop (prop)}
              {@const checked = selectedProperties.includes(prop)}
              <label class="flex items-center gap-2">
                <Checkbox
                  name={`prop-${prop}`}
                  {checked}
                  onchange={(e) => toggleProperty(prop, e.currentTarget.checked)}
                />
                <span>{prop}</span>
              </label>
            {/each}
          {/if}
        </div>
      </div>
    {/if}

    <Divider />

    <Button className="w-full" onclick={runAnalysis} disabled={running}>
      {#if running}
        <Spinner className="mr-1" />
        Running...
      {:else}
        Run Analysis
      {/if}
    </Button>
  </aside>

  <section class="flex min-h-0 min-w-0 flex-1 flex-col p-4">
    <div class="mb-3 flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold">{chartTitle || 'Analysis'}</h1>
        <p class="text-xs text-neutral-500">
          {mode === 'structural'
            ? 'RMSD, RMSF, Distance and Radius of Gyration from trajectories.'
            : 'NAMD energetic properties from ENERGY log records.'}
        </p>
      </div>
    </div>

    {#if lastError}
      <div class="mb-3 rounded-md border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-300">
        {lastError}
      </div>
    {/if}

    {#if chartSeries.length === 0}
      <div class="flex min-h-0 flex-1 items-center justify-center">
        <Empty message="Run an analysis to see results" />
      </div>
    {:else}
      <div class="min-h-0 flex-1 overflow-auto">
        <LineChart series={chartSeries} xLabel={chartXLabel} yLabel={chartYLabel} />

        {#if primaryStats}
          <div class="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Mean</p>
              <p class="font-semibold">{Number(primaryStats.mean).toFixed(4)}</p>
            </div>
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Std</p>
              <p class="font-semibold">{Number(primaryStats.std).toFixed(4)}</p>
            </div>
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Min</p>
              <p class="font-semibold">{Number(primaryStats.min).toFixed(4)}</p>
            </div>
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Max</p>
              <p class="font-semibold">{Number(primaryStats.max).toFixed(4)}</p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>

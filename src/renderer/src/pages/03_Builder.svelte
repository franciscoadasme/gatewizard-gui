<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import { builderStatus } from '../lib/pageStatus.svelte.js'
  import {
    getAvailableLipids,
    getAvailableForceFields,
    validateBuilder,
    startPreparation,
    detectLigands,
    parametrizeLigand,
    getLigandImage,
    checkLigandParametrization,
    getJobStatus,
    getJobLog,
    scanJobs
  } from '../lib/backendApi'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  let workingFile = $state('')
  let outputFolderName = $state('')

  const lipidsPromise = getAvailableLipids().then((data) => data.lipids)
  const ffPromise = getAvailableForceFields()

  let waterModel = $state('opc')
  let proteinFf = $state('ff19SB')
  let lipidFf = $state('lipid21')

  let preoriented = $state(true)
  let parametrize = $state(true)
  let addSalt = $state(true)
  let saltConcentration = $state(0.15)
  let cation = $state('K+')
  let anion = $state('Cl-')
  let distWat = $state(17.5)
  let boxSizingMode = $state('water_layer')
  let boxDimX = $state(100)
  let boxDimY = $state(100)
  let boxDimZ = $state(100)

  /** @type {{ name: string, charge: number, multiplicity: number, status: string, frcmod: string, lib: string, mol2: string, pdb_lines: string[], imageBase64: string }[]} */
  let ligands = $state([])
  let detectingLigands = $state(false)

  // ── Jobs ──
  /**
   * @typedef {{ jobDir: string, name: string, status: string, currentStep: number, steps: string[], stepsCompleted: string[], error: string|null, startTime: string, endTime: string|null, elapsed: string, logLines: string[], showLog: boolean }} Job
   */
  /** @type {Job[]} */
  let jobs = $state([])
  let launching = $state(false)
  let validating = $state(false)
  /** @type {{ valid: boolean, warning: boolean, message: string } | null} */
  let validationResult = $state(null)

  /** Ref to the poll interval so we can clear it */
  let pollIntervalId = $state(null)

  // ── Sync to shared status bar store ──
  $effect(() => {
    builderStatus.jobCount = jobs.length
    builderStatus.runningCount = jobs.filter((j) => j.status === 'running').length
    builderStatus.completedCount = jobs.filter((j) => j.status === 'completed').length
    builderStatus.errorCount = jobs.filter((j) => j.status === 'error').length
    const latest = jobs[0]
    builderStatus.latestName = latest?.name ?? ''
    builderStatus.latestStatus = latest?.status ?? ''
    builderStatus.latestElapsed = latest?.elapsed ?? ''
  })

  // When workingDir changes from App, scan for existing preparation jobs
  $effect(() => {
    if (!workingDir) return
    scanJobs(workingDir)
      .then(({ jobs: found }) => {
        const existing = new Set(jobs.map((j) => j.jobDir))
        const newJobs = found
          .filter((j) => !existing.has(j.job_dir))
          .map((j) => ({
            jobDir: j.job_dir,
            name: j.name,
            status: j.status || 'unknown',
            currentStep: j.current_step || 0,
            steps:
              j.steps?.length > 0
                ? j.steps
                : j.steps_completed?.length > 0
                  ? j.steps_completed
                  : ['Packmol'],
            stepsCompleted: j.steps_completed || [],
            error: j.error || null,
            startTime: j.start_time || '',
            endTime: j.end_time || null,
            elapsed: formatElapsed(j.start_time, j.end_time),
            logLines: [],
            showLog: false
          }))
        if (newJobs.length > 0) {
          jobs = [...newJobs, ...jobs].sort(
            (a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)
          )
          if (newJobs.some((j) => j.status === 'running')) startPolling()
        }
      })
      .catch(() => {})
  })

  function startPolling() {
    if (pollIntervalId) return
    pollIntervalId = setInterval(pollAllJobs, 4000)
  }

  function stopPollingIfDone() {
    if (jobs.every((j) => j.status !== 'running')) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = null
      }
    }
  }

  /** Format elapsed seconds to human string */
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

  async function pollAllJobs() {
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status !== 'running') continue
      try {
        const st = await getJobStatus(jobs[i].jobDir)
        jobs[i] = {
          ...jobs[i],
          status: st.status || 'running',
          currentStep: st.current_step ?? jobs[i].currentStep,
          stepsCompleted: st.steps_completed || [],
          error: st.error || null,
          startTime: st.start_time || jobs[i].startTime,
          endTime: st.end_time || null,
          elapsed: formatElapsed(st.start_time || jobs[i].startTime, st.end_time || null)
        }
        // Also refresh log if visible
        if (jobs[i].showLog) {
          await refreshJobLog(i)
        }
      } catch {
        // Backend unreachable — skip this cycle
      }
    }
    // Update elapsed for running jobs (even between polls)
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'running') {
        jobs[i] = {
          ...jobs[i],
          elapsed: formatElapsed(jobs[i].startTime, null)
        }
      }
    }
    stopPollingIfDone()
  }

  async function refreshJobLog(/** @type {number} */ index) {
    try {
      const { lines } = await getJobLog(jobs[index].jobDir)
      jobs[index] = { ...jobs[index], logLines: lines }
    } catch {
      // ignore
    }
  }

  async function toggleJobLog(/** @type {number} */ index) {
    const show = !jobs[index].showLog
    jobs[index] = { ...jobs[index], showLog: show }
    if (show) await refreshJobLog(index)
  }

  /** Load the 2D image for a ligand (initial from pdb_lines, or final from mol2). */
  async function loadLigandImage(/** @type {number} */ index) {
    const lig = ligands[index]
    try {
      /** @type {{ pdbLines?: string[], mol2Path?: string }} */
      const opts = lig.mol2 ? { mol2Path: lig.mol2 } : { pdbLines: lig.pdb_lines }
      const { image } = await getLigandImage(opts)
      ligands[index] = { ...ligands[index], imageBase64: image }
    } catch {
      // Silently ignore image failures — non-critical
    }
  }

  async function onDetectLigands() {
    if (!workingFile) return
    try {
      detectingLigands = true
      const data = await detectLigands(workingFile)
      ligands = data.ligands.map((l) => ({
        name: l.name,
        charge: 0,
        multiplicity: 1,
        status: 'not_parametrized',
        frcmod: '',
        lib: '',
        mol2: '',
        pdb_lines: l.pdb_lines || [],
        imageBase64: ''
      }))

      // Check if any ligands were already parametrized in a previous run
      const names = ligands.map((l) => l.name)
      if (names.length > 0) {
        const { parametrized } = await checkLigandParametrization(workingFile, names)
        for (let i = 0; i < ligands.length; i++) {
          const cached = parametrized[ligands[i].name]
          if (cached) {
            ligands[i] = {
              ...ligands[i],
              status: 'completed',
              frcmod: cached.frcmod,
              lib: cached.lib,
              mol2: cached.mol2 || ''
            }
          }
        }
      }

      // Load images for all detected ligands (in parallel)
      await Promise.all(ligands.map((_, i) => loadLigandImage(i)))
    } catch (error) {
      // Show error in the first job or as a standalone message
      console.error('Ligand detection error:', error)
    } finally {
      detectingLigands = false
    }
  }

  async function onParametrizeLigand(/** @type {number} */ index) {
    const lig = ligands[index]
    try {
      ligands[index] = { ...lig, status: 'running' }
      const result = await parametrizeLigand(workingFile, lig.name, lig.charge, lig.multiplicity)
      ligands[index] = {
        ...lig,
        status: 'completed',
        frcmod: result.frcmod || '',
        lib: result.lib || '',
        mol2: result.mol2 || ''
      }
      // Reload image from mol2 (better bond orders)
      await loadLigandImage(index)
    } catch (error) {
      ligands[index] = { ...lig, status: 'failed' }
      console.error(`Parametrization of ${lig.name} failed:`, error)
    }
  }

  async function onBrowseFrcmod(/** @type {number} */ index) {
    const result = await window.api.openLigandFileDialog('Select frcmod file', ['frcmod'])
    if (!result.canceled) {
      ligands[index] = { ...ligands[index], frcmod: result.filePath }
    }
  }

  async function onBrowseLib(/** @type {number} */ index) {
    const result = await window.api.openLigandFileDialog('Select lib file', ['lib'])
    if (!result.canceled) {
      ligands[index] = { ...ligands[index], lib: result.filePath }
    }
  }

  function removeLigand(/** @type {number} */ index) {
    ligands = ligands.filter((_, i) => i !== index)
  }

  function addManualLigand() {
    ligands = [
      ...ligands,
      {
        name: '',
        charge: 0,
        multiplicity: 1,
        status: 'manual',
        frcmod: '',
        lib: '',
        mol2: '',
        pdb_lines: [],
        imageBase64: ''
      }
    ]
  }

  function buildParams() {
    const upperLipids = upperLeaflet.map((e) => e.lipid)
    const lowerLipids = lowerLeaflet.map((e) => e.lipid)
    const upperRatios = upperLeaflet.map((e) => e.ratio).join(':')
    const lowerRatios = lowerLeaflet.map((e) => e.ratio).join(':')
    const lipidRatios = `${upperRatios}//${lowerRatios}`
    return {
      path: workingFile,
      upperLipids,
      lowerLipids,
      lipidRatios,
      waterModel,
      proteinFf,
      lipidFf,
      preoriented,
      parametrize,
      addSalt,
      saltConcentration: addSalt ? parseFloat(saltConcentration) : 0,
      cation,
      anion,
      distWat: parseFloat(distWat),
      dims:
        boxSizingMode === 'explicit'
          ? [parseFloat(boxDimX), parseFloat(boxDimY), parseFloat(boxDimZ)]
          : null,
      outputFolderName: outputFolderName || null,
      ligandParams: ligands
        .filter((l) => l.frcmod && l.lib && l.name)
        .map((l) => ({ name: l.name, frcmod: l.frcmod, lib: l.lib }))
    }
  }

  async function onValidate() {
    if (!workingFile) {
      validationResult = {
        valid: false,
        warning: false,
        message: 'Please select a working PDB file first.'
      }
      return
    }
    if (!upperLeaflet.length && !lowerLeaflet.length) {
      validationResult = {
        valid: false,
        warning: false,
        message: 'Please add at least one lipid to a leaflet.'
      }
      return
    }
    try {
      validating = true
      validationResult = null
      const params = buildParams()
      const result = await validateBuilder(params)
      validationResult = {
        valid: result.valid,
        warning: result.warning ?? false,
        message: result.message ?? result.error ?? ''
      }
    } catch (error) {
      validationResult = {
        valid: false,
        warning: false,
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      validating = false
    }
  }

  async function onStartPreparation() {
    try {
      launching = true
      const params = buildParams()
      const result = await startPreparation(params)
      if (result.success && result.job_dir) {
        const dirName = result.job_dir.split('/').pop() || result.job_dir
        /** @type {Job} */
        const newJob = {
          jobDir: result.job_dir,
          name: dirName,
          status: 'running',
          currentStep: 0,
          steps: parametrize
            ? preoriented
              ? ['Packmol', 'pdb4amber', 'tleap']
              : ['MEMEMBED', 'Packmol', 'pdb4amber', 'tleap']
            : preoriented
              ? ['Packmol']
              : ['MEMEMBED', 'Packmol'],
          stepsCompleted: [],
          error: null,
          startTime: new Date().toISOString(),
          endTime: null,
          elapsed: '0s',
          logLines: [],
          showLog: false
        }
        jobs = [newJob, ...jobs]
        startPolling()
      } else {
        alert(`Failed: ${result.message}`)
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      launching = false
    }
  }

  function removeJob(/** @type {number} */ index) {
    jobs = jobs.filter((_, i) => i !== index)
    stopPollingIfDone()
  }

  function onLoadDefaults() {
    waterModel = 'opc'
    proteinFf = 'ff19SB'
    lipidFf = 'lipid21'
    preoriented = true
    parametrize = true
    addSalt = true
    saltConcentration = 0.15
    cation = 'K+'
    anion = 'Cl-'
    distWat = 17.5
    boxSizingMode = 'water_layer'
    boxDimX = 100
    boxDimY = 100
    boxDimZ = 100
    upperLeaflet = [{ lipid: 'POPC', ratio: 1.0 }]
    lowerLeaflet = [{ lipid: 'POPC', ratio: 1.0 }]
    outputFolderName = ''
    ligands = []
  }

  /** @type {{ lipid: string, ratio: number }[]} */
  let upperLeaflet = $state([{ lipid: 'POPC', ratio: 1.0 }])
  /** @type {{ lipid: string, ratio: number }[]} */
  let lowerLeaflet = $state([{ lipid: 'POPC', ratio: 1.0 }])

  function addLipid(/** @type {'upper' | 'lower'} */ leaflet) {
    const entry = { lipid: 'POPC', ratio: 1.0 }
    if (leaflet === 'upper') upperLeaflet = [...upperLeaflet, entry]
    else lowerLeaflet = [...lowerLeaflet, entry]
  }

  function removeLipid(/** @type {'upper' | 'lower'} */ leaflet, /** @type {number} */ index) {
    if (leaflet === 'upper') upperLeaflet = upperLeaflet.filter((_, i) => i !== index)
    else lowerLeaflet = lowerLeaflet.filter((_, i) => i !== index)
  }

  async function onBrowse() {
    const result = await window.api.openPdbDialog()
    if (!result.canceled) {
      workingFile = result.filePath
    }
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800 overflow-hidden select-none">
  <!-- ── Left: Options (scrollable) ── -->
  <aside class="w-80 shrink-0 space-y-4 overflow-y-auto p-4 text-xs">
    <!-- Input -->
    <div class="space-y-2">
      <h2 class="font-semibold">Input</h2>
      <div class="space-y-1">
        <span class="dark:text-neutral-500">PDB File</span>
        <div class="flex items-center gap-1">
          <input
            type="text"
            placeholder="Select PDB file..."
            class="flex-1 rounded-md border p-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:placeholder-neutral-600"
            bind:value={workingFile}
            readonly
          />
          <Button variant="default" className="shrink-0 text-xs px-2 py-1.5" onclick={onBrowse}
            >Browse</Button
          >
        </div>
      </div>
      <div class="space-y-1">
        <span class="dark:text-neutral-500">Output Folder</span>
        <input
          type="text"
          placeholder="Auto-generated if empty"
          class="w-full rounded-md border p-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:placeholder-neutral-600"
          bind:value={outputFolderName}
        />
      </div>
    </div>
    <Divider />

    <!-- Ligand Parametrization (must run before packmol-memgen) -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">Ligand Parametrization</h2>
        <div class="flex gap-1">
          <Button
            variant="outline"
            className="text-xs px-1.5 py-0.5"
            onclick={onDetectLigands}
            disabled={!workingFile || detectingLigands}
          >
            {detectingLigands ? 'Detecting...' : 'Detect'}
          </Button>
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={addManualLigand}>+ Manual</button
          >
        </div>
      </div>
      {#if ligands.length === 0}
        <p class="dark:text-neutral-500">
          No ligands. Click "Detect" after selecting a PDB, or add manually.
        </p>
      {/if}
      {#each ligands as lig, i (i)}
        <div class="space-y-1.5 rounded-md border p-2 dark:border-neutral-700">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              {#if lig.status === 'manual'}
                <input
                  type="text"
                  placeholder="LIG"
                  class="w-14 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  bind:value={lig.name}
                />
              {:else}
                <span class="font-semibold dark:text-neutral-300">{lig.name}</span>
              {/if}
              <span
                class="rounded px-1 py-0.5"
                class:bg-neutral-700={lig.status === 'not_parametrized' || lig.status === 'manual'}
                class:bg-yellow-800={lig.status === 'running'}
                class:bg-green-800={lig.status === 'completed'}
                class:bg-red-800={lig.status === 'failed'}
              >
                {lig.status === 'not_parametrized'
                  ? 'Pending'
                  : lig.status === 'running'
                    ? 'Running...'
                    : lig.status === 'completed'
                      ? 'Done'
                      : lig.status === 'failed'
                        ? 'Failed'
                        : 'Manual'}
              </span>
            </div>
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => removeLigand(i)}>&times;</button
            >
          </div>
          <div class="flex items-center gap-2">
            <span class="dark:text-neutral-500">Charge</span>
            <input
              type="number"
              class="w-12 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              bind:value={lig.charge}
            />
            <span class="dark:text-neutral-500">Mult.</span>
            <input
              type="number"
              class="w-12 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              bind:value={lig.multiplicity}
            />
          </div>
          <div class="flex items-center gap-1">
            <span class="w-12 shrink-0 dark:text-neutral-500">frcmod</span>
            <input
              type="text"
              class="flex-1 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              bind:value={lig.frcmod}
              readonly
              placeholder="Auto or browse..."
            />
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => onBrowseFrcmod(i)}>Browse</button
            >
          </div>
          <div class="flex items-center gap-1">
            <span class="w-12 shrink-0 dark:text-neutral-500">lib</span>
            <input
              type="text"
              class="flex-1 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              bind:value={lig.lib}
              readonly
              placeholder="Auto or browse..."
            />
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => onBrowseLib(i)}>Browse</button
            >
          </div>
          {#if lig.status !== 'running'}
            <Button
              variant="outline"
              className="w-full text-xs"
              onclick={() => onParametrizeLigand(i)}
              disabled={!workingFile || lig.status === 'running'}
            >
              {lig.status === 'completed'
                ? `Re-parametrize ${lig.name || 'ligand'}`
                : `Parametrize ${lig.name || 'ligand'}`}
            </Button>
          {/if}
        </div>
      {/each}
    </div>
    <Divider />

    <!-- Membrane & Force Fields -->
    <div class="space-y-2">
      <h2 class="font-semibold">Force Fields</h2>
      {#await ffPromise then ff}
        <div class="flex items-center gap-1">
          <span class="w-20 shrink-0 dark:text-neutral-500">Water</span>
          <select
            class="flex-1 rounded-md border p-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={waterModel}
          >
            {#each ff.water_models as wm (wm)}
              <option value={wm}>{wm}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-20 shrink-0 dark:text-neutral-500">Protein FF</span>
          <select
            class="flex-1 rounded-md border p-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={proteinFf}
          >
            {#each ff.protein_ffs as pff (pff)}
              <option value={pff}>{pff}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-20 shrink-0 dark:text-neutral-500">Lipid FF</span>
          <select
            class="flex-1 rounded-md border p-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={lipidFf}
          >
            {#each ff.lipid_ffs as lff (lff)}
              <option value={lff}>{lff}</option>
            {/each}
          </select>
        </div>
      {/await}
    </div>
    <Divider />

    <!-- Lipid Composition -->
    <div class="space-y-2">
      <h2 class="font-semibold">Lipid Composition</h2>
      <div class="space-y-1.5 rounded-md border p-2 dark:border-neutral-700">
        <div class="flex items-center justify-between">
          <span class="font-semibold dark:text-neutral-300">Upper Leaflet</span>
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={() => addLipid('upper')}>+ Add</button
          >
        </div>
        {#each upperLeaflet as entry, i (i)}
          <div class="flex items-center gap-1">
            {#await lipidsPromise then lipids}
              <select
                class="flex-1 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                bind:value={entry.lipid}
              >
                {#each lipids as lipid (lipid)}
                  <option value={lipid}>{lipid}</option>
                {/each}
              </select>
            {/await}
            <input
              type="text"
              inputmode="decimal"
              class="w-10 rounded-md border p-1 text-center dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              bind:value={entry.ratio}
            />
            {#if upperLeaflet.length > 1}
              <button
                class="dark:text-neutral-500 dark:hover:text-neutral-300"
                onclick={() => removeLipid('upper', i)}>&times;</button
              >
            {/if}
          </div>
        {/each}
      </div>
      <div class="space-y-1.5 rounded-md border p-2 dark:border-neutral-700">
        <div class="flex items-center justify-between">
          <span class="font-semibold dark:text-neutral-300">Lower Leaflet</span>
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={() => addLipid('lower')}>+ Add</button
          >
        </div>
        {#each lowerLeaflet as entry, i (i)}
          <div class="flex items-center gap-1">
            {#await lipidsPromise then lipids}
              <select
                class="flex-1 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                bind:value={entry.lipid}
              >
                {#each lipids as lipid (lipid)}
                  <option value={lipid}>{lipid}</option>
                {/each}
              </select>
            {/await}
            <input
              type="text"
              inputmode="decimal"
              class="w-10 rounded-md border p-1 text-center dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              bind:value={entry.ratio}
            />
            {#if lowerLeaflet.length > 1}
              <button
                class="dark:text-neutral-500 dark:hover:text-neutral-300"
                onclick={() => removeLipid('lower', i)}>&times;</button
              >
            {/if}
          </div>
        {/each}
      </div>
    </div>
    <Divider />

    <!-- System Options -->
    <div class="space-y-2">
      <h2 class="font-semibold">System Options</h2>
      <div class="flex items-center gap-2">
        <Checkbox name="preoriented" bind:checked={preoriented} />
        <span class="dark:text-neutral-400">Pre-oriented in membrane</span>
      </div>
      <div class="flex items-center gap-2">
        <Checkbox name="parametrize" bind:checked={parametrize} />
        <span class="dark:text-neutral-400">Parametrize with tleap</span>
      </div>
      <div class="flex items-center gap-2">
        <Checkbox name="add-salt" bind:checked={addSalt} />
        <span class="dark:text-neutral-400">Add salt</span>
      </div>
      {#if addSalt}
        <div class="flex flex-wrap items-center gap-1 pl-6">
          <input
            type="text"
            inputmode="decimal"
            class="w-14 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={saltConcentration}
          />
          <span class="dark:text-neutral-500">M</span>
          <select
            class="rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={cation}
          >
            <option value="K+">K+</option>
            <option value="Na+">Na+</option>
          </select>
          <select
            class="rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={anion}
          >
            <option value="Cl-">Cl-</option>
          </select>
        </div>
      {/if}
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-1 dark:text-neutral-400">
          <input type="radio" name="box-sizing" value="water_layer" bind:group={boxSizingMode} />
          Water layer
        </label>
        <label class="flex items-center gap-1 dark:text-neutral-400">
          <input type="radio" name="box-sizing" value="explicit" bind:group={boxSizingMode} />
          Explicit dims
        </label>
      </div>
      {#if boxSizingMode === 'water_layer'}
        <div class="flex items-center gap-1 pl-6">
          <span class="dark:text-neutral-500">Thickness</span>
          <input
            type="text"
            inputmode="decimal"
            class="w-14 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={distWat}
          />
          <span class="dark:text-neutral-500">Å</span>
        </div>
      {:else}
        <div class="flex items-center gap-1 pl-6">
          <span class="dark:text-neutral-500">X</span>
          <input
            type="text"
            inputmode="decimal"
            class="w-12 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={boxDimX}
          />
          <span class="dark:text-neutral-500">Y</span>
          <input
            type="text"
            inputmode="decimal"
            class="w-12 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={boxDimY}
          />
          <span class="dark:text-neutral-500">Z</span>
          <input
            type="text"
            inputmode="decimal"
            class="w-12 rounded-md border p-1 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            bind:value={boxDimZ}
          />
          <span class="dark:text-neutral-500">Å</span>
        </div>
      {/if}
    </div>
    <Divider />

    <!-- Actions -->
    <div class="space-y-2">
      <Button
        className="w-full"
        variant="outline"
        onclick={onValidate}
        disabled={validating || launching}
      >
        {validating ? 'Validating…' : 'Validate Inputs'}
      </Button>
      {#if validationResult !== null}
        <div
          class="rounded-md border px-3 py-2 text-xs {validationResult.valid
            ? validationResult.warning
              ? 'border-yellow-600 bg-yellow-950 text-yellow-300'
              : 'border-green-700 bg-green-950 text-green-300'
            : 'border-red-700 bg-red-950 text-red-300'}"
        >
          {#if validationResult.valid && !validationResult.warning}
            ✓ All inputs are valid.
          {:else}
            {validationResult.message}
          {/if}
        </div>
      {/if}
      <Button
        className="w-full"
        onclick={onStartPreparation}
        disabled={launching || !workingFile || validationResult === null}
      >
        {launching ? 'Launching...' : 'Start Preparation'}
      </Button>
      {#if validationResult === null && workingFile}
        <p
          class="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400"
        >
          Inputs have not been validated. Click <strong>Validate Inputs</strong> before starting.
        </p>
      {/if}
      <button
        class="w-full text-center dark:text-neutral-500 dark:hover:text-neutral-300"
        onclick={onLoadDefaults}>Reset Defaults</button
      >
    </div>
  </aside>

  <!-- ── Right: Ligand Preview & Job Tracker ── -->
  <main class="flex flex-1 flex-col overflow-hidden p-4">
    <!-- Ligand 2D images -->
    {#if ligands.some((l) => l.imageBase64)}
      <div class="mb-3 shrink-0">
        <h2 class="mb-2 text-xs font-semibold dark:text-neutral-400">Ligand Structures</h2>
        <div class="flex flex-wrap gap-3">
          {#each ligands as lig (lig.name)}
            {#if lig.imageBase64}
              <div class="space-y-1 rounded-md border p-2 dark:border-neutral-700">
                <div class="flex items-center gap-1.5 text-xs">
                  <span class="font-semibold dark:text-neutral-300">{lig.name}</span>
                  <span
                    class="rounded px-1 py-0.5 text-xs"
                    class:bg-green-800={lig.status === 'completed'}
                    class:bg-neutral-700={lig.status !== 'completed'}
                  >
                    {lig.mol2 ? 'Final' : 'Initial'}
                  </span>
                </div>
                <img
                  src="data:image/png;base64,{lig.imageBase64}"
                  alt="2D structure of {lig.name}"
                  class="rounded"
                  style="max-width: 300px; max-height: 240px;"
                />
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}

    <!-- Preparation Jobs -->
    <h2 class="mb-2 text-xs font-semibold dark:text-neutral-400">Preparation Jobs</h2>
    <div class="flex-1 space-y-3 overflow-y-auto">
      {#if jobs.length === 0}
        <div class="flex h-full items-center justify-center text-xs dark:text-neutral-600">
          No preparations started yet. Configure options and click "Start Preparation".
        </div>
      {/if}
      {#each jobs as job, ji (job.jobDir)}
        <div
          class="rounded-lg border p-3 text-xs dark:border-neutral-700"
          class:dark:border-green-800={job.status === 'completed'}
          class:dark:border-red-800={job.status === 'error'}
          class:dark:border-yellow-800={job.status === 'running'}
        >
          <!-- Header -->
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <!-- Status icon -->
              {#if job.status === 'running'}
                <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500"></span>
              {:else if job.status === 'completed'}
                <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
              {:else if job.status === 'error'}
                <span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
              {:else}
                <span class="inline-block h-2 w-2 rounded-full bg-neutral-500"></span>
              {/if}
              <span class="font-semibold dark:text-neutral-200" title={job.jobDir}>{job.name}</span>
            </div>
            <div class="flex items-center gap-2">
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

          <!-- Step progress bar -->
          <div class="mb-2">
            <div class="flex gap-1">
              {#each job.steps as step, si (step)}
                {@const done =
                  job.stepsCompleted.includes(step) ||
                  (job.status === 'completed' && si < job.steps.length)}
                {@const active =
                  job.status === 'running' &&
                  !done &&
                  (si === 0 || job.stepsCompleted.includes(job.steps[si - 1]))}
                <div class="flex-1">
                  <div
                    class="h-1.5 rounded-full transition-colors"
                    class:bg-green-600={done}
                    class:bg-yellow-500={active}
                    class:animate-pulse={active}
                    class:bg-neutral-700={!done && !active}
                  ></div>
                  <span
                    class="mt-0.5 block text-center"
                    class:dark:text-green-400={done}
                    class:dark:text-yellow-400={active}
                    class:dark:text-neutral-600={!done && !active}
                    style="font-size: 0.6rem;"
                  >
                    {step}
                  </span>
                </div>
              {/each}
            </div>
          </div>

          <!-- Error message -->
          {#if job.error}
            <div class="mb-2 rounded bg-red-900/30 p-2 text-red-300">{job.error}</div>
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
            <pre
              class="mt-1 max-h-60 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-500">{job
                .logLines.length > 0
                ? job.logLines.join('\n')
                : 'No log output yet...'}</pre>
          {/if}
        </div>
      {/each}
    </div>
  </main>
</div>

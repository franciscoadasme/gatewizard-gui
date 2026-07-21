<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Input from '../components/ui/Input.svelte'
  import PrepStructureViewer from '../components/preparation/PrepStructureViewer.svelte'
  import {
    detectDisulfideBonds,
    detectTerminalCaps,
    preparePDB,
    previewProtonation,
    runPropKa
  } from '../lib/backendApi'
  import {
    defaultPreparationFolderName,
    outputFolderPath
  } from '../lib/outputFolders.js'
  import { logEvent, preparationStatus } from '../lib/pageStatus.svelte.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  const paneBackgroundStyle = $derived(
    `background-color: ${themeBackgroundHex(themeState.current)}`
  )

  // form fields
  let capProtein = $state(false)
  /** Strip protein H before pdb4amber (keeps ligand / hetero H). Default on. */
  let removeProteinHydrogens = $state(true)
  let maxDisulfideDistance = $state(2.5)
  let targetPh = $state(7.0)
  let workingFile = $state('')
  let outputFolderName = $state('')
  /** @type {string} PDB path used inside the output folder after workspace setup */
  let activeWorkingFile = $state('')
  /** @type {string} Resolved output folder path returned by the backend */
  let preparationJobDir = $state('')
  /** Warning when Cap is on but the structure already has ACE/NME (or *_capped name). */
  let cappingWarning = $state('')
  /** Caps detected in the working PDB (ACE / NME / NMA). */
  let detectedCaps = $state(/** @type {string[]} */ ([]))

  const looksAlreadyCapped = $derived(
    detectedCaps.length > 0 ||
      /_capped$/i.test(
        (workingFile.split(/[/\\]/).pop() ?? '').replace(/\.pdb$/i, '')
      )
  )

  /** Warn only about the user's original working file — not the post-PropKa *_capped.pdb. */
  const capRecapWarning = $derived.by(() => {
    if (!capProtein) return ''
    if (cappingWarning) return cappingWarning
    if (!looksAlreadyCapped) return ''
    if (detectedCaps.length > 0) {
      return (
        `The selected working file already contains terminal caps (${detectedCaps.join(', ')}). ` +
        'Capping will be skipped on Run PropKa. Uncheck “Cap protein termini” if that is intentional.'
      )
    }
    return (
      'The selected working file name ends with “_capped”. Capping will be skipped on Run PropKa. ' +
      'Uncheck “Cap protein termini” if that is intentional.'
    )
  })

  /** Last successful PropKa inputs — used to disable re-runs when nothing changed. */
  let lastPropKaFile = $state('')
  let lastPropKaPh = $state(/** @type {number | null} */ (null))
  let lastPropKaCap = $state(/** @type {boolean | null} */ (null))

  const propKaInputsUnchanged = $derived(
    preparationStatus.propkaDone &&
      lastPropKaFile === workingFile &&
      lastPropKaPh === Number(targetPh) &&
      lastPropKaCap === capProtein
  )

  function resolveOutputFolderName() {
    if (outputFolderName.trim()) return outputFolderName.trim()
    if (preparationJobDir) {
      const name = preparationJobDir.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
      if (name) return name
    }
    return defaultPreparationFolderName(workingFile)
  }

  /** Pin the output folder name in the UI before the first preparation step runs. */
  function syncOutputFolderName() {
    const resolved = resolveOutputFolderName()
    if (resolved && resolved !== outputFolderName.trim()) {
      outputFolderName = resolved
    }
    return resolved
  }

  function buildOutputOptions() {
    syncOutputFolderName()
    return {
      workingDir: workingDir || null,
      outputFolderName: outputFolderName.trim() || null
    }
  }

  function adoptJobDir(jobDir) {
    if (!jobDir) return
    preparationJobDir = jobDir
    syncOutputFolderName()
  }

  const outputDir = $derived(outputFolderPath(workingDir, resolveOutputFolderName()))

  const canRunPreparationSteps = $derived(workingDir !== '' && workingFile !== '')

  // derived values
  let protonatedFile = $derived.by(() => {
    if (outputDir) {
      const basename = (activeWorkingFile || workingFile).split(/[/\\]/).pop() ?? 'structure.pdb'
      const stem = basename.replace(/\.pdb$/i, '').replace(/_capped$/i, '')
      return `${outputDir.replace(/[/\\]+$/, '')}/${stem}_protonated.pdb`
    }
    if (!workingFile) return ''
    const basename = workingFile.split(/[/\\]/).pop() ?? 'structure.pdb'
    const outName = basename.replace(/\.pdb$/i, '_protonated.pdb')
    if (workingDir) {
      return `${workingDir.replace(/[/\\]+$/, '')}/${outName}`
    }
    return workingFile.replace(/\.pdb$/i, '_protonated.pdb')
  })
  let sortedProtonationStates = $derived.by(() => {
    const col = sortColumn
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...protonationStates].sort((a, b) => {
      const av = col === 'original_res_id' ? (a.original_res_id ?? a.res_id) : a[col]
      const bv = col === 'original_res_id' ? (b.original_res_id ?? b.res_id) : b[col]
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  })

  // state
  let preparingPDB = $state(false)
  let runningPropKa = $state(false)

  const canRunPropKa = $derived(
    canRunPreparationSteps && !runningPropKa && !propKaInputsUnchanged
  )

  /** @type {'residue' | 'original_res_id' | 'res_id' | 'chain' | 'pka' | 'current_state'} */
  let sortColumn = $state('residue')
  /** @type {'asc' | 'desc'} */
  let sortDirection = $state('asc')
  /** @type {{ key: typeof sortColumn, label: string }[]} */
  const columns = [
    { key: 'residue', label: 'Residue' },
    { key: 'original_res_id', label: 'Old ID' },
    { key: 'res_id', label: 'New ID' },
    { key: 'chain', label: 'Chain' },
    { key: 'pka', label: 'pKa' },
    { key: 'current_state', label: 'State' }
  ]

  // output
  /** @type {[[ [string, number], [string, number] ]]} */
  let disulfideBonds = $state([])
  let preparationOutput = $state('')
  /** @type {{residue: string, res_id: number, original_res_id?: number, chain: string, pka: number, atom: string, atom_type: string, model_pka: number, current_state: string, initial_state: string, all_states: string[]}[]} */
  let protonationStates = $state([])

  /** Selected residues for the 3D viewer — keys use New ID (`res_id`) + chain. */
  /** @type {{ chain: string, res_id: number }[]} */
  let selectedResidueKeys = $state([])
  /** @type {object[]} */
  let ghostAtoms = $state([])
  /** @type {object[]} */
  let removedMarkers = $state([])
  let ghostPreviewTimer = 0

  /** PDB shown in the embedded viewer (post-PropKa working path). */
  const viewerPdbPath = $derived(
    preparationStatus.propkaDone ? activeWorkingFile || workingFile : ''
  )

  function residueKey(info) {
    return `${info.chain || ''}:${info.res_id}`
  }

  function isResidueSelected(info) {
    const key = residueKey(info)
    return selectedResidueKeys.some((k) => `${k.chain || ''}:${k.res_id}` === key)
  }

  /** @param {MouseEvent} e */
  function onProtonationRowClick(e, info) {
    // Don't steal clicks from the state <select>
    if (
      e.target instanceof HTMLSelectElement ||
      (e.target instanceof Element && e.target.closest('select'))
    ) {
      return
    }
    const key = { chain: info.chain || '', res_id: info.res_id }
    const id = residueKey(key)
    if (e.ctrlKey || e.metaKey) {
      if (selectedResidueKeys.some((k) => residueKey(k) === id)) {
        selectedResidueKeys = selectedResidueKeys.filter((k) => residueKey(k) !== id)
      } else {
        selectedResidueKeys = [...selectedResidueKeys, key]
      }
    } else {
      selectedResidueKeys = [key]
    }
  }

  function scheduleGhostPreview() {
    if (ghostPreviewTimer) clearTimeout(ghostPreviewTimer)
    ghostPreviewTimer = setTimeout(() => {
      ghostPreviewTimer = 0
      refreshGhostPreview()
    }, 200)
  }

  async function refreshGhostPreview() {
    const path = viewerPdbPath
    if (!path || !protonationStates.length) {
      ghostAtoms = []
      removedMarkers = []
      return
    }
    const changed = protonationStates.filter((r) => r.current_state !== r.initial_state)
    if (!changed.length) {
      ghostAtoms = []
      removedMarkers = []
      return
    }
    try {
      const data = await previewProtonation({
        path,
        residues: changed.map((r) => ({
          chain: r.chain || '',
          res_id: r.res_id,
          residue: r.residue,
          initial_state: r.initial_state,
          current_state: r.current_state
        }))
      })
      ghostAtoms = data.ghost_atoms || []
      removedMarkers = data.removed_markers || []
    } catch {
      ghostAtoms = []
      removedMarkers = []
    }
  }

  /** @param {typeof sortColumn} column */
  function toggleSort(column) {
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      sortColumn = column
      sortDirection = 'asc'
    }
  }

  async function refreshTerminalCaps(path) {
    if (!path) {
      detectedCaps = []
      return
    }
    try {
      const data = await detectTerminalCaps(path)
      detectedCaps = Array.isArray(data.caps) ? data.caps : []
    } catch {
      // Filename heuristic still works via looksAlreadyCapped
      detectedCaps = []
    }
  }

  async function onRunPropKa() {
    try {
      runningPropKa = true
      preparationStatus.propkaRunning = true
      preparationStatus.propkaError = null
      // Keep warning based on the user's selected file only (do not scan *_capped.pdb).
      cappingWarning = ''
      selectedResidueKeys = []
      ghostAtoms = []
      removedMarkers = []
      await refreshTerminalCaps(workingFile)
      const data = await runPropKa(
        workingFile,
        parseFloat(targetPh),
        capProtein,
        buildOutputOptions()
      )
      protonationStates = (data.residues || []).map((r) => ({
        ...r,
        original_res_id: r.original_res_id ?? r.res_id
      }))
      adoptJobDir(data.job_dir)
      if (data.working_path) activeWorkingFile = data.working_path
      if (data.capping_warning) {
        // Backend skip-cap warning only applies when the *input* (working file) was already capped
        cappingWarning = data.capping_warning
        logEvent('info', 'prep', data.capping_warning)
      }
      preparationStatus.propkaDone = true
      preparationStatus.propkaPh = targetPh
      lastPropKaFile = workingFile
      lastPropKaPh = Number(targetPh)
      lastPropKaCap = capProtein
      if (data.job_dir) {
        logEvent('info', 'prep', `PropKa output folder: "${outputFolderName}"`, data.job_dir)
      }
      scheduleGhostPreview()
    } catch (error) {
      preparationStatus.propkaError = error instanceof Error ? error.message : String(error)
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      runningPropKa = false
      preparationStatus.propkaRunning = false
    }
  }

  async function onSelectWorkingFile() {
    const { canceled, filePath } = await window.api.openPdbDialog(workingDir || undefined)
    if (canceled) {
      return
    }
    workingFile = filePath
    cappingWarning = ''
    lastPropKaFile = ''
    lastPropKaPh = null
    lastPropKaCap = null
    resetOutput()
    if (workingDir) {
      outputFolderName = defaultPreparationFolderName(filePath)
    }
    await refreshTerminalCaps(filePath)
  }

  async function onDetectDisulfideBonds() {
    try {
      const pdbPath = activeWorkingFile || workingFile
      const data = await detectDisulfideBonds(pdbPath, maxDisulfideDistance, buildOutputOptions())
      disulfideBonds = data.disulfide_bonds
      adoptJobDir(data.job_dir)
      if (data.working_path) activeWorkingFile = data.working_path
      preparationStatus.bondsChecked = true
      preparationStatus.bondsCount = disulfideBonds.length
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function onPreparePDB() {
    try {
      preparingPDB = true
      // Use the active working PDB as-is. If PropKa already capped the structure,
      // activeWorkingFile points at *_capped.pdb — do not append _capped again.
      const pdbPath = activeWorkingFile || workingFile
      const data = await preparePDB({
        path: pdbPath,
        outputPath: protonatedFile,
        protonationStates,
        targetPh,
        disulfideBonds,
        removeProteinHydrogens,
        ...buildOutputOptions()
      })
      preparationOutput = data.output.trim()
      preparationStatus.prepareDone = true
      preparationStatus.outputFile = data.output_path ?? protonatedFile
      adoptJobDir(data.job_dir)
      if (data.working_path) activeWorkingFile = data.working_path
      if (data.job_dir) {
        logEvent('info', 'prep', 'Preparation complete', data.output_path ?? data.job_dir)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      preparingPDB = false
    }
  }

  async function onClear() {
    // clear form fields
    capProtein = false
    removeProteinHydrogens = true
    maxDisulfideDistance = 2.5
    targetPh = 7.0
    workingFile = ''
    activeWorkingFile = ''
    preparationJobDir = ''
    outputFolderName = ''
    cappingWarning = ''
    detectedCaps = []
    lastPropKaFile = ''
    lastPropKaPh = null
    lastPropKaCap = null

    // clear state
    preparingPDB = false
    runningPropKa = false

    resetOutput()
  }

  function resetOutput() {
    disulfideBonds = []
    preparationOutput = ''
    protonationStates = []
    selectedResidueKeys = []
    ghostAtoms = []
    removedMarkers = []
    if (ghostPreviewTimer) {
      clearTimeout(ghostPreviewTimer)
      ghostPreviewTimer = 0
    }
    preparationStatus.propkaDone = false
    preparationStatus.propkaPh = null
    preparationStatus.propkaRunning = false
    preparationStatus.propkaError = null
    preparationStatus.bondsChecked = false
    preparationStatus.bondsCount = 0
    preparationStatus.prepareDone = false
    preparationStatus.outputFile = ''
    activeWorkingFile = ''
    preparationJobDir = ''
    outputFolderName = ''
    lastPropKaFile = ''
    lastPropKaPh = null
    lastPropKaCap = null
  }

  $effect(() => {
    if (workingDir && workingFile && !outputFolderName.trim() && !preparationJobDir) {
      outputFolderName = defaultPreparationFolderName(workingFile)
    }
  })
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-200 overflow-hidden select-none dark:divide-neutral-800">
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <h2 class="sidebar-heading">Input</h2>
      <div class="space-y-1">
        <p class="sidebar-label">Working file</p>
      {#if workingFile}
        <p
          class="w-full rounded-md border border-neutral-200 p-2 wrap-break-word sidebar-label dark:border-neutral-800"
        >
          {workingFile}
        </p>
        <Button variant="outline" className="w-full" onclick={onSelectWorkingFile}
          >Select another file...</Button
        >
      {:else}
        <Button variant="outline" className="w-full" onclick={onSelectWorkingFile}
          >Select a file...</Button
        >
      {/if}
      </div>
      <div class="space-y-1">
        <p class="sidebar-label">Output folder</p>
        <Input
          type="text"
          size="sm"
          bind:value={outputFolderName}
          className="w-full"
          placeholder="01_preparation_structure"
        />
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
        {#if protonatedFile && outputDir}
          <p class="sidebar-hint">Protonated PDB: {protonatedFile.split(/[/\\]/).pop()}</p>
        {/if}
      </div>
    </div>
    <Divider />
    <form
      class="space-y-2"
      onsubmit={(e) => {
        e.preventDefault()
        onRunPropKa()
      }}
    >
      <h2 class="sidebar-heading">PropKa Analysis</h2>
      <div class="flex items-center gap-1">
        <label for="target-ph" class="sidebar-label flex-1">Target pH</label>
        <Input
          id="target-ph"
          name="target-ph"
          type="number"
          size="sm"
          className="w-20"
          min="0"
          max="14"
          step="0.1"
          bind:value={targetPh}
        />
      </div>
      <div class="flex items-center gap-1">
        <Checkbox name="protein-cap" bind:checked={capProtein} />
        <label for="protein-cap" class="sidebar-label">Cap protein termini (ACE/NME)</label>
      </div>
      {#if capRecapWarning}
        <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
          {capRecapWarning}
        </p>
      {/if}
      <Button type="submit" className="w-full" disabled={!canRunPropKa}>
        {runningPropKa
          ? 'Running PropKa...'
          : propKaInputsUnchanged
            ? 'PropKa up to date'
            : 'Run PropKa'}
      </Button>
      {#if propKaInputsUnchanged}
        <p class="sidebar-hint">
          Change target pH or Cap termini (or select another file) to run PropKa again.
        </p>
      {/if}
    </form>
    <Divider />
    <form
      class="space-y-2"
      onsubmit={(e) => {
        e.preventDefault()
        onDetectDisulfideBonds()
      }}
    >
      <h2 class="sidebar-heading">Disulfide Bonding</h2>
      <div class="flex items-center gap-1">
        <label for="max-ss-distance" class="sidebar-label flex-1">Max S-S distance (Å)</label>
        <Input
          id="max-ss-distance"
          name="max-ss-distance"
          type="number"
          size="sm"
          className="w-20"
          min="0"
          step="0.1"
          bind:value={maxDisulfideDistance}
        />
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={!canRunPreparationSteps}
        >Detect bonds</Button
      >
    </form>
    {#if preparationStatus.bondsChecked}
      <div class="space-y-2">
        {#if disulfideBonds.length > 0}
          <p class="sidebar-label">Detected S-S bonds</p>
          <ol class="list-inside list-decimal rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            {#each disulfideBonds as bond}
              <li>{bond[0][0]}{bond[0][1]} → {bond[1][0]}{bond[1][1]}</li>
            {/each}
          </ol>
        {:else}
          <p class="sidebar-hint rounded-md border border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
            No disulfide bonds detected
          </p>
        {/if}
      </div>
    {/if}
    <Divider />
    <div class="space-y-2">
      <div class="flex items-center gap-1">
        <Checkbox name="remove-protein-h" bind:checked={removeProteinHydrogens} />
        <label
          for="remove-protein-h"
          class="sidebar-label"
          title="Removes hydrogens from protein residues only before pdb4amber. Ligands and other heteroatoms keep their hydrogens. Recommended when the structure came from Schrödinger or similar tools — foreign H names often break tleap after Builder."
        >
          Remove protein hydrogens
        </label>
      </div>
      <Button className="w-full" onclick={onPreparePDB} disabled={!canRunPreparationSteps || preparingPDB}
        >{preparingPDB ? 'Preparing...' : 'Prepare'}</Button
      >
      <Button className="w-full" variant="ghost" onclick={onClear}>Clear</Button>
    </div>
  </aside>
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <h1 class="m-4 mb-2 text-xl font-semibold">Protonation states</h1>
    <div class="mx-4 mb-4 flex min-h-0 flex-1 gap-3 overflow-hidden">
      {#if protonationStates.length > 0}
        {@const sortIndicator = sortDirection === 'asc' ? '▲' : '▼'}
        <div
          class="flex min-h-0 min-w-0 flex-[0.45] flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
        >
          <div class="min-h-0 flex-1 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-950">
                <tr>
                  {#each columns as col, i}
                    <th class={['px-0.5 py-1', i === 0 && 'pl-1', i === columns.length - 1 && 'pr-1']}>
                      <button
                        class="flex w-full items-center justify-center gap-2 rounded-md bg-neutral-100 px-2 py-1 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                        onclick={() => toggleSort(col.key)}
                      >
                        <span>
                          {#if col.key === 'pka'}pK<sub>a</sub>{:else}{col.label}{/if}
                        </span>
                        {#if sortColumn === col.key}
                          <span class="pb-0.5 text-xs">{sortIndicator}</span>
                        {/if}
                      </button>
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
                {#each sortedProtonationStates as info}
                  <tr
                    class={[
                      'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900',
                      isResidueSelected(info) && 'bg-sky-500/15 dark:bg-sky-400/10'
                    ]}
                    onclick={(e) => onProtonationRowClick(e, info)}
                  >
                    <td class="px-2 py-1 text-center">{info.residue}</td>
                    <td class="px-2 py-1 text-center">{info.original_res_id ?? info.res_id}</td>
                    <td class="px-2 py-1 text-center">{info.res_id}</td>
                    <td class="px-2 py-1 text-center">{info.chain}</td>
                    <td class="px-2 py-1 text-center">{info.pka.toFixed(2)}</td>
                    <td class="px-2 py-1 text-center">
                      <select
                        class={[
                          'w-full rounded-md p-1 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-1 focus:outline-neutral-300 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900 dark:focus:outline-neutral-800',
                          info.current_state !== info.initial_state
                            ? 'outline-2 outline-neutral-900 focus:outline-2 focus:outline-neutral-900 dark:outline-white dark:focus:outline-white'
                            : ''
                        ]}
                        bind:value={info.current_state}
                        onchange={() => scheduleGhostPreview()}
                      >
                        {#each info.all_states as state}
                          <option value={state}>{state}</option>
                        {/each}
                      </select>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p
            class="shrink-0 border-t border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
          >
            Click a row to focus in 3D; Ctrl+click to multi-select.
          </p>
        </div>
        <div class="flex min-h-0 min-w-0 flex-[0.55] flex-col">
          <PrepStructureViewer
            pdbPath={viewerPdbPath}
            selectedKeys={selectedResidueKeys}
            {ghostAtoms}
            {removedMarkers}
          />
        </div>
      {:else}
        <p
          class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
        >
          Run PropKa to see the protonation states.
        </p>
      {/if}
    </div>
    {#if preparationOutput}
      <div class="max-h-2/5 overflow-y-auto border-t border-neutral-200 p-4 text-xs select-text dark:border-neutral-800">
        <p class="mb-1 font-semibold text-neutral-700 dark:text-neutral-300">pdb4amber log</p>
        <p class="mb-2 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
          “Gaps (Renumbered Residues!)” lines come from AmberTools pdb4amber: they flag places where
          sequential residues are farther than ~2&nbsp;Å (missing residues or chain breaks) after its
          own renumbering. They are informational and unrelated to ACE/NME capping renumbering (Old
          ID / New ID above).
        </p>
        <pre>{preparationOutput}</pre>
      </div>
    {/if}
  </div>
</div>

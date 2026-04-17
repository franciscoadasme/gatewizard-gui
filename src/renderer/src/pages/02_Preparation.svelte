<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import { detectDisulfideBonds, preparePDB, runPropKa } from '../lib/backendApi'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  let capProtein = $state(false)
  let maxDisulfideDistance = $state(2.5)
  let targetPh = $state(7.0)
  let workingFile = $state('')

  // derived values
  let protonatedFile = $derived(workingFile.replace('.pdb', '_protonated.pdb'))
  let sortedProtonationStates = $derived.by(() => {
    const col = sortColumn
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...protonationStates].sort((a, b) => {
      const av = a[col]
      const bv = b[col]
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  })

  // state
  let preparingPDB = $state(false)
  let runningPropKa = $state(false)
  /** @type {'residue' | 'res_id' | 'chain' | 'pka' | 'current_state'} */
  let sortColumn = $state('residue')
  /** @type {'asc' | 'desc'} */
  let sortDirection = $state('asc')
  /** @type {{ key: typeof sortColumn, label: string }[]} */
  const columns = [
    { key: 'residue', label: 'Residue' },
    { key: 'res_id', label: 'ID' },
    { key: 'chain', label: 'Chain' },
    { key: 'pka', label: 'pKa' },
    { key: 'current_state', label: 'State' }
  ]

  // output
  /** @type {[[ [string, number], [string, number] ]]} */
  let disulfideBonds = $state([])
  let preparationOutput = $state('')
  /** @type {{residue: string, res_id: number, chain: string, pka: number, atom: string, atom_type: string, model_pka: number, current_state: string, initial_state: string, all_states: string[]}[]} */
  let protonationStates = $state([])
  /** @type {Record<string, number>} */
  let residueRenumberingTable = $state({})

  /** @param {typeof sortColumn} column */
  function toggleSort(column) {
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      sortColumn = column
      sortDirection = 'asc'
    }
  }

  async function onRunPropKa() {
    try {
      runningPropKa = true
      const data = await runPropKa(workingFile, parseFloat(targetPh), capProtein)
      protonationStates = data.residues
      residueRenumberingTable = data.residue_renumbering_table
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      runningPropKa = false
    }
  }

  async function onSelectWorkingFile() {
    const { canceled, filePath } = await window.api.openPdbDialog()
    if (canceled) {
      return
    }
    workingFile = filePath
    resetOutput()
  }

  async function onDetectDisulfideBonds() {
    try {
      const data = await detectDisulfideBonds(workingFile, maxDisulfideDistance)
      disulfideBonds = data.disulfide_bonds
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function onPreparePDB() {
    try {
      preparingPDB = true
      const data = await preparePDB({
        path: capProtein ? workingFile.replace('.pdb', '_capped.pdb') : workingFile,
        outputPath: protonatedFile,
        protonationStates,
        targetPh,
        disulfideBonds
      })
      preparationOutput = data.output.trim()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      preparingPDB = false
    }
  }

  async function onReset() {
    // reset form fields
    capProtein = false
    maxDisulfideDistance = 2.5
    targetPh = 7.0
    workingFile = ''

    // reset state
    preparingPDB = false
    runningPropKa = false

    resetOutput()
  }

  function resetOutput() {
    disulfideBonds = []
    preparationOutput = ''
    protonationStates = []
    residueRenumberingTable = {}
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800 select-none">
  <aside class="w-70 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <p class="mb-1">Working file:</p>
      {#if workingFile}
        <p
          class="w-full rounded-md border p-2 wrap-break-word dark:border-neutral-800 dark:text-neutral-400"
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
      <div>
        <p class="mb-1">Export Protonated File:</p>
        <p
          class="rounded-md border p-2 wrap-break-word dark:border-neutral-800 dark:text-neutral-400"
        >
          {protonatedFile ? protonatedFile : 'It will be auto-generated'}
        </p>
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
      <h2 class="font-semibold">PropKa Analysis</h2>
      <div class="flex items-center gap-1">
        <label for="target-ph" class="flex-1">Target pH:</label>
        <input
          type="text"
          inputmode="decimal"
          name="target-ph"
          class="w-20 rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
          value={targetPh.toFixed(1)}
          onchange={(e) => {
            targetPh = parseFloat(e.target.value) || 0
            e.target.value = targetPh.toFixed(1)
          }}
        />
      </div>
      <div class="flex items-center gap-1">
        <Checkbox name="protein-cap" bind:checked={capProtein} />
        <label for="protein-cap">Cap protein termini (ACE/NME)</label>
      </div>
      <Button type="submit" className="w-full" disabled={!workingFile || runningPropKa}>
        {runningPropKa ? 'Running PropKa...' : 'Run PropKa'}
      </Button>
    </form>
    <Divider />
    <form
      class="space-y-2"
      onsubmit={(e) => {
        e.preventDefault()
        onDetectDisulfideBonds()
      }}
    >
      <h2 class="font-semibold">Disulfide Bonding</h2>
      <div class="flex items-center gap-1">
        <label for="max-ss-distance" class="flex-1">Max S-S distance (Å):</label>
        <input
          type="text"
          inputmode="decimal"
          name="max-ss-distance"
          class="w-20 rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
          bind:value={maxDisulfideDistance}
        />
      </div>
      <Button type="submit" variant="outline" className="w-full">Detect bonds</Button>
    </form>
    {#if disulfideBonds.length > 0}
      <div class="space-y-2">
        <p>Detected S-S bonds:</p>
        <ol class="list-inside list-decimal rounded-md border border-neutral-800 p-2">
          {#each disulfideBonds as bond}
            <li>{bond[0][0]}{bond[0][1]} → {bond[1][0]}{bond[1][1]}</li>
          {/each}
        </ol>
      </div>
    {/if}
    <Divider />
    <div class="space-y-2">
      <Button className="w-full" onclick={onPreparePDB} disabled={!workingFile || preparingPDB}
        >{preparingPDB ? 'Preparing...' : 'Prepare'}</Button
      >
      <Button className="w-full" variant="outline">Export Results</Button>
      <Button className="w-full" variant="ghost" onclick={onReset}>Reset</Button>
    </div>
  </aside>
  <div class="relative flex flex-1 flex-col overflow-hidden">
    <h1 class="m-4 text-xl font-semibold">Protonation states</h1>
    {#if protonationStates.length > 0}
      {@const sortIndicator = sortDirection === 'asc' ? '▲' : '▼'}
      <div class="mx-4 mb-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-800">
        <table class="w-full">
          <thead class="sticky top-0 z-10 bg-neutral-950">
            <tr>
              {#each columns as col, i}
                <th class={['px-0.5 py-1', i === 0 && 'pl-1', i === columns.length - 1 && 'pr-1']}>
                  <button
                    class="flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-2 py-1 hover:bg-neutral-800"
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
          <tbody class="divide-y divide-neutral-800">
            {#each sortedProtonationStates as info}
              {@const key = `${info.residue}_${info.chain}_${info.res_id}`}
              {@const newId = residueRenumberingTable[key]}
              <tr>
                <td class="px-2 py-1 text-center">{info.residue}</td>
                <td class="px-2 py-1 text-center">
                  {newId ? `${info.res_id}→${newId}` : info.res_id}
                </td>
                <td class="px-2 py-1 text-center">{info.chain}</td>
                <td class="px-2 py-1 text-center">{info.pka.toFixed(2)}</td>
                <td class="px-2 py-1 text-center">
                  <select
                    class={[
                      'w-full rounded-md p-1 hover:bg-neutral-900 focus:bg-neutral-900 focus:outline-1 focus:outline-neutral-800',
                      info.current_state !== info.initial_state
                        ? 'outline-2 outline-white focus:outline-2 focus:outline-white'
                        : ''
                    ]}
                    bind:value={info.current_state}
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
    {:else}
      <p
        class="mx-4 mb-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-neutral-700"
      >
        Run PropKa to see the protonation states.
      </p>
    {/if}
    {#if preparationOutput}
      <div class="max-h-2/5 overflow-y-auto border-t p-4 text-xs dark:border-neutral-800">
        <pre>{preparationOutput}</pre>
      </div>
    {/if}
  </div>
</div>

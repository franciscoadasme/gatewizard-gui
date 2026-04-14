<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import { runPropKa } from '../lib/backendApi'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  let capProtein = $state(false)
  let disulfideBonds = $state([])
  let maxDisulfideDistance = $state(2.5)
  let targetPh = $state(7.0)
  let workingFile = $state('')
  /** @type {{residue: string, res_id: number, chain: string, pka: number, atom: string, atom_type: string, model_pka: number, current_state: string, initial_state: string, all_states: string[]}[]} */
  let protonationStates = $state([])
  /** @type {Record<string, number>} */
  let residueRenumberingTable = $state({})
  let runningPropKa = $state(false)

  let protonatedFile = $derived(workingFile.replace('.pdb', '_protonated.pdb'))

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
  }

  workingFile = '1EVE.pdb'
  onRunPropKa()
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
    <form class="space-y-2">
      <h2 class="font-semibold">PropKa Analysis</h2>
      <div class="flex items-center gap-1">
        <label for="target-ph" class="flex-1">Target pH:</label>
        <input
          type="text"
          inputmode="decimal"
          name="target-ph"
          class="w-20 rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
          bind:value={targetPh}
        />
      </div>
      <div class="flex items-center gap-1">
        <Checkbox name="protein-cap" bind:checked={capProtein} />
        <label for="protein-cap">Cap protein termini (ACE/NME)</label>
      </div>
      <Button
        type="submit"
        className="w-full"
        onclick={onRunPropKa}
        disabled={!workingFile || runningPropKa}
      >
        {runningPropKa ? 'Running PropKa...' : 'Run PropKa'}
      </Button>
    </form>
    <Divider />
    <form class="space-y-2">
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
      <div class="space-y-2">
        <p>Detected S-S bonds:</p>
        <pre class="rounded-md border p-2 dark:border-neutral-800">No disulfide bonds detected.
        </pre>
      </div>
    </form>
    <Divider />
    <div class="space-y-2">
      <Button className="w-full">Prepare</Button>
      <Button className="w-full" variant="outline">Export Results</Button>
      <Button className="w-full" variant="ghost">Reset</Button>
    </div>
    <pre class="rounded-md border p-2 dark:border-neutral-800">No output yet.</pre>
  </aside>
  <div class="relative flex flex-1 flex-col overflow-hidden p-4">
    <h1 class="mb-4 text-xl font-semibold">Protonation states</h1>
    {#if protonationStates.length > 0}
      <div class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-800">
        <table class="w-full">
          <thead class="sticky top-0 z-10 bg-neutral-950">
            <tr>
              <th class="px-0.5 py-1 pl-1"
                ><button class="w-full rounded-md bg-neutral-900 px-2 py-1">Residue</button></th
              >
              <th class="px-0.5 py-1"
                ><button class="w-full rounded-md bg-neutral-900 px-2 py-1">ID</button></th
              >
              <th class="px-0.5 py-1"
                ><button class="w-full rounded-md bg-neutral-900 px-2 py-1">Chain</button></th
              >
              <th class="px-0.5 py-1"
                ><button class="w-full rounded-md bg-neutral-900 px-2 py-1">pK<sub>a</sub></button
                ></th
              >
              <th class="px-0.5 py-1 pr-1"
                ><button class="w-full rounded-md bg-neutral-900 px-2 py-1">State</button></th
              >
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-800">
            {#each protonationStates as info}
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
        class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-neutral-700"
      >
        Run PropKa to see the protonation states.
      </p>
    {/if}
  </div>
</div>

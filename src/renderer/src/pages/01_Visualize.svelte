<script>
  import { BallStick, CameraRig, Canvas, Cartoon, VdwSpheres } from '../components/viewer'
  import { getCameraForAtoms } from '../lib/viewer/base.js'
  import { getStructure } from '../lib/backendApi.js'
  import Button from '../components/ui/Button.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import ViewItem from '../components/ViewItem.svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' }} Representation */
  /** @typedef {{ id: string, name: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean }} View */

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  /** Shown under the buttons: PDB info or ping output. */
  let sidebarResult = $state('')
  let openPdbLoading = $state(false)
  let filePath = $state(null)
  let selection = $state(null)
  let selectionError = $state(null)

  /** @type {null | Awaited<ReturnType<typeof getStructure>>} */
  let structure = $state(null)
  /** @type {View[]} */
  let views = $state([])

  // derived state
  const camera = $derived.by(() => getCameraForAtoms(structure?.atoms))

  async function onOpenPdb() {
    openPdbLoading = true
    sidebarResult = ''
    try {
      const dlg = await window.api.openPdbDialog()
      if (dlg.canceled) {
        return
      }
      filePath = dlg.filePath

      structure = await getStructure({
        path: dlg.filePath,
        needs_bonds: true,
        needs_secondary_structure: true
      })

      views.length = 0
      addView('All', 'all', { type: 'vdw' })

      const base = dlg.filePath.split(/[/\\]/).pop() ?? dlg.filePath
      const n = structure?.atoms?.length
      sidebarResult = typeof n === 'number' ? `${n} atoms — ${base}` : JSON.stringify(structure)
    } catch (err) {
      sidebarResult = err instanceof Error ? err.message : String(err)
      structure = null
    } finally {
      openPdbLoading = false
    }
  }

  async function onSelect() {
    try {
      structure = await getStructure({ path: filePath, selection })
      selectionError = null
    } catch (ex) {
      selectionError = ex instanceof Error ? ex.message : String(ex)
    }
  }

  /** @param {string} name */
  /** @param {string} selection */
  /** @param {Representation} representation */
  function addView(name = 'New', selection = 'all', representation = { type: 'vdw' }) {
    views.push({
      id: crypto.randomUUID(),
      name,
      selection,
      representation,
      path: filePath,
      atoms: structure?.atoms,
      bonds: structure?.bonds,
      residues: structure?.residues,
      visible: true
    })
  }

  /** @param {string} id */
  function removeView(id) {
    views = views.filter((it) => it.id !== id)
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800">
  <div class="flex w-60 flex-col gap-2 p-2">
    <Button
      className="w-full"
      variant="outline"
      type="button"
      disabled={openPdbLoading}
      onclick={onOpenPdb}>{openPdbLoading ? '...' : 'Open PDB...'}</Button
    >
    <form class="flex flex-col gap-1">
      <input
        type="text"
        class="w-full rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
        placeholder="PDB ID (e.g. 1crn)"
      />
      <Button className="w-full" variant="outline" type="submit" disabled={openPdbLoading}
        >Download PDB</Button
      >
    </form>
    <input
      type="text"
      class="w-full rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
      placeholder="Selection (e.g. protein)"
      bind:value={selection}
      onchange={onSelect}
    />
    {#if selectionError}
      <p class="text-xs font-semibold text-red-500">{selectionError}</p>
    {/if}
    {#if sidebarResult}
      <p
        class="rounded-md border border-neutral-700 bg-neutral-900/50 p-2 font-mono text-sm text-neutral-200"
      >
        {sidebarResult}
      </p>
    {/if}
  </div>

  <div class="relative min-h-[420px] min-w-0 flex-1 bg-black">
    {#if structure && camera}
      <Canvas>
        <CameraRig center={camera.center} extent={camera.extent} />
        {#each views.filter((v) => v.visible) as view}
          {#if view.representation.type === 'ball-stick'}
            <BallStick atoms={view.atoms} bonds={view.bonds} />
          {:else if view.representation.type === 'cartoon'}
            <Cartoon atoms={view.atoms} residues={view.residues} />
          {:else if view.representation.type === 'vdw'}
            <VdwSpheres atoms={view.atoms} />
          {/if}
        {/each}
      </Canvas>
    {/if}
  </div>

  <div class="flex w-60 flex-col">
    <h2 class="border-b border-neutral-800 p-2 text-xs font-semibold">Representations</h2>
    {#if views.length > 0}
      {#each views as view, i (view.id)}
        <ViewItem bind:view={views[i]} onremove={() => removeView(view.id)} />
      {/each}
      <div class="p-2">
        <Button
          className="w-full"
          variant="outline"
          type="button"
          size="sm"
          onclick={() => addView()}>Add View</Button
        >
      </div>
    {:else}
      <div class="flex-1 p-2">
        <Empty message="Load a PDB file to get started" className="text-sm h-full" />
      </div>
    {/if}
  </div>
</div>

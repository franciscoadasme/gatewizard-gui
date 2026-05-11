<script>
  import { BallStick, CameraRig, Canvas, Cartoon, VdwSpheres } from '../components/viewer'
  import { getCameraForAtoms } from '../lib/viewer/base.js'
  import { getStructure } from '../lib/backendApi.js'
  import Button from '../components/ui/Button.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import Input from '../components/ui/Input.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import ViewItem from '../components/ViewItem.svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' }} Representation */
  /** @typedef {{ id: string, name: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean }} View */

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  // TODO: do we need filepath? structure.path may be enough
  let filePath = $state(null)
  let pdbId = $state('')

  // state
  let loadingPDB = $state(false)
  /** @type {null | Awaited<ReturnType<typeof getStructure>>} */
  let structure = $state(null)
  /** @type {View[]} */
  let views = $state([])

  // derived state
  const camera = $derived.by(() => getCameraForAtoms(structure?.atoms))
  const isPdbIdValid = $derived.by(() => pdbId.trim().length === 4)

  async function onFetchPDB() {
    if (!isPdbIdValid) return
    await loadStructure(pdbId)
    if (structure) {
      pdbId = ''
    }
  }

  async function onOpenPdb() {
    const dlg = await window.api.openPdbDialog()
    if (dlg.canceled) {
      return
    }
    await loadStructure(dlg.filePath)
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

  /** @param {string} path */
  async function loadStructure(path) {
    try {
      loadingPDB = true
      structure = await getStructure({
        path,
        needs_bonds: false,
        needs_secondary_structure: false
      })
      filePath = structure.path
      views.length = 0
      addView('All', 'all', { type: 'vdw' })
    } catch (ex) {
      structure = null
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      loadingPDB = false
    }
  }

  /** @param {string} id */
  function removeView(id) {
    views = views.filter((it) => it.id !== id)
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800">
  <div class="flex w-70 flex-col gap-2 p-4">
    <div class="space-y-2">
      <p class="mb-1 text-xs">Structure file:</p>
      {#if filePath && !loadingPDB}
        <div
          class="w-full rounded-md border border-neutral-800 p-2 font-mono text-xs wrap-anywhere"
        >
          {filePath}
        </div>
        <Button variant="outline" className="w-full" onclick={onOpenPdb}
          >Select another file...</Button
        >
      {:else}
        <Button
          variant="outline"
          className="w-full flex items-center gap-1"
          onclick={onOpenPdb}
          disabled={loadingPDB}
        >
          {#if loadingPDB}
            <Spinner />
            Loading...
          {:else}
            Select a file...
          {/if}
        </Button>
      {/if}
    </div>

    {#if !loadingPDB}
      <Divider message="or" />

      <form class="flex gap-2" onsubmit={onFetchPDB}>
        <Input
          placeholder="1crn"
          className="w-[calc(4ch+--spacing(3.5)*2)] font-mono"
          bind:value={pdbId}
          oninput={(e) => {
            if (e.target.value.length > 4) e.target.value = e.target.value.slice(0, 4)
          }}
        />
        <Button
          className="w-full"
          variant="outline"
          type="submit"
          disabled={loadingPDB || !isPdbIdValid}>Download PDB</Button
        >
      </form>
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

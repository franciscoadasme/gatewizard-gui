<script>
  import {
    AxesGizmo,
    AxesLines,
    BallStick,
    CameraRig,
    Canvas,
    Cartoon,
    VdwSpheres
  } from '../components/viewer'
  import Axes from '../components/icons/Axes.svelte'
  import AxesLinesIcon from '../components/icons/AxesLines.svelte'
  import { defaultColorScheme } from '../lib/colorSchemes.js'
  import { getCameraForAtoms } from '../lib/viewer/base.js'
  import { getStructure } from '../lib/backendApi.js'
  import Button from '../components/ui/Button.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import Input from '../components/ui/Input.svelte'
  import Plus from '../components/icons/Plus.svelte'
  import ResetIcon from '../components/icons/Reset.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import ViewItem from '../components/ViewItem.svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' }} Representation */
  /** @typedef {(atom: Atom) => import('three').Color} ColorScheme */
  /** @typedef {{ id: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean, colorScheme: ColorScheme }} View */
  /** @typedef {ReturnType<typeof getCameraForAtoms> & { framingZoom: number, framingGeneration: number, poseResetGeneration: number }} ViewerFraming */

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  // TODO: do we need filepath? structure.path may be enough
  let filePath = $state(null)
  let pdbId = $state('')

  // state
  let axesLinesVisible = $state(false)
  let axesVisible = $state(false)
  /** @type {ViewerFraming | null} */
  let camera = $state(null)
  let loadingPDB = $state(false)
  /** @type {null | Awaited<ReturnType<typeof getStructure>>} */
  let structure = $state(null)
  /** @type {View[]} */
  let views = $state([])

  // derived state
  const isPdbIdValid = $derived.by(() => pdbId.trim().length === 4)

  $effect(() => {
    const base = getCameraForAtoms(structure?.atoms)
    camera = base ? { ...base, framingZoom: 1, framingGeneration: 0, poseResetGeneration: 0 } : null
  })

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

  /** @param {string} selection */
  /** @param {Representation} representation */
  function addView(selection = 'all', representation = { type: 'vdw' }) {
    views.push({
      id: crypto.randomUUID(),
      selection,
      representation,
      path: filePath,
      atoms: structure?.atoms,
      bonds: structure?.bonds,
      residues: structure?.residues,
      visible: true,
      colorScheme: defaultColorScheme
    })
  }

  /** @param {Atom[] | undefined | null} atoms */
  function centerCameraOnAtoms(atoms) {
    const next = getCameraForAtoms(atoms)
    if (!next) {
      return
    }
    camera = {
      ...next,
      framingZoom: 1,
      framingGeneration: (camera?.framingGeneration ?? 0) + 1,
      poseResetGeneration: camera?.poseResetGeneration ?? 0
    }
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
      addView('all', { type: 'vdw' })
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

  function resetCamera() {
    const base = getCameraForAtoms(structure?.atoms)
    if (!base) {
      return
    }
    camera = {
      ...base,
      framingZoom: 1,
      framingGeneration: (camera?.framingGeneration ?? 0) + 1,
      poseResetGeneration: (camera?.poseResetGeneration ?? 0) + 1
    }
  }
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800">
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

  <div class="relative min-h-100 min-w-100 flex-1 bg-black">
    {#if structure && camera}
      <Canvas>
        <CameraRig framing={camera} />
        {#each views.filter((v) => v.visible) as view (view.id)}
          {#if view.representation.type === 'ball-stick'}
            <BallStick atoms={view.atoms} bonds={view.bonds} getColor={view.colorScheme} />
          {:else if view.representation.type === 'cartoon'}
            <Cartoon atoms={view.atoms} residues={view.residues} />
          {:else if view.representation.type === 'vdw'}
            <VdwSpheres atoms={view.atoms} getColor={view.colorScheme} />
          {/if}
        {/each}
        {#if axesLinesVisible}
          <AxesLines length={camera.extent * 2} />
        {/if}
      </Canvas>
      {#if axesVisible}
        <AxesGizmo />
      {/if}
    {/if}
  </div>

  <div class="flex w-60 flex-col">
    <h2 class="border-b border-neutral-800 p-2 text-xs font-semibold">Representations</h2>
    {#if views.length > 0 || filePath}
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each views as view, i (view.id)}
          <ViewItem
            bind:view={views[i]}
            onremove={() => removeView(view.id)}
            oncenter={() => centerCameraOnAtoms(view.atoms)}
          />
        {/each}
      </div>
      <div class="flex gap-1 border-t border-neutral-800 p-2">
        <Button
          variant="outline"
          size="sm"
          className="p-1.5!"
          aria-label="Add view"
          title="Add view"
          onclick={() => addView()}
        >
          <Plus className="size-3 fill-white" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="p-1!"
          onclick={() => (axesVisible = !axesVisible)}
          aria-label={axesVisible ? 'Hide axes gizmo' : 'Show axes gizmo'}
          title={axesVisible ? 'Hide axes gizmo' : 'Show axes gizmo'}
        >
          <Axes className="size-4 {axesVisible ? 'fill-white' : 'fill-neutral-500'}" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="p-1!"
          onclick={() => (axesLinesVisible = !axesLinesVisible)}
          aria-label={axesLinesVisible ? 'Hide axes lines' : 'Show axes lines'}
          title={axesLinesVisible ? 'Hide axes lines' : 'Show axes lines'}
        >
          <AxesLinesIcon
            className="size-4 stroke-2 {axesLinesVisible ? 'opacity-100' : 'opacity-45'}"
          />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="p-1.5!"
          onclick={() => resetCamera()}
          aria-label="Reset camera"
          title="Reset camera"
        >
          <ResetIcon className="size-3 fill-white" />
        </Button>
      </div>
    {:else}
      <div class="flex-1 p-2">
        <Empty message="Load a PDB file to get started" className="text-sm h-full" />
      </div>
    {/if}
  </div>
</div>

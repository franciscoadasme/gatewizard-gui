<script>
  import { BallStick, CameraRig, Canvas, VdwSpheres } from '../components/viewer'
  import Button from '../components/ui/Button.svelte'
  import { loadPdb, selectAtoms } from '../lib/backendApi.js'

  const R_SHELL = 2.3 // radius of the shell around the atoms

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  /** Shown under the buttons: PDB info or ping output. */
  let sidebarResult = $state('')
  let openPdbLoading = $state(false)
  let filePath = $state(null)
  let selection = $state(null)
  let selectionError = $state(null)

  /** Passed to Threlte viewer (positions + elements from backend). */
  /** @type {null | { atoms: { x: number, y: number, z: number, element: string }[], bonds: [number, number][] }} */
  let structure = $state(null)

  // derived state
  const camera = $derived.by(() => getCameraForAtoms(structure?.atoms))

  /**
   * @param {{ x: number, y: number, z: number }[]|undefined|null} atoms
   * @returns {{ center: { x: number, y: number, z: number }, extent: number } | null}
   */
  function getCameraForAtoms(atoms) {
    if (!atoms) {
      return null
    }

    const centroid = getCentroid(atoms)
    const extent = getExtent(atoms, centroid)
    return { center: centroid, extent }
  }

  /**
   * @param {{ x: number, y: number, z: number }[]} atoms
   * @returns {{ x: number, y: number, z: number }}
   */
  function getCentroid(atoms) {
    let cx = 0
    let cy = 0
    let cz = 0
    for (const a of atoms) {
      cx += a.x
      cy += a.y
      cz += a.z
    }
    const n = atoms.length
    cx /= n
    cy /= n
    cz /= n

    return { x: cx, y: cy, z: cz }
  }

  /**
   * @param {{ x: number, y: number, z: number }[]} atoms
   * @param {{ x: number, y: number, z: number }} centroid
   * @returns {number}
   */
  function getExtent(atoms, centroid) {
    /** Max distance from centroid to any atom (+ shell); floor keeps tiny sets sane before dist clamp in CameraRig. */
    let extent = 8
    for (const a of atoms) {
      const reach = Math.hypot(a.x - centroid.x, a.y - centroid.y, a.z - centroid.z) + R_SHELL
      if (reach > extent) extent = reach
    }
    return extent
  }

  async function onOpenPdb() {
    openPdbLoading = true
    sidebarResult = ''
    try {
      const dlg = await window.api.openPdbDialog()
      if (dlg.canceled) {
        return
      }
      filePath = dlg.filePath

      structure = await loadPdb(dlg.filePath)
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
      structure = await selectAtoms({ path: filePath, selection })
      selectionError = null
    } catch (ex) {
      selectionError = ex instanceof Error ? ex.message : String(ex)
    }
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
    {#if structure}
      <Canvas>
        <CameraRig center={camera.center} extent={camera.extent} />
        <!-- <VdwSpheres atoms={structure.atoms} /> -->
        <BallStick atoms={structure.atoms} bonds={structure.bonds} />
      </Canvas>
    {/if}
  </div>

  <div class="w-60 p-2">
    <h2>Representations</h2>
  </div>
</div>

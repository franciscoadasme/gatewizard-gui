<script>
  import { Color } from 'three'
  import { untrack } from 'svelte'
  import { BallStick, CameraRig, Canvas, Tube, VdwSpheres } from '../viewer'
  import { cpkScheme } from '../../lib/colorSchemes.js'
  import { getStructure } from '../../lib/backendApi'
  import { getCameraForAtoms } from '../../lib/viewer/base.js'

  /**
   * @typedef {{ chain: string, res_id: number }} ResidueKey
   * @typedef {{
   *   x: number, y: number, z: number, element: string, name: string,
   *   index?: number, res_name?: string, res_id?: number, chain_id?: string,
   *   role?: string
   * }} ViewerAtom
   */

  /**
   * @type {{
   *   pdbPath: string,
   *   selectedKeys?: ResidueKey[],
   *   ghostAtoms?: ViewerAtom[],
   *   removedMarkers?: ViewerAtom[]
   * }}
   */
  let {
    pdbPath = '',
    selectedKeys = [],
    ghostAtoms = [],
    removedMarkers = []
  } = $props()

  /** @type {null | Awaited<ReturnType<typeof getStructure>>} */
  let structure = $state(null)
  let loading = $state(false)
  let loadError = $state(/** @type {string | null} */ (null))
  /** @type {null | (ReturnType<typeof getCameraForAtoms> & { framingZoom: number, framingGeneration: number, poseResetGeneration: number })} */
  let framing = $state(null)

  const getColor = cpkScheme()
  const _ghostAdd = new Color(0.35, 0.85, 1.0)
  const _ghostRemove = new Color(1.0, 0.35, 0.55)
  const ghostAddColor = () => _ghostAdd
  const ghostRemoveColor = () => _ghostRemove

  const selectedKeySet = $derived(
    new Set(selectedKeys.map((k) => `${k.chain || ''}:${k.res_id}`))
  )

  const selectedAtoms = $derived.by(() => {
    if (!structure?.atoms?.length || selectedKeySet.size === 0) return []
    return structure.atoms.filter((a) =>
      selectedKeySet.has(`${a.chain_id || ''}:${a.res_id}`)
    )
  })

  const selectedBonds = $derived.by(() => {
    if (!selectedAtoms.length || !structure?.bonds?.length) return []
    const idx = new Set(selectedAtoms.map((a) => a.index))
    return structure.bonds.filter(([a, b]) => idx.has(a) && idx.has(b))
  })

  $effect(() => {
    const path = pdbPath
    if (!path) {
      structure = null
      framing = null
      loadError = null
      return
    }
    let cancelled = false
    ;(async () => {
      loading = true
      loadError = null
      try {
        const data = await getStructure({
          path,
          topology: null,
          selection: 'protein',
          needs_bonds: true,
          needs_secondary_structure: true
        })
        if (cancelled) return
        structure = data
        const base = getCameraForAtoms(data.atoms)
        framing = base
          ? { ...base, framingZoom: 1, framingGeneration: 0, poseResetGeneration: 0 }
          : null
      } catch (ex) {
        if (cancelled) return
        structure = null
        framing = null
        loadError = ex instanceof Error ? ex.message : String(ex)
      } finally {
        if (!cancelled) loading = false
      }
    })()
    return () => {
      cancelled = true
    }
  })

  // Reframe when selection keys change (union of selected residues).
  $effect(() => {
    if (!structure) return
    const keys = selectedKeySet
    const sel =
      keys.size === 0
        ? []
        : structure.atoms.filter((a) => keys.has(`${a.chain_id || ''}:${a.res_id}`))
    const atoms = sel.length ? sel : structure.atoms
    const base = getCameraForAtoms(atoms)
    if (!base) return
    const prevGen = untrack(() => framing?.framingGeneration ?? 0)
    const prevPose = untrack(() => framing?.poseResetGeneration ?? 0)
    framing = {
      ...base,
      framingZoom: sel.length ? 1.15 : 1,
      framingGeneration: prevGen + 1,
      poseResetGeneration: prevPose
    }
  })
</script>

<div
  class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
>
  {#if !pdbPath}
    <div
      class="flex flex-1 items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-600"
    >
      Run PropKa to load the structure here.
    </div>
  {:else if loading && !structure}
    <div
      class="flex flex-1 items-center justify-center p-4 text-center text-xs text-neutral-500"
    >
      Loading structure / bonds…
    </div>
  {:else if loadError}
    <div
      class="flex flex-1 items-center justify-center p-4 text-center text-xs text-red-600 dark:text-red-400"
    >
      {loadError}
    </div>
  {:else if structure && framing}
    <div class="relative min-h-0 flex-1">
      <Canvas registerAsMain={false}>
        <CameraRig {framing} />
        <Tube
          atoms={structure.atoms}
          residues={structure.residues ?? []}
          {getColor}
          tubeRadius={0.7}
          quality={3}
        />
        {#if selectedAtoms.length > 0}
          <BallStick
            atoms={selectedAtoms}
            bonds={selectedBonds}
            {getColor}
            atomScale={1.15}
            bondScale={1.0}
            quality={3}
          />
        {/if}
        {#if ghostAtoms.length > 0}
          <VdwSpheres
            atoms={ghostAtoms}
            getColor={ghostAddColor}
            atomScale={0.55}
            opacity={0.45}
            quality={3}
            depthTest={false}
            renderOrder={10}
          />
        {/if}
        {#if removedMarkers.length > 0}
          <VdwSpheres
            atoms={removedMarkers}
            getColor={ghostRemoveColor}
            atomScale={0.5}
            opacity={0.35}
            quality={3}
            depthTest={false}
            renderOrder={11}
          />
        {/if}
      </Canvas>
      {#if loading}
        <div
          class="pointer-events-none absolute top-2 right-2 rounded bg-neutral-900/70 px-2 py-1 text-[10px] text-white"
        >
          Refreshing…
        </div>
      {/if}
    </div>
    <p class="shrink-0 border-t border-neutral-200 px-2 py-1.5 text-[10px] leading-snug text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      Tube = protein. Click / Ctrl+click table rows for ball-and-stick (CPK). Cyan ghosts = H
      added by state change, magenta = H that would be removed. Approximate preview. Final
      hydrogens come from Builder (packmol-memgen).
    </p>
  {/if}
</div>

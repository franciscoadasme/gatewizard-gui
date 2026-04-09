<script>
  import { Canvas, T } from '@threlte/core'
  import { OrbitControls } from '@threlte/extras'
  import MoleculeCameraRig from './MoleculeCameraRig.svelte'
  import MoleculeVdwSpheres from './MoleculeVdwSpheres.svelte'

  /** @type {{ structure: { n_atoms: number, positions: number[], elements: string[] } | null }} */
  let { structure = null } = $props()

  const hasStructure = $derived(
    !!structure &&
      structure.n_atoms > 0 &&
      structure.positions?.length >= 3 &&
      structure.elements?.length
  )
</script>

<div class="relative min-h-[420px] min-w-0 flex-1">
  <Canvas>
    <T.Color attach="background" args={[0x000000]} />
    <T.PerspectiveCamera makeDefault position={[2.8, 2.2, 2.8]} fov={45} />
    <MoleculeCameraRig {structure} />
    <OrbitControls enableDamping={false} />
    <T.AmbientLight intensity={0.45} />
    <T.DirectionalLight position={[5, 8, 4]} intensity={1.1} />
    {#if hasStructure}
      <MoleculeVdwSpheres positions={structure.positions} elements={structure.elements} />
    {/if}
  </Canvas>
</div>

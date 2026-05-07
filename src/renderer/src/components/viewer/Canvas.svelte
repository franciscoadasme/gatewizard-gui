<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { OrbitControls } from '@threlte/extras'
  import CameraRig from './CameraRig.svelte'
  import VdwSpheres from './representations/VdwSpheres.svelte'

  /** @type {{ structure: { atoms: { x: number, y: number, z: number, element: string }[], bonds: [number, number][] } | null }} */
  let { structure = null } = $props()

  const hasStructure = $derived(!!structure && structure.atoms?.length > 0)
</script>

<div class="relative min-h-[420px] min-w-0 flex-1">
  <ThrelteCanvas>
    <T.Color attach="background" args={[0x000000]} />
    <T.PerspectiveCamera makeDefault position={[2.8, 2.2, 2.8]} fov={45} />
    <CameraRig {structure} />
    <OrbitControls enableDamping={false} />
    <T.AmbientLight intensity={0.45} />
    <T.DirectionalLight position={[5, 8, 4]} intensity={1.1} />
    {#if hasStructure}
      <VdwSpheres atoms={structure.atoms} />
      <!-- BallStick: import from ./representations/BallStick.svelte — <BallStick atoms={structure.atoms} bonds={structure.bonds} /> -->
    {/if}
  </ThrelteCanvas>
</div>

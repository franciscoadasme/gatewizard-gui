<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { OrbitControls } from '@threlte/extras'
  import { Vector3 } from 'three'

  /**
   * @type {{
   *   children?: import('svelte').Snippet
   *   orbitTarget?: { x: number, y: number, z: number } | null
   * }}
   */
  let { children, orbitTarget = null } = $props()

  const orbitPivot = $derived.by(() => {
    if (orbitTarget == null) {
      return new Vector3(0, 0, 0)
    }
    return new Vector3(orbitTarget.x, orbitTarget.y, orbitTarget.z)
  })
</script>

<ThrelteCanvas>
  <T.Color attach="background" args={[0x000000]} />
  <T.PerspectiveCamera makeDefault position={[2.8, 2.2, 2.8]} fov={45} />
  <OrbitControls enableDamping={false} target={orbitPivot} />
  <T.AmbientLight intensity={0.45} />
  <T.DirectionalLight position={[5, 8, 4]} intensity={1.1} />
  {@render children?.()}
</ThrelteCanvas>

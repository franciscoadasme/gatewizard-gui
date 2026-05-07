<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { OrbitControls } from '@threlte/extras'

  /**
   * Threlte shell (camera, controls, lights). Pass scene nodes as default content: e.g.
   * `CameraRig`, representations, overlays.
   * @type {{ children?: import('svelte').Snippet }}
   */
  let { children } = $props()
</script>

<ThrelteCanvas>
  <T.Color attach="background" args={[0x000000]} />
  <T.PerspectiveCamera makeDefault position={[2.8, 2.2, 2.8]} fov={45} />
  <OrbitControls enableDamping={false} />
  <T.AmbientLight intensity={0.45} />
  <T.DirectionalLight position={[5, 8, 4]} intensity={1.1} />
  {@render children?.()}
</ThrelteCanvas>

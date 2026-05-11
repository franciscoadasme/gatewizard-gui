<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { TrackballControls } from '@threlte/extras'

  /** @type {{ children?: import('svelte').Snippet }} */
  let { children } = $props()
</script>

<ThrelteCanvas>
  <T.Color attach="background" args={[0x000000]} />
  <T.PerspectiveCamera makeDefault fov={45} near={0.05} far={500000} />
  <TrackballControls staticMoving={true} rotateSpeed={1.5} panSpeed={0.3} zoomSpeed={3} />
  <T.AmbientLight intensity={0.45} />
  <T.DirectionalLight position={[5, 8, 4]} intensity={1.1} />
  {@render children?.()}
</ThrelteCanvas>

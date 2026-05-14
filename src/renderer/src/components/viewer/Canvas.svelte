<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { TrackballControls } from '@threlte/extras'

  /** @type {{ children?: import('svelte').Snippet }} */
  let { children } = $props()
</script>

<ThrelteCanvas>
  <T.Color attach="background" args={[0x000000]} />
  <T.OrthographicCamera makeDefault manual near={0.05} far={500000} />
  <TrackballControls staticMoving={true} rotateSpeed={1.5} panSpeed={0.3} zoomSpeed={3} />
  <T.HemisphereLight args={['#c4d2e8', '#0c0e12', 0.52]} />
  <T.AmbientLight intensity={0.35} />
  <T.DirectionalLight position={[7, 11, 9]} intensity={0.42} />
  <T.DirectionalLight position={[-9, 6, -7]} intensity={0.34} />
  {@render children?.()}
</ThrelteCanvas>

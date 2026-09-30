<script>
  import { onDestroy } from 'svelte'
  import { T } from '@threlte/core'
  import { sceneDirectionalLightRegistry } from '../../lib/viewer/sceneDirectionalLights.js'

  /**
   * @type {{
   *   index: number,
   *   position: [number, number, number],
   *   intensity: number,
   *   color: string,
   *   lightMode: 'camera' | 'world',
   *   castShadow?: boolean
   * }}
   */
  let {
    index,
    position,
    intensity,
    color,
    lightMode,
    castShadow = false
  } = $props()

  /** @type {import('three').DirectionalLight | undefined} */
  let ref = $state()

  $effect(() => {
    if (ref) {
      sceneDirectionalLightRegistry.byIndex.set(index, ref)
      // Ensure target is in the scene graph (required for correct direction + shadows).
      if (ref.target && !ref.target.parent && ref.parent) {
        ref.parent.add(ref.target)
      }
    }
    return () => {
      sceneDirectionalLightRegistry.byIndex.delete(index)
    }
  })

  onDestroy(() => {
    sceneDirectionalLightRegistry.byIndex.delete(index)
  })
</script>

<T.DirectionalLight
  bind:ref
  position={lightMode === 'world' ? position : [0, 0, 0]}
  {intensity}
  {color}
  {castShadow}
/>

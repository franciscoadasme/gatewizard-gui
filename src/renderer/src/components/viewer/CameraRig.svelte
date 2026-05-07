<script>
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { useThrelte, useThrelteUserContext } from '@threlte/core'

  /** @type {{center: { x: number, y: number, z: number }, extent: number}} */
  let { center, extent } = $props()

  const { camera, invalidate } = useThrelte()
  const controlsNamespace = useThrelteUserContext('threlte-controls')

  /**
   * After moving the camera, sync OrbitControls' target + `update()` so the orbit pivot matches
   * the structure center (THREE only updates internal spherical offset from controls, not `lookAt`).
   */
  $effect(() => {
    const cx = center.x
    const cy = center.y
    const cz = center.z
    const ext = extent

    untrack(() => {
      const cam = camera.current
      if (!cam) {
        return
      }

      const dist = Math.max(18, ext * 2.8)
      cam.position.set(cx + dist * 0.85, cy + dist * 0.55, cz + dist * 0.95)

      const ctx = controlsNamespace ? get(controlsNamespace) : undefined
      const ocWritable = ctx?.orbitControls
      /** @type {import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | undefined} */
      const oc = ocWritable ? get(ocWritable) : undefined
      if (oc) {
        oc.target.set(cx, cy, cz)
        oc.update()
      } else {
        cam.lookAt(cx, cy, cz)
      }
      invalidate()
    })
  })
</script>

<script>
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { useThrelte, useThrelteUserContext } from '@threlte/core'

  /** @type {{center: { x: number, y: number, z: number }, extent: number}} */
  let { center, extent } = $props()

  const { camera, invalidate } = useThrelte()
  const controlsNamespace = useThrelteUserContext('threlte-controls')

  /**
   * After moving the camera, sync controls target + `update()` so pivot matches structure center.
   * Prefers TrackballControls (Canvas) when present, else OrbitControls.
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
      const tb = ctx?.trackballControls ? get(ctx.trackballControls) : undefined
      const oc = ctx?.orbitControls ? get(ctx.orbitControls) : undefined
      /** @type {{ target: import('three').Vector3, update: () => void } | undefined} */
      const ctrl = tb ?? oc
      if (ctrl) {
        ctrl.target.set(cx, cy, cz)
        ctrl.update()
      } else {
        cam.lookAt(cx, cy, cz)
      }
      invalidate()
    })
  })
</script>

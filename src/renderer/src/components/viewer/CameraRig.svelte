<script module>
  /** Main viewer default camera — axes overlay reads `.current` each frame. */
  export const mainViewerCamera = { current: /** @type {import('three').Camera | null} */ (null) }
</script>

<script>
  import { onDestroy, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { OrthographicCamera } from 'three'
  import { useTask, useThrelte, useThrelteUserContext } from '@threlte/core'

  /** @type {{center: { x: number, y: number, z: number }, extent: number}} */
  let { center, extent } = $props()

  const { camera, invalidate, size } = useThrelte()

  useTask(
    () => {
      mainViewerCamera.current = camera.current
    },
    { autoInvalidate: false }
  )

  onDestroy(() => {
    mainViewerCamera.current = null
  })
  const controlsNamespace = useThrelteUserContext('threlte-controls')

  /** Vertical half-extent of ortho frustum in world units (~padding around structure). */
  const FRUSTUM_HALF_H_FACTOR = 1.35

  /**
   * After moving the camera, sync ortho frustum, controls target + `update()` so pivot matches structure center.
   * Prefers TrackballControls (Canvas) when present, else OrbitControls.
   */
  $effect(() => {
    const cx = center.x
    const cy = center.y
    const cz = center.z
    const ext = extent
    const { width, height } = $size

    untrack(() => {
      const cam = camera.current
      if (!cam || !width || !height) {
        return
      }

      if (cam instanceof OrthographicCamera) {
        const aspect = width / height
        const halfH = Math.max(ext * FRUSTUM_HALF_H_FACTOR, 4)
        const halfW = halfH * aspect
        cam.left = -halfW
        cam.right = halfW
        cam.top = halfH
        cam.bottom = -halfH
        cam.updateProjectionMatrix()
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

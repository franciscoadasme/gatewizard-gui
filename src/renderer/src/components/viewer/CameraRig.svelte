<script module>
  /** Main viewer default camera — axes overlay reads `.current` each frame. */
  export const mainViewerCamera = { current: /** @type {import('three').Camera | null} */ (null) }
</script>

<script>
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { OrthographicCamera } from 'three'
  import { useTask, useThrelte, useThrelteUserContext } from '@threlte/core'

  /**
   * @type {{
   *   framing: {
   *     center: { x: number, y: number, z: number }
   *     extent: number
   *     framingZoom: number
   *     framingGeneration: number
   *   }
   * }}
   */
  let { framing } = $props()

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
   * @param {OrthographicCamera} cam
   * @param {number} ext
   * @param {number} width
   * @param {number} height
   */
  function applyOrthoFrustum(cam, ext, width, height) {
    const aspect = width / height
    const halfH = Math.max(ext * FRUSTUM_HALF_H_FACTOR, 4)
    const halfW = halfH * aspect
    cam.left = -halfW
    cam.right = halfW
    cam.top = halfH
    cam.bottom = -halfH
    cam.updateProjectionMatrix()
  }

  /** Ortho frustum + aspect on resize / extent from props — does not move the camera or reset zoom. */
  $effect(() => {
    const ext = framing.extent
    const { width, height } = $size

    const cam = camera.current
    if (!cam || !width || !height) {
      return
    }

    if (cam instanceof OrthographicCamera) {
      applyOrthoFrustum(cam, ext, width, height)
    }

    invalidate()
  })

  let placed = false
  let lastCx = 0
  let lastCy = 0
  let lastCz = 0
  /** @type {number | null} */
  let lastExtent = null
  let lastFramingGeneration = 0

  /**
   * @param {OrthographicCamera} cam
   * @param {number} ext
   * @param {number} zoom
   */
  function applyFramingZoom(cam, ext, zoom) {
    if (!(cam instanceof OrthographicCamera)) {
      return
    }
    cam.zoom = zoom
    const { width, height } = get(size)
    if (width && height) {
      applyOrthoFrustum(cam, ext, width, height)
    }
  }

  /** Initial placement + target moves: preserve orbit orientation; apply framing zoom when reframing. */
  useTask(
    () => {
      const cam = camera.current
      if (!cam) {
        return
      }

      const cx = framing.center.x
      const cy = framing.center.y
      const cz = framing.center.z
      const ext = framing.extent
      const dist = Math.max(18, ext * 2.8)

      const ctx = controlsNamespace ? get(controlsNamespace) : undefined
      const tb = ctx?.trackballControls ? get(ctx.trackballControls) : undefined
      const oc = ctx?.orbitControls ? get(ctx.orbitControls) : undefined
      /** @type {{ target: import('three').Vector3, update: () => void } | undefined} */
      const ctrl = tb ?? oc

      if (!ctrl) {
        return
      }

      if (!placed) {
        cam.position.set(cx + dist * 0.85, cy + dist * 0.55, cz + dist * 0.95)
        ctrl.target.set(cx, cy, cz)
        lastCx = cx
        lastCy = cy
        lastCz = cz
        lastExtent = ext
        lastFramingGeneration = framing.framingGeneration
        applyFramingZoom(cam, ext, framing.framingZoom)
        placed = true
        ctrl.update()
        invalidate()
        return
      }

      const dx = cx - lastCx
      const dy = cy - lastCy
      const dz = cz - lastCz
      const centerChanged = dx !== 0 || dy !== 0 || dz !== 0
      const extentChanged = lastExtent === null || Math.abs(ext - lastExtent) > 1e-6
      const explicitReframe = framing.framingGeneration !== lastFramingGeneration

      if (!centerChanged && !extentChanged && !explicitReframe) {
        return
      }

      if (explicitReframe) {
        lastFramingGeneration = framing.framingGeneration
      }

      if (centerChanged) {
        cam.position.x += dx
        cam.position.y += dy
        cam.position.z += dz
        ctrl.target.set(cx, cy, cz)
        lastCx = cx
        lastCy = cy
        lastCz = cz
      }

      if (centerChanged || extentChanged || explicitReframe) {
        applyFramingZoom(cam, ext, framing.framingZoom)
        lastExtent = ext
        ctrl.update()
        invalidate()
      }
    },
    { autoInvalidate: false }
  )
</script>

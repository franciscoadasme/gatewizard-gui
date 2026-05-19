<script module>
  /** Main viewer default camera — axes overlay reads `.current` each frame. */
  export const mainViewerCamera = { current: /** @type {import('three').Camera | null} */ (null) }
</script>

<script>
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { OrthographicCamera, Vector3 } from 'three'
  import { useTask, useThrelte, useThrelteUserContext } from '@threlte/core'

  /**
   * @type {{
   *   framing: {
   *     center: { x: number, y: number, z: number }
   *     extent: number
   *     framingZoom: number
   *     framingGeneration: number
   *     poseResetGeneration?: number
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
  let lastPoseResetGeneration = 0

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

  const _eye = new Vector3()
  const _target = new Vector3()

  /**
   * Eye on +world Z, up +world Y, look at target → +Z points from structure toward the camera.
   * Screen: +X is to the viewer’s right (Three default); −X is to the left on screen.
   * @param {import('three').Camera} cam
   * @param {{ target: import('three').Vector3 }} ctrl
   * @param {number} cx
   * @param {number} cy
   * @param {number} cz
   * @param {number} ext
   */
  function applyCanonicalView(cam, ctrl, cx, cy, cz, ext) {
    const dist = Math.max(18, ext * 2.8)
    _target.set(cx, cy, cz)
    ctrl.target.copy(_target)
    _eye.set(cx, cy, cz + dist)
    cam.up.set(0, 1, 0)
    cam.position.copy(_eye)
    cam.lookAt(_target)
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

      const ctx = controlsNamespace ? get(controlsNamespace) : undefined
      const tb = ctx?.trackballControls ? get(ctx.trackballControls) : undefined
      const oc = ctx?.orbitControls ? get(ctx.orbitControls) : undefined
      /** @type {{ target: import('three').Vector3, update: () => void } | undefined} */
      const ctrl = tb ?? oc

      if (!ctrl) {
        return
      }

      const poseGen = framing.poseResetGeneration ?? 0

      if (!placed) {
        applyCanonicalView(cam, ctrl, cx, cy, cz, ext)
        lastCx = cx
        lastCy = cy
        lastCz = cz
        lastExtent = ext
        lastFramingGeneration = framing.framingGeneration
        lastPoseResetGeneration = poseGen
        applyFramingZoom(cam, ext, framing.framingZoom)
        placed = true
        ctrl.update()
        invalidate()
        return
      }

      if (poseGen !== lastPoseResetGeneration) {
        lastPoseResetGeneration = poseGen
        lastFramingGeneration = framing.framingGeneration
        applyCanonicalView(cam, ctrl, cx, cy, cz, ext)
        lastCx = cx
        lastCy = cy
        lastCz = cz
        lastExtent = ext
        applyFramingZoom(cam, ext, framing.framingZoom)
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

      // Normalize pan speed so a given mouse drag always moves the same fraction
      // of the visible area, regardless of molecule size or zoom level.
      //
      // TrackballControls ortho pan_fraction = Δpx × eyeLen × panSpeed / clientWidth²
      // For pixel-consistent feel: panSpeed = K × clientWidth / eyeLen
      // K=0.8 gives ~80% 1:1 tracking (comfortable, not too snappy).
      if ('panSpeed' in ctrl && cam instanceof OrthographicCamera) {
        const elW = ctrl.domElement?.clientWidth ?? 0
        if (elW > 0) {
          const eyeLen = cam.position.distanceTo(ctrl.target)
          if (eyeLen > 0) {
            ctrl.panSpeed = (0.5 * elW) / eyeLen
          }
        }
      }

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

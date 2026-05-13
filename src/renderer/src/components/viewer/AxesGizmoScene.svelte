<script>
  import { T, useRenderer, useTask, useThrelte } from '@threlte/core'
  import { get } from 'svelte/store'
  import { OrthographicCamera, Quaternion, Vector3 } from 'three'
  import { mainViewerCamera } from './CameraRig.svelte'

  /** @type {{ gizmo: import('three').Group }} */
  let { gizmo } = $props()

  const { camera, size } = useThrelte()
  const { autoRenderTask } = useRenderer()
  const look = new Vector3()
  const q = new Quaternion()

  /** View distance only affects depth ordering / lighting — ortho size is frustum-based. */
  const CAMERA_DIST = 3.6

  /** World-space half-height of the overlay frustum (triad + labels fit ~±1.1). */
  const FRUSTUM_HALF_H = 1.32

  useTask(
    () => {
      const mini = camera.current
      const main = mainViewerCamera.current
      if (!mini || !main) return

      const { width: w, height: h } = get(size)
      if (mini instanceof OrthographicCamera && w > 0 && h > 0) {
        const aspect = w / h
        const halfH = FRUSTUM_HALF_H
        const halfW = halfH * aspect
        mini.left = -halfW
        mini.right = halfW
        mini.top = halfH
        mini.bottom = -halfH
        mini.updateProjectionMatrix()
      }

      main.updateMatrixWorld(true)
      main.getWorldDirection(look)
      mini.position.copy(look).multiplyScalar(-CAMERA_DIST)
      main.getWorldQuaternion(q)
      mini.quaternion.copy(q)
      mini.up.copy(main.up)
      mini.updateMatrixWorld(true)
    },
    { before: autoRenderTask }
  )
</script>

<T.AmbientLight intensity={0.55} />
<T.DirectionalLight position={[2, 4, 3]} intensity={1.1} />
<T is={gizmo} />

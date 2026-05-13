<script>
  import { T, useRenderer, useTask, useThrelte } from '@threlte/core'
  import { Quaternion, Vector3 } from 'three'
  import { mainViewerCamera } from './CameraRig.svelte'

  /** @type {{ gizmo: import('three').Group }} */
  let { gizmo } = $props()

  const { camera } = useThrelte()
  const { autoRenderTask } = useRenderer()
  const look = new Vector3()
  const q = new Quaternion()

  const CAMERA_DIST = 3.6

  useTask(
    () => {
      const mini = camera.current
      const main = mainViewerCamera.current
      if (!mini || !main) return

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

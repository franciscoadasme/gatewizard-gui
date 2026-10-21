import { OrthographicCamera, Vector3 } from 'three'
import { interpolateCameraPose } from './cameraPoseMath.js'
import { mainViewerCamera, mainViewerInvalidate } from '../../components/viewer/CameraRig.svelte'
import { mainViewerControls } from '../../components/viewer/Canvas.svelte'

const _eye = new Vector3()
const _target = new Vector3()
const _up = new Vector3()

export { interpolateCameraPose }

/**
 * @returns {import('./schema.js').AnimationCameraPose | null}
 */
export function captureCameraPose() {
  const cam = mainViewerCamera.current
  const ctrl = mainViewerControls.current
  if (!cam || !ctrl?.target) return null
  return {
    position: cam.position.toArray(),
    target: ctrl.target.toArray(),
    up: cam.up.toArray(),
    zoom: cam instanceof OrthographicCamera ? cam.zoom : 1
  }
}

/**
 * Wait until the main Threlte camera + TrackballControls are registered.
 * `tick()` alone is not enough — those refs are assigned inside useTask/rAF.
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function waitForMainViewerReady(timeoutMs = 3000) {
  const started = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      const cam = mainViewerCamera.current
      const ctrl = mainViewerControls.current
      if (cam && ctrl?.target) {
        resolve(true)
        return
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false)
        return
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

/**
 * @param {import('./schema.js').AnimationCameraPose} pose
 * @returns {boolean} true if the pose was applied
 */
export function applyCameraPose(pose) {
  const cam = mainViewerCamera.current
  const ctrl = mainViewerControls.current
  if (!cam || !ctrl?.target || !pose) return false

  _target.fromArray(pose.target)
  _eye.fromArray(pose.position)
  _up.fromArray(pose.up)

  ctrl.target.copy(_target)
  cam.position.copy(_eye)
  cam.up.copy(_up)
  cam.lookAt(_target)

  if (cam instanceof OrthographicCamera && typeof pose.zoom === 'number') {
    cam.zoom = pose.zoom
    cam.updateProjectionMatrix()
  }

  if (typeof ctrl.update === 'function') ctrl.update()
  mainViewerInvalidate.fn()
  return true
}

import { Matrix4, OrthographicCamera, Quaternion, Vector3 } from 'three'
import { mainViewerCamera, mainViewerInvalidate } from '../../components/viewer/CameraRig.svelte'
import { mainViewerControls } from '../../components/viewer/Canvas.svelte'

const _eye = new Vector3()
const _target = new Vector3()
const _up = new Vector3()
const _mat = new Matrix4()
const _quat = new Quaternion()
const _startQuat = new Quaternion()
const _endQuat = new Quaternion()

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

/**
 * @param {import('./schema.js').AnimationCameraPose} a
 * @param {import('./schema.js').AnimationCameraPose} b
 * @param {number} t
 * @returns {import('./schema.js').AnimationCameraPose}
 */
export function interpolateCameraPose(a, b, t) {
  const target = [
    a.target[0] + (b.target[0] - a.target[0]) * t,
    a.target[1] + (b.target[1] - a.target[1]) * t,
    a.target[2] + (b.target[2] - a.target[2]) * t
  ]

  const distA = Math.hypot(
    a.position[0] - a.target[0],
    a.position[1] - a.target[1],
    a.position[2] - a.target[2]
  )
  const distB = Math.hypot(
    b.position[0] - b.target[0],
    b.position[1] - b.target[1],
    b.position[2] - b.target[2]
  )
  const dist = distA + (distB - distA) * t

  _target.fromArray(target)
  _startQuat.copy(quaternionFromPose(a))
  _endQuat.copy(quaternionFromPose(b))
  _quat.copy(_startQuat).slerp(_endQuat, t)

  _eye.set(0, 0, 1).applyQuaternion(_quat).multiplyScalar(dist).add(_target)
  const up = [0, 1, 0]
  _up.set(up[0], up[1], up[2]).applyQuaternion(_quat)

  return {
    position: _eye.toArray(),
    target,
    up: _up.toArray(),
    zoom: a.zoom + (b.zoom - a.zoom) * t
  }
}

/**
 * @param {import('./schema.js').AnimationCameraPose} pose
 */
function quaternionFromPose(pose) {
  _target.fromArray(pose.target)
  _eye.fromArray(pose.position)
  _mat.lookAt(_eye, _target, _up.fromArray(pose.up))
  return _quat.setFromRotationMatrix(_mat)
}

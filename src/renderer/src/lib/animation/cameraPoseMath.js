import { Matrix4, Quaternion, Vector3 } from 'three'

const _eye = new Vector3()
const _target = new Vector3()
const _up = new Vector3()
const _mat = new Matrix4()
const _quat = new Quaternion()
const _startQuat = new Quaternion()
const _endQuat = new Quaternion()

/**
 * @param {import('./schema.js').AnimationCameraPose} pose
 */
function quaternionFromPose(pose) {
  _target.fromArray(pose.target)
  _eye.fromArray(pose.position)
  _mat.lookAt(_eye, _target, _up.fromArray(pose.up))
  return _quat.setFromRotationMatrix(_mat)
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

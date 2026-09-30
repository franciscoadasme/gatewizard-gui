import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CLIP,
  atomClipCoordinate,
  fitClipRangeFromAtoms,
  normalizeClip,
  planesFromClip
} from './viewClip.js'

test('normalizeClip defaults and clamps far >= near', () => {
  assert.deepEqual(normalizeClip(null), { ...DEFAULT_CLIP, enabled: false })
  const bad = normalizeClip({ enabled: true, mode: 'world', axis: 'x', near: 10, far: 5 })
  assert.equal(bad.enabled, true)
  assert.equal(bad.mode, 'world')
  assert.equal(bad.axis, 'x')
  assert.equal(bad.near, 10)
  assert.ok(bad.far >= bad.near + 0.01)
})

test('atomClipCoordinate world axes', () => {
  const a = { x: 1, y: 2, z: 3 }
  assert.equal(atomClipCoordinate(a, 'world', 'x', null), 1)
  assert.equal(atomClipCoordinate(a, 'world', 'y', null), 2)
  assert.equal(atomClipCoordinate(a, 'world', 'z', null), 3)
})

test('fitClipRangeFromAtoms world y', () => {
  const atoms = [
    { x: 0, y: -10, z: 0 },
    { x: 0, y: 20, z: 0 }
  ]
  const r = fitClipRangeFromAtoms(atoms, { mode: 'world', axis: 'y' }, null, 2)
  assert.equal(r.near, -12)
  assert.equal(r.far, 22)
})

test('planesFromClip world keeps [near,far]', () => {
  const clip = normalizeClip({ enabled: true, mode: 'world', axis: 'y', near: -5, far: 15 })
  const planes = planesFromClip(clip, null)
  assert.equal(planes.length, 2)
  assert.ok(planes[0].distanceToPoint({ x: 0, y: 0, z: 0 }) >= -1e-6)
  assert.ok(planes[1].distanceToPoint({ x: 0, y: 0, z: 0 }) >= -1e-6)
  // y=-10 below near → outside near plane
  assert.ok(planes[0].distanceToPoint({ x: 0, y: -10, z: 0 }) < 0)
  // y=20 above far → outside far plane
  assert.ok(planes[1].distanceToPoint({ x: 0, y: 20, z: 0 }) < 0)
})

test('planesFromClip disabled returns empty', () => {
  const planes = planesFromClip(normalizeClip({ enabled: false }), null)
  assert.equal(planes.length, 0)
})

test('planesFromClip camera follows look direction', () => {
  const clip = normalizeClip({ enabled: true, mode: 'camera', near: -5, far: 15 })
  /** @type {{ getWorldDirection: (v: import('three').Vector3) => import('three').Vector3, updateMatrixWorld?: () => void }} */
  const cam = {
    getWorldDirection(v) {
      return v.set(0, 1, 0)
    }
  }
  const planes = planesFromClip(clip, /** @type {any} */ (cam))
  assert.equal(planes.length, 2)
  // Along +Y look: y=0 is inside [-5, 15]
  assert.ok(planes[0].distanceToPoint({ x: 0, y: 0, z: 0 }) >= -1e-6)
  assert.ok(planes[1].distanceToPoint({ x: 0, y: 0, z: 0 }) >= -1e-6)
  assert.ok(planes[0].distanceToPoint({ x: 0, y: -10, z: 0 }) < 0)
  assert.ok(planes[1].distanceToPoint({ x: 0, y: 20, z: 0 }) < 0)

  // Mutate look (+X) into the same plane objects — camera slab must update in place.
  cam.getWorldDirection = (v) => v.set(1, 0, 0)
  const again = planesFromClip(clip, /** @type {any} */ (cam), planes)
  assert.equal(again, planes)
  assert.ok(planes[0].distanceToPoint({ x: 0, y: 0, z: 0 }) >= -1e-6)
  assert.ok(planes[0].distanceToPoint({ x: -10, y: 0, z: 0 }) < 0)
  assert.ok(planes[1].distanceToPoint({ x: 20, y: 0, z: 0 }) < 0)
})

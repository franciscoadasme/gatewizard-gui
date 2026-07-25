import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCoordPatch, normalizeProject, ANIMATION_VERSION } from './schema.js'
import { lerpPatches } from '../viewer/workingCoords.js'

test('normalizeCoordPatch in schema', () => {
  assert.ok(normalizeCoordPatch({ indices: [1, 2], xyz: [0, 0, 0, 1, 1, 1] }))
  assert.equal(normalizeCoordPatch({ indices: [1], xyz: [0, 0] }), null)
})

test('keyframe coord patches lerp like animation mid-frames', () => {
  const from = { indices: [0], xyz: [0, 0, 0] }
  const to = { indices: [0], xyz: [10, 0, 0] }
  const mid = lerpPatches(from, to, 0.5)
  assert.ok(Math.abs(mid.xyz[0] - 5) < 1e-9)
})

test('normalizeProject keeps coordPatch and uses current version', () => {
  const project = normalizeProject({
    format: 'gatewizard-animation',
    version: 3,
    name: 't',
    structure: { path: '/tmp/a.pdb' },
    fps: 30,
    duration_s: 2,
    keyframes: [
      {
        id: 'k0',
        time_s: 0,
        camera: {
          position: [0, 0, 1],
          target: [0, 0, 0],
          up: [0, 1, 0],
          zoom: 1
        },
        views: [],
        scene: {},
        coordPatch: { indices: [3], xyz: [1, 2, 3] }
      }
    ]
  })
  assert.equal(project.version, ANIMATION_VERSION)
  assert.deepEqual(project.keyframes[0].coordPatch?.indices, [3])
})

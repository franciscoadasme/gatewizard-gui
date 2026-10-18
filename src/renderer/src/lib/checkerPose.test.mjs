import assert from 'node:assert/strict'
import test from 'node:test'

import { atomsForTickedPoses, bondJoinsOnePose, poseLetterByAtom } from './checkerPose.js'

test('unlabeled overlapping ligand keeps the first copy of each atom name', () => {
  const atoms = [
    { index: 0, name: 'C1', altloc: '' },
    { index: 1, name: 'C1', altloc: '' },
    { index: 2, name: 'C2', altloc: '' },
    { index: 3, name: 'C2', altloc: '' }
  ]
  const group = { inferred: true, mode: 'occurrence' }
  const marks = poseLetterByAtom(atoms, group)
  const poseA = atomsForTickedPoses(atoms, ['A'], marks).map((atom) => atom.index)
  const poseB = atomsForTickedPoses(atoms, ['B'], marks).map((atom) => atom.index)
  assert.deepEqual(poseA, [0, 2])
  assert.deepEqual(poseB, [1, 3])
  assert.equal(bondJoinsOnePose(marks.get(0), marks.get(1)), false)
  assert.equal(bondJoinsOnePose(marks.get(0), marks.get(2)), true)
})

test('a real altLoc letter is used instead of atom order', () => {
  const atoms = [
    { index: 0, name: 'CB', altloc: 'B' },
    { index: 1, name: 'CB', altloc: 'A' }
  ]
  const marks = poseLetterByAtom(atoms, null)
  assert.deepEqual(
    atomsForTickedPoses(atoms, ['A'], marks).map((atom) => atom.index),
    [1]
  )
})

test('two residues in one site follow the copy letter', () => {
  const atoms = [
    { index: 0, name: 'C1', chain_id: 'A', res_id: 1, res_name: 'LIG' },
    { index: 1, name: 'C2', chain_id: 'A', res_id: 1, res_name: 'LIG' },
    { index: 2, name: 'C1', chain_id: 'A', res_id: 2, res_name: 'LIG' },
    { index: 3, name: 'C2', chain_id: 'A', res_id: 2, res_name: 'LIG' }
  ]
  const group = {
    inferred: true,
    mode: 'copies',
    options: [
      { altloc: 'A', chain: 'A', resid: 1, resname: 'LIG' },
      { altloc: 'B', chain: 'A', resid: 2, resname: 'LIG' }
    ]
  }
  const marks = poseLetterByAtom(atoms, group)
  assert.deepEqual(
    atomsForTickedPoses(atoms, ['B'], marks).map((atom) => atom.index),
    [2, 3]
  )
})

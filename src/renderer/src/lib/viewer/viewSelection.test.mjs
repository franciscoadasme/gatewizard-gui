import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bondRepresentationNeedsFetch,
  localSelectionStillNeedsBonds,
  resolveViewAtomSubset,
  shouldDeferFullSystemSelection
} from './viewSelection.js'

test('shouldDeferFullSystemSelection blocks all only on huge trajectories', () => {
  assert.equal(shouldDeferFullSystemSelection(100, 'all', { trajectory: {} }), false)
  assert.equal(shouldDeferFullSystemSelection(100, 'protein and resid 1', { trajectory: {} }), false)
  assert.equal(shouldDeferFullSystemSelection(90_000, 'all', { trajectory: {} }), true)
  assert.equal(shouldDeferFullSystemSelection(90_000, 'all', { trajectory: {} }, 'vdw'), true)
  assert.equal(shouldDeferFullSystemSelection(90_000, 'all', { trajectory: {} }, 'points'), false)
  assert.equal(shouldDeferFullSystemSelection(105_000, 'all', null), false)
})

test('resolveViewAtomSubset does not attach a full huge trajectory as all', () => {
  const atoms = []
  for (let i = 0; i < 80_001; i++) {
    atoms.push({
      index: i,
      x: 0,
      y: 0,
      z: 0,
      res_name: i === 0 ? 'ALA' : 'WAT',
      res_id: i === 0 ? 1 : 2,
      name: i === 0 ? 'CA' : 'O',
      element: i === 0 ? 'C' : 'O'
    })
  }
  const owner = { atoms, bonds: [], residues: [], trajectory: {} }
  assert.deepEqual(resolveViewAtomSubset(owner, 'all').atoms, [])
  assert.equal(resolveViewAtomSubset(owner, 'all', 'points').atoms.length, atoms.length)
  const hit = resolveViewAtomSubset(owner, 'protein and resid 1')
  assert.deepEqual(
    hit.atoms.map((a) => a.index),
    [0]
  )
})

test('bondRepresentationNeedsFetch ignores a single-bond residue inside a protein with aromatic bonds', () => {
  const atoms = [
    { index: 1 },
    { index: 2 },
    { index: 3 },
    { index: 4 }
  ]
  const bonds = [
    [1, 2, 1],
    [2, 3, 1],
    [3, 4, 1],
    [4, 1, 1]
  ]
  const sourceBonds = [...bonds, [90, 91, 2]]
  assert.equal(
    bondRepresentationNeedsFetch({ atoms, bonds, sourceBonds, bondOrderFetchDone: false }),
    false
  )
  assert.equal(
    bondRepresentationNeedsFetch({
      atoms: [],
      bonds: [],
      sourceBonds,
      bondOrderFetchDone: false
    }),
    true
  )
  assert.equal(
    bondRepresentationNeedsFetch({
      atoms,
      bonds,
      sourceBonds: [[1, 2, 2]],
      bondOrderFetchDone: false
    }),
    true
  )
  assert.equal(
    bondRepresentationNeedsFetch({
      atoms,
      bonds: [],
      sourceBonds: [],
      bondOrderFetchDone: false
    }),
    true
  )
})

test('localSelectionStillNeedsBonds when a residue view has atoms but no bonds', () => {
  const atoms = [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }]
  assert.equal(
    localSelectionStillNeedsBonds({
      needsBonds: true,
      atoms,
      bonds: [],
      bondOrderFetchDone: false
    }),
    true
  )
  assert.equal(
    localSelectionStillNeedsBonds({
      needsBonds: true,
      atoms,
      bonds: [
        [1, 2, 1],
        [2, 3, 1],
        [3, 4, 1],
        [4, 1, 1]
      ],
      bondOrderFetchDone: false
    }),
    false
  )
})

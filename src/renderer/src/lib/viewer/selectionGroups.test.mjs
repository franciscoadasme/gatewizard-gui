import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSelectionGroups,
  selectionGroupIndices,
  selectionGroupKey
} from './selectionGroups.js'

test('chain and residue groups are looked up without scanning', () => {
  const atoms = [
    { index: 0, chain_id: 'A', res_id: 1 },
    { index: 1, chain_id: 'A', res_id: 1 },
    { index: 2, chain_id: 'A', res_id: 2 },
    { index: 3, chain_id: 'B', res_id: 1 }
  ]
  const groups = buildSelectionGroups(atoms)
  const chainA = { index: 2, chain_id: 'A', res_id: 2 }
  assert.deepEqual(selectionGroupIndices(groups, chainA, 'chain'), [0, 1, 2])
  assert.deepEqual(selectionGroupIndices(groups, chainA, 'residue'), [2])
  assert.equal(selectionGroupKey(chainA, 'chain'), selectionGroupKey(atoms[0], 'chain'))
  assert.notEqual(selectionGroupKey(chainA, 'chain'), selectionGroupKey(atoms[3], 'chain'))
  assert.equal(selectionGroupKey(null, 'chain'), '')
})

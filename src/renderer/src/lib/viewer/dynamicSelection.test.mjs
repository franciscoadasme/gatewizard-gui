import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateSelectionIndices,
  filterByIndexSet,
  selectionNeedsEachFrame,
  selectionUsesByres,
  trySubsetBySelection
} from './dynamicSelection.js'

function atom(partial) {
  return {
    index: 0,
    x: 0,
    y: 0,
    z: 0,
    name: 'C',
    element: 'C',
    res_name: 'ALA',
    res_id: 1,
    chain_id: 'A',
    ...partial
  }
}

test('selectionNeedsEachFrame detects prop clips', () => {
  assert.equal(selectionNeedsEachFrame('protein'), false)
  assert.equal(selectionNeedsEachFrame('byres ((resname PC OL) and prop y < 0)'), true)
  assert.equal(selectionUsesByres('same residue as (prop y < 0)'), true)
})

test('byres prop y keeps the whole residue', () => {
  const atoms = [
    atom({ index: 0, name: 'P', res_name: 'PC', res_id: 10, y: -2 }),
    atom({ index: 1, name: 'C1', res_name: 'PC', res_id: 10, y: 4 }),
    atom({ index: 2, name: 'P', res_name: 'PC', res_id: 11, y: 3 })
  ]
  const idx = evaluateSelectionIndices(atoms, 'byres ((resname PC) and prop y < 0)')
  assert.ok(idx)
  assert.deepEqual([...idx].sort((a, b) => a - b), [0, 1])
})

test('prop without byres slices the residue', () => {
  const atoms = [
    atom({ index: 0, name: 'P', res_name: 'PC', res_id: 10, y: -2 }),
    atom({ index: 1, name: 'C1', res_name: 'PC', res_id: 10, y: 4 })
  ]
  const idx = evaluateSelectionIndices(atoms, '(resname PC) and prop y < 0')
  assert.ok(idx)
  assert.deepEqual([...idx], [0])
})

test('protein or byres lipid clip', () => {
  const atoms = [
    atom({ index: 0, res_name: 'ALA', res_id: 1, y: 8 }),
    atom({ index: 1, res_name: 'PC', res_id: 20, y: -1 }),
    atom({ index: 2, res_name: 'PC', res_id: 20, y: 5 }),
    atom({ index: 3, res_name: 'PC', res_id: 21, y: 6 })
  ]
  const idx = evaluateSelectionIndices(
    atoms,
    'protein or byres ((resname PC) and prop y < 0)'
  )
  assert.ok(idx)
  assert.deepEqual([...idx].sort((a, b) => a - b), [0, 1, 2])
})

test('packed xyz overrides atom coordinates', () => {
  const atoms = [atom({ index: 0, y: 5, res_name: 'PC', res_id: 1 })]
  const xyz = new Float32Array([0, -3, 0])
  const idx = evaluateSelectionIndices(atoms, 'byres (prop y < 0)', xyz)
  assert.ok(idx)
  assert.deepEqual([...idx], [0])
})

test('unsupported around returns null', () => {
  assert.equal(evaluateSelectionIndices([atom({})], 'around 5 protein'), null)
})

test('trySubsetBySelection filters protein and resid without a backend fetch', () => {
  const atoms = [
    atom({ index: 0, res_name: 'ALA', res_id: 1 }),
    atom({ index: 1, res_name: 'ALA', res_id: 2 }),
    atom({ index: 2, res_name: 'WAT', res_id: 3 })
  ]
  const hit = trySubsetBySelection(atoms, [[0, 1], [1, 2]], [{ atom_indices: [0] }], 'protein and resid 1')
  assert.equal(hit.ok, true)
  if (hit.ok) {
    assert.deepEqual(hit.atoms.map((a) => a.index), [0])
    assert.deepEqual(hit.bonds, [])
    assert.equal(hit.residues.length, 1)
  }
})

test('trySubsetBySelection marks incomplete typing invalid and around as fallback', () => {
  const atoms = [atom({})]
  const incomplete = trySubsetBySelection(atoms, [], [], 'protein and resid')
  assert.equal(incomplete.ok, false)
  if (!incomplete.ok) {
    assert.equal(incomplete.fallback, false)
    assert.equal(incomplete.invalid, true)
  }
  const around = trySubsetBySelection(atoms, [], [], 'around 5 protein')
  assert.equal(around.ok, false)
  if (!around.ok) assert.equal(around.fallback, true)
})

test('filterByIndexSet drops bonds and residues', () => {
  const out = filterByIndexSet(
    [atom({ index: 0 }), atom({ index: 1 }), atom({ index: 2 })],
    [
      [0, 1],
      [1, 2]
    ],
    [{ atom_indices: [0, 1] }, { atom_indices: [2] }],
    new Set([0, 1])
  )
  assert.equal(out.atoms.length, 2)
  assert.deepEqual(out.bonds, [[0, 1]])
  assert.equal(out.residues.length, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { disulfideHighlight } from './disulfideHighlight.js'

/**
 * @param {number} index
 * @param {string} chain
 * @param {number} resId
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {string} [resName]
 */
function atom(index, chain, resId, name, x, y, z, resName = 'CYS') {
  return { index, chain_id: chain, res_id: resId, res_name: resName, name, x, y, z }
}

test('closer sulfur pair is kept when the same residue number is on two chains', () => {
  const atoms = [
    atom(0, 'A', 33, 'CA', 0, 1, 0),
    atom(1, 'A', 33, 'SG', 0, 0, 0),
    atom(2, 'A', 90, 'CA', 2, 1, 0),
    atom(3, 'A', 90, 'SG', 2, 0, 0),
    atom(4, 'B', 33, 'CA', 20, 1, 0),
    atom(5, 'B', 33, 'SG', 20, 0, 0),
    atom(6, 'B', 90, 'CA', 20, 1, 2.2),
    atom(7, 'B', 90, 'SG', 20, 0, 2.2)
  ]
  const bonds = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7]
  ]
  const highlight = disulfideHighlight(atoms, bonds, [[['CYS', 33], ['CYS', 90]]], 2.5)
  assert.deepEqual(
    highlight.atoms.map((item) => item.index),
    [0, 1, 2, 3]
  )
  assert.deepEqual(highlight.bonds, [
    [0, 1],
    [2, 3],
    [1, 3]
  ])
})

test('a pair with no sulfurs inside the distance returns nothing', () => {
  const atoms = [
    atom(0, 'A', 33, 'SG', 0, 0, 0),
    atom(1, 'A', 90, 'SG', 10, 0, 0)
  ]
  const highlight = disulfideHighlight(atoms, [], [[['CYS', 33], ['CYS', 90]]], 2.5)
  assert.deepEqual(highlight, { atoms: [], bonds: [] })
})

test('an empty pair list returns nothing', () => {
  const atoms = [atom(0, 'A', 33, 'SG', 0, 0, 0, 'CYX')]
  const highlight = disulfideHighlight(atoms, [[0, 0]], [], 2.5)
  assert.deepEqual(highlight, { atoms: [], bonds: [] })
})

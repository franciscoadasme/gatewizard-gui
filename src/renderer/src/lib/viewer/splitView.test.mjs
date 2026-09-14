import assert from 'node:assert/strict'
import test from 'node:test'
import { splitViewIntoParts } from './splitView.js'

test('molecule split uses absolute index selection (survives resname rename)', () => {
  const atoms = [
    { index: 0, chain_id: 'X', res_id: 900, res_name: 'UNK', element: 'C', x: 0, y: 0, z: 0 },
    { index: 1, chain_id: 'X', res_id: 900, res_name: 'UNK', element: 'C', x: 1, y: 0, z: 0 },
    { index: 2, chain_id: 'X', res_id: 900, res_name: 'UNK', element: 'C', x: 10, y: 0, z: 0 },
    { index: 3, chain_id: 'X', res_id: 900, res_name: 'UNK', element: 'C', x: 11, y: 0, z: 0 }
  ]
  const bonds = [
    [0, 1],
    [2, 3]
  ]
  const result = splitViewIntoParts(
    {
      selection: 'resname UNK',
      baseSelection: 'resname UNK',
      atoms,
      bonds,
      representation: { type: 'vdw' },
      colorScheme: { name: 'cpk' }
    },
    'molecule'
  )
  assert.ok(!('error' in result))
  assert.equal(result.parts.length, 2)
  for (const part of result.parts) {
    assert.match(part.selection, /^index /)
    assert.equal(/resname/i.test(part.selection), false)
  }
  assert.equal(result.parts[0].selection, 'index 0 1')
  assert.equal(result.parts[1].selection, 'index 2 3')
})

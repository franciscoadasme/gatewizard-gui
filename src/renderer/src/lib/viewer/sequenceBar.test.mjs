import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allResidueKeys,
  applyGapReport,
  buildSequenceChains,
  clickResidueSelection,
  keysInRange,
  parseGapSequence,
  selectionFromKeys
} from './sequenceBar.js'

test('sequence rows keep chains apart and mark numbering holes', () => {
  const atoms = [
    { res_name: 'ALA', res_id: 1, chain_id: 'A' },
    { res_name: 'GLY', res_id: 1, chain_id: 'A' },
    { res_name: 'GLY', res_id: 5, chain_id: 'A' },
    { res_name: 'VAL', res_id: 2, chain_id: 'B' },
    { res_name: 'WAT', res_id: 9, chain_id: 'A' }
  ]
  const rows = buildSequenceChains(atoms)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].chain, 'A')
  assert.deepEqual(
    rows[0].items.map((item) => item.kind === 'gap' ? `gap${item.count}` : item.letter),
    ['A', 'gap3', 'G']
  )
  assert.equal(rows[0].items[1].fillable, true)
  assert.equal(rows[1].items[0].letter, 'V')
})

test('a hole longer than 6 residues is not fillable', () => {
  const atoms = [
    { res_name: 'ALA', res_id: 1, chain_id: 'A' },
    { res_name: 'GLY', res_id: 9, chain_id: 'A' }
  ]
  const gap = buildSequenceChains(atoms)[0].items[1]
  assert.equal(gap.count, 7)
  assert.equal(gap.fillable, false)
})

test('drag and shift-range build a chain selection', () => {
  const chains = buildSequenceChains([
    { res_name: 'ALA', res_id: 1, chain_id: 'A' },
    { res_name: 'GLY', res_id: 2, chain_id: 'A' },
    { res_name: 'VAL', res_id: 3, chain_id: 'A' }
  ])
  const range = keysInRange(chains, 'A|1', 'A|3', new Set(), false)
  assert.deepEqual([...range], ['A|1', 'A|2', 'A|3'])
  const added = keysInRange(chains, 'A|3', 'A|3', range, true)
  assert.equal(added.size, 3)
  assert.equal(allResidueKeys(chains).size, 3)
  assert.match(selectionFromKeys(range), /chainID A and \(resid 1 to 3\)/)
})

test('a short hole without a SEQRES sequence is not marked fillable', () => {
  const chains = buildSequenceChains([
    { res_name: 'ALA', res_id: 1, chain_id: 'A' },
    { res_name: 'GLY', res_id: 4, chain_id: 'A' }
  ])
  assert.equal(chains[0].items[1].fillable, true)
  const marked = applyGapReport(chains, {
    gaps: [
      {
        chain: 'A',
        after_resid: 1,
        before_resid: 4,
        action: 'skip',
        reason: 'no SEQRES sequence for this gap'
      }
    ]
  })
  assert.equal(marked[0].items[1].fillable, false)
  assert.match(marked[0].items[1].reason, /SEQRES/)
})

test('clicking a residue adds it and clicking it again removes only that one', () => {
  const first = clickResidueSelection(new Set(), 'A|1')
  assert.deepEqual([...first], ['A|1'])
  const both = clickResidueSelection(first, 'A|2')
  assert.deepEqual([...both].sort(), ['A|1', 'A|2'])
  const cleared = clickResidueSelection(both, 'A|1')
  assert.deepEqual([...cleared], ['A|2'])
})

test('a gap sequence can be one letter or three-letter names', () => {
  assert.deepEqual(parseGapSequence('MRR', 3).sequence, ['MET', 'ARG', 'ARG'])
  assert.deepEqual(parseGapSequence('GLY ALA VAL', 3).sequence, ['GLY', 'ALA', 'VAL'])
  assert.equal(parseGapSequence('MR', 3).error, 'Need 3 residues')
})

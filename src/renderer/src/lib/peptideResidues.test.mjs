/**
 * @fileoverview Peptide polymer selection helpers for Analysis defaults.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultPeptideExcludeSelection,
  PEPTIDE_CLASS_MARKERS,
  PEPTIDE_EXTRA_RESNAMES,
  isBiopolymerSelection,
  peptideOrProteinSelection
} from './peptideResidues.js'

test('peptideOrProteinSelection includes D-aa and formyl/ETA', () => {
  const sel = peptideOrProteinSelection()
  assert.match(sel, /^protein or resname /)
  for (const name of ['FVA', 'DLE', 'DVA', 'ETA', 'ACE', 'NME']) {
    assert.ok(PEPTIDE_EXTRA_RESNAMES.includes(name), name)
    assert.ok(sel.includes(name), `selection missing ${name}`)
  }
})

test('defaultPeptideExcludeSelection matches polymer selection', () => {
  assert.equal(defaultPeptideExcludeSelection(), peptideOrProteinSelection())
})

test('isBiopolymerSelection covers protein and peptide', () => {
  assert.equal(isBiopolymerSelection('protein'), true)
  assert.equal(isBiopolymerSelection('peptide'), true)
  assert.equal(isBiopolymerSelection('water'), false)
  assert.ok(PEPTIDE_CLASS_MARKERS.includes('FVA'))
  assert.ok(PEPTIDE_CLASS_MARKERS.includes('DLE'))
})

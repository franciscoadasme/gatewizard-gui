import assert from 'node:assert/strict'
import test from 'node:test'
import { builderBlockers, structureNoticeFromReport } from './builderChecks.js'

const clear = {
  includeProtein: true,
  workingFile: 'a.pdb',
  lipidCount: 1,
  needsMembraneSize: false,
  membraneSize: 0,
  addSalt: false,
  saltConcentration: 0,
  forceFieldError: '',
  pendingParameters: false
}

test('structure notice asks to prepare and mentions alternate conformations', () => {
  const text = structureNoticeFromReport({
    summary: { missing_atoms: 2, altlocs: 1 },
    missing_residues: [{ count: 2 }],
    hydrogens: { protein_hydrogen: 10 }
  })
  assert.match(text, /Prepare this file/)
  assert.match(text, /most likely conformation/)
})

test('a long gap or missing hydrogens asks to prepare', () => {
  assert.match(
    structureNoticeFromReport({
      summary: { missing_atoms: 0, altlocs: 0 },
      missing_residues: [{ count: 12 }],
      hydrogens: { protein_hydrogen: 4 }
    }),
    /Prepare this file/
  )
  assert.match(
    structureNoticeFromReport({
      summary: {},
      hydrogens: { protein_hydrogen: 0 }
    }),
    /Prepare this file/
  )
})

test('a prepared file with hydrogens and no altlocs is quiet', () => {
  assert.equal(
    structureNoticeFromReport({
      summary: { missing_atoms: 0, altlocs: 0 },
      missing_residues: [{ count: 3 }],
      hydrogens: { protein_hydrogen: 8 }
    }),
    ''
  )
})

test('generate stays available for a warning-only force field', () => {
  assert.deepEqual(builderBlockers(clear), [])
})

test('missing pdb, lipids, membrane size, salt, and pending parameters block generate', () => {
  assert.deepEqual(
    builderBlockers({
      ...clear,
      workingFile: '',
      lipidCount: 0,
      addSalt: true,
      saltConcentration: 3,
      pendingParameters: true,
      forceFieldError: 'Unknown water model: no-such'
    }),
    [
      'Choose a PDB file.',
      'Add at least one lipid.',
      'Salt concentration must be between 0 and 2 M.',
      'Unknown water model: no-such',
      'Parametrize before generating, or tleap will fail.'
    ]
  )
  assert.deepEqual(
    builderBlockers({
      ...clear,
      includeProtein: false,
      needsMembraneSize: true,
      membraneSize: 0
    }),
    ['Set a membrane XY size.']
  )
})

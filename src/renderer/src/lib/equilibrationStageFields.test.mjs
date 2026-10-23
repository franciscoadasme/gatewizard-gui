import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSidebarControlledStage,
  stageFieldVisibility,
  syncProtocolToSidebarEnsemble
} from './equilibrationStageFields.js'

test('isSidebarControlledStage treats production by kind or name', () => {
  assert.equal(isSidebarControlledStage({ stage_kind: 'Production' }), true)
  assert.equal(isSidebarControlledStage({ name: 'PRODUCTION' }), true)
  assert.equal(isSidebarControlledStage({ stage_kind: 'packing', name: 'Eq3 packing' }), false)
})

test('syncProtocolToSidebarEnsemble does not throw on a default protocol', () => {
  const protocol = {
    stages: [
      { name: 'Minimization', stage_kind: 'minimization', ensemble: 'min' },
      { name: 'Production', stage_kind: 'production', ensemble: 'npt' }
    ]
  }
  assert.equal(syncProtocolToSidebarEnsemble(protocol, 'npat', 'namd'), true)
  assert.equal(protocol.stages[1].ensemble, null)
})

test('NPAT production shows constant area and NPgT shows surface tension', () => {
  for (const eng of ['namd', 'amber', 'gromacs', 'openmm']) {
    const npat = stageFieldVisibility(eng, null, 'npat')
    const npgt = stageFieldVisibility(eng, null, 'npgt')
    assert.equal(npat.surfaceArea, true, eng)
    assert.equal(npat.surfaceTension, false, eng)
    assert.equal(npgt.surfaceArea, false, eng)
    assert.equal(npgt.surfaceTension, true, eng)
  }
  const packing = stageFieldVisibility('namd', 'npgt', 'npat')
  assert.equal(packing.surfaceTension, true)
  assert.equal(packing.surfaceArea, false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSidebarControlledStage,
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

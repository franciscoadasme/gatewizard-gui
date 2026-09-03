import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  stageDurationLabel,
  stageEnsembleLabel,
  stageKindOf,
  stageResourceLabel,
  stageRestraintLabel,
  summarizeProtocolStage
} from './equilibrationProtocolSummary.js'

test('stageKindOf uses stage_kind then name', () => {
  assert.equal(stageKindOf({ stage_kind: 'minimization' }), 'minimization')
  assert.equal(stageKindOf({ name: 'Production' }), 'production')
  assert.equal(stageKindOf({ name: 'Eq3' }), 'equilibration')
})

test('stageDurationLabel formats mini steps and equilibration ns', () => {
  assert.equal(stageDurationLabel({ stage_kind: 'minimization', minimize_steps: 10000 }), '10,000 steps')
  assert.equal(stageDurationLabel({ stage_kind: 'equilibration', time_ns: 0.5 }), '0.5 ns')
  assert.equal(stageDurationLabel({ stage_kind: 'production', time_ns: 50 }), '50 ns')
})

test('stageEnsembleLabel inherits sidebar for production', () => {
  assert.equal(stageEnsembleLabel({ stage_kind: 'production', ensemble: null }, 'nvt'), 'NVT')
  assert.equal(stageEnsembleLabel({ stage_kind: 'equilibration', ensemble: 'npat' }, 'npt'), 'NPAT')
  assert.equal(stageEnsembleLabel({ stage_kind: 'minimization' }, 'npt'), '—')
})

test('stageResourceLabel matches EquilibrationStage chips', () => {
  assert.equal(stageResourceLabel({ stage_kind: 'minimization', cpu_cores: 8 }), 'CPU×8')
  assert.equal(
    stageResourceLabel({ stage_kind: 'equilibration', cpu_cores: 1, use_gpu: true, num_gpus: 2 }),
    'CPU×1 · GPU×2'
  )
  assert.equal(
    stageResourceLabel({ stage_kind: 'equilibration', cpu_cores: 4, use_gpu: false }),
    'CPU×4'
  )
})

test('stageRestraintLabel counts only non-zero force_constant', () => {
  assert.equal(stageRestraintLabel({ constraints: [] }), null)
  assert.equal(
    stageRestraintLabel({
      constraints: [{ name: 'bb', force_constant: 0 }, { name: 'sc', force_constant: 0 }]
    }),
    null
  )
  assert.equal(
    stageRestraintLabel({ constraints: [{ name: 'bb', force_constant: 10 }] }),
    '1 restraint'
  )
  assert.equal(
    stageRestraintLabel({
      constraints: [
        { name: 'a', force_constant: 5 },
        { name: 'b', force_constant: 0 },
        { name: 'c', force_constant: 1 }
      ]
    }),
    '2 restraints'
  )
})

test('summarizeProtocolStage bundles labels', () => {
  const s = summarizeProtocolStage(
    {
      name: 'Eq1',
      stage_kind: 'equilibration',
      time_ns: 0.1,
      ensemble: 'nvt',
      cpu_cores: 1,
      use_gpu: true,
      num_gpus: 1,
      constraints: [
        { name: 'bb', force_constant: 10 },
        { name: 'sc', force_constant: 5 },
        { name: 'off', force_constant: 0 }
      ]
    },
    'npt'
  )
  assert.deepEqual(s, {
    name: 'Eq1',
    durationLabel: '0.1 ns',
    ensembleLabel: 'NVT',
    resourceLabel: 'CPU×1 · GPU×1',
    restraintLabel: '2 restraints'
  })
})

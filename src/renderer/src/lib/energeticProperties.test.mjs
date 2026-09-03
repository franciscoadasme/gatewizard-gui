import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizeEnergeticProperty,
  energeticEnginesToTry,
  inferEnergeticEngineFromLogText,
  remapEnergeticSeries,
  remapPropertyList,
  seriesMatchesProperty,
  setHasEnergeticProperty,
  unionEnergeticProperties
} from './energeticProperties.js'

test('canonicalize maps Amber / GROMACS / NAMD aliases to one display name', () => {
  assert.deepEqual(canonicalizeEnergeticProperty('EPtot'), {
    key: 'potential',
    displayName: 'Potential Energy'
  })
  assert.deepEqual(canonicalizeEnergeticProperty('Etot'), {
    key: 'total',
    displayName: 'Total Energy'
  })
  assert.deepEqual(canonicalizeEnergeticProperty('TEMP'), {
    key: 'temp',
    displayName: 'Temperature'
  })
  assert.deepEqual(canonicalizeEnergeticProperty('Kinetic En.'), {
    key: 'kinetic',
    displayName: 'Kinetic Energy'
  })
  assert.deepEqual(canonicalizeEnergeticProperty('Total Energy', 'total'), {
    key: 'total',
    displayName: 'Total Energy'
  })
  assert.deepEqual(canonicalizeEnergeticProperty('LJ (SR)'), {
    key: 'vdw',
    displayName: 'Van der Waals Energy'
  })
})

test('unmapped engine-only labels keep their native name', () => {
  const custom = canonicalizeEnergeticProperty('1-4 VDW')
  assert.equal(custom.displayName, '1-4 VDW')
  assert.equal(custom.key, '1-4 VDW')
})

test('remapEnergeticSeries writes canonical baseName and keeps nativeName', () => {
  const out = remapEnergeticSeries([
    { baseName: 'TEMP', key: 'TEMP', y: [300] },
    { baseName: 'Etot', key: 'Etot', y: [1] }
  ])
  assert.equal(out[0].baseName, 'Temperature')
  assert.equal(out[0].key, 'temp')
  assert.equal(out[0].nativeName, 'TEMP')
  assert.equal(out[1].baseName, 'Total Energy')
})

test('seriesMatchesProperty matches across native and canonical names', () => {
  const s = { baseName: 'Temperature', key: 'temp', nativeName: 'TEMP' }
  assert.equal(seriesMatchesProperty(s, 'TEMP'), true)
  assert.equal(seriesMatchesProperty(s, 'Temperature'), true)
  assert.equal(seriesMatchesProperty(s, 'temp'), true)
  assert.equal(seriesMatchesProperty(s, 'Pressure'), false)
})

test('unionEnergeticProperties is a canonical union, not an intersection', () => {
  const sets = [
    {
      energeticResult: {
        rawSeries: [
          { baseName: 'Total Energy', key: 'total' },
          { baseName: 'Temperature', key: 'temp' }
        ]
      }
    },
    {
      energeticResult: {
        rawSeries: [
          { baseName: 'Etot', key: 'Etot' },
          { baseName: 'Density', key: 'Density' }
        ]
      }
    }
  ]
  assert.deepEqual(unionEnergeticProperties(sets), [
    'Total Energy',
    'Temperature',
    'Density'
  ])
  assert.equal(setHasEnergeticProperty(sets[1], 'Total Energy'), true)
  assert.equal(setHasEnergeticProperty(sets[0], 'Density'), false)
})

test('remapPropertyList de-duplicates aliases', () => {
  assert.deepEqual(remapPropertyList(['TEMP', 'Temperature', 'PRESS']), [
    'Temperature',
    'Pressure'
  ])
})

test('inferEnergeticEngineFromLogText sniffs common headers', () => {
  assert.equal(inferEnergeticEngineFromLogText('ETITLE: TS BOND\nENERGY: 1'), 'namd')
  assert.equal(inferEnergeticEngineFromLogText('Energies (kJ/mol)\n    Bond'), 'gromacs')
  assert.equal(
    inferEnergeticEngineFromLogText('#"Time (ps)","Potential Energy (kJ/mole)"\n0,1'),
    'openmm'
  )
  assert.equal(
    inferEnergeticEngineFromLogText(' NSTEP = 100  TIME(PS) = 0.2\n EPtot = -1.2'),
    'amber'
  )
})

test('energeticEnginesToTry puts the stored engine first', () => {
  assert.deepEqual(energeticEnginesToTry('amber'), [
    'amber',
    'namd',
    'openmm',
    'gromacs'
  ])
})

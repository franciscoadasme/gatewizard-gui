import assert from 'node:assert/strict'
import test from 'node:test'
import { condaMetaNameMatches } from './conda-meta.js'

test('AmberTools 26.x conda-meta names count as installed', () => {
  assert.equal(
    condaMetaNameMatches('ambertools-26.0-py312h123_0.json', 'ambertools', '26'),
    true
  )
  assert.equal(
    condaMetaNameMatches('ambertools-26.1.0-py312h123_0.json', 'ambertools', '26'),
    true
  )
  assert.equal(condaMetaNameMatches('ambertools-26-py312h123_0.json', 'ambertools', '26'), true)
  assert.equal(condaMetaNameMatches('ambertools-25.6-py312h123_0.json', 'ambertools', '26'), false)
  assert.equal(condaMetaNameMatches('ambertools-260.0-py312h123_0.json', 'ambertools', '26'), false)
  assert.equal(condaMetaNameMatches('ambertools-26.0-py312h123_0.txt', 'ambertools', '26'), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldStartToolsPrune } from './toolsJobPoll.js'

test('Tools prune stays off when the page is hidden', () => {
  assert.equal(shouldStartToolsPrune({ pageActive: false, jobCount: 3 }), false)
  assert.equal(shouldStartToolsPrune({ pageActive: true, jobCount: 0 }), false)
  assert.equal(shouldStartToolsPrune({ pageActive: true, jobCount: 2 }), true)
  assert.equal(shouldStartToolsPrune({ jobCount: 1 }), true)
})

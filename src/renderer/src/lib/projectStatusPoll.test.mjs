import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_STATUS_BACKOFF_MS,
  PROJECT_STATUS_POLL_MS,
  projectStatusPollMs,
  projectStatusTasksEqual
} from './projectStatusPoll.js'

test('projectStatusPollMs pauses on Visualize and backs off when empty', () => {
  assert.equal(projectStatusPollMs({ pageId: 'tools', emptyTasks: false }), PROJECT_STATUS_POLL_MS)
  assert.equal(projectStatusPollMs({ pageId: 'visualize', emptyTasks: false }), 0)
  assert.equal(projectStatusPollMs({ pageId: 'visualize', emptyTasks: true }), 0)
  assert.equal(projectStatusPollMs({ pageId: 'tools', emptyTasks: true }), PROJECT_STATUS_BACKOFF_MS)
})

test('projectStatusTasksEqual is a no-op compare for identical payloads', () => {
  const a = [{ id: 'j1', status: 'running' }]
  const b = [{ id: 'j1', status: 'running' }]
  assert.equal(projectStatusTasksEqual(a, b), true)
  assert.equal(projectStatusTasksEqual(a, [{ id: 'j1', status: 'completed' }]), false)
  assert.equal(projectStatusTasksEqual(undefined, []), true)
})

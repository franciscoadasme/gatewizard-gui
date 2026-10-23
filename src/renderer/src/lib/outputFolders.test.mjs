import assert from 'node:assert/strict'
import test from 'node:test'
import { nextBuildFolderName } from './outputFolders.js'

test('next build folder adds _2, then the next free number', () => {
  assert.equal(nextBuildFolderName('02_build_6rv2'), '02_build_6rv2_2')
  assert.equal(
    nextBuildFolderName('02_build_6rv2', ['02_build_6rv2_2']),
    '02_build_6rv2_3'
  )
  assert.equal(nextBuildFolderName('02_build_6rv2_2'), '02_build_6rv2_3')
  assert.equal(
    nextBuildFolderName('02_build_6rv2_2', ['02_build_6rv2_3', '02_build_6rv2_4']),
    '02_build_6rv2_5'
  )
})

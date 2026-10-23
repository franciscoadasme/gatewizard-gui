import assert from 'node:assert/strict'
import test from 'node:test'
import { isFilesystemRoot, usableWorkingDir } from './workingDir.js'

test('filesystem root is not a working directory', () => {
  assert.equal(usableWorkingDir('/'), '')
  assert.equal(usableWorkingDir('//'), '')
  assert.equal(usableWorkingDir('\\'), '')
  assert.equal(usableWorkingDir('C:\\'), '')
  assert.equal(usableWorkingDir('C:'), '')
  assert.equal(isFilesystemRoot('/home/project'), false)
  assert.equal(usableWorkingDir('/home/project'), '/home/project')
})

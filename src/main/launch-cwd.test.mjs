import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { resolveLaunchCwd } from './launch-cwd.js'

const yes = () => true

test('prefers the launcher pwd over npm INIT_CWD', () => {
  assert.equal(
    resolveLaunchCwd({
      env: { GATEWIZARD_LAUNCH_CWD: '/data/project', INIT_CWD: '/tmp/npm' },
      cwd: '/opt/app',
      execDir: '/opt/app',
      isDirectory: yes
    }),
    path.resolve('/data/project')
  )
})

test('uses the console folder npm recorded when the script cwd is the package root', () => {
  assert.equal(
    resolveLaunchCwd({
      env: { INIT_CWD: '/data/project' },
      cwd: '/src/gatewizard-gui',
      execDir: '/src/gatewizard-gui/node_modules/electron/dist',
      isDirectory: yes
    }),
    path.resolve('/data/project')
  )
})

test('uses the process cwd when it is not the executable folder', () => {
  assert.equal(
    resolveLaunchCwd({
      env: {},
      cwd: '/data/project',
      execDir: '/opt/GateWizard',
      isDirectory: yes
    }),
    path.resolve('/data/project')
  )
})

test('leaves a desktop launch unset when cwd is the executable folder', () => {
  assert.equal(
    resolveLaunchCwd({
      env: {},
      cwd: '/opt/GateWizard',
      execDir: '/opt/GateWizard',
      isDirectory: yes
    }),
    ''
  )
})

test('skips a launch path that is not a directory', () => {
  assert.equal(
    resolveLaunchCwd({
      env: { GATEWIZARD_LAUNCH_CWD: '/missing', INIT_CWD: '/data/project' },
      cwd: '/opt/GateWizard',
      execDir: '/opt/GateWizard',
      isDirectory: (dir) => dir === '/data/project'
    }),
    path.resolve('/data/project')
  )
})

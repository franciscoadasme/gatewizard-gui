import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const postrm = join(dirname(fileURLToPath(import.meta.url)), 'deb-postrm.sh')

/**
 * @param {string} action
 * @param {Record<string, string>} extra
 */
function runPostrm(action, extra) {
  return spawnSync('sh', [postrm, action], {
    encoding: 'utf8',
    env: { ...process.env, ...extra }
  })
}

test('apt remove says the Python environment was kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-postrm-'))
  const config = join(dir, 'gatewizard-gui')
  await mkdir(config)
  const result = runPostrm('remove', {
    GATEWIZARD_DPKG_PURGE: '0',
    GATEWIZARD_PURGE_CONFIG_DIR: config
  })
  assert.equal(result.status, 0)
  assert.match(result.stderr, /Python environment was kept/)
  assert.match(result.stderr, /apt purge gatewizard-gui-linux/)
  assert.match(result.stderr, new RegExp(config.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(existsSync(config), true)
  await rm(dir, { recursive: true, force: true })
})

test('apt purge stays quiet on the remove step, then deletes the environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-postrm-'))
  const config = join(dir, 'gatewizard-gui')
  await mkdir(config)
  const remove = runPostrm('remove', {
    GATEWIZARD_DPKG_PURGE: '1',
    GATEWIZARD_PURGE_CONFIG_DIR: config
  })
  assert.equal(remove.status, 0)
  assert.equal(remove.stderr, '')
  assert.equal(existsSync(config), true)

  const purge = runPostrm('purge', {
    GATEWIZARD_PURGE_CONFIG_DIR: config
  })
  assert.equal(purge.status, 0)
  assert.match(purge.stderr, /Removed the GateWizard Python environment/)
  assert.match(purge.stderr, /System libraries such as ALSA and GTK were kept/)
  assert.doesNotMatch(purge.stderr, /apt purge/)
  assert.equal(existsSync(config), false)
  await rm(dir, { recursive: true, force: true })
})

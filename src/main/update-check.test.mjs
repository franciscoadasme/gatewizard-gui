import assert from 'node:assert/strict'
import { compareSemver, pickNewerManifest } from './update-check.js'

assert.ok(compareSemver('1.0.11', '1.0.13') < 0)
assert.ok(compareSemver('1.0.53', '1.0.49') > 0)

const stale = {
  gui: { latest: '1.0.11' },
  gatewizard: { latest: '1.0.49' }
}
const fresh = {
  gui: { latest: '1.0.13' },
  gatewizard: { latest: '1.0.49' }
}
assert.equal(pickNewerManifest(stale, fresh), fresh)
assert.equal(pickNewerManifest(fresh, stale), fresh)

const apiBump = {
  gui: { latest: '1.0.13' },
  gatewizard: { latest: '1.0.53' }
}
assert.equal(pickNewerManifest(fresh, apiBump), apiBump)

console.log('update-check.test.mjs: ok')

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GLOW_LIGHTS_HARD_MAX,
  clampGlowMaxLights,
  countGlowPool,
  selectGlowLightAtoms
} from './glowLights.js'
import { applyGlowMaterial, clearGlowMaterial } from './glowMaterial.js'
import { MeshStandardMaterial } from 'three'

test('clampGlowMaxLights never exceeds WebGL-safe hard max', () => {
  assert.equal(clampGlowMaxLights(1), 1)
  assert.equal(clampGlowMaxLights(48), GLOW_LIGHTS_HARD_MAX)
  assert.equal(clampGlowMaxLights(999), GLOW_LIGHTS_HARD_MAX)
  assert.equal(clampGlowMaxLights(0), 1)
})

test('countGlowPool / selectGlowLightAtoms respect filters and cap', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', index: 0 },
    { x: 1, y: 0, z: 0, element: 'H', index: 1 },
    { x: 2, y: 0, z: 0, element: 'N', index: 2 },
    { x: 3, y: 0, z: 0, element: 'H', index: 3 }
  ]
  assert.equal(countGlowPool(atoms, 'all'), 4)
  assert.equal(countGlowPool(atoms, 'non_hydrogen'), 2)

  const hi = new Set([1, 3])
  const highlighted = selectGlowLightAtoms(atoms, {
    filter: 'highlighted',
    maxLights: 48,
    highlightIndices: hi
  })
  assert.equal(highlighted.length, 2)

  const many = Array.from({ length: 200 }, (_, i) => ({
    x: i,
    y: 0,
    z: 0,
    element: 'C',
    index: i
  }))
  const capped = selectGlowLightAtoms(many, { filter: 'all', maxLights: 48 })
  assert.equal(capped.length, GLOW_LIGHTS_HARD_MAX)
})

test('applyGlowMaterial / clearGlowMaterial leave material usable', () => {
  const mat = new MeshStandardMaterial({ color: 0xff0000 })
  applyGlowMaterial(mat, 2.5, { useSurfaceColor: true })
  assert.ok(mat.emissiveIntensity > 0)
  assert.equal(typeof mat.onBeforeCompile, 'function')
  clearGlowMaterial(mat)
  assert.equal(mat.emissiveIntensity, 0)
  // Must remain callable (prototype) — assigning undefined used to crash the renderer.
  assert.equal(typeof mat.customProgramCacheKey, 'function')
  assert.equal(typeof mat.onBeforeCompile, 'function')
  assert.doesNotThrow(() => mat.customProgramCacheKey())
  mat.dispose()
})

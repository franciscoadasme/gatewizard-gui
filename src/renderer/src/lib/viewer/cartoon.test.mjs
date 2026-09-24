import assert from 'node:assert/strict'
import test from 'node:test'
import { Color } from 'three'
import {
  buildCartoonGeometries,
  createCartoonSkin,
  updateRibbonSkins
} from './cartoon.js'

function toyProtein() {
  const atoms = []
  const residues = []
  for (let i = 0; i < 6; i++) {
    const ca = { index: i * 2, name: 'CA', x: i * 3.8, y: 0, z: 0, element: 'C' }
    const o = { index: i * 2 + 1, name: 'O', x: i * 3.8, y: 1.2, z: 0, element: 'O' }
    atoms.push(ca, o)
    residues.push({
      chain: 'A',
      number: i + 1,
      ca_index: ca.index,
      sec: 'H',
      atom_indices: [ca.index, o.index]
    })
  }
  return { atoms, residues }
}

const colorFn = () => new Color(0.5, 0.4, 0.8)

test('buildCartoonGeometries still returns BufferGeometry', () => {
  const { atoms, residues } = toyProtein()
  const geoms = buildCartoonGeometries(atoms, residues, colorFn, { quality: 1 })
  assert.ok(geoms.length >= 1)
  assert.ok(geoms[0].getAttribute('position').count > 0)
})

test('updateRibbonSkins moves vertices and keeps the same mesh', () => {
  const { atoms, residues } = toyProtein()
  const skins = createCartoonSkin(atoms, residues, colorFn, { quality: 1 })
  assert.ok(skins.length >= 1)
  const pos = skins[0].geometry.getAttribute('position')
  const before = new Float32Array(pos.array)
  const indexCount = skins[0].geometry.getIndex()?.count ?? 0
  const xyz = new Float32Array(12 * 3)
  for (let i = 0; i < 6; i++) {
    xyz[i * 6] = i * 3.8
    xyz[i * 6 + 1] = 4
    xyz[i * 6 + 2] = 0
    xyz[i * 6 + 3] = i * 3.8
    xyz[i * 6 + 4] = 5.2
    xyz[i * 6 + 5] = 0
  }
  updateRibbonSkins(skins, xyz)
  assert.equal(skins[0].geometry.getIndex()?.count ?? 0, indexCount)
  assert.equal(pos.array.length, before.length)
  let moved = 0
  for (let i = 1; i < pos.array.length; i += 3) {
    if (Math.abs(pos.array[i] - before[i]) > 0.5) moved += 1
  }
  assert.ok(moved > 10, 'ribbon Y should follow the shifted Cα')
})

test('updateRibbonSkins refreshes face-averaged normals with the ribbon', () => {
  const { atoms, residues } = toyProtein()
  const skins = createCartoonSkin(atoms, residues, colorFn, { quality: 1 })
  const nrm = skins[0].geometry.getAttribute('normal')
  assert.ok(nrm)
  const before = new Float32Array(nrm.array)
  const xyz = new Float32Array(12 * 3)
  for (let i = 0; i < 6; i++) {
    xyz[i * 6] = i * 3.8
    xyz[i * 6 + 1] = i * 1.4
    xyz[i * 6 + 2] = 0
    xyz[i * 6 + 3] = i * 3.8
    xyz[i * 6 + 4] = i * 1.4 + 1.2
    xyz[i * 6 + 5] = 0
  }
  updateRibbonSkins(skins, xyz)
  let changed = 0
  for (let i = 0; i < nrm.array.length; i++) {
    if (Math.abs(nrm.array[i] - before[i]) > 1e-4) changed += 1
  }
  assert.ok(changed > 10, 'normals must follow the bent backbone for lighting')
})

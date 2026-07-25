import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAtomPickableInView,
  isBackboneAtomName,
  isViewPickable,
  pickAtomFromViews,
  pickRadiusPx,
  viewRepresentationType
} from './picking.js'

test('isBackboneAtomName covers protein and NA', () => {
  assert.equal(isBackboneAtomName('CA'), true)
  assert.equal(isBackboneAtomName('N'), true)
  assert.equal(isBackboneAtomName('CB'), false)
  assert.equal(isBackboneAtomName("O5'"), true)
  assert.equal(isBackboneAtomName('CG'), false)
})

test('cartoon/tube only pick backbone atoms', () => {
  const cartoon = { visible: true, representation: { type: 'cartoon' } }
  const tube = { visible: true, representation: { type: 'tube' } }
  const vdw = { visible: true, representation: { type: 'vdw' } }
  assert.equal(isAtomPickableInView(cartoon, { name: 'CA' }), true)
  assert.equal(isAtomPickableInView(cartoon, { name: 'CB' }), false)
  assert.equal(isAtomPickableInView(tube, { name: 'O' }), true)
  assert.equal(isAtomPickableInView(tube, { name: 'CG' }), false)
  assert.equal(isAtomPickableInView(vdw, { name: 'CB' }), true)
})

test('hidden or transparent views are not pickable', () => {
  assert.equal(isViewPickable({ visible: false, atoms: [{ x: 0, y: 0, z: 0 }] }), false)
  assert.equal(isViewPickable({ visible: true, opacity: 0, atoms: [{ x: 0, y: 0, z: 0 }] }), false)
  assert.equal(isViewPickable({ visible: true, atoms: [{ x: 0, y: 0, z: 0 }] }), true)
  assert.equal(isViewPickable({ visible: true, atoms: [] }), false)
})

test('viewRepresentationType accepts string or {type}', () => {
  assert.equal(viewRepresentationType({ representation: 'tube' }), 'tube')
  assert.equal(viewRepresentationType({ representation: { type: 'vdw' } }), 'vdw')
  assert.equal(viewRepresentationType({}), 'points')
})

test('pickRadiusPx is smaller for ball-stick/points than full VdW', () => {
  const atom = { element: 'C' }
  const vdw = pickRadiusPx('vdw', atom, 10, 20)
  const bs = pickRadiusPx('ball-stick', atom, 10, 20)
  const pts = pickRadiusPx('points', atom, 10, 20)
  assert.ok(bs < vdw)
  assert.ok(pts < vdw)
})

test('pickAtomFromViews skips cartoon sidechains and hidden water', async () => {
  const { OrthographicCamera } = await import('three')
  const cam = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  cam.position.set(0, 0, 20)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)

  // World (0,0,0) projects near canvas center for this camera.
  const w = 200
  const h = 200
  const cx = 100
  const cy = 100

  const proteinCartoon = {
    visible: true,
    representation: { type: 'cartoon' },
    atoms: [
      { x: 0, y: 0, z: 0, element: 'C', name: 'CA', index: 1 },
      { x: 0.2, y: 0, z: 0, element: 'C', name: 'CB', index: 2 }
    ]
  }
  const waterHidden = {
    visible: false,
    representation: { type: 'vdw' },
    atoms: [{ x: 0, y: 0, z: 0.5, element: 'O', name: 'O', index: 99 }]
  }
  // Toward the camera (cam at +Z) so it sits in front of the cartoon CA.
  const ligandVdw = {
    visible: true,
    representation: { type: 'vdw' },
    atoms: [{ x: 0.05, y: 0, z: 2, element: 'C', name: 'C1', index: 50 }]
  }

  // Cartoon alone: CB must not win over CA even if closer in x to pointer.
  const onlyCartoon = pickAtomFromViews([proteinCartoon], cam, w, h, cx, cy, 30)
  assert.equal(onlyCartoon?.name, 'CA')
  assert.equal(onlyCartoon?.index, 1)

  // Hidden water never picked.
  const withWater = pickAtomFromViews([proteinCartoon, waterHidden], cam, w, h, cx, cy, 30)
  assert.notEqual(withWater?.index, 99)

  // Ligand in front of cartoon backbone should win when atomistic.
  const mixed = pickAtomFromViews([proteinCartoon, ligandVdw], cam, w, h, cx, cy, 30)
  assert.equal(mixed?.index, 50)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  atomsForOverlayRecord,
  remapSavedStructureId,
  residueHintFromLabelText
} from './overlayAtoms.js'

test('residueHintFromLabelText parses LYS73 chips', () => {
  assert.deepEqual(residueHintFromLabelText('LYS73'), { resName: 'LYS', resid: 73 })
  assert.deepEqual(residueHintFromLabelText('A:LYS73'), { resName: 'LYS', resid: 73 })
})

test('legacy labels without structureId attach to the matching residue', () => {
  const structures = [
    {
      id: '9g9v',
      atoms: [
        { index: 1233, x: 1, y: 1, z: 1, res_name: 'VAL', res_id: 76 },
        { index: 5373, x: 2, y: 2, z: 2, res_name: 'ALA', res_id: 74 }
      ]
    },
    {
      id: '6rv2',
      atoms: [
        { index: 1233, x: 10, y: 10, z: 10, res_name: 'LYS', res_id: 73 },
        { index: 5373, x: 20, y: 20, z: 20, res_name: 'LYS', res_id: 73 }
      ]
    }
  ]
  const a = atomsForOverlayRecord(
    { id: 'a', atomIndex: 1233, text: 'LYS73' },
    { structures, fallbackAtoms: structures[0].atoms }
  )
  const b = atomsForOverlayRecord(
    { id: 'b', atomIndex: 5373, text: 'LYS73' },
    { structures, fallbackAtoms: structures[0].atoms }
  )
  assert.equal(a.structureId, '6rv2')
  assert.equal(a.atoms[0].x, 10)
  assert.equal(b.structureId, '6rv2')
  assert.equal(b.atoms.find((atom) => atom.index === 5373)?.x, 20)
})

test('structureId wins over residue-text heuristic', () => {
  const structures = [
    {
      id: '9g9v',
      atoms: [{ index: 1233, x: 1, y: 1, z: 1, res_name: 'VAL', res_id: 76 }]
    },
    {
      id: '6rv2',
      atoms: [{ index: 1233, x: 10, y: 10, z: 10, res_name: 'LYS', res_id: 73 }]
    }
  ]
  const resolved = atomsForOverlayRecord(
    { id: 'a', atomIndex: 1233, text: 'LYS73', structureId: '9g9v' },
    { structures, fallbackAtoms: structures[0].atoms }
  )
  assert.equal(resolved.structureId, '9g9v')
  assert.equal(resolved.atoms[0].x, 1)
})

test('atomsForOverlayRecord keeps a plain atom list for animation', () => {
  const atoms = [{ index: 3, x: 0, y: 0, z: 0 }]
  const resolved = atomsForOverlayRecord({ atomIndex: 3, text: 'ALA1' }, atoms)
  assert.equal(resolved.atoms, atoms)
})

test('9g9v_6rv2_view.json LYS73 chips attach to 6rv2, not 9g9v', () => {
  const structures = [
    {
      id: '0529a0f1-bab6-4e8c-b6e2-83fed51104a1',
      path: '/mnt/d/Dropbox/work/ucm/9g9v_protonated.pdb',
      atoms: [
        { index: 1233, x: 1, y: 1, z: 1, res_name: 'VAL', res_id: 76 },
        { index: 5373, x: 2, y: 2, z: 2, res_name: 'ALA', res_id: 74 }
      ]
    },
    {
      id: '0d185cfb-7c23-455b-8361-084beb1a7117',
      path: '/mnt/d/Dropbox/work/ucm/6rv2_CD_protonated.pdb',
      atoms: [
        { index: 1233, x: 10, y: 10, z: 10, res_name: 'LYS', res_id: 73 },
        { index: 5373, x: 20, y: 20, z: 20, res_name: 'LYS', res_id: 73 }
      ]
    }
  ]
  const source = { structures, fallbackAtoms: structures[0].atoms }
  const a = atomsForOverlayRecord({ id: 'a', atomIndex: 1233, text: 'LYS73' }, source)
  const b = atomsForOverlayRecord({ id: 'b', atomIndex: 5373, text: 'LYS73' }, source)
  assert.equal(a.structureId, '0d185cfb-7c23-455b-8361-084beb1a7117')
  assert.equal(b.structureId, '0d185cfb-7c23-455b-8361-084beb1a7117')
})

test('remapSavedStructureId follows path tail when ids differ', () => {
  const live = [
    { id: 'live-9g9v', path: 'D:/Dropbox/work/ucm/01_preparation_9g9v/9g9v_protonated.pdb' },
    { id: 'live-6rv2', path: 'D:/Dropbox/work/ucm/01_preparation_6rv2_CD/6rv2_CD_protonated.pdb' }
  ]
  const metas = [
    {
      id: 'saved-6rv2',
      path: '/mnt/d/Dropbox/work/ucm/01_preparation_6rv2_CD/6rv2_CD_protonated.pdb'
    }
  ]
  assert.equal(remapSavedStructureId('saved-6rv2', live, metas), 'live-6rv2')
  assert.equal(remapSavedStructureId('live-9g9v', live, metas), 'live-9g9v')
})

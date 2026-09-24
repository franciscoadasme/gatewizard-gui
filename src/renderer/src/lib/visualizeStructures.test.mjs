import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createStructureEntry,
  normalizeStructuresMeta,
  serializeStructuresMeta,
  groupStructureMetasForLoad,
  parseBondRow,
  componentKeyFromSelection,
  componentLabel,
  isCoordinateTrajectoryPath,
  structureFetchPath,
  normalizeTrajAlignment,
  nextDuplicateLabel,
  highlightIndicesForStructure,
  editStructureIdFromPanel
} from './visualizeStructures.js'
import { normalizeViewpoint, VIEWPOINT_FORMAT, VIEWPOINT_VERSION } from './viewpoint.js'
import { normalizeProject, ANIMATION_VERSION } from './animation/schema.js'

test('parseBondRow supports [i,j] and [i,j,order]', () => {
  assert.deepEqual(parseBondRow([1, 2]), { i: 1, j: 2, order: 1 })
  assert.deepEqual(parseBondRow([0, 3, 2]), { i: 0, j: 3, order: 2 })
  assert.deepEqual(parseBondRow([0, 1, 1.5]), { i: 0, j: 1, order: 1 }) // aromatic → single
  assert.equal(parseBondRow([1]), null)
})

test('highlightIndicesForStructure stays on one structure', () => {
  const indices = new Set([0, 1, 2])
  assert.equal(highlightIndicesForStructure('copy-b', 'copy-a', indices).size, 0)
  assert.equal(highlightIndicesForStructure('copy-a', 'copy-a', indices), indices)
  assert.equal(highlightIndicesForStructure(undefined, 'copy-a', indices).size, 0)
})

test('editStructureIdFromPanel follows the selected representation group', () => {
  const viewStructureById = new Map([
    ['v1', 'copy-a'],
    ['v2', 'copy-a'],
    ['v3', 'copy-b']
  ])
  assert.equal(
    editStructureIdFromPanel({
      selectedViewIds: ['v1', 'v2'],
      viewStructureById,
      selectedStructureIds: []
    }),
    'copy-a'
  )
  assert.equal(
    editStructureIdFromPanel({
      selectedViewIds: ['v1', 'v3'],
      viewStructureById,
      selectedStructureIds: []
    }),
    null
  )
  assert.equal(
    editStructureIdFromPanel({
      selectedViewIds: [],
      viewStructureById,
      selectedStructureIds: ['copy-b']
    }),
    'copy-b'
  )
})

test('nextDuplicateLabel stays unique', () => {
  assert.equal(nextDuplicateLabel(['prot.pdb'], 'prot.pdb'), 'prot.pdb copy')
  assert.equal(nextDuplicateLabel(['prot.pdb', 'prot.pdb copy'], 'prot.pdb'), 'prot.pdb copy 2')
  assert.equal(
    nextDuplicateLabel(['prot.pdb', 'prot.pdb copy', 'prot.pdb copy 2'], 'prot.pdb copy'),
    'prot.pdb copy 3'
  )
})

test('createStructureEntry fills defaults', () => {
  const s = createStructureEntry({
    path: '/tmp/a.pdb',
    atoms: [{ index: 0, x: 0, y: 0, z: 0 }],
    kind: 'pdb_model',
    modelIndex: 2,
    label: 'a.pdb · model 3'
  })
  assert.ok(s.id)
  assert.equal(s.kind, 'pdb_model')
  assert.equal(s.modelIndex, 2)
  assert.equal(s.visible, true)
  assert.equal(s.sourcePath, '/tmp/a.pdb')
})

test('normalizeStructuresMeta migrates singular structure and assigns ids', () => {
  const list = normalizeStructuresMeta({ path: '/tmp/one.pdb', topology: null })
  assert.equal(list.length, 1)
  assert.equal(list[0].path, '/tmp/one.pdb')
  assert.ok(list[0].id)
})

test('normalizeViewpoint v1 singular migrates to structures[] and structureId on views', () => {
  const vp = normalizeViewpoint({
    format: VIEWPOINT_FORMAT,
    version: 1,
    name: 'old',
    structure: { path: '/tmp/old.pdb', topology: null },
    camera: {
      position: [0, 0, 10],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1
    },
    views: [
      {
        id: 'v1',
        selection: 'all',
        representation: { type: 'points' },
        visible: true,
        colorScheme: { name: 'cpk' }
      }
    ],
    scene: {},
    viewport: {},
    labels: [],
    measurements: []
  })
  assert.equal(vp.version, 1)
  assert.ok(Array.isArray(vp.structures))
  assert.equal(vp.structures.length, 1)
  assert.equal(vp.views[0].structureId, vp.structures[0].id)
  assert.equal(VIEWPOINT_VERSION, 4)
})

test('normalizeProject v4 migrates structures and structureId; version becomes current', () => {
  const project = normalizeProject({
    format: 'gatewizard-animation',
    version: 4,
    name: 'anim',
    structure: { path: '/tmp/a.pdb' },
    fps: 30,
    duration_s: 2,
    keyframes: [
      {
        id: 'k0',
        time_s: 0,
        camera: {
          position: [0, 0, 1],
          target: [0, 0, 0],
          up: [0, 1, 0],
          zoom: 1
        },
        views: [
          {
            id: 'v1',
            selection: 'protein',
            baseSelection: 'protein',
            representation: { type: 'cartoon' },
            visible: true,
            colorScheme: { name: 'ss' },
            material: {}
          }
        ],
        scene: {},
        coordPatch: { indices: [3], xyz: [1, 2, 3] }
      }
    ]
  })
  assert.equal(project.version, ANIMATION_VERSION)
  assert.equal(ANIMATION_VERSION, 7)
  assert.ok(project.structures?.length >= 1)
  assert.equal(project.keyframes[0].views[0].structureId, project.structures[0].id)
  assert.deepEqual(project.keyframes[0].coordPatch?.indices, [3])
})

test('normalizeProject keeps per-structure coordPatches', () => {
  const sid = 'struct-a'
  const project = normalizeProject({
    format: 'gatewizard-animation',
    version: 5,
    name: 'multi',
    structures: [{ id: sid, path: '/tmp/a.pdb' }],
    structure: { path: '/tmp/a.pdb' },
    fps: 24,
    duration_s: 1,
    keyframes: [
      {
        id: 'k0',
        time_s: 0,
        camera: {
          position: [0, 0, 1],
          target: [0, 0, 0],
          up: [0, 1, 0],
          zoom: 1
        },
        views: [],
        scene: {},
        coordPatches: {
          [sid]: { indices: [1], xyz: [9, 8, 7] }
        }
      }
    ]
  })
  assert.deepEqual(project.keyframes[0].coordPatches?.[sid]?.xyz, [9, 8, 7])
})

test('serializeStructuresMeta prefers durable Maestro sourcePath', () => {
  const s = createStructureEntry({
    path: '/tmp/structure_cache/ct_0001.pdb',
    sourcePath: '/data/ligands.maegz',
    kind: 'maestro_ct',
    ctIndex: 1,
    atoms: [{ index: 0, x: 0, y: 0, z: 0 }],
    label: 'CT 2'
  })
  const meta = serializeStructuresMeta([s])[0]
  assert.equal(meta.path, '/data/ligands.maegz')
  assert.equal(meta.sourcePath, '/data/ligands.maegz')
  assert.equal(meta.ctIndex, 1)
  assert.equal(meta.kind, 'maestro_ct')
})

test('groupStructureMetasForLoad buckets maestro by source', () => {
  const { maestro, singles } = groupStructureMetasForLoad([
    {
      id: 'a',
      path: '/data/ligands.maegz',
      sourcePath: '/data/ligands.maegz',
      kind: 'maestro_ct',
      ctIndex: 0
    },
    {
      id: 'b',
      path: '/data/ligands.maegz',
      sourcePath: '/data/ligands.maegz',
      kind: 'maestro_ct',
      ctIndex: 2
    },
    { id: 'c', path: '/data/one.pdb', kind: 'file' }
  ])
  assert.equal(maestro.get('/data/ligands.maegz')?.length, 2)
  assert.equal(singles.length, 1)
})

test('componentKeyFromSelection buckets common selections', () => {
  assert.equal(componentKeyFromSelection('protein'), 'polymer')
  assert.equal(componentKeyFromSelection('resname TIP3'), 'water')
  assert.equal(componentLabel('lipid'), 'Lipids')
})

test('trajectory meta survives serialize / normalize', () => {
  const s = createStructureEntry({
    path: '/data/run.xtc',
    topologyPath: '/data/top.psf',
    atoms: [{ index: 0, x: 0, y: 0, z: 0 }],
    trajectory: {
      files: [{ path: '/data/run.xtc', stride: 2 }],
      logicalFrame: 12,
      logicalFrameCount: 100,
      rawFrameCounts: [200],
      box: [120.5, 80, 80],
      alignment: { mode: 'align', apply: true, selection: 'backbone', referenceFrame: 0 }
    }
  })
  const meta = serializeStructuresMeta([s])[0]
  assert.equal(meta.trajectory.files[0].stride, 2)
  assert.equal(meta.trajectory.logicalFrame, 12)
  assert.equal(meta.trajectory.box[0], 120.5)
  assert.equal(meta.trajectory.alignment.mode, 'align')
  const [again] = normalizeStructuresMeta(meta)
  assert.equal(again.trajectory.logicalFrameCount, 100)
  assert.deepEqual(again.trajectory.box, [120.5, 80, 80])
  assert.equal(again.trajectory.alignment.apply, true)
})

test('structureFetchPath keeps the DCD so frame-0 coordinates exist', () => {
  assert.equal(isCoordinateTrajectoryPath('run.dcd'), true)
  assert.equal(isCoordinateTrajectoryPath('system.prmtop'), false)
  assert.equal(
    structureFetchPath('/data/run.dcd', '/data/system.prmtop'),
    '/data/run.dcd'
  )
  assert.equal(structureFetchPath('/data/prot.pdb', null), '/data/prot.pdb')
  assert.equal(structureFetchPath('', '/data/system.prmtop'), '/data/system.prmtop')
})

test('normalizeTrajAlignment keeps apply for align and not for rmsd', () => {
  const align = normalizeTrajAlignment({
    mode: 'align',
    apply: true,
    selection: 'backbone',
    referenceFrame: 3
  })
  assert.equal(align.mode, 'align')
  assert.equal(align.apply, true)
  assert.equal(align.selection, 'backbone')
  assert.equal(align.referenceFrame, 3)
  const rmsd = normalizeTrajAlignment({ mode: 'rmsd', selection: 'protein' })
  assert.equal(rmsd.mode, 'rmsd')
  assert.equal(rmsd.apply, false)
  assert.equal(normalizeTrajAlignment({ mode: 'none' }), null)
})

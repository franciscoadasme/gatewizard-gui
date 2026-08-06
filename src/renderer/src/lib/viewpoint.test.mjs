import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeViewpoint, VIEWPOINT_FORMAT, VIEWPOINT_VERSION } from './viewpoint.js'

test('normalizeViewpoint accepts a full session snapshot', () => {
  const vp = normalizeViewpoint({
    format: VIEWPOINT_FORMAT,
    version: VIEWPOINT_VERSION,
    name: '3t4d look',
    structure: { path: '/tmp/3t4d.pdb', topology: '/tmp/3t4d.prmtop' },
    camera: {
      position: [1, 2, 3],
      target: [0, 0, 0],
      up: [0, 0, 1],
      zoom: 1.5,
      framing: { center: [0, 0, 0], extent: 40, framingZoom: 1.5 }
    },
    views: [
      {
        id: 'v1',
        selection: 'protein',
        representation: { type: 'cartoon' },
        visible: true,
        colorScheme: { name: 'ss' },
        material: { preset: 'Glowing', emissiveIntensity: 0.4 }
      }
    ],
    scene: {
      backgroundMode: 'custom',
      customBackgroundHex: '#112233',
      ambientIntensity: 0.8,
      directionalLights: [{ enabled: true, position: [1, 2, 3], intensity: 0.5 }]
    },
    viewport: { axesVisible: false, axesLinesVisible: true },
    labels: [
      {
        id: 'l1',
        atomIndex: 10,
        text: 'CA',
        background: '#1a1a2e',
        backgroundOpacity: 0.5,
        padding: 8,
        radius: 6,
        offsetY: 30,
        liftDir: 'right'
      }
    ],
    measurements: [
      {
        id: 'm1',
        type: 'distance',
        atomIndices: [1, 2],
        background: '#101010',
        backgroundOpacity: 0.6,
        padding: 10,
        radius: 5,
        offsetY: 12,
        liftDir: 'up',
        lineWidth: 2.5
      }
    ]
  })

  assert.equal(vp.format, VIEWPOINT_FORMAT)
  assert.equal(vp.structure.path, '/tmp/3t4d.pdb')
  assert.equal(vp.structure.topology, '/tmp/3t4d.prmtop')
  assert.equal(vp.camera.zoom, 1.5)
  assert.equal(vp.views.length, 1)
  assert.equal(vp.views[0].representation.type, 'cartoon')
  assert.equal(vp.views[0].material?.preset, 'Glowing')
  assert.equal(vp.scene.customBackgroundHex, '#112233')
  assert.equal(vp.viewport.axesVisible, false)
  assert.equal(vp.labels[0].atomIndex, 10)
  assert.equal(vp.labels[0].background, '#1a1a2e')
  assert.equal(vp.labels[0].backgroundOpacity, 0.5)
  assert.equal(vp.labels[0].padding, 8)
  assert.equal(vp.labels[0].radius, 6)
  assert.equal(vp.labels[0].offsetY, 30)
  assert.equal(vp.labels[0].liftDir, 'right')
  assert.equal(vp.measurements[0].type, 'distance')
  assert.equal(vp.measurements[0].background, '#101010')
  assert.equal(vp.measurements[0].backgroundOpacity, 0.6)
  assert.equal(vp.measurements[0].padding, 10)
  assert.equal(vp.measurements[0].radius, 5)
  assert.equal(vp.measurements[0].offsetY, 12)
  assert.equal(vp.measurements[0].liftDir, 'up')
  assert.equal(vp.measurements[0].lineWidth, 2.5)
})

test('normalizeViewpoint rejects animation projects and unknown formats', () => {
  assert.throws(
    () => normalizeViewpoint({ format: 'gatewizard-animation', version: 3 }),
    /Not a GateWizard viewpoint file/
  )
  assert.throws(() => normalizeViewpoint({ format: 'nope' }), /Not a GateWizard viewpoint file/)
})

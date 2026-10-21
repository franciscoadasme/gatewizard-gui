import assert from 'node:assert/strict'
import test from 'node:test'
import {
  interpolateChannelsAtTime,
  migrateKeyframesToChannelTracks
} from './channelTracks.js'
import { viewsApproximatelyEqual } from './keyframeEasing.js'
import { normalizeProject } from './schema.js'
import { animExportFrameTime } from './timelinePlayhead.js'
import { syncProjectViewTracks } from './tracks.js'

function solidView(id, color, extras = {}) {
  return {
    id,
    structureId: 's1',
    selection: 'ion',
    baseSelection: 'ion',
    visible: true,
    opacity: 1,
    representation: { type: 'ball+stick' },
    colorScheme: { name: 'uniform', color },
    material: {},
    ...extras
  }
}

const cam = (zoom) => ({
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  zoom,
  framing: { center: [0, 0, 0], extent: 40, framingZoom: zoom }
})

test('migrateKeyframesToChannelTracks expands shared keyframes into channels', () => {
  const migrated = migrateKeyframesToChannelTracks(
    [
      {
        id: 'k0',
        name: 'A',
        time_s: 0,
        camera: cam(1),
        cameraEasing: 'linear',
        views: [
          {
            id: 'v1',
            structureId: 's1',
            selection: 'protein',
            visible: true,
            opacity: 1
          }
        ],
        scene: {},
        labels: [],
        measurements: [],
        coordPatches: { s1: { indices: [0], xyz: [0, 0, 0] } },
        motionEasings: { s1: { easing: 'linear' } }
      },
      {
        id: 'k1',
        name: 'B',
        time_s: 2,
        camera: cam(2),
        cameraEasing: 'easeInOutCubic',
        views: [
          {
            id: 'v1',
            structureId: 's1',
            selection: 'protein',
            visible: true,
            opacity: 1
          }
        ],
        scene: {},
        labels: [],
        measurements: [],
        coordPatches: { s1: { indices: [0], xyz: [10, 0, 0] } },
        motionEasings: { s1: { easing: 'linear' } }
      }
    ],
    's1'
  )

  assert.equal(migrated.cameraTrack.keys.length, 2)
  assert.equal(migrated.structureTracks.s1.keys.length, 2)
  assert.equal(migrated.viewKeyTracks.v1.keys.length, 2)
  assert.equal(migrated.cameraTrack.keys[0].time_s, 0)
  assert.equal(migrated.structureTracks.s1.keys[1].coordPatch.xyz[0], 10)
})

test('normalizeProject migrates legacy keyframes into channel tracks', () => {
  const project = normalizeProject({
    format: 'gatewizard-animation',
    version: 7,
    duration_s: 4,
    fps: 30,
    keyframes: [
      {
        id: 'a',
        time_s: 0,
        camera: cam(1),
        views: [{ id: 'v1', structureId: 's1', selection: 'all', visible: true }],
        scene: {},
        labels: [],
        measurements: [],
        coordPatches: { s1: { indices: [0], xyz: [0, 0, 0] } }
      },
      {
        id: 'b',
        time_s: 1,
        camera: cam(2),
        views: [{ id: 'v1', structureId: 's1', selection: 'all', visible: true }],
        scene: {},
        labels: [],
        measurements: [],
        coordPatches: { s1: { indices: [0], xyz: [4, 0, 0] } }
      }
    ],
    structures: [{ id: 's1', label: 'Mol' }]
  })

  assert.ok(project.cameraTrack.keys.length >= 2)
  assert.ok(project.structureTracks.s1?.keys?.length >= 2)
  assert.ok(project.viewKeyTracks.v1?.keys?.length >= 2)
})

test('camera and structure keys at different times animate independently', () => {
  const project = {
    cameraTrack: {
      keys: [
        {
          id: 'c0',
          time_s: 0,
          camera: cam(1),
          cameraEasing: 'linear'
        },
        {
          id: 'c1',
          time_s: 2,
          camera: cam(3),
          cameraEasing: 'linear'
        }
      ]
    },
    structureTracks: {
      s1: {
        keys: [
          {
            id: 'm0',
            time_s: 1,
            coordPatch: { indices: [0], xyz: [0, 0, 0] },
            motionEasing: 'linear'
          },
          {
            id: 'm1',
            time_s: 3,
            coordPatch: { indices: [0], xyz: [10, 0, 0] },
            motionEasing: 'linear'
          }
        ]
      }
    },
    viewKeyTracks: {},
    viewTracks: []
  }

  const at0 = interpolateChannelsAtTime(project, 0, null, 's1')
  assert.ok(at0)
  assert.equal(at0.camera.zoom, 1)
  assert.equal(at0.coordPatches?.s1, undefined)

  const at1 = interpolateChannelsAtTime(project, 1, null, 's1')
  assert.ok(at1)
  assert.ok(Math.abs(at1.camera.zoom - 2) < 1e-6, `camera mid at t=1, zoom=${at1.camera.zoom}`)
  assert.ok(at1.coordPatches?.s1)
  assert.ok(Math.abs(at1.coordPatches.s1.xyz[0]) < 1e-6)

  const at2 = interpolateChannelsAtTime(project, 2, null, 's1')
  assert.ok(at2)
  assert.equal(at2.camera.zoom, 3)
  assert.ok(Math.abs(at2.coordPatches.s1.xyz[0] - 5) < 1e-6)

  const at3 = interpolateChannelsAtTime(project, 3, null, 's1')
  assert.ok(at3)
  assert.equal(at3.camera.zoom, 3)
  assert.ok(Math.abs(at3.coordPatches.s1.xyz[0] - 10) < 1e-6)
})

test('channel playback blends background, lights, fog, and shadows with the camera easing', () => {
  const pose = cam(1)
  const project = {
    cameraTrack: {
      keys: [
        {
          id: 'c0',
          time_s: 0,
          camera: pose,
          cameraEasing: 'linear',
          scene: {
            backgroundMode: 'custom',
            customBackgroundHex: '#000000',
            ambientIntensity: 0,
            hemisphereIntensity: 0,
            fog: { enabled: true, near: 70, far: 200, color: '#000000', matchBackground: false },
            shadows: { enabled: true, strength: 0, softness: 0.45 }
          }
        },
        {
          id: 'c1',
          time_s: 2,
          camera: pose,
          cameraEasing: 'linear',
          scene: {
            backgroundMode: 'custom',
            customBackgroundHex: '#ffffff',
            ambientIntensity: 2,
            hemisphereIntensity: 2,
            fog: { enabled: true, near: 140, far: 200, color: '#ffffff', matchBackground: false },
            shadows: { enabled: true, strength: 1, softness: 0.45 }
          }
        }
      ]
    },
    structureTracks: {},
    viewKeyTracks: {},
    viewTracks: []
  }
  const mid = interpolateChannelsAtTime(project, 1, null, 's1')
  assert.ok(mid)
  assert.equal(mid.scene.customBackgroundHex, '#808080')
  assert.ok(Math.abs(mid.scene.ambientIntensity - 1) < 1e-6)
  assert.ok(Math.abs(mid.scene.hemisphereIntensity - 1) < 1e-6)
  assert.ok(Math.abs(mid.scene.fog.near - 105) < 1e-6)
  assert.ok(Math.abs(mid.scene.shadows.strength - 0.5) < 1e-6)
})

test('export frame clock stays i/fps for channel projects', () => {
  assert.equal(animExportFrameTime(0, 30, 10), 0)
  assert.equal(animExportFrameTime(15, 30, 10), 0.5)
  assert.equal(animExportFrameTime(30, 30, 10), 1)
  assert.equal(animExportFrameTime(999, 30, 2), 2)
})

test('syncProjectViewTracks keeps channel viewKeyTracks ids when keyframes empty', () => {
  const project = {
    keyframes: [],
    viewTracks: ['ion'],
    viewKeyTracks: {
      ion: {
        keys: [
          { id: 'a', time_s: 0, view: solidView('ion', '#ff0000'), styleEasing: 'linear' },
          { id: 'b', time_s: 2, view: solidView('ion', '#0000ff'), styleEasing: 'linear' }
        ]
      }
    }
  }
  syncProjectViewTracks(project)
  assert.deepEqual(project.viewTracks, ['ion'])

  const mid = interpolateChannelsAtTime({ ...project, viewTracks: [] }, 1, null, 's1')
  assert.ok(mid)
  assert.equal(mid.views.length, 1)
  assert.ok(mid.views[0].colorScheme?.color)
  assert.notEqual(mid.views[0].colorScheme.color, '#ff0000')
  assert.notEqual(mid.views[0].colorScheme.color, '#0000ff')
})

test('representation style keys lerp color independently of structure motion', () => {
  const project = {
    viewTracks: ['ion'],
    cameraTrack: { keys: [{ id: 'c0', time_s: 0, camera: cam(1), cameraEasing: 'linear' }] },
    structureTracks: {
      s1: {
        keys: [
          {
            id: 'm0',
            time_s: 0,
            coordPatch: { indices: [0], xyz: [0, 0, 0] },
            motionEasing: 'linear'
          },
          {
            id: 'm1',
            time_s: 1,
            coordPatch: { indices: [0], xyz: [10, 0, 0] },
            motionEasing: 'linear'
          }
        ]
      }
    },
    viewKeyTracks: {
      ion: {
        keys: [
          {
            id: 'v0',
            time_s: 2,
            view: solidView('ion', '#000000'),
            styleEasing: 'linear'
          },
          {
            id: 'v1',
            time_s: 4,
            view: solidView('ion', '#ffffff'),
            styleEasing: 'linear'
          }
        ]
      }
    }
  }

  const at05 = interpolateChannelsAtTime(project, 0.5, null, 's1')
  assert.ok(at05.coordPatches?.s1)
  assert.ok(Math.abs(at05.coordPatches.s1.xyz[0] - 5) < 1e-6)
  assert.equal(at05.views.length, 0, 'style keys have not started yet')

  const at3 = interpolateChannelsAtTime(project, 3, null, 's1')
  assert.ok(at3.views.length === 1)
  assert.equal(at3.coordPatches?.s1?.xyz[0], 10)
  // Mid gray between black and white with linear style easing
  const hex = String(at3.views[0].colorScheme.color).toLowerCase()
  assert.match(hex, /^#[0-9a-f]{6}$/)
  const r = parseInt(hex.slice(1, 3), 16)
  assert.ok(r > 80 && r < 180, `expected mid gray red channel, got ${hex}`)
})

test('viewsApproximatelyEqual detects color-only style changes', () => {
  const a = solidView('ion', '#ff0000')
  const b = solidView('ion', '#00ff00')
  assert.equal(viewsApproximatelyEqual(a, a), true)
  assert.equal(viewsApproximatelyEqual(a, b), false)
  assert.equal(viewsApproximatelyEqual(a, { ...a, opacity: 0.5 }), false)
})

test('style easing lerps constant colorScheme, bondColor, and material.color', async () => {
  const { interpolateView } = await import('./interpolate.js')
  const a = {
    id: 'ion',
    selection: 'ion',
    baseSelection: 'ion',
    representation: { type: 'ball-stick' },
    visible: true,
    opacity: 1,
    colorScheme: { name: 'constant', color: '#ff0000' },
    material: { preset: 'Default', color: '#ff0000', metalness: 0, roughness: 0.5, emissiveIntensity: 0 },
    bondColor: '#ff0000',
    ssColors: null
  }
  const b = {
    ...a,
    colorScheme: { name: 'constant', color: '#0000ff' },
    material: { preset: 'Default', color: '#0000ff', metalness: 0, roughness: 0.5, emissiveIntensity: 0 },
    bondColor: '#0000ff'
  }
  const mid = interpolateView(a, b, 0.5)
  assert.equal(mid.colorScheme.color, '#800080')
  assert.equal(mid.bondColor, '#800080')
  assert.equal(mid.material.color, '#800080')
})

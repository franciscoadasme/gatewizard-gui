import assert from 'node:assert/strict'
import test from 'node:test'
import { channelClock } from './channelClock.js'
import { interpolateAtTime, interpolateScene, interpolateView, representationDrawLayers } from './interpolate.js'
import { blendSchemeResolvers, constantScheme, cpkScheme } from '../colorSchemes.js'
import { installSchemeBlend } from './colorBlend.js'
import {
  curvesForCapturedKeyframe,
  stampViewsForMovedStructure,
  structureIdsWithMotion
} from './keyframeEasing.js'
import { normalizeProject } from './schema.js'
import { animExportFrameTime } from './timelinePlayhead.js'
import { writeViewFadeOnKeyframe } from './viewFadeKeyframe.js'

const cam = (zoom) => ({
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  zoom,
  framing: { center: [0, 0, 0], extent: 40, framingZoom: zoom }
})

function keyframe(id, time_s, extra) {
  return {
    id,
    name: id,
    time_s,
    camera: cam(time_s === 0 ? 1 : 2),
    views: [],
    scene: {},
    labels: [],
    measurements: [],
    ...extra
  }
}

test('camera easeIn and structure motion linear share one segment clock', () => {
  const { cameraT, motionT } = channelClock(
    0.5,
    {
      cameraEasing: 'easeIn',
      motionEasings: { s1: { easing: 'linear' } }
    },
    's1'
  )
  assert.equal(motionT, 0.5)
  assert.ok(cameraT < 0.5, `ease-in should still be behind the midpoint, got ${cameraT}`)

  const from = keyframe('a', 0, {
    coordPatches: { s1: { indices: [0], xyz: [0, 0, 0] } },
    cameraEasing: 'linear',
    motionEasings: { s1: { easing: 'linear' } }
  })
  const to = keyframe('b', 2, {
    coordPatches: { s1: { indices: [0], xyz: [10, 0, 0] } },
    cameraEasing: 'easeIn',
    motionEasings: { s1: { easing: 'linear' } }
  })
  const mid = interpolateAtTime([from, to], 1, [], null, 's1')
  assert.ok(mid)
  assert.ok(Math.abs(mid.coordPatches.s1.xyz[0] - 5) < 1e-6)
  assert.ok(mid.camera.zoom < 1.5, `camera should follow ease-in, got zoom ${mid.camera.zoom}`)
})

test('capture stores linear motion for one structure without rewriting another', () => {
  const curves = curvesForCapturedKeyframe({
    cameraChanged: false,
    atomsChanged: false,
    trajChanged: true,
    structureId: 'sA',
    existing: null,
    prev: {
      cameraEasing: 'easeIn',
      motionEasings: {
        sA: { easing: 'easeOut' },
        sB: { easing: 'easeInOut' }
      }
    }
  })
  assert.equal(curves.cameraEasing, 'easeIn')
  assert.equal(curves.motionEasings.sA.easing, 'linear')
  assert.equal(curves.motionEasings.sB.easing, 'easeInOut')
})

test('stampViewsForMovedStructure adds every representation of that structure', () => {
  const kf = keyframe('k', 1, { views: [] })
  stampViewsForMovedStructure(
    kf,
    's1',
    [
      { id: 'v1', structureId: 's1', visible: true },
      { id: 'v2', structureId: 's1', visible: true },
      { id: 'v3', structureId: 's2', visible: true }
    ],
    null
  )
  assert.equal(kf.views.length, 2)
  assert.deepEqual(
    kf.views.map((v) => v.id).sort(),
    ['v1', 'v2']
  )
})

test('writeViewFadeOnKeyframe updates fadeInEasing on the destination keyframe', () => {
  const keys = [
    keyframe('a', 0, {
      views: [{ id: 'ion', structureId: 's1', visible: false, fadeInEasing: 'linear' }]
    }),
    keyframe('b', 2, {
      views: [{ id: 'ion', structureId: 's1', visible: true, fadeInEasing: 'linear' }]
    })
  ]
  assert.ok(
    writeViewFadeOnKeyframe(keys, 'b', 'ion', {
      fadeEnabled: true,
      fadeIn_s: 0.5,
      fadeOut_s: 0.35,
      fadeInEasing: 'easeIn',
      fadeOutEasing: 'easeOut'
    })
  )
  assert.equal(keys[1].views[0].fadeInEasing, 'easeIn')
  assert.equal(keys[0].views[0].fadeInEasing, 'linear')
})

test('normalizeProject migrates legacy motionEasing onto primary structure', () => {
  const project = normalizeProject({
    format: 'gatewizard-animation',
    version: 7,
    name: 't',
    structure: { path: '/tmp/a.pdb' },
    structures: [{ id: 'p1', path: '/tmp/a.pdb', label: 'a.pdb' }],
    fps: 30,
    duration_s: 2,
    keyframes: [
      {
        id: 'k0',
        time_s: 0,
        camera: cam(1),
        views: [],
        scene: {},
        coordPatch: { indices: [0], xyz: [1, 2, 3] },
        motionEasing: 'linear'
      }
    ]
  })
  assert.ok(project.keyframes[0].coordPatches?.p1)
  assert.equal(project.keyframes[0].motionEasings?.p1?.easing, 'linear')
  assert.deepEqual(structureIdsWithMotion(project.keyframes, 'p1'), ['p1'])
})

function styleView(over = {}) {
  return {
    id: 'ion',
    structureId: 's1',
    selection: 'ion',
    baseSelection: 'ion',
    visible: true,
    opacity: 1,
    representation: { type: 'vdw' },
    colorScheme: { name: 'cpk' },
    material: { preset: 'Default' },
    ...over
  }
}

test('CPK to uniform blends each atom instead of snapping the scheme', () => {
  const carbon = { element: 'C' }
  const from = cpkScheme()(carbon)
  const to = constantScheme('#0000ff')(carbon)
  const blended = blendSchemeResolvers(cpkScheme(), constantScheme('#0000ff'), 0.5)(carbon)
  assert.ok(Math.abs(blended.r - (from.r + to.r) / 2) < 1e-4)
  assert.ok(Math.abs(blended.g - (from.g + to.g) / 2) < 1e-4)
  assert.ok(Math.abs(blended.b - (from.b + to.b) / 2) < 1e-4)

  const mid = interpolateView(
    styleView({ colorScheme: { name: 'cpk' } }),
    styleView({ colorScheme: { name: 'constant', color: '#0000ff' } }),
    0.5
  )
  assert.equal(mid.colorBlend.t, 0.5)
  assert.equal(mid.colorBlend.from.name, 'cpk')
  assert.equal(mid.colorBlend.to.color, '#0000ff')

  const live = { id: 'ion', residues: [], colorScheme: { name: 'cpk', resolver: cpkScheme() } }
  installSchemeBlend(live, mid.colorBlend)
  const painted = live.colorScheme.resolver(carbon)
  assert.ok(Math.abs(painted.r - (from.r + to.r) / 2) < 1e-4)
  assert.ok(Math.abs(painted.b - (from.b + to.b) / 2) < 1e-4)
  assert.match(String(live._colorSchemeSig), /:0\.5000$/)
})

test('material sliders lerp from preset defaults and shader family steps at the destination', () => {
  const shiny = interpolateView(
    styleView({ material: { preset: 'Default' } }),
    styleView({ material: { preset: 'Shiny' } }),
    0.5
  )
  assert.ok(Math.abs(shiny.material.metalness - (0.08 + 0.1) / 2) < 1e-6)
  assert.ok(Math.abs(shiny.material.roughness - (0.48 + 0.1) / 2) < 1e-6)
  assert.equal(shiny.material.preset, 'Shiny')

  const goodsellMid = interpolateView(
    styleView({ material: { preset: 'Default' } }),
    styleView({ material: { preset: 'Goodsell' } }),
    0.5
  )
  assert.equal(goodsellMid.material.preset, 'Default')
  assert.ok(Math.abs(goodsellMid.material.roughness - (0.48 + 1) / 2) < 1e-6)
  assert.ok(Math.abs(goodsellMid.material.outlineWidth - 0.06) < 1e-6)
  const goodsellEnd = interpolateView(
    styleView({ material: { preset: 'Default' } }),
    styleView({ material: { preset: 'Goodsell' } }),
    1
  )
  assert.equal(goodsellEnd.material.preset, 'Goodsell')
  assert.equal(goodsellEnd.material.outlineWidth, 0.12)
})

test('representation type changes crossfade opacity instead of morphing one mesh', () => {
  const mid = interpolateView(
    styleView({ representation: { type: 'vdw' }, opacity: 0.8 }),
    styleView({ representation: { type: 'ball-stick' }, opacity: 0.8 }),
    0.5
  )
  const layers = representationDrawLayers(mid)
  assert.deepEqual(
    layers.map((layer) => layer.type),
    ['vdw', 'ball-stick']
  )
  assert.ok(Math.abs(layers[0].opacity - 0.4) < 1e-6)
  assert.ok(Math.abs(layers[1].opacity - 0.4) < 1e-6)
  const done = representationDrawLayers(
    interpolateView(
      styleView({ representation: { type: 'vdw' } }),
      styleView({ representation: { type: 'licorice' } }),
      1
    )
  )
  assert.equal(done.length, 1)
  assert.equal(done[0].type, 'licorice')
})

test('depth cueing fades in by stretching the far distance', () => {
  const off = { enabled: false, near: 70, far: 140, color: '#000000', matchBackground: true }
  const on = { enabled: true, near: 70, far: 140, color: '#ffffff', matchBackground: true }
  const start = interpolateScene({ fog: off }, { fog: on }, 0)
  const mid = interpolateScene({ fog: off }, { fog: on }, 0.5)
  const end = interpolateScene({ fog: off }, { fog: on }, 1)
  assert.equal(start.fog.enabled, false)
  assert.equal(mid.fog.enabled, true)
  assert.equal(mid.fog.near, 70)
  assert.ok(Math.abs(mid.fog.far - 210) < 1e-6)
  assert.equal(end.fog.enabled, true)
  assert.ok(Math.abs(end.fog.far - 140) < 1e-6)
  const fadeOut = interpolateScene({ fog: on }, { fog: off }, 0.5)
  assert.equal(fadeOut.fog.enabled, true)
  assert.ok(Math.abs(fadeOut.fog.near - 70) < 1e-6)
  assert.ok(Math.abs(fadeOut.fog.far - 210) < 1e-6)
})

test('export frame time stays index over fps', () => {
  assert.equal(animExportFrameTime(0, 30, 10), 0)
  assert.equal(animExportFrameTime(15, 30, 10), 0.5)
  assert.equal(animExportFrameTime(999, 30, 2), 2)
})

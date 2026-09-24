import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Color } from 'three'
import {
  beginExportRendererSize,
  beginTransparentCapture,
  endExportRendererSize,
  endTransparentCapture,
  isExportCaptureActive
} from './exportCapture.js'

function mockRenderer(clearHex = 0x112233, clearAlpha = 1) {
  let pixelRatio = 2
  let sizeW = 400
  let sizeH = 300
  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 400,
    clientHeight: 300,
    style: { width: '400px', height: '300px' }
  }
  const clear = new Color(clearHex)
  let alpha = clearAlpha
  return {
    domElement: canvas,
    getClearColor(target) {
      return target.copy(clear)
    },
    getClearAlpha() {
      return alpha
    },
    setClearColor(color, nextAlpha) {
      clear.set(color)
      alpha = nextAlpha
    },
    getPixelRatio() {
      return pixelRatio
    },
    setPixelRatio(v) {
      pixelRatio = v
    },
    setSize(w, h, _updateStyle) {
      sizeW = w
      sizeH = h
      canvas.width = Math.round(w * pixelRatio)
      canvas.height = Math.round(h * pixelRatio)
    },
    _size() {
      return { w: sizeW, h: sizeH, pixelRatio, alpha, hex: clear.getHex() }
    }
  }
}

test('transparent capture clears alpha and restores the previous clear', () => {
  assert.equal(isExportCaptureActive(), false)
  const scene = { background: new Color(0xff0000) }
  const renderer = mockRenderer(0x00ff00, 1)
  const handle = beginTransparentCapture({ scene, renderer })
  assert.equal(isExportCaptureActive(), true)
  assert.equal(scene.background, null)
  assert.equal(renderer._size().alpha, 0)
  endTransparentCapture(handle)
  assert.equal(isExportCaptureActive(), false)
  assert.ok(scene.background instanceof Color)
  assert.equal(scene.background.getHex(), 0xff0000)
  assert.equal(renderer._size().alpha, 1)
  assert.equal(renderer._size().hex, 0x00ff00)
})

test('endTransparentCapture with no handle still clears the flag', () => {
  const scene = { background: null }
  const renderer = mockRenderer()
  beginTransparentCapture({ scene, renderer })
  endTransparentCapture(null)
  assert.equal(isExportCaptureActive(), false)
})

test('export renderer size restores pixel ratio and ortho frustum', () => {
  const renderer = mockRenderer()
  const camera = {
    isOrthographicCamera: true,
    left: -8,
    right: 8,
    top: 6,
    bottom: -6,
    updateProjectionMatrix() {}
  }
  const handle = beginExportRendererSize({ renderer, camera, width: 1920, height: 1080 })
  assert.ok(handle)
  assert.equal(renderer.getPixelRatio(), 1)
  assert.equal(camera.right - camera.left > 0, true)
  endExportRendererSize(handle)
  assert.equal(renderer.getPixelRatio(), 2)
  assert.equal(camera.left, -8)
  assert.equal(camera.right, 8)
  assert.equal(camera.top, 6)
  assert.equal(camera.bottom, -6)
})

test('export renderer size can keep the current ortho frustum', () => {
  const renderer = mockRenderer()
  const camera = {
    isOrthographicCamera: true,
    left: -8,
    right: 8,
    top: 6,
    bottom: -6,
    updateProjectionMatrix() {}
  }
  const handle = beginExportRendererSize({
    renderer,
    camera,
    width: 1920,
    height: 1080,
    adjustFrustum: false
  })
  assert.ok(handle)
  assert.equal(camera.left, -8)
  assert.equal(camera.right, 8)
  endExportRendererSize(handle)
})

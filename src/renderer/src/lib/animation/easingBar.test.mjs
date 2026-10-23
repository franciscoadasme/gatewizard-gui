import assert from 'node:assert/strict'
import test from 'node:test'
import { easingBarClass } from './easing.js'

test('each easing kind has its own bar color', () => {
  const kinds = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeInOutCubic', 'bezier']
  const classes = kinds.map((kind) => easingBarClass(kind))
  assert.equal(new Set(classes).size, kinds.length)
  assert.match(easingBarClass('linear', true), /ring-/)
  assert.match(easingBarClass('easeIn', true), /sky/)
})

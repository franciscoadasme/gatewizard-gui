import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampNumber, formatRangeValue, setRangeValue } from './rangeInput.js'

test('clampNumber snaps to step', () => {
  assert.equal(clampNumber(0.53, 0, 1, 0.1), 0.5)
  assert.equal(clampNumber(-1, 0, 1, 0.01), 0)
  assert.equal(clampNumber(9, 0, 1, 0.01), 1)
})

test('formatRangeValue respects decimals', () => {
  assert.equal(formatRangeValue(1.2345, 2), '1.23')
})

test('setRangeValue blocks wheel and tracks primary drag only', () => {
  /** @type {Record<string, Set<Function>>} */
  const listeners = {}
  /** @type {{ value: string, __gwRangeDragging?: boolean, addEventListener: Function, removeEventListener: Function }} */
  const node = {
    value: '0',
    addEventListener(type, fn, _opts) {
      if (!listeners[type]) listeners[type] = new Set()
      listeners[type].add(fn)
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn)
    }
  }
  const action = setRangeValue(/** @type {any} */ (node), 0.2)
  assert.equal(node.value, '0.2')

  const wheel = [...(listeners.wheel ?? [])][0]
  assert.ok(wheel)
  let prevented = false
  wheel({
    preventDefault() {
      prevented = true
    },
    stopPropagation() {}
  })
  assert.equal(prevented, true)

  const down = [...(listeners.pointerdown ?? [])][0]
  assert.ok(down)
  down({ button: 0, pointerId: 1 })
  assert.equal(node.__gwRangeDragging, true)

  node.__gwRangeDragging = false
  down({ button: 2, pointerId: 2 })
  assert.equal(node.__gwRangeDragging, false)

  down({ button: 0 })
  assert.equal(node.__gwRangeDragging, true)
  const move = [...(listeners.pointermove ?? [])][0]
  assert.ok(move)
  move({ buttons: 1 })
  assert.equal(node.__gwRangeDragging, true)

  action.update(0.9)
  assert.equal(node.value, '0.2')
  node.__gwRangeDragging = false
  action.update(0.9)
  assert.equal(node.value, '0.9')

  action.destroy()
})

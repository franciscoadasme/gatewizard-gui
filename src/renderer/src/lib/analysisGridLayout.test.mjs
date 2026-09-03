import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID_LAYOUT_DEFAULTS,
  aspectPaddingBottom,
  autoFillEnergeticGrid,
  autoFillEnergeticGridBySet,
  ensureEnergeticGridCells,
  extraMarginPx,
  gridCellEmptyReason,
  lineChartAxisProps,
  lineChartExtraMarginProps,
  MAX_AXIS_TICKS,
  axisTickFractions,
  normalizeGridCell,
  normalizeGridLayout,
  plotSpecAxisChrome,
  plotSpecExtraMargins,
  visibleSetIds
} from './analysisGridLayout.js'

test('normalizeGridLayout defaults to left+bottom axis box', () => {
  const layout = normalizeGridLayout({})
  assert.equal(layout.showTicks, true)
  assert.equal(layout.tickLength, GRID_LAYOUT_DEFAULTS.tickLength)
  assert.equal(layout.tickWidth, GRID_LAYOUT_DEFAULTS.tickWidth)
  assert.equal(layout.spineWidth, GRID_LAYOUT_DEFAULTS.spineWidth)
  assert.equal(layout.spineLeft, true)
  assert.equal(layout.spineBottom, true)
  assert.equal(layout.spineTop, false)
  assert.equal(layout.spineRight, false)
})

test('normalizeGridLayout keeps a full axis box and tick width', () => {
  const layout = normalizeGridLayout({
    spineTop: true,
    spineRight: true,
    spineLeft: false,
    tickWidth: 2.4,
    spineWidth: 0.5,
    tickLength: 12
  })
  assert.equal(layout.spineLeft, false)
  assert.equal(layout.spineTop, true)
  assert.equal(layout.spineRight, true)
  assert.equal(layout.tickWidth, 2.4)
  assert.equal(layout.spineWidth, 0.5)
  assert.equal(layout.tickLength, 12)
})

test('lineChartAxisProps maps spine flags and allows zero-length ticks', () => {
  const none = lineChartAxisProps({
    showTicks: false,
    tickLength: 0,
    tickWidth: 0.4,
    spineWidth: 3,
    spineLeft: false,
    spineBottom: false,
    spineTop: true,
    spineRight: true
  })
  assert.equal(none.showTicks, false)
  assert.equal(none.tickLength, 0)
  assert.equal(none.tickWidth, 0.4)
  assert.equal(none.spineWidth, 3)
  assert.equal(none.showSpineLeft, false)
  assert.equal(none.showSpineBottom, false)
  assert.equal(none.showSpineTop, true)
  assert.equal(none.showSpineRight, true)
})

test('plotSpecAxisChrome uses snake_case PlotSpec keys', () => {
  const chrome = plotSpecAxisChrome({
    tickWidth: 2,
    spineTop: true,
    spineLeft: false
  })
  assert.equal(chrome.tick_width, 2)
  assert.equal(chrome.show_spine_top, true)
  assert.equal(chrome.show_spine_left, false)
  assert.equal(chrome.show_spine_bottom, true)
  assert.equal(chrome.show_ticks, true)
})

test('extraMarginPx keeps 0 tight and allows a negative pull-in', () => {
  assert.equal(extraMarginPx(undefined), 0)
  assert.equal(extraMarginPx('0'), 0)
  assert.equal(extraMarginPx(-15), -15)
  assert.equal(extraMarginPx(300), 240)
})

test('visibleSetIds drops hidden and missing sets', () => {
  const assigned = ['a', 'b', 'c', 'gone']
  const sets = [
    { id: 'a', visible: true },
    { id: 'b', visible: false },
    { id: 'c' }
  ]
  assert.deepEqual(visibleSetIds(assigned, sets), ['a', 'c'])
  const map = new Map([
    ['a', { visible: false }],
    ['b', { visible: true }]
  ])
  assert.deepEqual(visibleSetIds(['a', 'b'], map), ['b'])
})

test('gridCellEmptyReason distinguishes hidden vs waiting', () => {
  assert.equal(gridCellEmptyReason([], [], 1), '')
  assert.equal(gridCellEmptyReason([], [], 0), 'empty')
  assert.equal(gridCellEmptyReason(['a'], [], 0), 'hidden')
  assert.equal(gridCellEmptyReason(['a'], ['a'], 0), 'waiting')
})

test('aspectPaddingBottom is width-driven height, not CSS aspect-ratio', () => {
  assert.equal(aspectPaddingBottom(2.5), '40.0000%')
  assert.equal(aspectPaddingBottom(1), '100.0000%')
  assert.equal(aspectPaddingBottom(''), '40.0000%')
  assert.equal(aspectPaddingBottom(0), '40.0000%')
})

test('plotSpecExtraMargins maps all four sides', () => {
  const m = plotSpecExtraMargins({
    extraLeftMargin: -12,
    extraRightMargin: 8,
    extraTopMargin: 4,
    extraBottomMargin: 0
  })
  assert.equal(m.extra_left, -12)
  assert.equal(m.extra_right, 8)
  assert.equal(m.extra_top, 4)
  assert.equal(m.extra_bottom, 0)
  const props = lineChartExtraMarginProps({ extraTopMargin: 10 })
  assert.equal(props.extraTopMargin, 10)
  assert.equal(props.extraLeftMargin, 0)
})

test('axisTickFractions uses step when it fits, otherwise tick count', () => {
  const ticks = axisTickFractions(0, 250, 50, 5)
  assert.ok(Math.abs(ticks[0]) < 1e-12)
  assert.equal(ticks.at(-1), 1)
  assert.equal(ticks.length, 6)
  const counted = axisTickFractions(0, 10, '', 5)
  assert.equal(counted.length, 5)
})

test('axisTickFractions caps a tiny step so the loop cannot freeze', () => {
  const ticks = axisTickFractions(0, 1e6, 1e-9, 5)
  assert.ok(ticks.length <= MAX_AXIS_TICKS)
  assert.ok(ticks.length >= 2)
})

test('normalizeGridCell keeps propertyKeys and defaults them to []', () => {
  const empty = normalizeGridCell(null)
  assert.deepEqual(empty, { setIds: [], propertyKeys: [], title: '' })
  const cell = normalizeGridCell({
    setIds: ['a', 'b'],
    propertyKeys: ['Temperature', 'Temperature', ''],
    title: ' T '
  })
  assert.deepEqual(cell.setIds, ['a', 'b'])
  assert.deepEqual(cell.propertyKeys, ['Temperature'])
  assert.equal(cell.title, 'T')
})

test('autoFillEnergeticGrid seeds one property per cell with all sets', () => {
  const layout = autoFillEnergeticGrid({ cols: 2 }, ['s1', 's2'], [
    'Temperature',
    'Total Energy',
    'Density'
  ])
  assert.equal(layout.edited, false)
  assert.equal(layout.rows, 2)
  assert.deepEqual(layout.cells[0], {
    setIds: ['s1', 's2'],
    propertyKeys: ['Temperature'],
    title: ''
  })
  assert.deepEqual(layout.cells[2].propertyKeys, ['Density'])
  assert.deepEqual(layout.overlaySetIds, ['s1', 's2'])
})

test('autoFillEnergeticGridBySet seeds one set per cell with all properties', () => {
  const layout = autoFillEnergeticGridBySet({ cols: 2 }, ['s1', 's2'], [
    'Temperature',
    'Pressure'
  ])
  assert.deepEqual(layout.cells[0], {
    setIds: ['s1'],
    propertyKeys: ['Temperature', 'Pressure'],
    title: ''
  })
  assert.deepEqual(layout.cells[1].setIds, ['s2'])
})

test('ensureEnergeticGridCells prunes missing ids only when edited', () => {
  const edited = ensureEnergeticGridCells(
    {
      edited: true,
      cols: 2,
      rows: 1,
      cells: [
        { setIds: ['s1', 'gone'], propertyKeys: ['Temperature', 'Missing'] },
        { setIds: ['s2'], propertyKeys: ['Pressure'] }
      ]
    },
    ['s1', 's2'],
    ['Temperature', 'Pressure']
  )
  assert.equal(edited.edited, true)
  assert.deepEqual(edited.cells[0].setIds, ['s1'])
  assert.deepEqual(edited.cells[0].propertyKeys, ['Temperature'])
  const fresh = ensureEnergeticGridCells(
    { edited: false, cols: 2, cells: [{ setIds: ['old'], propertyKeys: ['x'] }] },
    ['s1'],
    ['Temperature', 'Pressure']
  )
  assert.equal(fresh.edited, false)
  assert.deepEqual(fresh.cells[0].propertyKeys, ['Temperature'])
  assert.deepEqual(fresh.cells[0].setIds, ['s1'])
})

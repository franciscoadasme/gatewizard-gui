import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID_LAYOUT_DEFAULTS,
  aspectPaddingBottom,
  autoFillEnergeticGrid,
  autoFillEnergeticGridBySet,
  cellShowsLegend,
  ensureEnergeticGridCells,
  extraMarginPx,
  figureLegendItems,
  gridCellEmptyReason,
  lineChartAxisProps,
  lineChartExtraMarginProps,
  lineChartPanelLetterProps,
  mosaicPanelLetterPadStyle,
  panelLetterForCell,
  outsidePanelLetterBadge,
  MAX_AXIS_TICKS,
  axisTickFractions,
  normalizeGridCell,
  normalizeGridLayout,
  normalizeManualLegendItems,
  plotSpecAxisChrome,
  plotSpecExtraMargins,
  plotSpecPanelLetter,
  seedManualLegendItemsFromSeries,
  visibleSetIds,
  mosaicRows,
  gridSpecSlices,
  outsideLegendAlignClasses,
  estimateOutsideLegendNaturalBox,
  resolveCellCountOnResize,
  activeGridCells
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
    spineLeft: false,
    axisFontSize: 14,
    axisFontBold: true
  })
  assert.equal(chrome.tick_width, 2)
  assert.equal(chrome.show_spine_top, true)
  assert.equal(chrome.show_spine_left, false)
  assert.equal(chrome.show_spine_bottom, true)
  assert.equal(chrome.show_ticks, true)
  assert.equal(chrome.axis_fontsize, 14)
  assert.equal(chrome.axis_font_bold, true)
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

test('normalizeGridLayout defaults cellCount to full frame', () => {
  const layout = normalizeGridLayout({ cols: 4, rows: 2 })
  assert.equal(layout.cellCount, 8)
  assert.equal(layout.cells.length, 8)
  const trimmed = normalizeGridLayout({ cols: 4, rows: 2, cellCount: 7 })
  assert.equal(trimmed.cellCount, 7)
  const clamped = normalizeGridLayout({ cols: 2, rows: 1, cellCount: 99 })
  assert.equal(clamped.cellCount, 2)
})

test('mosaicRows keeps empty cells in a full last row under center', () => {
  const panels = Array.from({ length: 8 }, (_, i) => ({
    key: String(i),
    empty: i !== 4
  }))
  const centered = mosaicRows(panels, 4, 'center')
  assert.equal(centered.lastAlign, null)
  assert.equal(centered.fullRows.length, 2)
  assert.equal(centered.fullRows[1].length, 4)
  assert.equal(centered.fullRows[1].filter((p) => p.empty).length, 3)
})

test('mosaicRows center/end keep empties on a short last row', () => {
  const panels = Array.from({ length: 7 }, (_, i) => ({
    key: String(i),
    empty: i !== 4
  }))
  const centered = mosaicRows(panels, 4, 'center')
  assert.equal(centered.fullRows.length, 1)
  assert.equal(centered.lastRow.length, 3)
  assert.equal(centered.lastAlign, 'center')
  assert.equal(centered.lastRow.filter((p) => p.empty).length, 2)

  const right = mosaicRows(panels, 4, 'end')
  assert.equal(right.lastRow.length, 3)
  assert.equal(right.lastAlign, 'end')

  const left = mosaicRows(panels, 4, 'start')
  assert.equal(left.lastAlign, null)
  assert.equal(left.fullRows.length, 2)
  assert.equal(left.fullRows[1].length, 3)
})

test('gridSpecSlices end aligns short last row to the right', () => {
  const { slices, rows, microCols } = gridSpecSlices(7, 4, 'end')
  assert.equal(microCols, 8)
  assert.equal(rows, 2)
  assert.equal(slices.length, 7)
  assert.deepEqual(slices[4], { row: 1, c0: 2, c1: 4 })
  assert.deepEqual(slices[6], { row: 1, c0: 6, c1: 8 })
})

test('resolveCellCountOnResize keeps trim when growing frame', () => {
  assert.equal(resolveCellCountOnResize(7, 4, 2, 4, 3), 7)
  assert.equal(resolveCellCountOnResize(8, 4, 2, 4, 3), 12)
  assert.equal(resolveCellCountOnResize(7, 4, 2, 2, 2), 4)
})

test('activeGridCells returns only the first cellCount entries', () => {
  const layout = normalizeGridLayout({
    cols: 4,
    rows: 2,
    cellCount: 5,
    cells: Array.from({ length: 8 }, (_, i) => ({ setIds: [`s${i}`], title: '' }))
  })
  const active = activeGridCells(layout)
  assert.equal(active.length, 5)
  assert.deepEqual(active[4].setIds, ['s4'])
})

test('normalizeGridLayout clears absurdly small legend box mins', () => {
  const layout = normalizeGridLayout({
    legendBoxMinWidth: 1,
    legendBoxMinHeight: '1'
  })
  assert.equal(layout.legendBoxMinWidth, '')
  assert.equal(layout.legendBoxMinHeight, '')
})

test('normalizeGridLayout accepts large legend fonts and title sizing', () => {
  const layout = normalizeGridLayout({
    legendFontSize: 42,
    legendTitleFontSize: 48,
    legendTitleGap: 12,
    legendBoxMinWidth: 220,
    legendBoxMinHeight: 180
  })
  assert.equal(layout.legendFontSize, '42')
  assert.equal(layout.legendTitleFontSize, '48')
  assert.equal(layout.legendTitleGap, '12')
  assert.equal(layout.legendBoxMinWidth, '220')
  assert.equal(layout.legendBoxMinHeight, '180')
})

test('estimateOutsideLegendNaturalBox grows with font and labels', () => {
  const small = estimateOutsideLegendNaturalBox({
    series: [{ name: 'A' }, { name: 'B' }],
    fontSize: 10,
    swatchWidth: 12,
    swatchHeight: 12,
    title: ''
  })
  const large = estimateOutsideLegendNaturalBox({
    series: [{ name: 'LiPyphilic AreaPerLipid' }, { name: 'EVAPL' }],
    fontSize: 28,
    titleFontSize: 32,
    titleGap: 12,
    swatchWidth: 30,
    swatchHeight: 30,
    title: 'Methods',
    boxPadding: 0
  })
  assert.ok(large.width > small.width)
  assert.ok(large.height > small.height)
})

test('normalizeGridLayout accepts manual legend entries and strip sizes', () => {
  const layout = normalizeGridLayout({
    legendMode: 'outside',
    legendEntries: 'manual',
    legendFontSize: 14,
    legendSwatchSize: 16,
    legendSwatchWidth: 20,
    legendSwatchHeight: 10,
    legendSwatchRound: false,
    legendBoxRound: false,
    legendBoxBorderColor: '#ff0000',
    legendBoxBorderWidth: 2,
    legendManualItems: [
      { id: 'a', label: 'Amber', color: '#f59e0b', marker: 'circle' },
      { id: 'a', label: 'dup', color: '#000' },
      { label: 'NAMD', color: '#22c55e', marker: 'bogus', marker_size: 10 },
      { id: 'hid', label: 'Hidden', color: '#fff', visible: false }
    ]
  })
  assert.equal(layout.legendEntries, 'manual')
  assert.equal(layout.legendOutsideAlign, 'center')
  assert.equal(layout.legendFontSize, '14')
  assert.equal(layout.legendSwatchSize, '16')
  assert.equal(layout.legendSwatchWidth, '20')
  assert.equal(layout.legendSwatchHeight, '10')
  assert.equal(layout.legendSwatchRound, false)
  assert.equal(layout.legendBoxRound, false)
  assert.equal(layout.legendBoxBorderColor, '#ff0000')
  assert.equal(layout.legendBoxBorderWidth, '2')
  assert.equal(layout.legendManualItems.length, 3)
  assert.equal(layout.legendManualItems[0].label, 'Amber')
  assert.equal(layout.legendManualItems[0].marker, 'circle')
  assert.equal(layout.legendManualItems[1].id, 'leg-2')
  assert.equal(layout.legendManualItems[1].marker, 'none')
  assert.equal(layout.legendManualItems[1].markerSize, 10)
  assert.equal(layout.legendManualItems[2].visible, false)
})

test('outsideLegendAlignClasses centers side strips by default', () => {
  const side = outsideLegendAlignClasses({
    legendOutside: 'right',
    legendOutsideAlign: 'center'
  })
  assert.equal(side.wrapper, 'flex-row items-center')
  assert.equal(side.self, '')
  const topStart = outsideLegendAlignClasses({
    legendOutside: 'top',
    legendOutsideAlign: 'start'
  })
  assert.equal(topStart.wrapper, 'flex-col')
  assert.equal(topStart.self, 'self-start')
  const bottomEnd = outsideLegendAlignClasses({
    legendOutside: 'bottom',
    legendOutsideAlign: 'end'
  })
  assert.equal(bottomEnd.self, 'self-end')
})

test('normalizeManualLegendItems and seedManualLegendItemsFromSeries', () => {
  assert.deepEqual(normalizeManualLegendItems(null), [])
  const seeded = seedManualLegendItemsFromSeries([
    { name: 'A', color: '#aaa', marker: 'square' },
    { name: 'B', color: '#AAA', marker: 'circle' },
    { name: 'C', color: '#bbb', marker: 'diamond' }
  ])
  assert.equal(seeded.length, 2)
  assert.equal(seeded[0].label, 'A')
  assert.equal(seeded[0].marker, 'square')
  assert.equal(seeded[1].color, '#bbb')
})

test('figureLegendItems returns visible manual items; cellShowsLegend false for outside', () => {
  const layout = normalizeGridLayout({
    legendMode: 'outside',
    legendEntries: 'manual',
    legendManualItems: [
      { id: 'e1', label: 'Engine 1', color: '#111', marker: 'circle' },
      { id: 'e2', label: 'Engine 2', color: '#222', visible: false }
    ]
  })
  const items = figureLegendItems([{ setId: 'x', name: 'ignored', color: '#999' }], layout)
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Engine 1')
  assert.equal(items[0].marker, 'circle')
  assert.equal(cellShowsLegend(layout, 0), false)
  assert.equal(cellShowsLegend(layout, 3), false)
})

test('panelLetterForCell advances A→B→C from the start letter', () => {
  const layout = normalizeGridLayout({
    cols: 2,
    rows: 2,
    panelLetterShow: true,
    panelLetterText: 'A',
    panelLetterScope: 'each',
    panelLetterPlacement: 'outside',
    panelLetterPosition: 'outside-tl',
    panelLetterBold: true
  })
  assert.equal(panelLetterForCell(layout, 0), 'A')
  assert.equal(panelLetterForCell(layout, 1), 'B')
  assert.equal(panelLetterForCell(layout, 2), 'C')
  assert.equal(panelLetterForCell({ ...layout, panelLetterShow: false }, 0), '')
  const rowOnly = normalizeGridLayout({ ...layout, panelLetterScope: 'row' })
  assert.equal(panelLetterForCell(rowOnly, 0), 'A')
  assert.equal(panelLetterForCell(rowOnly, 1), '')
  assert.equal(panelLetterForCell(rowOnly, 2), 'B')
  assert.equal(panelLetterForCell(rowOnly, 3), '')
  const outside = outsidePanelLetterBadge(layout, 0, 13, '#111', 'Roboto, sans-serif')
  assert.ok(outside)
  assert.equal(outside.letter, 'A')
  assert.match(outside.style, /font-family:Roboto/)
  assert.match(outside.style, /color:#111/)
  const colored = outsidePanelLetterBadge(
    { ...layout, panelLetterColor: '#ff0000' },
    0,
    13,
    '#111',
    'Roboto, sans-serif'
  )
  assert.ok(colored)
  assert.match(colored.style, /color:#ff0000/)
  const pad = mosaicPanelLetterPadStyle(layout)
  assert.match(pad, /padding:/)
  assert.match(pad, /overflow:visible/)
  const insideProps = lineChartPanelLetterProps(
    { ...layout, panelLetterPlacement: 'inside', panelLetterColor: '#00ff00' },
    0,
    13
  )
  assert.equal(insideProps.panelLetter, 'A')
  assert.equal(insideProps.panelLetterColor, '#00ff00')
  assert.equal(lineChartPanelLetterProps(layout, 0, 13).panelLetter, '')
  const spec = plotSpecPanelLetter({ ...layout, panelLetterColor: '#abcdef' }, 0, 13)
  assert.equal(spec.panel_letter_color, '#abcdef')
})

test('normalizeReferenceLines opacity and zOrder', async () => {
  const { normalizeReferenceLines, emptyReferenceLine, normalizeReferenceBands, emptyReferenceBand } =
    await import('./analysisGridLayout.js')
  const lines = normalizeReferenceLines([
    { axis: 'y', value: 1, opacity: 0.4, zOrder: 'forward' },
    emptyReferenceLine()
  ])
  assert.equal(lines[0].opacity, 0.4)
  assert.equal(lines[0].zOrder, 'forward')
  assert.equal(lines[1].opacity, 1)
  assert.equal(lines[1].zOrder, 'back')
  const bands = normalizeReferenceBands([
    { axis: 'x', min: 10, max: 5, color: '#abc', opacity: 0.5, border: true, borderStyle: 'dashed' },
    emptyReferenceBand()
  ])
  // Live normalize preserves typed order; drawing/export orders via finalizeReferenceBands.
  assert.equal(bands[0].min, 10)
  assert.equal(bands[0].max, 5)
  assert.equal(bands[0].axis, 'x')
  assert.equal(bands[0].border, true)
  assert.equal(bands[0].borderStyle, 'dashed')
  assert.equal(bands[1].border, false)
  assert.equal(bands[1].zOrder, 'back')
})

test('normalizeReferenceBands preserves sibling bound when one field is cleared', async () => {
  const { normalizeReferenceBands, finalizeReferenceBands, coerceReferenceBandBound } = await import(
    './analysisGridLayout.js'
  )
  assert.equal(coerceReferenceBandBound(''), '')
  assert.equal(coerceReferenceBandBound('12.5'), 12.5)
  const editing = normalizeReferenceBands([{ axis: 'y', min: 50, max: '', color: '#888' }])
  assert.equal(editing.length, 1)
  assert.equal(editing[0].min, 50)
  assert.equal(editing[0].max, '')
  const drawn = finalizeReferenceBands([{ axis: 'y', min: 50, max: '', color: '#888' }])
  assert.equal(drawn.length, 0)
  const ordered = finalizeReferenceBands([{ axis: 'y', min: 50, max: 10 }])
  assert.equal(ordered[0].min, 10)
  assert.equal(ordered[0].max, 50)
})

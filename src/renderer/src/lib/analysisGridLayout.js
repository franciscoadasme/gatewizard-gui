/**
 * Customizable structural compare grid: ordered set lists per cell,
 * overlay series order, label/legend presets, last-row centering.
 */

export const GRID_LAYOUT_DEFAULTS = {
  cols: 2,
  rows: 1,
  gapPx: 16,
  /** Empty string = use plot-settings aspect ratio */
  aspectRatio: '',
  lastRowAlign: 'start',
  /**
   * Active squares in the cols×rows frame (1…cols*rows).
   * Null in raw input means “full frame”; stored value is always clamped.
   */
  cellCount: 2,
  showXLabels: 'all',
  showYLabels: 'all',
  showXTickLabels: 'all',
  showYTickLabels: 'all',
  showTicks: true,
  tickLength: 4,
  tickWidth: 1,
  spineWidth: 1,
  spineLeft: true,
  spineBottom: true,
  spineTop: false,
  spineRight: false,
  xTickStep: '',
  yTickStep: '',
  figureBg: '',
  cellBg: '',
  cellBorder: true,
  cellBorderColor: '',
  legendMode: 'each',
  legendCell: 0,
  legendOutside: 'bottom',
  /** Along the strip axis: left/right = vertical, top/bottom = horizontal */
  legendOutsideAlign: 'center',
  legendEntries: 'sets',
  legendColumns: 1,
  legendTitle: '',
  /** Empty = fall back to plot-settings legendFontSize / legendSwatchSize */
  legendFontSize: '',
  /** Empty = use legendFontSize for the title */
  legendTitleFontSize: '',
  /** Gap (px) between title baseline and first legend row; empty = 8 */
  legendTitleGap: '',
  legendSwatchSize: '',
  /** Independent strip swatch size (empty → legendSwatchSize) */
  legendSwatchWidth: '',
  legendSwatchHeight: '',
  /** Rounded color squares vs sharp corners */
  legendSwatchRound: true,
  /** Rounded outside strip box vs sharp */
  legendBoxRound: true,
  /** Outside strip frame border (empty color = theme; width 0 = no border) */
  legendBoxBorderColor: '',
  legendBoxBorderWidth: '1',
  /** Empty = default 8px frame padding */
  legendBoxPadding: '',
  /** Empty = content-sized; outer frame size (px) */
  legendBoxMinWidth: '',
  legendBoxMinHeight: '',
  /** Curated outside-strip items when legendEntries === 'manual' */
  legendManualItems: [],
  overlaySetIds: [],
  cells: [],
  cellOverrides: {},
  edited: false,
  /** Plot-settings writes go to every cell or the selected cell */
  plotApplyScope: 'all',
  /** Paper-style panel letters (A, B, C…) on overlay / mosaic cells */
  panelLetterShow: false,
  /** Starting letter (grid advances A→B→C…; overlay uses this alone) */
  panelLetterText: 'A',
  /**
   * Which cells get letters:
   * each = every cell; row = first cell of each row; col = first cell of each column
   */
  panelLetterScope: 'each',
  /**
   * outside = badge beside the panel (does not reshape plot gutters);
   * inside = drawn in the chart SVG
   */
  panelLetterPlacement: 'outside',
  /** outside-tl | inside-tl | outside-tr | inside-tr (corner relative to the panel) */
  panelLetterPosition: 'outside-tl',
  /** Empty = slightly larger than title font */
  panelLetterFontSize: '',
  panelLetterBold: true,
  /** Empty = same as plot text / tick color */
  panelLetterColor: '',
  /** Badge behind outside letters: none | theme | white | black */
  panelLetterBg: 'theme',
  /** Extra shift in screen px (negative = left / up) */
  panelLetterOffsetX: '0',
  panelLetterOffsetY: '0'
}

const LABEL_PRESETS = new Set(['all', 'bottom', 'left', 'none'])
const LAST_ROW = new Set(['start', 'center', 'end'])
const LEGEND_MODES = new Set(['each', 'one', 'outside', 'none'])
const LEGEND_OUTSIDE = new Set(['bottom', 'top', 'right', 'left'])
const LEGEND_OUTSIDE_ALIGN = new Set(['start', 'center', 'end'])
const LEGEND_ENTRIES = new Set(['sets', 'roles', 'both', 'manual'])
const PANEL_LETTER_POS = new Set(['outside-tl', 'inside-tl', 'outside-tr', 'inside-tr'])
const PANEL_LETTER_SCOPE = new Set(['each', 'row', 'col'])
const PANEL_LETTER_PLACE = new Set(['outside', 'inside'])
const PANEL_LETTER_BG = new Set(['none', 'theme', 'white', 'black'])
/** Marker shapes shared with LineChart / ChartLegend */
export const LEGEND_MARKERS = ['none', 'circle', 'square', 'triangle', 'cross', 'diamond']
const LEGEND_MARKER_SET = new Set(LEGEND_MARKERS)
const REF_AXES = new Set(['x', 'y'])
const REF_STYLES = new Set(['solid', 'dashed', 'dotted', 'dashdot'])

/**
 * @param {unknown} value
 * @param {number} lo
 * @param {number} hi
 * @param {number} fallback
 */
function clampInt(value, lo, hi, fallback) {
  return Math.round(clampNum(value, lo, hi, fallback))
}

function clampNum(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeIdList(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Assigned cell/overlay ids that still exist and are checked visible.
 * Missing sets and `visible === false` are dropped; unset `visible` stays shown.
 * @param {string[]} assignedIds
 * @param {Iterable<{ id?: string, visible?: boolean }> | Map<string, { visible?: boolean }>} sets
 * @returns {string[]}
 */
export function visibleSetIds(assignedIds, sets) {
  const ids = normalizeIdList(assignedIds)
  /** @type {Map<string, boolean>} */
  const vis = new Map()
  if (sets instanceof Map) {
    for (const [id, s] of sets) vis.set(String(id), s == null || s.visible !== false)
  } else if (sets && typeof sets[Symbol.iterator] === 'function') {
    for (const s of sets) {
      if (s == null || s.id == null) continue
      vis.set(String(s.id), s.visible !== false)
    }
  }
  return ids.filter((id) => vis.get(id) === true)
}

/**
 * Why a mosaic cell has no series after visibility filtering.
 * @param {string[]} assignedIds
 * @param {string[]} visibleIds
 * @param {number} seriesLength
 * @returns {'' | 'empty' | 'hidden' | 'waiting'}
 */
export function gridCellEmptyReason(assignedIds, visibleIds, seriesLength) {
  if (Number(seriesLength) > 0) return ''
  if (!normalizeIdList(assignedIds).length) return 'empty'
  if (!normalizeIdList(visibleIds).length) return 'hidden'
  return 'waiting'
}

/**
 * Keep stored order for ids that still exist; append new ids; drop missing.
 * @param {string[]} stored
 * @param {string[]} allIds
 */
export function syncOrderedIds(stored, allIds) {
  const allow = new Set(allIds.map(String))
  const kept = normalizeIdList(stored).filter((id) => allow.has(id))
  const have = new Set(kept)
  for (const id of allIds) {
    if (!have.has(id)) kept.push(id)
  }
  return kept
}

/**
 * @param {unknown} cell
 * @returns {{ setIds: string[], propertyKeys: string[], title: string }}
 */
export function normalizeGridCell(cell) {
  if (!cell || typeof cell !== 'object') {
    return { setIds: [], propertyKeys: [], title: '' }
  }
  const obj = /** @type {Record<string, unknown>} */ (cell)
  const propertyKeys = normalizeIdList(obj.propertyKeys)
  const title = String(obj.title || '').trim()
  if (Array.isArray(obj.setIds)) {
    return { setIds: normalizeIdList(obj.setIds), propertyKeys, title }
  }
  if (obj.setId != null && String(obj.setId).trim()) {
    return { setIds: [String(obj.setId).trim()], propertyKeys, title }
  }
  return { setIds: [], propertyKeys, title }
}

/**
 * @param {number} cols
 * @param {number} rows
 */
export function gridCapacity(cols, rows) {
  return Math.max(1, Math.round(Number(cols) || 1)) * Math.max(1, Math.round(Number(rows) || 1))
}

/**
 * @param {unknown} n
 * @param {number} cols
 * @param {number} rows
 */
export function clampCellCount(n, cols, rows) {
  const cap = gridCapacity(cols, rows)
  return clampInt(n, 1, cap, cap)
}

/**
 * When the frame grows/shrinks: stay full if it was full; otherwise keep a trimmed count.
 * @param {unknown} prevCellCount
 * @param {number} prevCols
 * @param {number} prevRows
 * @param {number} nextCols
 * @param {number} nextRows
 */
export function resolveCellCountOnResize(prevCellCount, prevCols, prevRows, nextCols, nextRows) {
  const oldCap = gridCapacity(prevCols, prevRows)
  const newCap = gridCapacity(nextCols, nextRows)
  const prev =
    prevCellCount == null || prevCellCount === ''
      ? oldCap
      : clampCellCount(prevCellCount, prevCols, prevRows)
  if (prev >= oldCap) return newCap
  return Math.min(prev, newCap)
}

/**
 * Active (visible/editable) cells for the mosaic — first `cellCount` entries.
 * @param {object} layout
 */
export function activeGridCells(layout) {
  const cols = clampInt(layout?.cols, 1, 8, 2)
  const rows = clampInt(layout?.rows, 1, 16, 1)
  const cells = Array.isArray(layout?.cells) ? layout.cells : []
  const n = clampCellCount(layout?.cellCount, cols, rows)
  return cells.slice(0, n).map(normalizeGridCell)
}

/**
 * @param {number} cols
 * @param {number} rows
 */
export function emptyGridCells(cols, rows) {
  const n = Math.max(1, cols) * Math.max(1, rows)
  return Array.from({ length: n }, () => ({ setIds: [], propertyKeys: [], title: '' }))
}

/**
 * Grow/shrink the cell list when cols×rows change. Extra cells are empty;
 * truncated cells are dropped from the end.
 * @param {{ setIds: string[], propertyKeys?: string[], title?: string }[]} cells
 * @param {number} cols
 * @param {number} rows
 */
export function resizeGridCells(cells, cols, rows) {
  const next = emptyGridCells(cols, rows)
  const src = Array.isArray(cells) ? cells : []
  for (let i = 0; i < next.length && i < src.length; i++) {
    next[i] = normalizeGridCell(src[i])
  }
  return next
}

/**
 * One set per cell in sidebar order. Does not mark edited.
 * @param {object} layout
 * @param {string[]} setIds
 */
export function autoFillGridLayout(layout, setIds) {
  const cols = clampInt(layout?.cols, 1, 8, 2)
  const ids = normalizeIdList(setIds)
  const minRows = Math.max(1, Math.ceil(Math.max(ids.length, 1) / cols))
  const rows = Math.max(minRows, clampInt(layout?.rows, 1, 16, minRows))
  const cells = emptyGridCells(cols, rows)
  ids.forEach((id, i) => {
    if (i < cells.length) cells[i] = { setIds: [id], title: '' }
  })
  return {
    ...normalizeGridLayout({ ...layout, cols, rows, cells, cellCount: cols * rows }),
    edited: false,
    overlaySetIds: ids
  }
}

/**
 * If the mosaic was never edited, keep one-set-per-cell auto layout.
 * @param {object} layout
 * @param {string[]} setIds
 */
export function ensureGridCellsForSets(layout, setIds) {
  const normalized = normalizeGridLayout(layout)
  const ids = normalizeIdList(setIds)
  if (normalized.edited) {
    const allow = new Set(ids)
    const cells = normalized.cells.map((c) => ({
      ...c,
      setIds: (c.setIds || []).filter((id) => allow.has(id))
    }))
    return {
      ...normalized,
      cells,
      overlaySetIds: syncOrderedIds(normalized.overlaySetIds, ids)
    }
  }
  return autoFillGridLayout(normalized, ids)
}

/**
 * One cell per property; every set is assigned to that cell. Does not mark edited.
 * @param {object} layout
 * @param {string[]} setIds
 * @param {string[]} propertyKeys
 */
export function autoFillEnergeticGrid(layout, setIds, propertyKeys) {
  const ids = normalizeIdList(setIds)
  const props = normalizeIdList(propertyKeys)
  const cols = clampInt(layout?.cols, 1, 8, 2)
  const minRows = Math.max(1, Math.ceil(Math.max(props.length, 1) / cols))
  const rows = Math.max(minRows, clampInt(layout?.rows, 1, 16, minRows))
  const cells = emptyGridCells(cols, rows)
  props.forEach((prop, i) => {
    if (i < cells.length) cells[i] = { setIds: [...ids], propertyKeys: [prop], title: '' }
  })
  return {
    ...normalizeGridLayout({ ...layout, cols, rows, cells, cellCount: cols * rows }),
    edited: false,
    overlaySetIds: ids
  }
}

/**
 * One cell per set; every property is assigned to that cell. Does not mark edited.
 * @param {object} layout
 * @param {string[]} setIds
 * @param {string[]} propertyKeys
 */
export function autoFillEnergeticGridBySet(layout, setIds, propertyKeys) {
  const ids = normalizeIdList(setIds)
  const props = normalizeIdList(propertyKeys)
  const cols = clampInt(layout?.cols, 1, 8, 2)
  const minRows = Math.max(1, Math.ceil(Math.max(ids.length, 1) / cols))
  const rows = Math.max(minRows, clampInt(layout?.rows, 1, 16, minRows))
  const cells = emptyGridCells(cols, rows)
  ids.forEach((id, i) => {
    if (i < cells.length) cells[i] = { setIds: [id], propertyKeys: [...props], title: '' }
  })
  return {
    ...normalizeGridLayout({ ...layout, cols, rows, cells, cellCount: cols * rows }),
    edited: false,
    overlaySetIds: ids
  }
}

/**
 * If the energetic mosaic was never edited, keep one-property-per-cell auto layout.
 * @param {object} layout
 * @param {string[]} setIds
 * @param {string[]} propertyKeys
 * @param {'by_property' | 'by_set'} [fill]
 */
export function ensureEnergeticGridCells(layout, setIds, propertyKeys, fill = 'by_property') {
  const normalized = normalizeGridLayout(layout)
  const ids = normalizeIdList(setIds)
  const props = normalizeIdList(propertyKeys)
  if (normalized.edited) {
    const allowSets = new Set(ids)
    const allowProps = new Set(props)
    const cells = normalized.cells.map((c) => ({
      ...c,
      setIds: (c.setIds || []).filter((id) => allowSets.has(id)),
      propertyKeys: (c.propertyKeys || []).filter((p) => allowProps.has(p))
    }))
    return {
      ...normalized,
      cells,
      overlaySetIds: syncOrderedIds(normalized.overlaySetIds, ids)
    }
  }
  if (fill === 'by_set') return autoFillEnergeticGridBySet(normalized, ids, props)
  return autoFillEnergeticGrid(normalized, ids, props)
}

/**
 * @param {unknown} raw
 */
export function normalizeGridLayout(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const cols = clampInt(src.cols, 1, 8, GRID_LAYOUT_DEFAULTS.cols)
  const rows = clampInt(src.rows, 1, 16, GRID_LAYOUT_DEFAULTS.rows)
  const lastRowAlign = LAST_ROW.has(String(src.lastRowAlign))
    ? String(src.lastRowAlign)
    : GRID_LAYOUT_DEFAULTS.lastRowAlign
  const showXLabels = LABEL_PRESETS.has(String(src.showXLabels))
    ? String(src.showXLabels)
    : GRID_LAYOUT_DEFAULTS.showXLabels
  const showYLabels = LABEL_PRESETS.has(String(src.showYLabels))
    ? String(src.showYLabels)
    : GRID_LAYOUT_DEFAULTS.showYLabels
  const legendMode = LEGEND_MODES.has(String(src.legendMode))
    ? String(src.legendMode)
    : GRID_LAYOUT_DEFAULTS.legendMode
  const legendOutside = LEGEND_OUTSIDE.has(String(src.legendOutside))
    ? String(src.legendOutside)
    : GRID_LAYOUT_DEFAULTS.legendOutside
  const legendOutsideAlign = LEGEND_OUTSIDE_ALIGN.has(String(src.legendOutsideAlign))
    ? String(src.legendOutsideAlign)
    : GRID_LAYOUT_DEFAULTS.legendOutsideAlign
  const legendEntries = LEGEND_ENTRIES.has(String(src.legendEntries))
    ? String(src.legendEntries)
    : GRID_LAYOUT_DEFAULTS.legendEntries
  const legendManualItems = normalizeManualLegendItems(src.legendManualItems)
  const cells = resizeGridCells(
    Array.isArray(src.cells) ? src.cells.map(normalizeGridCell) : [],
    cols,
    rows
  )
  const capacity = gridCapacity(cols, rows)
  const cellCount =
    src.cellCount == null || src.cellCount === ''
      ? capacity
      : clampCellCount(src.cellCount, cols, rows)
  const overrides =
    src.cellOverrides && typeof src.cellOverrides === 'object' && !Array.isArray(src.cellOverrides)
      ? { ...src.cellOverrides }
      : {}
  return {
    cols,
    rows,
    gapPx: clampInt(src.gapPx, 0, 80, GRID_LAYOUT_DEFAULTS.gapPx),
    aspectRatio: src.aspectRatio == null ? '' : String(src.aspectRatio),
    lastRowAlign,
    cellCount,
    showXLabels,
    showYLabels,
    showXTickLabels: LABEL_PRESETS.has(String(src.showXTickLabels))
      ? String(src.showXTickLabels)
      : GRID_LAYOUT_DEFAULTS.showXTickLabels,
    showYTickLabels: LABEL_PRESETS.has(String(src.showYTickLabels))
      ? String(src.showYTickLabels)
      : GRID_LAYOUT_DEFAULTS.showYTickLabels,
    showTicks: src.showTicks !== false,
    tickLength: clampInt(src.tickLength, 0, 16, GRID_LAYOUT_DEFAULTS.tickLength),
    tickWidth: clampNum(src.tickWidth, 0.2, 8, GRID_LAYOUT_DEFAULTS.tickWidth),
    spineWidth: clampNum(src.spineWidth, 0.2, 8, GRID_LAYOUT_DEFAULTS.spineWidth),
    spineLeft: src.spineLeft !== false,
    spineBottom: src.spineBottom !== false,
    spineTop: src.spineTop === true,
    spineRight: src.spineRight === true,
    xTickStep: src.xTickStep == null ? '' : String(src.xTickStep),
    yTickStep: src.yTickStep == null ? '' : String(src.yTickStep),
    figureBg: String(src.figureBg || ''),
    cellBg: String(src.cellBg || ''),
    cellBorder: src.cellBorder !== false,
    cellBorderColor: String(src.cellBorderColor || ''),
    legendMode,
    legendCell: clampInt(src.legendCell, 0, Math.max(0, cellCount - 1), 0),
    legendOutside,
    legendOutsideAlign,
    legendEntries,
    legendColumns: clampInt(src.legendColumns, 1, 8, 1),
    legendTitle: String(src.legendTitle || ''),
    legendFontSize: src.legendFontSize == null || src.legendFontSize === ''
      ? ''
      : String(clampNum(src.legendFontSize, 1, 500, 10)),
    legendTitleFontSize:
      src.legendTitleFontSize == null || src.legendTitleFontSize === ''
        ? ''
        : String(clampNum(src.legendTitleFontSize, 1, 500, 10)),
    legendTitleGap:
      src.legendTitleGap == null || src.legendTitleGap === ''
        ? ''
        : String(clampNum(src.legendTitleGap, 0, 200, 8)),
    legendSwatchSize: src.legendSwatchSize == null || src.legendSwatchSize === ''
      ? ''
      : String(clampNum(src.legendSwatchSize, 1, 500, 12)),
    legendSwatchWidth: src.legendSwatchWidth == null || src.legendSwatchWidth === ''
      ? ''
      : String(clampNum(src.legendSwatchWidth, 1, 500, 12)),
    legendSwatchHeight: src.legendSwatchHeight == null || src.legendSwatchHeight === ''
      ? ''
      : String(clampNum(src.legendSwatchHeight, 1, 500, 12)),
    legendSwatchRound: src.legendSwatchRound !== false,
    legendBoxRound: src.legendBoxRound !== false,
    legendBoxBorderColor: String(src.legendBoxBorderColor || ''),
    legendBoxBorderWidth:
      src.legendBoxBorderWidth == null || src.legendBoxBorderWidth === ''
        ? '1'
        : String(clampNum(src.legendBoxBorderWidth, 0, 32, 1)),
    legendBoxPadding:
      src.legendBoxPadding == null || src.legendBoxPadding === ''
        ? ''
        : String(clampNum(src.legendBoxPadding, 0, 200, 8)),
    legendBoxMinWidth:
      src.legendBoxMinWidth == null || src.legendBoxMinWidth === ''
        ? ''
        : (() => {
            // Absurdly small saved mins (e.g. spinner "1") used to force a
            // 1×1px outside-legend frame — treat as auto.
            const n = clampNum(src.legendBoxMinWidth, 0, 5000, 0)
            return n < 8 ? '' : String(n)
          })(),
    legendBoxMinHeight:
      src.legendBoxMinHeight == null || src.legendBoxMinHeight === ''
        ? ''
        : (() => {
            const n = clampNum(src.legendBoxMinHeight, 0, 5000, 0)
            return n < 8 ? '' : String(n)
          })(),
    legendManualItems,
    overlaySetIds: normalizeIdList(src.overlaySetIds),
    cells,
    cellOverrides: overrides,
    edited: Boolean(src.edited),
    plotApplyScope: src.plotApplyScope === 'cell' ? 'cell' : 'all',
    panelLetterShow: src.panelLetterShow === true,
    panelLetterText: (() => {
      const t = String(src.panelLetterText ?? 'A').trim()
      return t ? t.slice(0, 4) : 'A'
    })(),
    panelLetterScope: PANEL_LETTER_SCOPE.has(String(src.panelLetterScope))
      ? String(src.panelLetterScope)
      : GRID_LAYOUT_DEFAULTS.panelLetterScope,
    panelLetterPlacement: PANEL_LETTER_PLACE.has(String(src.panelLetterPlacement))
      ? String(src.panelLetterPlacement)
      : GRID_LAYOUT_DEFAULTS.panelLetterPlacement,
    panelLetterPosition: PANEL_LETTER_POS.has(String(src.panelLetterPosition))
      ? String(src.panelLetterPosition)
      : GRID_LAYOUT_DEFAULTS.panelLetterPosition,
    panelLetterFontSize:
      src.panelLetterFontSize == null || src.panelLetterFontSize === ''
        ? ''
        : String(clampNum(src.panelLetterFontSize, 8, 48, 16)),
    panelLetterBold: src.panelLetterBold !== false,
    panelLetterColor: typeof src.panelLetterColor === 'string' ? String(src.panelLetterColor).trim() : '',
    panelLetterBg: PANEL_LETTER_BG.has(String(src.panelLetterBg))
      ? String(src.panelLetterBg)
      : GRID_LAYOUT_DEFAULTS.panelLetterBg,
    panelLetterOffsetX:
      src.panelLetterOffsetX == null || src.panelLetterOffsetX === ''
        ? '0'
        : String(clampNum(src.panelLetterOffsetX, -40, 40, 0)),
    panelLetterOffsetY:
      src.panelLetterOffsetY == null || src.panelLetterOffsetY === ''
        ? '0'
        : String(clampNum(src.panelLetterOffsetY, -40, 40, 0))
  }
}

/**
 * @param {unknown} raw
 * @returns {Array<{ id: string, label: string, color: string, marker: string, markerSize: number, visible: boolean }>}
 */
export function normalizeManualLegendItems(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {Array<{ id: string, label: string, color: string, marker: string, markerSize: number, visible: boolean }>} */
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (item)
    let id = String(row.id || '').trim()
    if (!id) id = `leg-${out.length + 1}`
    if (seen.has(id)) continue
    seen.add(id)
    const markerRaw = String(row.marker || 'none')
    const marker = LEGEND_MARKER_SET.has(markerRaw) ? markerRaw : 'none'
    const label = String(row.label ?? row.name ?? '').trim() || id
    const color = String(row.color || '#888888').trim() || '#888888'
    const sizeRaw = row.markerSize ?? row.marker_size
    out.push({
      id,
      label,
      color,
      marker,
      markerSize: clampNum(sizeRaw, 2, 24, 8),
      visible: row.visible !== false
    })
  }
  return out
}

/**
 * Seed manual strip entries from unique series colors in the mosaic.
 * @param {Array<{ name?: string, color?: string, marker?: string }>} series
 */
export function seedManualLegendItemsFromSeries(series) {
  const list = Array.isArray(series) ? series : []
  const seen = new Set()
  /** @type {Array<{ id: string, label: string, color: string, marker: string, markerSize: number, visible: boolean }>} */
  const items = []
  for (const s of list) {
    if (!s) continue
    const color = String(s.color || '#888888').trim() || '#888888'
    const key = color.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const markerRaw = String(s.marker || 'none')
    const marker = LEGEND_MARKER_SET.has(markerRaw) ? markerRaw : 'none'
    const n = items.length + 1
    items.push({
      id: `color-${n}`,
      label: String(s.name || `Series ${n}`).trim() || `Series ${n}`,
      color,
      marker,
      markerSize: 8,
      visible: true
    })
  }
  return items
}

export function defaultGridLayout() {
  return normalizeGridLayout({ ...GRID_LAYOUT_DEFAULTS, cells: emptyGridCells(2, 1) })
}

/**
 * @param {object} layout
 * @param {number} cellIndex
 */
export function cellOverride(layout, cellIndex) {
  const key = String(cellIndex)
  const row = Math.floor(cellIndex / Math.max(1, Number(layout.cols) || 2))
  const col = cellIndex % Math.max(1, Number(layout.cols) || 2)
  const rc = `${row},${col}`
  const bag = layout?.cellOverrides && typeof layout.cellOverrides === 'object' ? layout.cellOverrides : {}
  return bag[key] || bag[rc] || {}
}

/**
 * @param {object} layout
 * @param {number} cellIndex
 * @returns {{ showXLabel: boolean, showYLabel: boolean, showXTickLabels: boolean, showYTickLabels: boolean }}
 */
export function cellLabelVisibility(layout, cellIndex) {
  const cols = Math.max(1, Number(layout?.cols) || 2)
  const rows = Math.max(1, Number(layout?.rows) || 1)
  const col = cellIndex % cols
  const row = Math.floor(cellIndex / cols)
  const over = cellOverride(layout, cellIndex)
  let showXLabel = layout?.showXLabels !== 'none'
  let showYLabel = layout?.showYLabels !== 'none'
  let showXTickLabels = layout?.showXTickLabels !== 'none'
  let showYTickLabels = layout?.showYTickLabels !== 'none'
  if (layout?.showXLabels === 'bottom') showXLabel = row === rows - 1
  if (layout?.showYLabels === 'left') showYLabel = col === 0
  if (layout?.showXTickLabels === 'bottom') showXTickLabels = row === rows - 1
  if (layout?.showYTickLabels === 'left') showYTickLabels = col === 0
  if (typeof over.showXLabel === 'boolean') showXLabel = over.showXLabel
  if (typeof over.showYLabel === 'boolean') showYLabel = over.showYLabel
  if (typeof over.showXTickLabels === 'boolean') showXTickLabels = over.showXTickLabels
  if (typeof over.showYTickLabels === 'boolean') showYTickLabels = over.showYTickLabels
  return { showXLabel, showYLabel, showXTickLabels, showYTickLabels }
}

/**
 * Keep plot boxes the same size when some mosaic cells hide axis titles or tick numbers.
 * @param {object} layout
 * @returns {{ reserveXLabel: boolean, reserveYLabel: boolean, reserveXTickLabels: boolean, reserveYTickLabels: boolean }}
 */
export function cellAxisReservation(layout) {
  return {
    reserveXLabel: layout?.showXLabels !== 'none',
    reserveYLabel: layout?.showYLabels !== 'none',
    reserveXTickLabels: layout?.showXTickLabels !== 'none',
    reserveYTickLabels: layout?.showYTickLabels !== 'none'
  }
}

/** Cap for data-unit tick loops so a tiny step cannot freeze the chart flush. */
export const MAX_AXIS_TICKS = 48

/**
 * Evenly spaced tick positions in [0, 1], or count-based fallback.
 * @param {number} min
 * @param {number} max
 * @param {unknown} step
 * @param {unknown} count
 * @returns {number[]}
 */
export function axisTickFractions(min, max, step, count) {
  const span = max - min
  const st = Number(step)
  if (Number.isFinite(st) && st > 0 && Number.isFinite(span) && span > 0) {
    /** @type {number[]} */
    const ticks = []
    const start = Math.ceil((min - 1e-12) / st) * st
    for (let v = start, n = 0; v <= max + 1e-12 && n < MAX_AXIS_TICKS; n++) {
      ticks.push((v - min) / span)
      const next = v + st
      if (next === v) break
      v = next
    }
    if (ticks.length >= 2) return ticks
  }
  const n = Math.max(2, Math.min(20, Math.round(Number(count) || 5)))
  /** @type {number[]} */
  const ticks = []
  for (let i = 0; i < n; i++) ticks.push(i / (n - 1))
  return ticks
}

/**
 * Tick marks + axis-box (spine) props for LineChart / PlotSpec.
 * @param {object} [src]
 */
export function lineChartAxisProps(src) {
  const s = src && typeof src === 'object' ? src : {}
  return {
    showTicks: s.showTicks !== false,
    tickLength: clampNum(s.tickLength, 0, 16, 4),
    tickWidth: clampNum(s.tickWidth, 0.2, 8, 1),
    spineWidth: clampNum(s.spineWidth, 0.2, 8, 1),
    showSpineLeft: s.spineLeft !== false,
    showSpineBottom: s.spineBottom !== false,
    showSpineTop: Boolean(s.spineTop),
    showSpineRight: Boolean(s.spineRight)
  }
}

/**
 * @param {object} [src]
 */
export function plotSpecAxisChrome(src) {
  const p = lineChartAxisProps(src)
  const s = src && typeof src === 'object' ? src : {}
  const axisFs = Number(s.axisFontSize)
  return {
    show_ticks: p.showTicks,
    tick_length: p.tickLength,
    tick_width: p.tickWidth,
    spine_width: p.spineWidth,
    show_spine_left: p.showSpineLeft,
    show_spine_bottom: p.showSpineBottom,
    show_spine_top: p.showSpineTop,
    show_spine_right: p.showSpineRight,
    axis_fontsize: Number.isFinite(axisFs) && axisFs > 0 ? axisFs : undefined,
    axis_font_bold: s.axisFontBold === true
  }
}

/**
 * Extra plot padding in CSS px. 0 is tight to labels; negative pulls the plot box out.
 * @param {unknown} value
 * @param {number} [fallback=0]
 */
export function extraMarginPx(value, fallback = 0) {
  return clampNum(value, -80, 240, fallback)
}

/**
 * @param {object} [src]
 */
export function lineChartExtraMarginProps(src) {
  const s = src && typeof src === 'object' ? src : {}
  return {
    extraLeftMargin: extraMarginPx(s.extraLeftMargin),
    extraRightMargin: extraMarginPx(s.extraRightMargin),
    extraTopMargin: extraMarginPx(s.extraTopMargin),
    extraBottomMargin: extraMarginPx(s.extraBottomMargin)
  }
}

/**
 * @param {object} [src]
 */
export function plotSpecExtraMargins(src) {
  const p = lineChartExtraMarginProps(src)
  return {
    extra_left: p.extraLeftMargin,
    extra_right: p.extraRightMargin,
    extra_top: p.extraTopMargin,
    extra_bottom: p.extraBottomMargin
  }
}

/**
 * Sequence index for a mosaic cell’s panel letter, or -1 if this cell has none.
 * `row` = first column of each row; `col` = first row of each column; `each` = all cells.
 * @param {object | null | undefined} layout
 * @param {number} [cellIndex]
 * @returns {number}
 */
export function panelLetterSequenceIndex(layout, cellIndex = 0) {
  if (!layout || layout.panelLetterShow !== true) return -1
  const cols = Math.max(1, Math.round(Number(layout.cols) || 1))
  const idx = Math.max(0, Math.round(Number(cellIndex) || 0))
  const row = Math.floor(idx / cols)
  const col = idx % cols
  const scope = String(layout.panelLetterScope || 'each')
  if (scope === 'row') return col === 0 ? row : -1
  if (scope === 'col') return row === 0 ? col : -1
  return idx
}

/**
 * Paper-style panel letter for overlay (index 0) or mosaic cell index.
 * @param {object | null | undefined} layout
 * @param {number} [cellIndex]
 * @returns {string}
 */
export function panelLetterForCell(layout, cellIndex = 0) {
  const seq = panelLetterSequenceIndex(layout, cellIndex)
  if (seq < 0) return ''
  const startRaw = String(layout?.panelLetterText || 'A').trim() || 'A'
  const ch = startRaw.charAt(0).toUpperCase()
  const code = ch.charCodeAt(0)
  if (code >= 65 && code <= 90) {
    const next = code + seq
    if (next <= 90) return String.fromCharCode(next)
    return `${ch}${seq + 1}`
  }
  return seq === 0 ? startRaw : `${startRaw}${seq + 1}`
}

/**
 * Resolved font size (px) for panel letters.
 * @param {object | null | undefined} layout
 * @param {number} [titleFontSize]
 */
export function panelLetterResolvedFontSize(layout, titleFontSize = 13) {
  const titleFs = Number(titleFontSize) || 13
  const rawFs = Number(layout?.panelLetterFontSize)
  if (Number.isFinite(rawFs) && rawFs > 0) return rawFs
  return Math.max(titleFs + 3, 16)
}

/**
 * Props for LineChart panel-letter chrome (only when placement is inside the plot SVG).
 * @param {object | null | undefined} layout
 * @param {number} [cellIndex]
 * @param {number} [titleFontSize]
 */
export function lineChartPanelLetterProps(layout, cellIndex = 0, titleFontSize = 13) {
  const empty = {
    panelLetter: '',
    panelLetterFontSize: 0,
    panelLetterBold: true,
    panelLetterColor: '',
    panelLetterPosition: 'outside-tl',
    panelLetterOffsetX: 0,
    panelLetterOffsetY: 0
  }
  if (String(layout?.panelLetterPlacement || 'outside') !== 'inside') return empty
  const letter = panelLetterForCell(layout, cellIndex)
  if (!letter) return empty
  return {
    panelLetter: letter,
    panelLetterFontSize: panelLetterResolvedFontSize(layout, titleFontSize),
    panelLetterBold: layout?.panelLetterBold !== false,
    panelLetterColor: String(layout?.panelLetterColor || '').trim(),
    panelLetterPosition: PANEL_LETTER_POS.has(String(layout?.panelLetterPosition))
      ? String(layout.panelLetterPosition)
      : 'outside-tl',
    panelLetterOffsetX: Number(layout?.panelLetterOffsetX) || 0,
    panelLetterOffsetY: Number(layout?.panelLetterOffsetY) || 0
  }
}

/**
 * Outside-of-panel letter badge model (HTML overlay; does not reshape plot gutters).
 * Uses the plot font family (same stack as axis ticks) when `fontFamily` is set.
 * @param {object | null | undefined} layout
 * @param {number} [cellIndex]
 * @param {number} [titleFontSize]
 * @param {string} [textColor] fallback when panelLetterColor is empty (tick/text color)
 * @param {string} [fontFamily] plot settings font (ticks/labels)
 * @returns {null | {
 *   letter: string,
 *   fontSize: number,
 *   bold: boolean,
 *   style: string
 * }}
 */
export function outsidePanelLetterBadge(
  layout,
  cellIndex = 0,
  titleFontSize = 13,
  textColor = '',
  fontFamily = ''
) {
  if (String(layout?.panelLetterPlacement || 'outside') !== 'outside') return null
  const letter = panelLetterForCell(layout, cellIndex)
  if (!letter) return null
  const fontSize = panelLetterResolvedFontSize(layout, titleFontSize)
  const bold = layout?.panelLetterBold !== false
  const pos = String(layout?.panelLetterPosition || 'outside-tl')
  const ox = Number(layout?.panelLetterOffsetX) || 0
  const oy = Number(layout?.panelLetterOffsetY) || 0
  const bg = String(layout?.panelLetterBg || 'theme')
  const color = String(layout?.panelLetterColor || '').trim() || textColor || ''
  const family = String(fontFamily || '').trim()
  const right = pos.endsWith('-tr')
  const inside = pos.startsWith('inside')
  /** @type {string[]} */
  const parts = [
    `font-size:${fontSize}px`,
    `font-weight:${bold ? 700 : 400}`,
    color ? `color:${color}` : '',
    family ? `font-family:${family}` : ''
  ]
  if (inside) {
    parts.push(
      right ? 'right:0.35rem;left:auto' : 'left:0.35rem;right:auto',
      'top:0.2rem',
      `transform:translate(${ox}px, ${oy}px)`
    )
  } else {
    // Hang just into the mosaic gutter (full glyph stays inside padded mosaic).
    parts.push(
      right ? 'left:100%;right:auto' : 'left:0;right:auto',
      'top:0',
      right
        ? `transform:translate(calc(0.1rem + ${ox}px), calc(-8% + ${oy}px))`
        : `transform:translate(calc(-100% - 0.1rem + ${ox}px), calc(-8% + ${oy}px))`
    )
  }
  if (bg === 'white') {
    parts.push('background:#fff', 'box-shadow:0 0 0 1px rgba(0,0,0,0.12)')
  } else if (bg === 'black') {
    parts.push('background:#0a0a0a', 'color:#f5f5f5', 'box-shadow:0 0 0 1px rgba(255,255,255,0.15)')
  } else if (bg === 'theme') {
    parts.push(
      'background:color-mix(in srgb, canvas 92%, transparent)',
      'box-shadow:0 0 0 1px color-mix(in srgb, currentColor 22%, transparent)'
    )
  }
  parts.push('padding:0.05rem 0.28rem', 'border-radius:0.2rem', 'line-height:1.1', 'white-space:nowrap')
  return {
    letter,
    fontSize,
    bold,
    style: parts.filter(Boolean).join(';')
  }
}

/**
 * Extra mosaic padding so outside badges sit fully inside the mosaic box (view + PNG/SVG).
 * @param {object | null | undefined} layout
 */
export function mosaicPanelLetterPadStyle(layout) {
  if (!layout?.panelLetterShow || String(layout.panelLetterPlacement || 'outside') !== 'outside') {
    return ''
  }
  const pos = String(layout.panelLetterPosition || 'outside-tl')
  const fs = panelLetterResolvedFontSize(layout, 13)
  const ox = Number(layout?.panelLetterOffsetX) || 0
  const oy = Number(layout?.panelLetterOffsetY) || 0
  // Bold letter + badge pad + 0.1rem hang ≈ ~2× font-size on the side.
  const padL = pos.endsWith('-tr') ? 4 : Math.ceil(fs * 2.05 + Math.max(0, -ox) + 8)
  const padR = pos.endsWith('-tr') ? Math.ceil(fs * 2.05 + Math.max(0, ox) + 8) : 4
  const padT = Math.ceil(fs * 1.25 + Math.max(0, -oy) + 6)
  return `padding:${padT}px ${padR}px 4px ${padL}px;box-sizing:border-box;overflow:visible;`
}

/**
 * PlotSpec panel letter fields for publication PNG/PDF.
 * @param {object | null | undefined} layout
 * @param {number} [cellIndex]
 * @param {number} [titleFontSize]
 */
export function plotSpecPanelLetter(layout, cellIndex = 0, titleFontSize = 13) {
  const letter = panelLetterForCell(layout, cellIndex)
  if (!letter) return {}
  const placement = String(layout?.panelLetterPlacement || 'outside')
  let loc = String(layout?.panelLetterPosition || 'outside-tl')
  // Outside placement always uses axes-fraction coords outside the frame.
  if (placement === 'outside' && loc.startsWith('inside')) {
    loc = loc.replace('inside', 'outside')
  }
  if (placement === 'inside' && loc.startsWith('outside')) {
    loc = loc.replace('outside', 'inside')
  }
  const color = String(layout?.panelLetterColor || '').trim()
  /** @type {Record<string, string | number | boolean>} */
  const out = {
    panel_letter: letter,
    panel_letter_fontsize: panelLetterResolvedFontSize(layout, titleFontSize),
    panel_letter_bold: layout?.panelLetterBold !== false,
    panel_letter_loc: loc,
    panel_letter_dx: Number(layout?.panelLetterOffsetX) || 0,
    panel_letter_dy: Number(layout?.panelLetterOffsetY) || 0
  }
  if (color) out.panel_letter_color = color
  return out
}

/**
 * Height as padding-bottom % of width. Use this instead of CSS `aspect-ratio`
 * inside flex + overflow panes — Chromium can tight-loop layout with no JS error.
 * @param {unknown} aspect
 */
export function aspectPaddingBottom(aspect) {
  const a = Number(aspect)
  const n = Number.isFinite(a) && a > 0.05 && a < 100 ? a : 2.5
  return `${(100 / n).toFixed(4)}%`
}

/**
 * Flex classes for the outside-strip mosaic wrapper / ChartLegend self-align.
 * Left/right use cross-axis (vertical) align; top/bottom use self-* horizontally.
 * @param {object} layout
 * @returns {{ wrapper: string, self: string }}
 */
export function outsideLegendAlignClasses(layout) {
  const loc = String(layout?.legendOutside || 'bottom')
  const align = LEGEND_OUTSIDE_ALIGN.has(String(layout?.legendOutsideAlign))
    ? String(layout.legendOutsideAlign)
    : 'center'
  const side = loc === 'left' || loc === 'right'
  if (side) {
    const items =
      align === 'end' ? 'items-end' : align === 'start' ? 'items-start' : 'items-center'
    return { wrapper: `flex-row ${items}`, self: '' }
  }
  const self =
    align === 'end' ? 'self-end' : align === 'start' ? 'self-start' : 'self-center'
  return { wrapper: 'flex-col', self }
}

/**
 * @param {object} layout
 * @param {number} cellIndex
 */
export function cellShowsLegend(layout, cellIndex) {
  const over = cellOverride(layout, cellIndex)
  if (typeof over.showLegend === 'boolean') return over.showLegend
  const mode = layout?.legendMode || 'each'
  if (mode === 'none' || mode === 'outside') return false
  if (mode === 'one') return cellIndex === Number(layout?.legendCell || 0)
  return true
}

/**
 * @param {string[]} ids
 * @param {number} index
 * @param {-1 | 1} dir
 */
export function moveIdInList(ids, index, dir) {
  const next = [...ids]
  const j = index + dir
  if (index < 0 || j < 0 || index >= next.length || j >= next.length) return next
  const tmp = next[index]
  next[index] = next[j]
  next[j] = tmp
  return next
}

/**
 * Split panels into full rows and an optional short last row for alignment.
 * Empty panels are kept so placeholders stay editable in the live mosaic.
 * @param {Array<{ empty?: boolean }>} panels
 * @param {number} cols
 * @param {'start' | 'center' | 'end'} lastRowAlign
 * @returns {{ fullRows: typeof panels[], lastRow: typeof panels, lastAlign: null | 'center' | 'end' }}
 */
export function mosaicRows(panels, cols, lastRowAlign) {
  const nCols = Math.max(1, cols)
  const list = Array.isArray(panels) ? panels : []
  /** @type {typeof list[]} */
  const rows = []
  for (let i = 0; i < list.length; i += nCols) {
    rows.push(list.slice(i, i + nCols))
  }
  if (!rows.length) return { fullRows: [], lastRow: [], lastAlign: null }
  const align = LAST_ROW.has(String(lastRowAlign)) ? String(lastRowAlign) : 'start'
  const last = rows[rows.length - 1]
  const incomplete = last.length > 0 && last.length < nCols
  if (!incomplete || align === 'start') {
    return { fullRows: rows, lastRow: [], lastAlign: null }
  }
  return {
    fullRows: rows.slice(0, -1),
    lastRow: last,
    lastAlign: /** @type {'center' | 'end'} */ (align)
  }
}

/**
 * Concatenate per-set series chunks in `setIds` order (later ids draw on top).
 * Missing or empty chunks are skipped, not dropped from the id list.
 * @param {string[]} setIds
 * @param {Record<string, unknown[]>} seriesBySetId
 */
export function concatInSetIdOrder(setIds, seriesBySetId) {
  const bag = seriesBySetId && typeof seriesBySetId === 'object' ? seriesBySetId : {}
  /** @type {unknown[]} */
  const out = []
  for (const id of normalizeIdList(setIds)) {
    const chunk = bag[id]
    if (Array.isArray(chunk) && chunk.length) out.push(...chunk)
  }
  return out
}

/**
 * Outside-strip legend items: unique sets in first-assignment order,
 * optional series roles (Mean / Upper / Lower) once, or curated manual entries.
 * @param {Array<{ setId?: string, seriesRole?: string, name?: string, color?: string, marker?: string }>} series
 * @param {object} layout
 * @param {{ setNames?: Record<string, string>, setColors?: Record<string, string> }} [opts]
 */
export function figureLegendItems(series, layout, opts = {}) {
  const entries = layout?.legendEntries || 'sets'
  if (entries === 'manual') {
    return normalizeManualLegendItems(layout?.legendManualItems)
      .filter((m) => m.visible)
      .map((m) => ({
        key: m.id,
        name: m.label,
        color: m.color,
        marker: m.marker,
        markerSize: m.markerSize
      }))
  }
  const names = opts.setNames && typeof opts.setNames === 'object' ? opts.setNames : {}
  const colors = opts.setColors && typeof opts.setColors === 'object' ? opts.setColors : {}
  const list = Array.isArray(series) ? series : []
  const order = assignedSetIdsInOrder(layout, 'grid')
  /** @type {Array<{ key: string, name: string, color: string, marker?: string, markerSize?: number }>} */
  const items = []
  if (entries === 'sets' || entries === 'both') {
    for (const id of order) {
      const s = list.find((x) => x && x.setId === id)
      if (!s) continue
      items.push({
        key: `set-${id}`,
        name: names[id] || s.name || id,
        color: s.color || colors[id] || '#888888',
        marker: s.marker || 'none'
      })
    }
  }
  if (entries === 'roles' || entries === 'both') {
    const seen = new Set()
    for (const s of list) {
      if (!s) continue
      const role = String(s.seriesRole || 'mean')
      if (seen.has(role)) continue
      seen.add(role)
      const label =
        role === 'mean'
          ? 'Mean'
          : role === 'upper'
            ? 'Upper'
            : role === 'lower'
              ? 'Lower'
              : s.name || role
      items.push({
        key: `role-${role}`,
        name: label,
        color: s.color || '#888888',
        marker: s.marker || 'none'
      })
    }
  }
  return items
}

/**
 * Estimate natural outside-legend outer box size (matches ChartLegend content math).
 * Used to seed Box width/height when leaving "auto".
 * @param {{
 *   series?: Array<{ name?: string, key?: string }>,
 *   columns?: number,
 *   title?: string,
 *   fontSize?: number,
 *   titleFontSize?: number,
 *   titleGap?: number,
 *   swatchWidth?: number,
 *   swatchHeight?: number,
 *   boxPadding?: number,
 *   boxBorderWidth?: number
 * }} opts
 * @returns {{ width: number, height: number, contentW: number, contentH: number }}
 */
export function estimateOutsideLegendNaturalBox(opts = {}) {
  const items = (Array.isArray(opts.series) ? opts.series : []).filter(
    (s) => s && (s.name || s.key)
  )
  const fs = Math.max(1, Number(opts.fontSize) || 10)
  const tfs = Math.max(1, Number(opts.titleFontSize) > 0 ? Number(opts.titleFontSize) : fs)
  const gap =
    opts.titleGap == null || opts.titleGap === ''
      ? 8
      : Math.max(0, Number(opts.titleGap) || 0)
  const swW = Math.max(1, Number(opts.swatchWidth) || 12)
  const swH = Math.max(1, Number(opts.swatchHeight) || 12)
  const cols = Math.max(1, Math.min(8, Math.round(Number(opts.columns) || 1)))
  const titleText = String(opts.title || '').trim()
  const itemH = Math.max(14, swH + 6, fs + 4)
  const maxLen = Math.max(...items.map((s) => String(s.name || '').length), 4)
  const itemW = maxLen * fs * 0.62 + swW + 16
  const rows = Math.max(1, Math.ceil(items.length / cols) || 1)
  const titleBand = titleText ? tfs + gap : 0
  const contentW = Math.max(40, cols * itemW + 8)
  const contentH = titleBand + rows * itemH + 8
  const pad =
    opts.boxPadding == null || opts.boxPadding === ''
      ? 8
      : Math.max(0, Number(opts.boxPadding) || 0)
  const borderW = Math.max(0, Number(opts.boxBorderWidth) || 0)
  return {
    width: Math.round(contentW + pad * 2 + borderW * 2),
    height: Math.round(contentH + pad * 2 + borderW * 2),
    contentW: Math.round(contentW),
    contentH: Math.round(contentH)
  }
}

export const CELL_PLOT_KEYS = [
  'legendPosition',
  'legendFontSize',
  'legendSwatchSize',
  'axisFontSize',
  'axisFontBold',
  'titleFontSize',
  'extraLeftMargin',
  'extraRightMargin',
  'extraTopMargin',
  'extraBottomMargin',
  'showGrid',
  'gridColor',
  'tickLabelGap',
  'lineWidth',
  'lineStyle',
  'plotBg',
  'plotBgCustomized'
]

/** Extra per-cell keys for energetic mosaics (mixed Y units). */
export const ENERGETIC_CELL_PLOT_KEYS = [...CELL_PLOT_KEYS, 'yMin', 'yMax', 'yLabel', 'title']

/**
 * Overlay per-cell plot settings on the analysis-type defaults.
 * @param {object} base
 * @param {object} override
 * @param {string[]} [keys]
 */
export function mergeCellPlotSettings(base, override, keys = CELL_PLOT_KEYS) {
  const o = override && typeof override === 'object' ? override : {}
  const out = { ...(base || {}) }
  for (const key of keys) {
    if (o[key] === undefined || o[key] === '') continue
    out[key] = o[key]
  }
  return out
}

/**
 * GUI SVG user-unit fonts (viewBox 900) map to matplotlib points.
 * Defaults 10–13 → ~8–9 pt; large GUI values are clamped so Pub PNG legends stay readable.
 * @param {unknown} px
 * @param {number} [fallback=8]
 */
export function guiSvgFontToMpl(px, fallback = 8) {
  const n = Number(px)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(6, Math.min(11, Math.round(n * 0.28 + 5.2)))
}

/**
 * @param {object} layout
 * @param {number} cellIndex
 * @param {Record<string, unknown>} patch
 */
export function patchCellPlotOverride(layout, cellIndex, patch) {
  const key = String(Math.max(0, Math.round(Number(cellIndex) || 0)))
  const prev = cellOverride(layout, Number(key))
  const cellOverrides = {
    ...(layout?.cellOverrides && typeof layout.cellOverrides === 'object' ? layout.cellOverrides : {}),
    [key]: { ...prev, ...(patch && typeof patch === 'object' ? patch : {}) }
  }
  return normalizeGridLayout({ ...layout, cellOverrides })
}

/**
 * Remove keys from every cell override so a global “apply to all” write wins.
 * @param {object} layout
 * @param {string[]} keys
 */
export function clearCellPlotKeysFromOverrides(layout, keys) {
  const keySet = new Set(keys || [])
  const src =
    layout?.cellOverrides && typeof layout.cellOverrides === 'object' ? layout.cellOverrides : {}
  /** @type {Record<string, object>} */
  const cellOverrides = {}
  for (const [k, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue
    const next = { ...v }
    for (const key of keySet) delete next[key]
    if (Object.keys(next).length > 0) cellOverrides[k] = next
  }
  return normalizeGridLayout({ ...layout, cellOverrides })
}

/**
 * Unique set ids in first-assignment order across cells (or overlay).
 * @param {object} layout
 * @param {'overlay' | 'grid'} compareLayout
 */
export function assignedSetIdsInOrder(layout, compareLayout) {
  if (compareLayout === 'overlay') return normalizeIdList(layout?.overlaySetIds)
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const cell of activeGridCells(layout || {})) {
    for (const id of cell?.setIds || []) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

const REF_Z_ORDERS = new Set(['back', 'forward'])

/**
 * @param {unknown} raw
 * @param {number} fallback
 */
function clampOpacity(raw, fallback = 1) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/**
 * @param {unknown} raw
 * @returns {'back' | 'forward'}
 */
function normalizeZOrder(raw) {
  return REF_Z_ORDERS.has(String(raw)) ? /** @type {'back'|'forward'} */ (String(raw)) : 'back'
}

/**
 * @param {unknown} raw
 * @returns {Array<{
 *   axis: 'x'|'y',
 *   value: number,
 *   color: string,
 *   width: number,
 *   style: string,
 *   label: string,
 *   opacity: number,
 *   zOrder: 'back'|'forward'
 * }>}
 */
export function normalizeReferenceLines(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {Array<{ axis: 'x'|'y', value: number, color: string, width: number, style: string, label: string, opacity: number, zOrder: 'back'|'forward' }>} */
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = /** @type {Record<string, unknown>} */ (item)
    const value = Number(obj.value)
    if (!Number.isFinite(value)) continue
    const axis = REF_AXES.has(String(obj.axis)) ? String(obj.axis) : 'y'
    const style = REF_STYLES.has(String(obj.style)) ? String(obj.style) : 'dashed'
    const width = Number(obj.width)
    out.push({
      axis,
      value,
      color: String(obj.color || '#888888'),
      width: Number.isFinite(width) && width > 0 ? width : 1.2,
      style,
      label: String(obj.label || ''),
      opacity: clampOpacity(obj.opacity, 1),
      zOrder: normalizeZOrder(obj.zOrder ?? obj.z_order)
    })
  }
  return out
}

export function emptyReferenceLine() {
  return {
    axis: 'y',
    value: 0,
    color: '#888888',
    width: 1.2,
    style: 'dashed',
    label: '',
    opacity: 1,
    zOrder: 'back'
  }
}

/**
 * Parse a band min/max field for live editing.
 * Empty stays empty (never coerced to 0) so clearing one bound does not
 * rewrite the other via Number('') === 0 + min/max swap.
 * @param {unknown} raw
 * @returns {number | ''}
 */
export function coerceReferenceBandBound(raw) {
  if (raw === '' || raw == null) return ''
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : ''
  const s = String(raw)
  if (s.trim() === '') return ''
  // Keep in-progress typed values (e.g. "-", ".", "1e") instead of forcing NaN→0.
  if (
    s === '+' ||
    s === '-' ||
    s === '.' ||
    s === '-.' ||
    s === '+.' ||
    /[eE][+-]?$/.test(s.trim())
  ) {
    return s
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : s
}

/**
 * Numeric bound for drawing/export; empty or incomplete → NaN.
 * @param {unknown} raw
 */
export function referenceBandBoundNumber(raw) {
  if (raw === '' || raw == null) return NaN
  if (typeof raw === 'string' && raw.trim() === '') return NaN
  if (
    typeof raw === 'string' &&
    (raw === '+' ||
      raw === '-' ||
      raw === '.' ||
      raw === '-.' ||
      raw === '+.' ||
      /[eE][+-]?$/.test(raw.trim()))
  ) {
    return NaN
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Horizontal (y) or vertical (x) shaded band between min/max.
 * Empty min/max strings are preserved for in-progress edits (do not swap).
 * @param {unknown} raw
 * @returns {Array<{
 *   axis: 'x'|'y',
 *   min: number | string,
 *   max: number | string,
 *   color: string,
 *   opacity: number,
 *   zOrder: 'back'|'forward',
 *   border: boolean,
 *   borderColor: string,
 *   borderWidth: number,
 *   borderStyle: string,
 *   label: string
 * }>}
 */
export function normalizeReferenceBands(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {Array<{ axis: 'x'|'y', min: number | string, max: number | string, color: string, opacity: number, zOrder: 'back'|'forward', border: boolean, borderColor: string, borderWidth: number, borderStyle: string, label: string }>} */
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = /** @type {Record<string, unknown>} */ (item)
    const min = coerceReferenceBandBound(obj.min ?? obj.start ?? obj.lo)
    const max = coerceReferenceBandBound(obj.max ?? obj.end ?? obj.hi)
    // Drop only when both bounds are absent/invalid (not mid-edit empties).
    const minN = referenceBandBoundNumber(min)
    const maxN = referenceBandBoundNumber(max)
    const editing = min === '' || max === '' || typeof min === 'string' || typeof max === 'string'
    if (!editing && !Number.isFinite(minN) && !Number.isFinite(maxN)) continue
    const axis = REF_AXES.has(String(obj.axis)) ? String(obj.axis) : 'y'
    const borderStyle = REF_STYLES.has(String(obj.borderStyle ?? obj.border_style))
      ? String(obj.borderStyle ?? obj.border_style)
      : 'solid'
    const borderWidth = Number(obj.borderWidth ?? obj.border_width)
    const color = String(obj.color || '#888888')
    out.push({
      axis,
      min,
      max,
      color,
      opacity: clampOpacity(obj.opacity, 0.2),
      zOrder: normalizeZOrder(obj.zOrder ?? obj.z_order),
      border: obj.border === true || obj.border === 1 || obj.border === '1' || obj.border === 'true',
      borderColor: String(obj.borderColor || obj.border_color || color),
      borderWidth: Number.isFinite(borderWidth) && borderWidth > 0 ? borderWidth : 1,
      borderStyle,
      label: String(obj.label || '')
    })
  }
  return out
}

/**
 * Bands ready for chart draw / publication (both bounds finite; ordered).
 * @param {unknown} raw
 */
export function finalizeReferenceBands(raw) {
  /** @type {ReturnType<typeof normalizeReferenceBands>} */
  const out = []
  for (const band of normalizeReferenceBands(raw)) {
    const lo = referenceBandBoundNumber(band.min)
    const hi = referenceBandBoundNumber(band.max)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    out.push({
      ...band,
      min: Math.min(lo, hi),
      max: Math.max(lo, hi)
    })
  }
  return out
}

export function emptyReferenceBand() {
  return {
    axis: 'y',
    min: 0,
    max: 1,
    color: '#888888',
    opacity: 0.2,
    zOrder: 'back',
    border: false,
    borderColor: '#888888',
    borderWidth: 1,
    borderStyle: 'solid',
    label: ''
  }
}

/** Dash on/off lengths in units of line width (butt caps). */
const DASH_UNITS = {
  dashed: [4, 2.5],
  dotted: [1, 2],
  dashdot: [4, 1.8, 1, 1.8]
}

/**
 * SVG dash pattern in the same units as stroke width.
 * Lengths grow with `lineWidth` so gaps stay visible on thick strokes.
 * @param {string} style
 * @param {unknown} [lineWidth=2]
 */
export function strokeDashForStyle(style, lineWidth = 2) {
  const units = DASH_UNITS[String(style || 'solid')]
  if (!units) return ''
  const w = Math.max(0.5, Number(lineWidth) || 2)
  return units.map((u) => Number((u * w).toFixed(2))).join(' ')
}

/**
 * Matplotlib linestyle.
 * @param {string} style
 */
export function mplLineStyle(style) {
  if (style === 'dashed') return '--'
  if (style === 'dotted') return ':'
  if (style === 'dashdot') return '-.'
  return '-'
}

/**
 * GridSpec slices into a (rows × cols*2) micro-grid so a short last row can align.
 * @param {number} nPanels
 * @param {number} cols
 * @param {'start' | 'center' | 'end'} lastRowAlign
 * @returns {{ slices: Array<{ row: number, c0: number, c1: number }>, rows: number, microCols: number }}
 */
export function gridSpecSlices(nPanels, cols, lastRowAlign) {
  const nCols = Math.max(1, cols)
  const n = Math.max(0, nPanels)
  const rows = Math.max(1, Math.ceil(n / nCols) || 1)
  const microCols = nCols * 2
  /** @type {Array<{ row: number, c0: number, c1: number }>} */
  const slices = []
  const full = Math.floor(n / nCols)
  const rem = n % nCols
  for (let i = 0; i < full * nCols; i++) {
    const r = Math.floor(i / nCols)
    const c = i % nCols
    slices.push({ row: r, c0: c * 2, c1: c * 2 + 2 })
  }
  if (rem) {
    const r = full
    const start =
      lastRowAlign === 'center'
        ? nCols - rem
        : lastRowAlign === 'end'
          ? 2 * (nCols - rem)
          : 0
    for (let k = 0; k < rem; k++) {
      const c0 = start + k * 2
      slices.push({ row: r, c0, c1: c0 + 2 })
    }
  }
  return { slices, rows, microCols }
}

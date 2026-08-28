/**
 * Build PlotSpec JSON from GUI energetic analysis state (mirrors gatewizard plot_spec.py).
 */

import { plotSpecAxisChrome, plotSpecExtraMargins } from './analysisGridLayout.js'

const DEFAULT_LINE_COLORS = [
  '#f59e0b',
  '#22c55e',
  '#38bdf8',
  '#f87171',
  '#a78bfa',
  '#f472b6',
  '#61afef',
  '#98c379'
]

/**
 * @param {string | number | null | undefined} v
 * @returns {[number, number] | null}
 */
function pair(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? [n, n] : null
}

/**
 * @param {string | number | null | undefined} min
 * @param {string | number | null | undefined} max
 * @returns {[number, number] | null}
 */
function limits(min, max) {
  const lo = min === '' || min == null ? null : Number(min)
  const hi = max === '' || max == null ? null : Number(max)
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return lo <= hi ? [lo, hi] : [hi, lo]
}

/**
 * @param {object} opts
 * @param {'overlay'|'grid'} opts.layout
 * @param {object} opts.globalSettings
 * @param {Record<string, object>} opts.panelSettings
 * @param {Array<{ key?: string, baseName?: string, name?: string, unit?: string }>} opts.rawSeries
 * @param {string[]} opts.selectedKeys
 * @param {string} opts.timeUnits
 * @param {string} opts.energyUnits
 */
export function buildPlotSpecFromGui({
  layout = 'overlay',
  globalSettings = {},
  panelSettings = {},
  rawSeries = [],
  selectedKeys = [],
  timeUnits = 'ns',
  energyUnits = 'kcal/mol'
}) {
  const g = globalSettings
  const visible = rawSeries.filter((s) => selectedKeys.includes(s.baseName ?? s.name ?? s.key))
  const panels = visible.map((s, i) => {
    const key = s.key ?? s.baseName ?? s.name
    const ps = panelSettings[key] ?? panelSettings[s.baseName] ?? {}
    const name = s.baseName ?? s.name ?? key
    const unit = s.unit ?? ''
    return {
      key,
      name,
      title: ps.title || name,
      ylabel: ps.ylabel || (unit ? `${name} (${unit})` : name),
      line_color: ps.lineColor || DEFAULT_LINE_COLORS[i % DEFAULT_LINE_COLORS.length],
      linewidth: Number(ps.lineWidth) || Number(g.lineWidth) || 1.5,
      linestyle: ps.lineStyle || g.lineStyle || 'solid',
      xlim: limits(ps.xMin, ps.xMax),
      ylim: limits(ps.yMin, ps.yMax),
      show_grid: ps.showGrid ?? null
    }
  })

  return {
    version: 1,
    layout: layout === 'grid' ? 'grid' : 'overlay',
    cols: 2,
    sync_x: g.syncX !== false,
    global: {
      time_units: timeUnits,
      energy_units: energyUnits,
      plot_bg: g.plotBg ?? '#0a0a0a',
      fig_bg: g.plotBg ?? '#0a0a0a',
      text_color: g.textColor ?? '#a3a3a3',
      grid_color: g.gridColor ?? '#262626',
      show_grid: g.showGrid !== false,
      figsize: [10, 6],
      dpi: Number(g.dpi) || 300,
      font_family: g.fontFamily ?? 'Roboto, sans-serif',
      xlabel: g.xLabel || `Time (${timeUnits})`,
      title: g.title || null,
      xlim: limits(g.xMin, g.xMax),
      ...plotSpecAxisChrome(g),
      ...plotSpecExtraMargins(g)
    },
    panels
  }
}

/**
 * Default per-panel settings for a property key.
 * @param {string} [lineColor]
 */
export function defaultPanelSettings(lineColor = '#f59e0b') {
  return {
    title: '',
    ylabel: '',
    lineColor,
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
    showGrid: null
  }
}

export const energGlobalDefaults = {
  title: '',
  xLabel: '',
  syncX: true,
  layout: 'grid',
  plotBg: '',
  textColor: '',
  plotBgCustomized: false,
  textColorCustomized: false,
  gridColor: '#262626',
  showGrid: true,
  lineWidth: '2',
  lineStyle: 'solid',
  tickLength: '4',
  tickWidth: '1',
  spineWidth: '1',
  showTicks: true,
  spineLeft: true,
  spineBottom: true,
  spineTop: false,
  spineRight: false,
  extraLeftMargin: '0',
  extraRightMargin: '0',
  extraTopMargin: '0',
  extraBottomMargin: '0',
  xMin: '',
  xMax: '',
  dpi: '300',
  fontFamily: 'Roboto, sans-serif'
}

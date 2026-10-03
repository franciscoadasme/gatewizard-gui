/** Residue-type colors from the PropKa distribution example. */
export const TITRATION_TYPE_COLORS = {
  ASP: '#e74c3c',
  GLU: '#f92f94',
  HIS: '#72e183',
  LYS: '#60cae7',
  CYS: '#9b59b6',
  TYR: '#5b76f8',
  ARG: '#f39c12',
  'N+': '#95a5a6',
  'C-': '#34495e',
  NTE: '#95a5a6',
  CTE: '#34495e'
}

const FALLBACK_COLORS = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6', '#94a3b8']

const TYPE_ORDER = ['ARG', 'ASP', 'CYS', 'GLU', 'HIS', 'LYS', 'TYR', 'N+', 'C-', 'NTE', 'CTE']

/**
 * @param {string} residue
 * @param {number} index
 */
export function titrationTypeColor(residue, index = 0) {
  const base = TITRATION_TYPE_COLORS[residue]
  if (base) return shadeHex(base, index)
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/**
 * @param {string} hex
 * @param {number} index
 */
function shadeHex(hex, index) {
  if (!index) return hex
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const toward = index % 2 === 1 ? 255 : 20
  const t = Math.min(0.55, 0.22 * Math.ceil(index / 2))
  const mix = (c) => Math.round(c + (toward - c) * t)
  return rgbToHex(mix(rgb[0]), mix(rgb[1]), mix(rgb[2]))
}

/** @param {string} hex */
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** @param {number} r @param {number} g @param {number} b */
function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * @param {Array<{ residue?: string, pka?: number, id?: string }>} residues
 * @param {number} targetPh
 * @param {number} [limit]
 */
export function suggestTitrationCurveIds(residues, targetPh, limit = 4) {
  const rows = (residues || []).filter((r) => r && r.id)
  const preferred = new Set(['ASP', 'GLU', 'HIS', 'LYS'])
  const ranked = [...rows].sort((a, b) => {
    const da = Math.abs(Number(a.pka) - targetPh)
    const db = Math.abs(Number(b.pka) - targetPh)
    const pa = preferred.has(String(a.residue)) ? 0 : 1
    const pb = preferred.has(String(b.residue)) ? 0 : 1
    if (pa !== pb) return pa - pb
    return da - db
  })
  const near = ranked.filter((r) => Math.abs(Number(r.pka) - targetPh) <= 2.5)
  const pool = near.length ? near : ranked
  return pool.slice(0, limit).map((r) => String(r.id))
}

/**
 * @param {unknown} raw
 */
export function normalizeTitrationResult(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const residues = Array.isArray(src.residues) ? src.residues.map(normalizeResidue) : []
  const curves = Array.isArray(src.curves) ? src.curves.map(normalizeCurve) : []
  const hiddenRaw = Array.isArray(src.disulfide_hidden)
    ? src.disulfide_hidden
    : Array.isArray(src.disulfideHidden)
      ? src.disulfideHidden
      : []
  return {
    pdbPath: String(src.pdb_path || src.pdbPath || ''),
    targetPh: Number(src.target_ph ?? src.targetPh),
    phMin: Number(src.ph_min ?? src.phMin),
    phMax: Number(src.ph_max ?? src.phMax),
    phStep: Number(src.ph_step ?? src.phStep),
    residues: residues.filter(Boolean),
    curves: curves.filter(Boolean),
    disulfideWarning: String(src.disulfide_warning || src.disulfideWarning || ''),
    disulfideHidden: hiddenRaw.map(normalizeDisulfideHidden).filter(Boolean)
  }
}

/** @param {unknown} raw */
function normalizeDisulfideHidden(raw) {
  if (!raw || typeof raw !== 'object') return null
  const row = /** @type {Record<string, unknown>} */ (raw)
  const id = String(row.id || '').trim()
  if (!id) return null
  const distance = Number(row.distance)
  return {
    id,
    label: String(row.label || id),
    partner: String(row.partner || ''),
    distance: Number.isFinite(distance) ? distance : null,
    pka: Number(row.pka),
    source: String(row.source || '')
  }
}

/** @param {unknown} raw */
function normalizeResidue(raw) {
  if (!raw || typeof raw !== 'object') return null
  const row = /** @type {Record<string, unknown>} */ (raw)
  const id = String(row.id || '').trim()
  if (!id) return null
  const pka = Number(row.pka)
  if (!Number.isFinite(pka)) return null
  return {
    id,
    label: String(row.label || id),
    residue: String(row.residue || ''),
    resId: Number(row.res_id ?? row.resId) || 0,
    chain: String(row.chain || ''),
    pka,
    state: String(row.state || ''),
    protonated: Boolean(row.protonated)
  }
}

/** @param {unknown} raw */
function normalizeCurve(raw) {
  if (!raw || typeof raw !== 'object') return null
  const row = /** @type {Record<string, unknown>} */ (raw)
  const id = String(row.id || '').trim()
  if (!id) return null
  const ph = Array.isArray(row.ph) ? row.ph.map(Number).filter((n) => Number.isFinite(n)) : []
  const y = Array.isArray(row.y) ? row.y.map(Number).filter((n) => Number.isFinite(n)) : []
  return {
    id,
    label: String(row.label || id),
    residue: String(row.residue || ''),
    resId: Number(row.res_id ?? row.resId) || 0,
    chain: String(row.chain || ''),
    pka: Number(row.pka),
    ph,
    y
  }
}

/**
 * Recompute protonated flags when the displayed pH differs from the run.
 * @param {number} pka
 * @param {number} targetPh
 */
export function isProtonated(pka, targetPh) {
  return targetPh < pka
}

/**
 * @param {{ residues: Array<{ id: string, label: string, residue: string, pka: number }>, curves: Array<{ id: string, label: string, residue: string, ph: number[], y: number[] }> }} result
 * @param {{ targetPh: number, typeFilter?: string[], curveIds?: string[], excludeIds?: string[], disulfideIds?: string[], colorOverrides?: Record<string, string> }} opts
 */
export function deriveTitrationView(result, opts) {
  const targetPh = Number(opts?.targetPh)
  const filter = new Set((opts?.typeFilter || []).map((t) => String(t)))
  const useFilter = filter.size > 0
  const excluded = new Set([
    ...(opts?.excludeIds || []).map(String),
    ...(opts?.disulfideIds || []).map(String)
  ])
  const overrides = opts?.colorOverrides || {}
  const residues = (result?.residues || []).filter(
    (r) => !excluded.has(r.id) && (!useFilter || filter.has(r.residue))
  )
  const present = []
  const seen = new Set()
  for (const name of TYPE_ORDER) {
    if (residues.some((r) => r.residue === name)) {
      present.push(name)
      seen.add(name)
    }
  }
  for (const r of residues) {
    if (!seen.has(r.residue)) {
      present.push(r.residue)
      seen.add(r.residue)
    }
  }
  const types = present.map((name) => {
    const rows = residues.filter((r) => r.residue === name)
    const protonated = rows.filter((r) => isProtonated(r.pka, targetPh))
    return {
      name,
      color: overrides[`type:${name}`] || titrationTypeColor(name, 0),
      pka: rows.map((r) => r.pka),
      fraction: rows.length ? protonated.length / rows.length : 0,
      points: rows.map((r) => ({
        id: r.id,
        label: r.label,
        pka: r.pka,
        protonated: isProtonated(r.pka, targetPh)
      }))
    }
  })
  const wanted = new Set((opts?.curveIds || []).map(String))
  const byTypeCount = new Map()
  const curves = (result?.curves || [])
    .filter((c) => wanted.has(c.id))
    .filter((c) => !useFilter || filter.has(c.residue))
    .map((c) => {
      const n = byTypeCount.get(c.residue) || 0
      byTypeCount.set(c.residue, n + 1)
      const nPts = Math.min(c.ph.length, c.y.length)
      return {
        id: c.id,
        label: c.label,
        residue: c.residue,
        color: overrides[`curve:${c.id}`] || titrationTypeColor(c.residue, n),
        ph: c.ph.slice(0, nPts),
        y: c.y.slice(0, nPts)
      }
    })
  const allTypes = []
  const typeSeen = new Set()
  for (const r of result?.residues || []) {
    if (typeSeen.has(r.residue)) continue
    typeSeen.add(r.residue)
    allTypes.push(r.residue)
  }
  allTypes.sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a)
    const ib = TYPE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return { types, curves, allTypes, residues }
}

/**
 * @param {object} view
 * @param {object} chrome
 */
export function buildTitrationPublicationSpec(view, chrome) {
  return {
    target_ph: chrome.targetPh,
    show: { a: chrome.showA !== false, b: chrome.showB !== false, c: chrome.showC !== false },
    letters: chrome.letters || {},
    titles: chrome.titles || {},
    labels: chrome.labels || {},
    types: (view?.types || []).map((t) => ({
      name: t.name,
      color: t.color,
      pka: t.pka,
      fraction: t.fraction,
      points: t.points
    })),
    curves: (view?.curves || []).map((c) => ({
      label: c.label,
      color: c.color,
      ph: c.ph,
      y: c.y
    })),
    reference_lines: chrome.referenceLines || [],
    a_ymin: chrome.aYMin ?? '',
    a_ymax: chrome.aYMax ?? '',
    c_ymin: chrome.cYMin ?? '',
    c_ymax: chrome.cYMax ?? '',
    layout: {
      aspect_a: chrome.aspectA,
      aspect_b: chrome.aspectB,
      aspect_c: chrome.aspectC,
      height_a: chrome.heightA,
      height_b: chrome.heightB,
      left_share: chrome.leftShare,
      gap: chrome.panelGap,
      column_gap: chrome.columnGap,
      pixels: chrome.pixels || null
    },
    b_ymin: chrome.bYMin ?? '',
    b_ymax: chrome.bYMax ?? '',
    c_xmin: chrome.cXMin ?? '',
    c_xmax: chrome.cXMax ?? '',
    c_ypad: chrome.cYPad ?? 0.05,
    c_ytick_step: chrome.cYTickStep ?? '',
    c_ytick_count: chrome.cYTickCount ?? '',
    c_ytick_decimals: chrome.cYTickDecimals ?? '',
    fonts: chrome.fonts || {},
    markers: {
      pka: chrome.pkaMarkerSize,
      curve: chrome.curveMarkerSize
    },
    style: {
      dpi: chrome.dpi || 200,
      text_color: chrome.textColor || '#222222',
      plot_bg: chrome.plotBg || 'white',
      fig_bg: chrome.figBg || chrome.plotBg || 'white',
      font_family: chrome.fontFamily || 'sans-serif',
      show_grid: chrome.showGrid !== false,
      legend_fontsize: chrome.legendFontSize,
      legend_frame_c: chrome.legendFrameC !== false,
      spine_width: chrome.spineWidth,
      line_width: chrome.lineWidth,
      line_style: chrome.lineStyle || 'solid',
      spine_left: chrome.showSpineLeft,
      spine_bottom: chrome.showSpineBottom,
      spine_top: chrome.showSpineTop,
      spine_right: chrome.showSpineRight,
      extra_left: chrome.extraLeftMargin,
      extra_right: chrome.extraRightMargin,
      extra_top: chrome.extraTopMargin,
      extra_bottom: chrome.extraBottomMargin
    }
  }
}

/**
 * Tick values between lo and hi. A positive step wins; otherwise count splits the span.
 * @param {number} lo
 * @param {number} hi
 * @param {unknown} stepRaw
 * @param {unknown} countRaw
 */
export function axisTicks(lo, hi, stepRaw, countRaw) {
  const span = hi - lo
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(span) || span === 0) return [lo]
  let step = Number(stepRaw)
  if (!Number.isFinite(step) || step <= 0) {
    const count = Math.max(2, Math.min(20, Number(countRaw) || 5))
    step = span / (count - 1)
  }
  const ticks = []
  let v = Math.ceil((lo - step * 1e-9) / step) * step
  if (v < lo - step * 1e-6) v += step
  for (; v <= hi + step * 1e-6 && ticks.length < 30; v += step) {
    ticks.push(Math.round(v * 1e9) / 1e9)
  }
  return ticks.length ? ticks : [lo, hi]
}

/**
 * @param {number} value
 * @param {unknown} decimalsRaw
 */
export function formatAxisTick(value, decimalsRaw) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  const d = decimalsRaw === '' || decimalsRaw == null ? null : Number(decimalsRaw)
  if (d != null && Number.isFinite(d)) return n.toFixed(Math.max(0, Math.min(8, d)))
  const rounded = Math.round(n * 1000) / 1000
  return String(rounded)
}

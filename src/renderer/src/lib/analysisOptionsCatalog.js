/**
 * Searchable Analysis sidebar options: navigate + pulse highlight targets.
 * Kept in sync with STRUCTURAL_TYPE_GROUPS / Plot Settings section ids.
 */

import { STRUCTURAL_TYPE_GROUPS, STRUCTURAL_TYPE_TITLES } from './analysisSets.js'

/**
 * @typedef {Object} AnalysisOptionEntry
 * @property {string} id
 * @property {string} label
 * @property {string[]} [aliases]
 * @property {'analysis' | 'analysis-grid'} panel
 * @property {string} [sectionId]
 * @property {'structural' | 'energetic' | 'any'} [mode]
 * @property {string} [structuralType]
 * @property {boolean} [requiresGrid]
 */

/** @type {AnalysisOptionEntry[]} */
export const ANALYSIS_OPTIONS_CATALOG = [
  // Structural options
  {
    id: 'structural-type',
    label: 'Analysis type',
    aliases: ['structural type', 'rmsd', 'rmsf', 'apl', 'distance'],
    panel: 'analysis',
    sectionId: 'structural',
    mode: 'structural'
  },
  {
    id: 'selection',
    label: 'Selection',
    aliases: ['mdanalysis', 'atom group', 'selection string'],
    panel: 'analysis',
    sectionId: 'structural',
    mode: 'structural'
  },
  {
    id: 'apply-selection-all',
    label: 'Apply selection to all sets',
    aliases: ['copy selection', 'apply to all sets'],
    panel: 'analysis',
    sectionId: 'structural',
    mode: 'structural'
  },
  {
    id: 'apl-method',
    label: 'APL method',
    aliases: ['fatslim', 'evapl', 'gridmat', 'vtmc', 'area per lipid method'],
    panel: 'analysis',
    sectionId: 'structural',
    mode: 'structural',
    structuralType: 'area_per_lipid'
  },
  // Plot Settings — Figure
  {
    id: 'plot-title',
    label: 'Plot title',
    aliases: ['title', 'figure title'],
    panel: 'analysis',
    sectionId: 'figure',
    mode: 'any'
  },
  {
    id: 'legend-label',
    label: 'Legend label (this set)',
    aliases: ['series name', 'legend name'],
    panel: 'analysis',
    sectionId: 'figure',
    mode: 'structural'
  },
  // Limits & ticks
  {
    id: 'x-limits',
    label: 'X limits',
    aliases: ['x min', 'x max', 'axis limits'],
    panel: 'analysis',
    sectionId: 'limits',
    mode: 'any'
  },
  {
    id: 'y-limits',
    label: 'Y limits',
    aliases: ['y min', 'y max'],
    panel: 'analysis',
    sectionId: 'limits',
    mode: 'any'
  },
  {
    id: 'x-tick-step',
    label: 'X tick step',
    aliases: ['tick spacing', 'x step'],
    panel: 'analysis',
    sectionId: 'limits',
    mode: 'any'
  },
  {
    id: 'y-tick-step',
    label: 'Y tick step',
    aliases: ['y step'],
    panel: 'analysis',
    sectionId: 'limits',
    mode: 'any'
  },
  {
    id: 'sync-x-limits',
    label: 'Sync X limits',
    aliases: ['sync x', 'shared x'],
    panel: 'analysis',
    sectionId: 'limits',
    mode: 'energetic'
  },
  // Appearance
  {
    id: 'line-color',
    label: 'Line color',
    aliases: ['series color', 'set color'],
    panel: 'analysis',
    sectionId: 'appearance',
    mode: 'structural'
  },
  {
    id: 'plot-bg',
    label: 'Plot background',
    aliases: ['plot bg', 'background color'],
    panel: 'analysis',
    sectionId: 'appearance',
    mode: 'any'
  },
  {
    id: 'text-color',
    label: 'Text / axes color',
    aliases: ['text color', 'axes color'],
    panel: 'analysis',
    sectionId: 'appearance',
    mode: 'any'
  },
  {
    id: 'show-grid',
    label: 'Show grid',
    aliases: ['grid lines', 'grid color'],
    panel: 'analysis',
    sectionId: 'appearance',
    mode: 'any'
  },
  // Series
  {
    id: 'line-width',
    label: 'Line width',
    aliases: ['stroke width'],
    panel: 'analysis',
    sectionId: 'series',
    mode: 'any'
  },
  {
    id: 'line-style',
    label: 'Line style',
    aliases: ['dashed', 'dotted', 'dash-dot'],
    panel: 'analysis',
    sectionId: 'series',
    mode: 'any'
  },
  {
    id: 'apl-series',
    label: 'Area per lipid series',
    aliases: ['leaflet series', 'upper leaflet', 'lower leaflet', 'average'],
    panel: 'analysis',
    sectionId: 'series',
    mode: 'structural',
    structuralType: 'area_per_lipid'
  },
  // In-chart legend
  {
    id: 'legend-position',
    label: 'Legend position',
    aliases: ['in-chart legend', 'legend corner'],
    panel: 'analysis',
    sectionId: 'legend',
    mode: 'any'
  },
  {
    id: 'legend-square',
    label: 'Legend square',
    aliases: ['legend swatch', 'swatch size'],
    panel: 'analysis',
    sectionId: 'legend',
    mode: 'any'
  },
  {
    id: 'legend-font',
    label: 'Legend font',
    aliases: ['legend font size'],
    panel: 'analysis',
    sectionId: 'legend',
    mode: 'any'
  },
  // Typography
  {
    id: 'axis-font',
    label: 'Axis font',
    aliases: ['tick font', 'axis bold'],
    panel: 'analysis',
    sectionId: 'typography',
    mode: 'any'
  },
  {
    id: 'title-font',
    label: 'Title font',
    aliases: ['title size'],
    panel: 'analysis',
    sectionId: 'typography',
    mode: 'any'
  },
  // Margins
  {
    id: 'extra-margins',
    label: 'Extra margins',
    aliases: ['left margin', 'right margin', 'plot padding'],
    panel: 'analysis',
    sectionId: 'margins',
    mode: 'any'
  },
  {
    id: 'tick-marks',
    label: 'Tick marks',
    aliases: ['tick length', 'tick width', 'show ticks'],
    panel: 'analysis',
    sectionId: 'margins',
    mode: 'any'
  },
  {
    id: 'axis-box',
    label: 'Axis box / spines',
    aliases: ['spines', 'axis line'],
    panel: 'analysis',
    sectionId: 'margins',
    mode: 'any'
  },
  // Advanced
  {
    id: 'aspect-ratio',
    label: 'Aspect ratio',
    aliases: ['w/h', 'figure aspect'],
    panel: 'analysis',
    sectionId: 'advanced',
    mode: 'any'
  },
  {
    id: 'export-dpi',
    label: 'Export DPI',
    aliases: ['dpi', 'print dpi'],
    panel: 'analysis',
    sectionId: 'advanced',
    mode: 'any'
  },
  {
    id: 'font-family',
    label: 'Font family',
    aliases: ['font', 'typeface'],
    panel: 'analysis',
    sectionId: 'advanced',
    mode: 'any'
  },
  {
    id: 'show-selection-subtitle',
    label: 'Show selection on plot',
    aliases: ['selection subtitle'],
    panel: 'analysis',
    sectionId: 'advanced',
    mode: 'structural'
  },
  {
    id: 'reset-plot',
    label: 'Reset plot settings',
    aliases: ['reset'],
    panel: 'analysis',
    sectionId: 'advanced',
    mode: 'any'
  },
  // Grid options
  {
    id: 'grid-legend-mode',
    label: 'Legend placement (grid)',
    aliases: ['outside legend', 'legend mode', 'outside strip'],
    panel: 'analysis-grid',
    sectionId: 'grid-legend',
    mode: 'any',
    requiresGrid: true
  },
  {
    id: 'grid-outside-legend',
    label: 'Outside legend chrome',
    aliases: ['legend frame', 'strip font', 'legend padding'],
    panel: 'analysis-grid',
    sectionId: 'grid-legend',
    mode: 'any',
    requiresGrid: true
  }
]

// Ensure type titles appear as searchable aliases for structural types
for (const group of STRUCTURAL_TYPE_GROUPS) {
  for (const type of group.types) {
    const title = STRUCTURAL_TYPE_TITLES[type] || type
    ANALYSIS_OPTIONS_CATALOG.push({
      id: `type-${type}`,
      label: title,
      aliases: [type.replace(/_/g, ' '), group.label],
      panel: 'analysis',
      sectionId: 'structural',
      mode: 'structural',
      structuralType: type
    })
  }
}

/**
 * @param {string} query
 * @param {{ mode?: string, structuralType?: string, catalog?: AnalysisOptionEntry[] }} ctx
 * @returns {AnalysisOptionEntry[]}
 */
export function rankAnalysisOptions(query, ctx = {}) {
  const q = String(query || '')
    .trim()
    .toLowerCase()
  if (!q) return []
  const catalog = ctx.catalog || ANALYSIS_OPTIONS_CATALOG
  const mode = ctx.mode || 'structural'
  const structuralType = ctx.structuralType || ''

  /** @param {AnalysisOptionEntry} e */
  function matchScore(e) {
    const hay = [e.label, ...(e.aliases || [])].join(' ').toLowerCase()
    if (!hay.includes(q) && !q.split(/\s+/).every((w) => hay.includes(w))) return -1
    let score = 0
    if (e.label.toLowerCase().startsWith(q)) score += 40
    else if (e.label.toLowerCase().includes(q)) score += 25
    if ((e.aliases || []).some((a) => a.toLowerCase().includes(q))) score += 10
    const em = e.mode || 'any'
    if (em === mode || em === 'any') score += 20
    else score -= 5
    if (e.structuralType) {
      if (e.structuralType === structuralType) score += 30
      else if (mode === 'structural') score += 5
      else score -= 10
    }
    return score
  }

  return catalog
    .map((e) => ({ e, score: matchScore(e) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label))
    .slice(0, 12)
    .map((x) => x.e)
}

/**
 * @param {AnalysisOptionEntry} entry
 * @param {object} handlers
 */
export async function navigateToAnalysisOption(entry, handlers) {
  if (!entry) return
  if (entry.mode === 'structural' || entry.mode === 'energetic') {
    if (handlers.mode !== entry.mode && typeof handlers.setMode === 'function') {
      handlers.setMode(entry.mode)
    }
  }
  if (
    entry.structuralType &&
    entry.structuralType !== handlers.structuralType &&
    typeof handlers.setStructuralType === 'function'
  ) {
    await handlers.setStructuralType(entry.structuralType)
  }
  if (entry.panel === 'analysis-grid' || entry.requiresGrid) {
    handlers.openGridOptions?.()
  }
  if (entry.sectionId === 'structural') {
    handlers.openStructuralOptions?.()
  }
  if (
    entry.sectionId &&
    ['figure', 'limits', 'appearance', 'series', 'legend', 'typography', 'margins', 'advanced'].includes(
      entry.sectionId
    )
  ) {
    handlers.openPlotSettings?.()
    handlers.openPlotSection?.(entry.sectionId)
  }
  handlers.expandPanel?.(entry.panel)
  // Allow layout/DOM to settle (type switches re-render Structural Options).
  const settleMs = entry.structuralType ? 180 : 80
  await new Promise((r) => setTimeout(r, settleMs))
  handlers.pulseOption?.(resolveOptionHighlightId(entry))
}

/**
 * Map catalog entry ids to DOM `data-option-id` targets.
 * Type picks (`type-rmsd`, …) highlight the structural type Select.
 * @param {AnalysisOptionEntry | null | undefined} entry
 */
export function resolveOptionHighlightId(entry) {
  if (!entry?.id) return ''
  if (entry.id.startsWith('type-')) return 'structural-type'
  return entry.id
}

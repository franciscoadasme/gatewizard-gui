<script>
  import { onMount } from 'svelte'
  import ChartLegend from './ChartLegend.svelte'
  import { axisTickFractions, strokeDashForStyle } from '../lib/analysisGridLayout.js'

  let wrapEl = $state(/** @type {HTMLElement | null} */ (null))

  let {
    /** @type {Array<{ name: string, x: number[], y: number[], color?: string, strokeDasharray?: string, strokeWidth?: number, marker?: string, markerSize?: number, markerEvery?: number }>} */
    series = [],
    xLabel = 'X',
    yLabel = 'Y',
    className = '',
    plotBg = '#0a0a0a',
    axisColor = '#525252',
    gridColor = '#262626',
    tickColor = '#a3a3a3',
    labelColor = '#d4d4d4',
    showGrid = true,
    xMinOverride = null,
    xMaxOverride = null,
    yMinOverride = null,
    yMaxOverride = null,
    svgEl = $bindable(null),
    aspectRatio = 2.5,
    transparentBg = false,
    fontFamily = 'Roboto, sans-serif',
    chartTitle = '',
    chartSubtitle = '',
    xTickLabels = [],
    extraLeftMargin = 0,
    extraRightMargin = 0,
    extraTopMargin = 0,
    extraBottomMargin = 0,
    /** Gap between tick marks and tick numbers (SVG user units) */
    tickLabelGap = 8,
    legendPosition = 'bottom',
    xTicks = 5,
    yTicks = 5,
    /** Empty = auto trim; 0–8 fixed decimal places for axis ticks */
    xTickDecimals = '',
    yTickDecimals = '',
    /** Width/height of the legend color square in SVG units */
    legendSwatchSize = 12,
    /** Legend text size */
    legendFontSize = 10,
    /** Axis tick and axis-title size */
    axisFontSize = 12,
    /** Chart title size */
    titleFontSize = 13,
    showXLabel = true,
    showYLabel = true,
    showTicks = true,
    showXTickLabels = true,
    showYTickLabels = true,
    /** Keep left/bottom plot gutters even when labels or tick numbers are hidden */
    reserveXLabel = false,
    reserveYLabel = false,
    reserveXTickLabels = false,
    reserveYTickLabels = false,
    tickLength = 4,
    tickWidth = 1,
    spineWidth = 1,
    showSpineLeft = true,
    showSpineBottom = true,
    showSpineTop = false,
    showSpineRight = false,
    /** Data-unit step; empty / 0 uses even tick count */
    xTickStep = '',
    yTickStep = '',
    /** @type {Array<{ axis?: string, value: number, color?: string, width?: number, style?: string, label?: string }>} */
    referenceLines = [],
    /** @type {'none' | 'pan' | 'boxZoom' | 'rangeSelect'} */
    interactionMode = 'none',
    /** Highlight band for range stats [t0, t1] in data x units */
    statsRange = null,
    /** @type {((range: { xMin?: number, xMax?: number, yMin?: number, yMax?: number }) => void) | null} */
    onAxisRange = null,
    /** @type {((range: { t0: number, t1: number } | null) => void) | null} */
    onStatsRange = null,
    /** Fill parent height instead of CSS aspect-ratio (mosaic cells). */
    fillContainer = false
  } = $props()

  const palette = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']
  /** CSS pixel width of the chart box — settings are screen px, SVG viewBox is 900. */
  let cssW = $state(400)
  const width = 900
  const height = $derived(Math.round(width / aspectRatio))
  const pxToSvg = $derived(cssW > 16 ? width / cssW : 1)

  // Measure once (and on window resize). ResizeObserver + bind:clientWidth
  // fought mosaic layout after Overlay/Grid session load and starved all clicks.
  onMount(() => {
    const el = wrapEl
    if (!el) return
    const apply = () => {
      const n = Math.round(el.getBoundingClientRect().width)
      if (n > 16) cssW = n
    }
    apply()
    let timer = 0
    const onResize = () => {
      clearTimeout(timer)
      timer = window.setTimeout(apply, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  })

  /**
   * Dash lengths from plot settings are CSS px; stroke-width is also CSS px × pxToSvg.
   * @param {string | undefined} dash
   * @param {number} scale
   */
  function svgDasharray(dash, scale) {
    const raw = String(dash || '').trim()
    if (!raw) return undefined
    const parts = raw.split(/[\s,]+/).map((n) => Number(n) * scale)
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return raw
    return parts.join(' ')
  }
  const legendSwatch = $derived(Math.max(6, Number(legendSwatchSize) || 12) * pxToSvg)
  const legendFs = $derived(Math.max(7, Number(legendFontSize) || 10) * pxToSvg)
  const axisFs = $derived(Math.max(7, Number(axisFontSize) || 12) * pxToSvg)
  const titleFs = $derived(Math.max(8, Number(titleFontSize) || 13) * pxToSvg)
  const tickFs = $derived(Math.max(6 * pxToSvg, axisFs * 0.92))
  const edgePad = $derived(Math.max(4, 6 * pxToSvg))
  const tickLen = $derived(Math.max(0, Number(tickLength) || 0) * pxToSvg)
  const tickStroke = $derived(Math.max(0.2, Number(tickWidth) || 1) * pxToSvg)
  const spineStroke = $derived(Math.max(0.2, Number(spineWidth) || 1) * pxToSvg)
  const tickGap = $derived(Math.max(0, Number(tickLabelGap) || 8) * pxToSvg)
  const titleBand = $derived.by(() => {
    if (!chartTitle && !chartSubtitle) return edgePad
    const titleH = chartTitle ? titleFs * 1.15 + edgePad : 0
    const subH = chartSubtitle ? Math.max(8, titleFs - 3 * pxToSvg) * 1.15 + edgePad * 0.5 : 0
    return titleH + subH + edgePad
  })
  const yLabelX = $derived(showYLabel || reserveYLabel ? axisFs * 0.5 + edgePad : 0)
  /** Extra padding in SVG units; 0 is tight to labels, negative is allowed. */
  function extraSvg(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    return Math.max(-80, Math.min(240, n)) * pxToSvg
  }
  const margin = $derived.by(() => {
    const spaceYLabel = showYLabel || reserveYLabel
    const spaceYTickLabels = showYTickLabels || reserveYTickLabels
    const spaceXLabel = showXLabel || reserveXLabel
    const spaceXTickLabels = showXTickLabels || reserveXTickLabels
    const yLabelSpace = spaceYLabel ? yLabelX + axisFs * 0.2 : 0
    const yTickMarkSpace = showTicks ? tickLen : 0
    let yTickNumSpace = 0
    if (spaceYTickLabels) {
      const y0 = extents.yMin
      const y1 = extents.yMax
      const ticks = axisTickFractions(y0, y1, yTickStep, yTicks)
      let maxChars = 2
      for (const t of ticks) {
        const yVal = y1 - (y1 - y0) * t
        maxChars = Math.max(maxChars, String(fmtY(yVal)).length)
      }
      yTickNumSpace = Math.ceil(maxChars * tickFs * 0.58) + tickGap
    }
    const yTickSpace =
      yTickMarkSpace + yTickNumSpace || (spaceYLabel ? edgePad : edgePad * 0.5)
    const xLabelSpace = spaceXLabel ? axisFs + edgePad : 0
    const xTickMarkSpace = showTicks ? tickLen : 0
    const xTickNumSpace = spaceXTickLabels ? tickFs + tickGap + edgePad : 0
    const xTickSpace = xTickMarkSpace + xTickNumSpace || edgePad
    const extraL = extraSvg(extraLeftMargin)
    const extraR = extraSvg(extraRightMargin)
    const extraT = extraSvg(extraTopMargin)
    const extraB = extraSvg(extraBottomMargin)
    const rightBase = spaceXTickLabels
      ? Math.max(edgePad * 1.5, Math.ceil(tickFs * 2.8))
      : edgePad
    return {
      top: Math.max(2, titleBand + extraT),
      right: Math.max(2, rightBase + extraR),
      bottom: Math.max(2, xTickSpace + xLabelSpace + extraB),
      left: Math.max(2, yLabelSpace + yTickSpace + extraL)
    }
  })
  const clipId = `plot-clip-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
  const plotWidth = $derived(Math.max(40, width - margin.left - margin.right))
  const plotHeight = $derived(Math.max(40, height - margin.top - margin.bottom))

  const dataDomain = $derived(typeof onAxisRange === 'function')

  let scale = $state(1)
  let tx = $state(0)
  let ty = $state(0)
  let dragging = $state(false)
  let dragStart = $state({ x: 0, y: 0, tx: 0, ty: 0 })
  /** @type {{ x0: number, y0: number, x1: number, y1: number } | null} */
  let selectRect = $state(null)
  /** @type {null | 'left' | 'right' | 'move'} */
  let rangeHandleDrag = $state(null)
  /** @type {{ t0: number, t1: number, svgX: number } | null} */
  let rangeDragAnchor = $state(null)

  const RANGE_HANDLE_PX = 10

  let lastExtentsRefs = /** @type {Array<{ x: unknown, y: unknown }>} */ ([])
  let lastExtentsBase = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }

  const extents = $derived.by(() => {
    const refsChanged =
      series.length !== lastExtentsRefs.length ||
      series.some((s, i) => s.x !== lastExtentsRefs[i]?.x || s.y !== lastExtentsRefs[i]?.y)
    if (refsChanged) {
      let xMin = Infinity,
        xMax = -Infinity,
        yMin = Infinity,
        yMax = -Infinity
      for (const s of series) {
        const xs = s.x ?? []
        const ys = s.y ?? []
        const n = Math.min(xs.length, ys.length)
        // Sample extents on large series (full scan of 1e6+ points freezes UI).
        const step = n > 20000 ? Math.ceil(n / 8000) : 1
        for (let i = 0; i < n; i += step) {
          const xv = xs[i]
          const yv = ys[i]
          if (Number.isFinite(xv)) {
            xMin = Math.min(xMin, xv)
            xMax = Math.max(xMax, xv)
          }
          if (Number.isFinite(yv)) {
            yMin = Math.min(yMin, yv)
            yMax = Math.max(yMax, yv)
          }
        }
        if (n > 0) {
          const xv = xs[n - 1]
          const yv = ys[n - 1]
          if (Number.isFinite(xv)) {
            xMin = Math.min(xMin, xv)
            xMax = Math.max(xMax, xv)
          }
          if (Number.isFinite(yv)) {
            yMin = Math.min(yMin, yv)
            yMax = Math.max(yMax, yv)
          }
        }
      }
      if (!Number.isFinite(xMin)) {
        xMin = 0
        xMax = 1
      }
      if (!Number.isFinite(yMin)) {
        yMin = 0
        yMax = 1
      }
      if (xMin === xMax) xMax = xMin + 1
      if (yMin === yMax) yMax = yMin + 1
      const yPad = (yMax - yMin) * 0.05
      lastExtentsRefs = series.map((s) => ({ x: s.x, y: s.y }))
      lastExtentsBase = {
        xMin,
        xMax,
        yMin: yMin - yPad,
        yMax: yMax + yPad
      }
    }
    return {
      xMin: xMinOverride !== null && Number.isFinite(xMinOverride) ? xMinOverride : lastExtentsBase.xMin,
      xMax: xMaxOverride !== null && Number.isFinite(xMaxOverride) ? xMaxOverride : lastExtentsBase.xMax,
      yMin: yMinOverride !== null && Number.isFinite(yMinOverride) ? yMinOverride : lastExtentsBase.yMin,
      yMax: yMaxOverride !== null && Number.isFinite(yMaxOverride) ? yMaxOverride : lastExtentsBase.yMax
    }
  })

  function sx(x) {
    const { xMin, xMax } = extents
    return margin.left + ((x - xMin) / (xMax - xMin)) * plotWidth
  }
  function sy(y) {
    const { yMin, yMax } = extents
    return margin.top + (1 - (y - yMin) / (yMax - yMin)) * plotHeight
  }
  function dataX(svgX) {
    const { xMin, xMax } = extents
    const px = svgX - margin.left
    return xMin + (px / plotWidth) * (xMax - xMin)
  }
  function dataY(svgY) {
    const { yMin, yMax } = extents
    const py = svgY - margin.top
    return yMax - (py / plotHeight) * (yMax - yMin)
  }

  function pathFromSeries(s) {
    const xs = s.x ?? [],
      ys = s.y ?? []
    const n = Math.min(xs.length, ys.length)
    // Cap SVG path size so huge energetic series stay interactive.
    const maxPts = 4000
    const step = n > maxPts ? Math.ceil(n / maxPts) : 1
    let path = ''
    for (let i = 0; i < n; i += step) {
      const x = xs[i],
        y = ys[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      path += `${path === '' ? 'M' : 'L'}${sx(x)},${sy(y)} `
    }
    if (step > 1 && n > 0) {
      const x = xs[n - 1],
        y = ys[n - 1]
      if (Number.isFinite(x) && Number.isFinite(y)) {
        path += `L${sx(x)},${sy(y)} `
      }
    }
    return path.trim()
  }

  /** Cache path strings by x/y array identity so color/name edits do not rebuild geometry. */
  /** @type {WeakMap<object, { sig: string, ys: unknown, d: string }>} */
  const linePathMemo = new WeakMap()
  /** @type {WeakMap<object, { sig: string, ys: unknown, ds: string[] }>} */
  const markerMemo = new WeakMap()

  const geomSig = $derived(
    `${extents.xMin}:${extents.xMax}:${extents.yMin}:${extents.yMax}:${plotWidth}:${plotHeight}:${margin.left}:${margin.top}`
  )

  const linePaths = $derived.by(() => {
    const sig = geomSig
    return series.map((s) => {
      const xs = s.x
      const ys = s.y
      if (xs && typeof xs === 'object') {
        const hit = linePathMemo.get(xs)
        if (hit && hit.sig === sig && hit.ys === ys) return hit.d
        const d = pathFromSeries(s)
        linePathMemo.set(xs, { sig, ys, d })
        return d
      }
      return pathFromSeries(s)
    })
  })

  const markerPaths = $derived.by(() => {
    const sig = `${geomSig}:${series.map((s) => `${s.marker || 'none'}:${s.markerSize || 0}:${s.markerEvery || 0}`).join('|')}`
    return series.map((s) => {
      const xs = s.x
      const ys = s.y
      if (xs && typeof xs === 'object') {
        const hit = markerMemo.get(xs)
        if (hit && hit.sig === sig && hit.ys === ys) return hit.ds
        const ds = markersFromSeries(s)
        markerMemo.set(xs, { sig, ys, ds })
        return ds
      }
      return markersFromSeries(s)
    })
  })

  /** @param {string | undefined} marker @param {number} cx @param {number} cy @param {number} size */
  function markerPath(marker, cx, cy, size) {
    const r = Math.max(1.5, size)
    switch (marker) {
      case 'circle':
        return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
      case 'square': {
        const h = r * 0.9
        return `M ${cx - h} ${cy - h} h ${h * 2} v ${h * 2} h ${-h * 2} z`
      }
      case 'triangle': {
        const h = r * 1.2
        return `M ${cx} ${cy - h} L ${cx + h} ${cy + h * 0.7} L ${cx - h} ${cy + h * 0.7} z`
      }
      case 'cross': {
        const h = r
        return `M ${cx - h} ${cy} L ${cx + h} ${cy} M ${cx} ${cy - h} L ${cx} ${cy + h}`
      }
      default:
        return ''
    }
  }

  /** @param {{ x?: number[], y?: number[], marker?: string, markerSize?: number, markerEvery?: number }} s */
  function markersFromSeries(s) {
    const marker = s.marker || 'none'
    if (!marker || marker === 'none') return []
    const xs = s.x ?? []
    const ys = s.y ?? []
    const n = Math.min(xs.length, ys.length)
    const size = Number(s.markerSize) || 3
    const every = Math.floor(Number(s.markerEvery) || 0)
    /** Explicit every-N, else adaptive cap for dense series. */
    const step =
      every > 0 ? every : n > 120 ? Math.ceil(n / 80) : 1
    /** @type {string[]} */
    const out = []
    for (let i = 0; i < n; i += step) {
      const x = xs[i]
      const y = ys[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const d = markerPath(marker, sx(x), sy(y), size)
      if (d) out.push(d)
    }
    return out
  }

  function clampTickDecimals(v) {
    if (v === '' || v == null) return null
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(8, n))
  }

  /** @param {number} v @param {string | number | null | undefined} decimals */
  function formatTickValue(v, decimals) {
    if (!Number.isFinite(v)) return ''
    const d = clampTickDecimals(decimals)
    if (d != null) return v.toFixed(d)
    const abs = Math.abs(v)
    if (abs >= 1000 || (abs > 0 && abs < 0.01)) return v.toExponential(2)
    return v
      .toFixed(3)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1')
  }

  function fmtX(v) {
    return formatTickValue(v, xTickDecimals)
  }

  function fmtY(v) {
    return formatTickValue(v, yTickDecimals)
  }

  function clamp(val, lo, hi) {
    return Math.max(lo, Math.min(hi, val))
  }

  function clampTransform(newScale, newTx, newTy) {
    const maxTx = plotWidth * (newScale - 1)
    const maxTy = plotHeight * (newScale - 1)
    return { scale: newScale, tx: clamp(newTx, -maxTx, 0), ty: clamp(newTy, -maxTy, 0) }
  }

  function emitAxisRange(patch) {
    onAxisRange?.({
      xMin: patch.xMin ?? extents.xMin,
      xMax: patch.xMax ?? extents.xMax,
      yMin: patch.yMin ?? extents.yMin,
      yMax: patch.yMax ?? extents.yMax
    })
  }

  function onWheel(e) {
    // Allow normal page scroll unless an interaction tool is active.
    if (interactionMode === 'none') return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    const svgY = ((e.clientY - rect.top) / rect.height) * height
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12

    if (dataDomain) {
      const cx = dataX(svgX)
      const cy = dataY(svgY)
      const { xMin, xMax, yMin, yMax } = extents
      const nx0 = cx - (cx - xMin) / factor
      const nx1 = cx + (xMax - cx) / factor
      const ny0 = cy - (cy - yMin) / factor
      const ny1 = cy + (yMax - cy) / factor
      emitAxisRange({ xMin: nx0, xMax: nx1, yMin: ny0, yMax: ny1 })
      return
    }

    const newScale = clamp(scale * factor, 1, 20)
    if (newScale === scale) return
    const px = svgX - margin.left
    const py = svgY - margin.top
    const c = clampTransform(
      newScale,
      px - (px - tx) * (newScale / scale),
      py - (py - ty) * (newScale / scale)
    )
    scale = c.scale
    tx = c.tx
    ty = c.ty
  }

  /** @param {MouseEvent} e */
  function onMouseDown(e) {
    if (e.button !== 0) return
    if (interactionMode === 'none') return
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    const svgY = ((e.clientY - rect.top) / rect.height) * height

    if (interactionMode === 'rangeSelect' && statsRange && statsBand) {
      const handle = hitTestRangeHandle(svgX, svgY)
      if (handle) {
        dragging = true
        rangeHandleDrag = handle
        rangeDragAnchor = {
          t0: statsBand.t0,
          t1: statsBand.t1,
          svgX
        }
        return
      }
    }

    if (interactionMode === 'boxZoom' || interactionMode === 'rangeSelect') {
      dragging = true
      rangeHandleDrag = null
      rangeDragAnchor = null
      dragStart = { x: svgX, y: svgY, tx: 0, ty: 0 }
      selectRect =
        interactionMode === 'rangeSelect'
          ? { x0: svgX, y0: margin.top, x1: svgX, y1: margin.top + plotHeight }
          : { x0: svgX, y0: svgY, x1: svgX, y1: svgY }
      return
    }

    if (interactionMode !== 'pan') return

    dragging = true
    rangeHandleDrag = null
    rangeDragAnchor = null
    dragStart = { x: e.clientX, y: e.clientY, tx, ty }
  }

  /** @param {MouseEvent} e */
  function onMouseMove(e) {
    if (!dragging) return
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    const svgY = ((e.clientY - rect.top) / rect.height) * height

    if (rangeHandleDrag && rangeDragAnchor && statsRange) {
      const xData = dataX(clamp(svgX, margin.left, margin.left + plotWidth))
      const { t0, t1, svgX: anchorX } = rangeDragAnchor
      if (rangeHandleDrag === 'left') {
        emitStatsRange({ t0: xData, t1 })
      } else if (rangeHandleDrag === 'right') {
        emitStatsRange({ t0, t1: xData })
      } else if (rangeHandleDrag === 'move') {
        const dx = dataX(svgX) - dataX(anchorX)
        emitStatsRange({ t0: t0 + dx, t1: t1 + dx })
      }
      return
    }

    if (interactionMode === 'boxZoom' || interactionMode === 'rangeSelect') {
      if (selectRect) {
        selectRect =
          interactionMode === 'rangeSelect'
            ? { ...selectRect, x1: svgX }
            : { ...selectRect, x1: svgX, y1: svgY }
      }
      return
    }

    if (dataDomain) {
      const dx = (e.clientX - dragStart.x) * (width / rect.width)
      const dy = (e.clientY - dragStart.y) * (height / rect.height)
      const { xMin, xMax, yMin, yMax } = extents
      const xSpan = xMax - xMin
      const ySpan = yMax - yMin
      emitAxisRange({
        xMin: xMin - (dx / plotWidth) * xSpan,
        xMax: xMax - (dx / plotWidth) * xSpan,
        yMin: yMin + (dy / plotHeight) * ySpan,
        yMax: yMax + (dy / plotHeight) * ySpan
      })
      dragStart = { x: e.clientX, y: e.clientY, tx: 0, ty: 0 }
      return
    }

    const dx = (e.clientX - dragStart.x) * (width / rect.width)
    const dy = (e.clientY - dragStart.y) * (height / rect.height)
    const c = clampTransform(scale, dragStart.tx + dx, dragStart.ty + dy)
    tx = c.tx
    ty = c.ty
  }

  function onMouseUp() {
    if (dragging && rangeHandleDrag) {
      dragging = false
      rangeHandleDrag = null
      rangeDragAnchor = null
      return
    }
    if (dragging && selectRect && (interactionMode === 'boxZoom' || interactionMode === 'rangeSelect')) {
      const x0 = Math.min(selectRect.x0, selectRect.x1)
      const x1 = Math.max(selectRect.x0, selectRect.x1)
      const y0 = Math.min(selectRect.y0, selectRect.y1)
      const y1 = Math.max(selectRect.y0, selectRect.y1)

      if (interactionMode === 'rangeSelect' && typeof onStatsRange === 'function') {
        const t0 = dataX(x0)
        const t1 = dataX(x1)
        onStatsRange(t0 <= t1 ? { t0, t1 } : { t0: t1, t1: t0 })
      } else if (interactionMode === 'boxZoom') {
        const xmin = dataX(x0)
        const xmax = dataX(x1)
        const ymin = dataY(y1)
        const ymax = dataY(y0)
        if (Math.abs(xmax - xmin) > 0 && Math.abs(ymax - ymin) > 0) {
          if (dataDomain) {
            emitAxisRange({ xMin: xmin, xMax: xmax, yMin: ymin, yMax: ymax })
          } else {
            onAxisRange?.({ xMin: xmin, xMax: xmax, yMin: ymin, yMax: ymax })
          }
        }
      }
    }
    dragging = false
    rangeHandleDrag = null
    rangeDragAnchor = null
    selectRect = null
  }

  function onMouseLeave() {
    dragging = false
    rangeHandleDrag = null
    rangeDragAnchor = null
    selectRect = null
  }

  const plotTransform = $derived(
    dataDomain
      ? ''
      : `translate(${margin.left},${margin.top}) translate(${tx},${ty}) scale(${scale}) translate(${-margin.left},${-margin.top})`
  )

  const statsBand = $derived.by(() => {
    if (!statsRange || statsRange.t0 == null || statsRange.t1 == null) return null
    const t0 = Math.min(statsRange.t0, statsRange.t1)
    const t1 = Math.max(statsRange.t0, statsRange.t1)
    return {
      t0,
      t1,
      x: sx(t0),
      w: Math.max(1, sx(t1) - sx(t0))
    }
  })

  /** @param {number} svgX @param {number} svgY */
  function hitTestRangeHandle(svgX, svgY) {
    if (!statsBand || interactionMode !== 'rangeSelect') return null
    if (svgY < margin.top || svgY > margin.top + plotHeight) return null
    const left = statsBand.x
    const right = statsBand.x + statsBand.w
    if (Math.abs(svgX - left) <= RANGE_HANDLE_PX) return 'left'
    if (Math.abs(svgX - right) <= RANGE_HANDLE_PX) return 'right'
    if (svgX >= left && svgX <= right) return 'move'
    return null
  }

  /** @param {{ t0: number, t1: number }} next */
  function emitStatsRange(next) {
    onStatsRange?.({ t0: next.t0, t1: next.t1 })
  }

  const xTickFractions = $derived(axisTickFractions(extents.xMin, extents.xMax, xTickStep, xTicks))
  const yTickFractions = $derived(axisTickFractions(extents.yMin, extents.yMax, yTickStep, yTicks))

  const xTickData = $derived.by(() => {
    const ticks = xTickFractions
    if (xTickLabels.length === 0) {
      return ticks.map((t) => ({
        t,
        label: fmtX(extents.xMin + (extents.xMax - extents.xMin) * t)
      }))
    }
    const xs = series[0]?.x ?? []
    return ticks.map((t) => {
      const xVal = extents.xMin + (extents.xMax - extents.xMin) * t
      let best = 0,
        bestDist = Infinity
      for (let i = 0; i < xs.length; i++) {
        const d = Math.abs(xs[i] - xVal)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
      return { t, label: xTickLabels[best] ?? fmtX(xVal) }
    })
  })

  const cursorStyle = $derived(
    dragging
      ? rangeHandleDrag === 'left' || rangeHandleDrag === 'right'
        ? 'ew-resize'
        : 'grabbing'
      : interactionMode === 'rangeSelect'
        ? statsBand
          ? 'col-resize'
          : 'crosshair'
        : interactionMode === 'boxZoom'
          ? 'crosshair'
          : interactionMode === 'pan'
            ? 'grab'
            : 'default'
  )
</script>

<div class={`space-y-2 ${fillContainer ? 'flex h-full min-h-0 flex-col' : ''} ${className}`}>
  <div class={`relative ${fillContainer ? 'min-h-0 flex-1' : ''}`}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={wrapEl}
      class={`relative w-full overflow-hidden ${fillContainer ? 'h-full min-h-0' : ''}`}
      style={`${fillContainer ? '' : `aspect-ratio: ${aspectRatio}; `}contain: layout paint; cursor: ${cursorStyle}`}
      role="application"
      aria-label="Interactive line chart"
      onwheel={onWheel}
      onmousedown={onMouseDown}
      onmousemove={onMouseMove}
      onmouseup={onMouseUp}
      onmouseleave={onMouseLeave}
    >
      <svg
        bind:this={svgEl}
        role="img"
        aria-label="Line chart"
        viewBox={`0 0 ${width} ${height}`}
        overflow="hidden"
        class="h-full w-full overflow-hidden rounded-md border dark:border-neutral-800"
        font-family={fontFamily}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={margin.left} y={margin.top} width={Math.max(1, plotWidth)} height={Math.max(1, plotHeight)} />
          </clipPath>
        </defs>

        {#if !transparentBg}<rect x="0" y="0" {width} {height} fill={plotBg} />{/if}

        {#if chartTitle || chartSubtitle}
          {#if chartTitle}
            <text
              x={margin.left + plotWidth / 2}
              y={titleFs * 0.9 + edgePad}
              text-anchor="middle"
              font-size={titleFs}
              font-weight="600"
              font-family={fontFamily}
              fill={labelColor}>{chartTitle}</text
            >
          {/if}
          {#if chartSubtitle}
            <text
              x={margin.left + plotWidth / 2}
              y={
                chartTitle
                  ? titleFs * 0.9 + edgePad + Math.max(8, titleFs - 3 * pxToSvg) + 4
                  : Math.max(8, titleFs - 3 * pxToSvg) + edgePad
              }
              text-anchor="middle"
              font-size={Math.max(7, titleFs - 3)}
              font-family={fontFamily}
              fill={labelColor}
              opacity="0.85">{chartSubtitle}</text
            >
          {/if}
        {/if}

        {#if showSpineBottom}
        <line
          x1={margin.left}
          y1={margin.top + plotHeight}
          x2={margin.left + plotWidth}
          y2={margin.top + plotHeight}
          stroke={axisColor}
          stroke-width={spineStroke}
          stroke-linecap="square"
        />
        {/if}
        {#if showSpineLeft}
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={margin.top + plotHeight}
          stroke={axisColor}
          stroke-width={spineStroke}
          stroke-linecap="square"
        />
        {/if}
        {#if showSpineTop}
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left + plotWidth}
          y2={margin.top}
          stroke={axisColor}
          stroke-width={spineStroke}
          stroke-linecap="square"
        />
        {/if}
        {#if showSpineRight}
        <line
          x1={margin.left + plotWidth}
          y1={margin.top}
          x2={margin.left + plotWidth}
          y2={margin.top + plotHeight}
          stroke={axisColor}
          stroke-width={spineStroke}
          stroke-linecap="square"
        />
        {/if}

        {#each yTickFractions as t (t)}
          {@const yVal = extents.yMax - (extents.yMax - extents.yMin) * t}
          {@const ty = margin.top + plotHeight * t}
          {#if showGrid}
            <line
              x1={margin.left}
              y1={ty}
              x2={margin.left + plotWidth}
              y2={ty}
              stroke={gridColor}
              stroke-width="1"
            />
          {/if}
          {#if showTicks && tickLen > 0}
            <line
              x1={margin.left - tickLen}
              y1={ty}
              x2={margin.left}
              y2={ty}
              stroke={axisColor}
              stroke-width={tickStroke}
            />
          {/if}
          {#if showYTickLabels}
            <text
              x={margin.left - tickLen - tickGap}
              y={ty + tickFs * 0.35}
              text-anchor="end"
              font-size={tickFs}
              font-family={fontFamily}
              fill={tickColor}>{fmtY(yVal)}</text
            >
          {/if}
        {/each}
        {#each xTickData as tick (tick.t)}
          {@const tx = margin.left + plotWidth * tick.t}
          {#if showTicks && tickLen > 0}
            <line
              x1={tx}
              y1={margin.top + plotHeight}
              x2={tx}
              y2={margin.top + plotHeight + tickLen}
              stroke={axisColor}
              stroke-width={tickStroke}
            />
          {/if}
          {#if showXTickLabels}
            <text
              x={tx}
              y={margin.top + plotHeight + tickLen + tickGap + tickFs * 0.85}
              text-anchor="middle"
              font-size={tickFs}
              font-family={fontFamily}
              fill={tickColor}>{tick.label}</text
            >
          {/if}
        {/each}

        {#if statsBand}
          <rect
            x={statsBand.x}
            y={margin.top}
            width={statsBand.w}
            height={plotHeight}
            fill="#38bdf8"
            fill-opacity="0.12"
            stroke="#38bdf8"
            stroke-opacity="0.35"
            stroke-width="1"
            pointer-events="none"
          />
          {#if interactionMode === 'rangeSelect'}
            <line
              x1={statsBand.x}
              y1={margin.top}
              x2={statsBand.x}
              y2={margin.top + plotHeight}
              stroke="#38bdf8"
              stroke-width="3"
              pointer-events="none"
            />
            <line
              x1={statsBand.x + statsBand.w}
              y1={margin.top}
              x2={statsBand.x + statsBand.w}
              y2={margin.top + plotHeight}
              stroke="#38bdf8"
              stroke-width="3"
              pointer-events="none"
            />
          {/if}
        {/if}

        {#if selectRect}
          {@const rx = Math.min(selectRect.x0, selectRect.x1)}
          {@const rw = Math.abs(selectRect.x1 - selectRect.x0)}
          {@const ry =
            interactionMode === 'rangeSelect'
              ? margin.top
              : Math.min(selectRect.y0, selectRect.y1)}
          {@const rh =
            interactionMode === 'rangeSelect'
              ? plotHeight
              : Math.abs(selectRect.y1 - selectRect.y0)}
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill="#f59e0b"
            fill-opacity="0.15"
            stroke="#f59e0b"
            stroke-width="1"
            stroke-dasharray="4 2"
            pointer-events="none"
          />
        {/if}

        <g clip-path={`url(#${clipId})`}>
          <g transform={plotTransform}>
            {#each referenceLines as line, ri (`ref-${ri}-${line.axis}-${line.value}`)}
              {@const axis = line.axis === 'x' ? 'x' : 'y'}
              {@const val = Number(line.value)}
              {#if Number.isFinite(val)}
                {@const refW = (Number(line.width) || 1.2) * pxToSvg}
                {@const refDash = svgDasharray(
                  strokeDashForStyle(line.style, Number(line.width) || 1.2),
                  pxToSvg
                )}
                <line
                  x1={axis === 'x' ? sx(val) : sx(extents.xMin)}
                  y1={axis === 'x' ? sy(extents.yMax) : sy(val)}
                  x2={axis === 'x' ? sx(val) : sx(extents.xMax)}
                  y2={axis === 'x' ? sy(extents.yMin) : sy(val)}
                  stroke={line.color || axisColor}
                  stroke-width={refW}
                  stroke-dasharray={refDash}
                  stroke-linecap={refDash ? 'butt' : 'round'}
                  pointer-events="none"
                />
              {/if}
            {/each}
            {#each series as s, i (s.key ?? i)}
              {@const sw = (Number(s.strokeWidth) || 2) * pxToSvg}
              {@const dash = svgDasharray(s.strokeDasharray, pxToSvg)}
              <path
                d={linePaths[i] ?? ''}
                fill="none"
                stroke={s.color || palette[i % palette.length]}
                stroke-width={dataDomain ? sw : sw / scale}
                stroke-dasharray={dash}
                stroke-linejoin={dash ? 'miter' : 'round'}
                stroke-linecap={dash ? 'butt' : 'round'}
              />
              {#each markerPaths[i] ?? [] as md, mi (`${s.key ?? i}-m${mi}`)}
                <path
                  d={md}
                  fill={s.marker === 'cross' ? 'none' : s.color || palette[i % palette.length]}
                  stroke={s.color || palette[i % palette.length]}
                  stroke-width={s.marker === 'cross' ? 1.5 : 0}
                />
              {/each}
            {/each}
          </g>
        </g>

        {#if showXLabel}
        <text
          x={margin.left + plotWidth / 2}
          y={height - edgePad * 0.7}
          text-anchor="middle"
          font-size={axisFs}
          font-family={fontFamily}
          fill={labelColor}>{xLabel}</text
        >
        {/if}
        {#if showYLabel}
        <text
          x={yLabelX}
          y={margin.top + plotHeight / 2}
          text-anchor="middle"
          font-size={axisFs}
          font-family={fontFamily}
          fill={labelColor}
          transform={`rotate(-90, ${yLabelX}, ${margin.top + plotHeight / 2})`}>{yLabel}</text
        >
        {/if}

        {#if legendPosition !== 'bottom' && legendPosition !== 'none' && series.length > 0}
          {@const itemH = Math.max(16, legendSwatch + 6)}
          {@const maxLen = Math.max(...series.map((s) => s.name.length), 5)}
          {@const lw = Math.min(maxLen * legendFs * 0.62 + legendSwatch + 16, plotWidth - 16)}
          {@const lh = series.length * itemH + 10}
          {@const lx = legendPosition.includes('right')
            ? margin.left + plotWidth - lw - 8
            : margin.left + 8}
          {@const ly = legendPosition.includes('bottom')
            ? margin.top + plotHeight - lh - 8
            : margin.top + 8}
          <rect
            x={lx}
            y={ly}
            width={lw}
            height={lh}
            rx="3"
            fill={plotBg}
            fill-opacity="0.85"
            stroke={axisColor}
            stroke-width="0.5"
          />
          {#each series as s, i (s.key ?? i)}
            {@const iy = ly + 5 + itemH * i + itemH / 2}
            <rect
              x={lx + 4}
              y={iy - legendSwatch / 2}
              width={legendSwatch}
              height={legendSwatch}
              rx="1"
              fill={s.color || palette[i % palette.length]}
            />
            <text
              x={lx + 8 + legendSwatch}
              y={iy + legendFs * 0.35}
              text-anchor="start"
              font-size={legendFs}
              font-family={fontFamily}
              fill={labelColor}>{s.name}</text
            >
          {/each}
        {/if}
      </svg>
    </div>
  </div>

  {#if legendPosition === 'bottom' && series.length > 0}
    <ChartLegend
      series={series.map((s, i) => ({
        key: s.key ?? `${s.name}-${i}`,
        name: s.name,
        color: s.color || palette[i % palette.length]
      }))}
      columns={Math.min(4, Math.max(1, series.length))}
      fontFamily={fontFamily}
      fontSize={legendFs}
      swatchSize={legendSwatch}
      textColor={labelColor}
    />
  {/if}
</div>

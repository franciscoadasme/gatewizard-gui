<script>
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
    extraBottomMargin = 0,
    legendPosition = 'bottom',
    xTicks = 5,
    yTicks = 5,
    /** @type {'pan' | 'boxZoom' | 'rangeSelect'} */
    interactionMode = 'pan',
    /** Highlight band for range stats [t0, t1] in data x units */
    statsRange = null,
    /** @type {((range: { xMin?: number, xMax?: number, yMin?: number, yMax?: number }) => void) | null} */
    onAxisRange = null,
    /** @type {((range: { t0: number, t1: number } | null) => void) | null} */
    onStatsRange = null
  } = $props()

  const palette = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']

  const width = 900
  const height = $derived(Math.round(width / aspectRatio))
  const titleBand = $derived(chartTitle || chartSubtitle ? (chartSubtitle ? 34 : 22) : 0)
  const margin = $derived({
    top: 36 + (titleBand > 22 ? 12 : 0),
    right: 16,
    bottom: 42 + (Number(extraBottomMargin) || 0),
    left: 56 + (Number(extraLeftMargin) || 0)
  })
  const plotWidth = $derived(width - margin.left - margin.right)
  const plotHeight = $derived(height - margin.top - margin.bottom)

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

  const extents = $derived.by(() => {
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
    const baseYMin = yMin - yPad
    const baseYMax = yMax + yPad
    return {
      xMin: xMinOverride !== null && Number.isFinite(xMinOverride) ? xMinOverride : xMin,
      xMax: xMaxOverride !== null && Number.isFinite(xMaxOverride) ? xMaxOverride : xMax,
      yMin: yMinOverride !== null && Number.isFinite(yMinOverride) ? yMinOverride : baseYMin,
      yMax: yMaxOverride !== null && Number.isFinite(yMaxOverride) ? yMaxOverride : baseYMax
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

  function fmt(v) {
    if (!Number.isFinite(v)) return ''
    const abs = Math.abs(v)
    if (abs >= 1000 || (abs > 0 && abs < 0.01)) return v.toExponential(2)
    return v
      .toFixed(3)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1')
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

  export function resetView() {
    scale = 1
    tx = 0
    ty = 0
    selectRect = null
    onAxisRange?.({ xMin: null, xMax: null, yMin: null, yMax: null })
    onStatsRange?.(null)
  }

  const zoomed = $derived(
    dataDomain
      ? xMinOverride != null ||
          xMaxOverride != null ||
          yMinOverride != null ||
          yMaxOverride != null
      : scale !== 1 || tx !== 0 || ty !== 0
  )

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

  function normalizeTickCount(v) {
    const n = Math.round(Number(v) || 5)
    return Math.max(2, Math.min(20, n))
  }

  const xTickFractions = $derived.by(() => {
    const n = normalizeTickCount(xTicks)
    const ticks = []
    for (let i = 0; i < n; i++) ticks.push(i / (n - 1))
    return ticks
  })

  const yTickFractions = $derived.by(() => {
    const n = normalizeTickCount(yTicks)
    const ticks = []
    for (let i = 0; i < n; i++) ticks.push(i / (n - 1))
    return ticks
  })

  const xTickData = $derived.by(() => {
    const ticks = xTickFractions
    if (xTickLabels.length === 0) {
      return ticks.map((t) => ({
        t,
        label: fmt(extents.xMin + (extents.xMax - extents.xMin) * t)
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
      return { t, label: xTickLabels[best] ?? fmt(xVal) }
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
          : 'grab'
  )
</script>

<div class={`space-y-2 ${className}`}>
  <div class="relative">
    {#if zoomed || statsRange}
      <button
        class="absolute top-2 right-2 z-10 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
        onclick={resetView}
      >
        Reset view
      </button>
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="relative w-full"
      style={`aspect-ratio: ${aspectRatio}; max-height: 100%; cursor: ${cursorStyle}`}
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
        class="h-full w-full rounded-md border dark:border-neutral-800"
        font-family={fontFamily}
      >
        <defs>
          <clipPath id="plot-area">
            <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>

        {#if !transparentBg}<rect x="0" y="0" {width} {height} fill={plotBg} />{/if}

        {#if chartTitle || chartSubtitle}
          {#if chartTitle}
            <text
              x={margin.left + plotWidth / 2}
              y={chartSubtitle ? 16 : 20}
              text-anchor="middle"
              font-size="13"
              font-weight="600"
              font-family={fontFamily}
              fill={labelColor}>{chartTitle}</text
            >
          {/if}
          {#if chartSubtitle}
            <text
              x={margin.left + plotWidth / 2}
              y={chartTitle ? 30 : 18}
              text-anchor="middle"
              font-size="10"
              font-family={fontFamily}
              fill={labelColor}
              opacity="0.85">{chartSubtitle}</text
            >
          {/if}
        {/if}

        <line
          x1={margin.left}
          y1={margin.top + plotHeight}
          x2={margin.left + plotWidth}
          y2={margin.top + plotHeight}
          stroke={axisColor}
          stroke-width="1"
        />
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={margin.top + plotHeight}
          stroke={axisColor}
          stroke-width="1"
        />

        {#each yTickFractions as t (t)}
          {#if showGrid}
            <line
              x1={margin.left}
              y1={margin.top + plotHeight * t}
              x2={margin.left + plotWidth}
              y2={margin.top + plotHeight * t}
              stroke={gridColor}
              stroke-width="1"
            />
          {/if}
          {@const yVal = extents.yMax - (extents.yMax - extents.yMin) * t}
          <text
            x={margin.left - 8}
            y={margin.top + plotHeight * t + 4}
            text-anchor="end"
            font-size="11"
            font-family={fontFamily}
            fill={tickColor}>{fmt(yVal)}</text
          >
        {/each}
        {#each xTickData as tick (tick.t)}
          <text
            x={margin.left + plotWidth * tick.t}
            y={margin.top + plotHeight + 18}
            text-anchor="middle"
            font-size="11"
            font-family={fontFamily}
            fill={tickColor}>{tick.label}</text
          >
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

        <g clip-path="url(#plot-area)">
          <g transform={plotTransform}>
            {#each series as s, i (s.name + i)}
              {@const sw = Number(s.strokeWidth) || 2}
              <path
                d={pathFromSeries(s)}
                fill="none"
                stroke={s.color || palette[i % palette.length]}
                stroke-width={dataDomain ? sw : sw / scale}
                stroke-dasharray={s.strokeDasharray || undefined}
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              {#each markersFromSeries(s) as md, mi (`${s.name}-m${mi}`)}
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

        <text
          x={margin.left + plotWidth / 2}
          y={height - 8}
          text-anchor="middle"
          font-size="12"
          font-family={fontFamily}
          fill={labelColor}>{xLabel}</text
        >
        <text
          x="14"
          y={margin.top + plotHeight / 2}
          text-anchor="middle"
          font-size="12"
          font-family={fontFamily}
          fill={labelColor}
          transform={`rotate(-90, 14, ${margin.top + plotHeight / 2})`}>{yLabel}</text
        >

        {#if legendPosition !== 'bottom' && legendPosition !== 'none' && series.length > 0}
          {@const itemH = 16}
          {@const maxLen = Math.max(...series.map((s) => s.name.length), 5)}
          {@const lw = Math.min(maxLen * 7 + 24, plotWidth - 16)}
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
          {#each series as s, i (s.name + i)}
            {@const iy = ly + 5 + itemH * i + itemH / 2}
            <line
              x1={lx + 4}
              y1={iy}
              x2={lx + 16}
              y2={iy}
              stroke={s.color || palette[i % palette.length]}
              stroke-width="2"
              stroke-dasharray={s.strokeDasharray || undefined}
            />
            <text
              x={lx + 20}
              y={iy + 4}
              text-anchor="start"
              font-size="10"
              font-family={fontFamily}
              fill={labelColor}>{s.name}</text
            >
          {/each}
        {/if}
      </svg>
    </div>
  </div>

  {#if legendPosition === 'bottom' && series.length > 0}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {#each series as s, i (s.name + i)}
        <div class="flex items-center gap-1">
          <span
            class="inline-block h-2.5 w-2.5 rounded-full"
            style={`background:${s.color || palette[i % palette.length]}`}
          ></span>
          <span class="text-neutral-300">{s.name}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

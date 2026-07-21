<script>
  let {
    /** @type {Array<{ name: string, x: number[], y: number[], color?: string }>} */
    series = [],
    xLabel = 'X',
    yLabel = 'Y',
    className = '',
    // Styling overrides
    plotBg = '#0a0a0a',
    axisColor = '#525252',
    gridColor = '#262626',
    tickColor = '#a3a3a3',
    labelColor = '#d4d4d4',
    showGrid = true,
    // Axis range overrides (null = auto)
    xMinOverride = null,
    xMaxOverride = null,
    yMinOverride = null,
    yMaxOverride = null,
    // Expose SVG element for export
    svgEl = $bindable(null),
    // Aspect ratio (width/height). Default 2.5 ≈ 900×360
    aspectRatio = 2.5,
    // Transparent background (skip fill rect)
    transparentBg = false,
    // Font family for all text in the chart
    fontFamily = 'Roboto, sans-serif',
    // Optional chart title rendered inside the SVG
    chartTitle = '',
    // Optional subtitle under the title (e.g. atom selection)
    chartSubtitle = '',
    // Custom string labels for x-axis ticks (e.g. residue names for RMSF)
    xTickLabels = [],
    // Extra pixels added to left/bottom margin to fit long tick labels
    extraLeftMargin = 0,
    extraBottomMargin = 0,
    // Where to show the legend: 'bottom'|'top-left'|'top-right'|'bottom-left'|'bottom-right'|'none'
    legendPosition = 'bottom',
    // Number of major ticks shown on each axis
    xTicks = 5,
    yTicks = 5
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

  // zoom / pan state
  let scale = $state(1)
  let tx = $state(0)
  let ty = $state(0)
  let dragging = $state(false)
  let dragStart = $state({ x: 0, y: 0, tx: 0, ty: 0 })

  const extents = $derived.by(() => {
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity
    for (const s of series) {
      for (const v of s.x ?? []) {
        if (Number.isFinite(v)) {
          xMin = Math.min(xMin, v)
          xMax = Math.max(xMax, v)
        }
      }
      for (const v of s.y ?? []) {
        if (Number.isFinite(v)) {
          yMin = Math.min(yMin, v)
          yMax = Math.max(yMax, v)
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

  function pathFromSeries(s) {
    const xs = s.x ?? [],
      ys = s.y ?? []
    const n = Math.min(xs.length, ys.length)
    let path = ''
    for (let i = 0; i < n; i++) {
      const x = xs[i],
        y = ys[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      path += `${path === '' ? 'M' : 'L'}${sx(x)},${sy(y)} `
    }
    return path.trim()
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

  function onWheel(e) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const newScale = clamp(scale * factor, 1, 20)
    if (newScale === scale) return
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    const svgY = ((e.clientY - rect.top) / rect.height) * height
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

  function onMouseDown(e) {
    if (e.button !== 0) return
    dragging = true
    dragStart = { x: e.clientX, y: e.clientY, tx, ty }
  }

  function onMouseMove(e) {
    if (!dragging) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - dragStart.x) * (width / rect.width)
    const dy = (e.clientY - dragStart.y) * (height / rect.height)
    const c = clampTransform(scale, dragStart.tx + dx, dragStart.ty + dy)
    tx = c.tx
    ty = c.ty
  }

  function onMouseUp() {
    dragging = false
  }
  function onMouseLeave() {
    dragging = false
  }
  function resetView() {
    scale = 1
    tx = 0
    ty = 0
  }

  const zoomed = $derived(scale !== 1 || tx !== 0 || ty !== 0)
  const plotTransform = $derived(
    `translate(${margin.left},${margin.top}) translate(${tx},${ty}) scale(${scale}) translate(${-margin.left},${-margin.top})`
  )

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

  // X tick label strings — uses xTickLabels array when provided (e.g. RMSF residue names)
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
</script>

<div class={`space-y-2 ${className}`}>
  <div class="relative">
    {#if zoomed}
      <button
        class="absolute top-2 right-2 z-10 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
        onclick={resetView}
      >
        Reset zoom
      </button>
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="relative w-full"
      style={`aspect-ratio: ${aspectRatio}; max-height: 100%; cursor: ${dragging ? 'grabbing' : 'crosshair'}`}
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

        <!-- static axes -->
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

        <!-- static grid + tick labels -->
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

        <!-- zoomable/pannable lines, clipped to plot area -->
        <g clip-path="url(#plot-area)">
          <g transform={plotTransform}>
            {#each series as s, i (s.name + i)}
              <path
                d={pathFromSeries(s)}
                fill="none"
                stroke={s.color || palette[i % palette.length]}
                stroke-width={2 / scale}
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            {/each}
          </g>
        </g>

        <!-- axis labels -->
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

        <!-- SVG legend (when legendPosition targets inside the plot) -->
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
            <circle cx={lx + 8} cy={iy} r="4" fill={s.color || palette[i % palette.length]} />
            <text
              x={lx + 18}
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

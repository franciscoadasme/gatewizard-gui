<script>
  import { onMount } from 'svelte'
  import { strokeDashForStyle } from '../lib/analysisGridLayout.js'
  import { axisTicks, formatAxisTick } from '../lib/titration.js'

  let {
    /** @type {Array<{ name: string, color: string, pka: number[], points: Array<{ pka: number, protonated: boolean }> }>} */
    types = [],
    yMin = null,
    yMax = null,
    yLabel = 'pKa',
    title = '',
    plotBg = '#ffffff',
    textColor = '#222222',
    gridColor = '#d4d4d4',
    showGrid = true,
    fontFamily = 'Roboto, sans-serif',
    axisFontSize = 12,
    titleFontSize = 13,
    /** @type {Array<{ axis: string, value: number, color: string, width: number, style: string, label: string, opacity: number }>} */
    referenceLines = [],
    /** @type {Array<{ axis?: string, min?: number, max?: number, color?: string, opacity?: number }>} */
    referenceBands = [],
    showMarkerLegend = true,
    markerSize = 5,
    legendFontSize = 11,
    legendSwatchSize = 12,
    extraLeftMargin = 0,
    extraRightMargin = 0,
    extraTopMargin = 0,
    extraBottomMargin = 0,
    showTicks = true,
    tickLength = 4,
    tickWidth = 1,
    spineWidth = 1,
    lineStyle = 'solid',
    showSpineLeft = true,
    showSpineBottom = true,
    showSpineTop = false,
    showSpineRight = false,
    axisFontBold = false,
    legendPosition = 'top-left',
    yTickStep = '',
    yTickCount = '',
    yTickDecimals = '',
    interactionMode = 'none',
    /** @type {((range: { yMin?: number, yMax?: number }) => void) | undefined} */
    onAxisRange = undefined,
    selected = false,
    /** @type {((panel: 'a') => void) | undefined} */
    onSelect = undefined
  } = $props()

  let host = $state(/** @type {HTMLElement | null} */ (null))
  let measuredW = $state(0)
  let measuredH = $state(0)

  onMount(() => {
    const el = host
    if (!el) return
    const apply = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 16) measuredW = Math.round(r.width)
      if (r.height > 16) measuredH = Math.round(r.height)
    }
    apply()
    const obs = new ResizeObserver(apply)
    obs.observe(el)
    return () => obs.disconnect()
  })

  const W = $derived(measuredW > 16 ? measuredW : 640)
  const H = $derived(measuredH > 16 ? measuredH : 420)

  /** @param {unknown} value @param {number} [fallback] */
  function px(value, fallback = 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const frame = $derived.by(() => {
    const padL = 58 + px(extraLeftMargin)
    const padR = 16 + px(extraRightMargin)
    const padT = 36 + px(extraTopMargin)
    const padB = 42 + px(extraBottomMargin)
    return {
      padL,
      padR,
      padT,
      padB,
      plotW: Math.max(24, W - padL - padR),
      plotH: Math.max(24, H - padT - padB),
      spine: Math.max(0.4, px(spineWidth, 1)),
      spineDash: strokeDashForStyle(lineStyle, Math.max(0.4, px(spineWidth, 1))) || undefined,
      tickLen: Math.max(0, px(tickLength, 4)),
      tickW: Math.max(0.2, px(tickWidth, 1)),
      marker: Math.max(1.5, px(markerSize, 5)),
      legendFs: Math.max(7, px(legendFontSize, 11)),
      swatch: Math.max(6, px(legendSwatchSize, 12))
    }
  })

  const extent = $derived.by(() => {
    const vals = types.flatMap((t) => t.pka || [])
    const refs = referenceLines.filter((l) => l.axis === 'y').map((l) => Number(l.value))
    const dataMin = vals.length ? Math.min(...vals, ...refs) : Math.min(0, ...refs)
    const dataMax = vals.length ? Math.max(...vals, ...refs) : Math.max(14, ...refs)
    const loIn = yMin != null && yMin !== '' && Number.isFinite(Number(yMin)) ? Number(yMin) : null
    const hiIn = yMax != null && yMax !== '' && Number.isFinite(Number(yMax)) ? Number(yMax) : null
    const lo = loIn != null ? loIn : Math.min(0, dataMin)
    const hi = hiIn != null ? hiIn : Math.max(dataMax, lo + 1) * 1.08
    return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) }
  })

  /** @param {number} y */
  function yPx(y) {
    const span = extent.hi - extent.lo || 1
    return frame.padT + ((extent.hi - y) / span) * frame.plotH
  }

  /** @param {number[]} values */
  function stats(values) {
    const s = [...values].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
    if (!s.length) return null
    const q = (p) => {
      const pos = (s.length - 1) * p
      const lo = Math.floor(pos)
      const hi = Math.ceil(pos)
      if (lo === hi) return s[lo]
      return s[lo] * (hi - pos) + s[hi] * (pos - lo)
    }
    const q1 = q(0.25)
    const med = q(0.5)
    const q3 = q(0.75)
    const iqr = q3 - q1
    const lowFence = q1 - 1.5 * iqr
    const highFence = q3 + 1.5 * iqr
    const inside = s.filter((v) => v >= lowFence && v <= highFence)
    const mean = s.reduce((a, b) => a + b, 0) / s.length
    return {
      q1,
      med,
      q3,
      whiskerLo: inside[0] ?? s[0],
      whiskerHi: inside[inside.length - 1] ?? s[s.length - 1],
      mean
    }
  }

  const slots = $derived.by(() => {
    const n = Math.max(types.length, 1)
    return types.map((t, i) => {
      const cx = frame.padL + ((i + 0.5) / n) * frame.plotW
      const boxW = Math.min(46, (frame.plotW / n) * 0.55)
      return { ...t, cx, boxW, st: stats(t.pka || []) }
    })
  })

  const yTicks = $derived(axisTicks(extent.lo, extent.hi, yTickStep, yTickCount || 5))
  const legendBox = $derived.by(() => {
    if (!showMarkerLegend || legendPosition === 'none') return null
    const w = 220
    const h = frame.swatch * 2 + 14
    const left = frame.padL + 8
    const right = Math.max(left, W - frame.padR - w - 4)
    const top = frame.padT + 6
    const bottom = Math.max(top, H - frame.padB - h - 8)
    if (legendPosition === 'top-right') return { x: right, y: top }
    if (legendPosition === 'bottom-left') return { x: left, y: bottom }
    if (legendPosition === 'bottom-right') return { x: right, y: bottom }
    if (legendPosition === 'bottom') return { x: left, y: Math.max(top, H - h - 6) }
    return { x: left, y: top }
  })

  /** @param {number} i @param {number} j */
  function jitter(i, j) {
    const x = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
    return (x - Math.floor(x) - 0.5) * 10
  }

  /** @type {{ mode: string, y: number, yMin: number, yMax: number } | null} */
  let drag = null

  /** @param {number} clientY */
  function dataY(clientY) {
    const svg = host?.querySelector('svg')
    if (!svg) return extent.lo
    const r = svg.getBoundingClientRect()
    if (r.height < 1) return extent.lo
    const yUser = ((clientY - r.top) / r.height) * H
    const span = extent.hi - extent.lo || 1
    return extent.hi - ((yUser - frame.padT) / frame.plotH) * span
  }

  /** @param {number} y0 @param {number} y1 */
  function emitY(y0, y1) {
    onAxisRange?.({ yMin: Math.min(y0, y1), yMax: Math.max(y0, y1) })
  }

  /** @param {PointerEvent} e */
  function onPointerDown(e) {
    onSelect?.('a')
    if (interactionMode === 'none' || interactionMode === 'rangeSelect') return
    if (e.button != null && e.button !== 0) return
    drag = { mode: interactionMode, y: dataY(e.clientY), yMin: extent.lo, yMax: extent.hi }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (!drag || drag.mode !== 'pan') return
    const dy = drag.y - dataY(e.clientY)
    emitY(drag.yMin + dy, drag.yMax + dy)
  }

  /** @param {PointerEvent} e */
  function onPointerUp(e) {
    if (!drag) return
    if (drag.mode === 'boxZoom') {
      const y = dataY(e.clientY)
      if (Math.abs(y - drag.y) > (extent.hi - extent.lo) * 0.02) emitY(drag.y, y)
    }
    drag = null
  }

  /** @param {WheelEvent} e */
  function onWheel(e) {
    if (interactionMode === 'none') return
    e.preventDefault()
    const y = dataY(e.clientY)
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    emitY(y - (y - extent.lo) * factor, y + (extent.hi - y) * factor)
  }
</script>

<div
  bind:this={host}
  class="h-full w-full min-h-0 {selected ? 'ring-2 ring-amber-400' : ''}"
  role="presentation"
>
<svg
  viewBox={`0 0 ${W} ${H}`}
  preserveAspectRatio="none"
  class="h-full w-full"
  style={interactionMode === 'pan' ? 'cursor:grab' : interactionMode === 'boxZoom' ? 'cursor:crosshair' : ''}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={() => (drag = null)}
  onwheel={onWheel}
  role="img"
  aria-label={title || 'pKa distribution'}
>
  <rect width={W} height={H} fill={plotBg} />
  {#if title}
    <text
      x={W / 2}
      y="20"
      text-anchor="middle"
      fill={textColor}
      font-size={titleFontSize}
      font-family={fontFamily}
      font-weight={axisFontBold ? 700 : 400}>{title}</text
    >
  {/if}
  {#each yTicks as tick (tick)}
    {#if showGrid}
      <line
        x1={frame.padL}
        x2={W - frame.padR}
        y1={yPx(tick)}
        y2={yPx(tick)}
        stroke={gridColor}
        stroke-dasharray="2 3"
      />
    {/if}
    <text
      x={frame.padL - 8}
      y={yPx(tick) + 4}
      text-anchor="end"
      fill={textColor}
      font-size={axisFontSize}
      font-family={fontFamily}
      font-weight={axisFontBold ? 700 : 400}>{formatAxisTick(tick, yTickDecimals)}</text
    >
  {/each}
  {#if showTicks}
    {#each yTicks as tick (tick)}
      <line
        x1={frame.padL - frame.tickLen}
        x2={frame.padL}
        y1={yPx(tick)}
        y2={yPx(tick)}
        stroke={textColor}
        stroke-width={frame.tickW}
      />
    {/each}
  {/if}
  {#if showSpineLeft}
    <line
      x1={frame.padL}
      x2={frame.padL}
      y1={frame.padT}
      y2={H - frame.padB}
      stroke={textColor}
      stroke-width={frame.spine}
      stroke-dasharray={frame.spineDash}
    />
  {/if}
  {#if showSpineBottom}
    <line
      x1={frame.padL}
      x2={W - frame.padR}
      y1={H - frame.padB}
      y2={H - frame.padB}
      stroke={textColor}
      stroke-width={frame.spine}
      stroke-dasharray={frame.spineDash}
    />
  {/if}
  {#if showSpineTop}
    <line
      x1={frame.padL}
      x2={W - frame.padR}
      y1={frame.padT}
      y2={frame.padT}
      stroke={textColor}
      stroke-width={frame.spine}
      stroke-dasharray={frame.spineDash}
    />
  {/if}
  {#if showSpineRight}
    <line
      x1={W - frame.padR}
      x2={W - frame.padR}
      y1={frame.padT}
      y2={H - frame.padB}
      stroke={textColor}
      stroke-width={frame.spine}
      stroke-dasharray={frame.spineDash}
    />
  {/if}
  <text
    x="16"
    y={frame.padT + frame.plotH / 2}
    fill={textColor}
    font-size={axisFontSize}
    font-family={fontFamily}
    font-weight={axisFontBold ? 700 : 400}
    transform={`rotate(-90 16 ${frame.padT + frame.plotH / 2})`}
    text-anchor="middle">{yLabel}</text
  >
  {#each referenceLines.filter((l) => l.axis === 'y') as line, i (`y-${i}-${line.value}`)}
    <line
        x1={frame.padL}
        x2={W - frame.padR}
      y1={yPx(line.value)}
      y2={yPx(line.value)}
      stroke={line.color || '#e74c3c'}
      stroke-width={line.width || 1.5}
      stroke-dasharray={strokeDashForStyle(line.style, line.width || 1.5)}
      opacity={line.opacity ?? 1}
    />
    {#if line.label}
      <text
        x={W - frame.padR - 4}
        y={yPx(line.value) - 4}
        text-anchor="end"
        fill={line.color || '#e74c3c'}
        font-size="11"
        font-family={fontFamily}>{line.label}</text
      >
    {/if}
  {/each}
  {#each slots as slot, i (slot.name)}
    {#if slot.st}
      <line
        x1={slot.cx}
        x2={slot.cx}
        y1={yPx(slot.st.whiskerLo)}
        y2={yPx(slot.st.whiskerHi)}
        stroke={textColor}
      />
      <line
        x1={slot.cx - 8}
        x2={slot.cx + 8}
        y1={yPx(slot.st.whiskerLo)}
        y2={yPx(slot.st.whiskerLo)}
        stroke={textColor}
      />
      <line
        x1={slot.cx - 8}
        x2={slot.cx + 8}
        y1={yPx(slot.st.whiskerHi)}
        y2={yPx(slot.st.whiskerHi)}
        stroke={textColor}
      />
      <rect
        x={slot.cx - slot.boxW / 2}
        y={yPx(slot.st.q3)}
        width={slot.boxW}
        height={Math.max(1, yPx(slot.st.q1) - yPx(slot.st.q3))}
        fill={slot.color}
        fill-opacity="0.55"
        stroke={textColor}
      />
      <line
        x1={slot.cx - slot.boxW / 2}
        x2={slot.cx + slot.boxW / 2}
        y1={yPx(slot.st.med)}
        y2={yPx(slot.st.med)}
        stroke="#111"
        stroke-width="2"
      />
      <path
        d={`M ${slot.cx} ${yPx(slot.st.mean) - 4} L ${slot.cx + 4} ${yPx(slot.st.mean)} L ${slot.cx} ${yPx(slot.st.mean) + 4} L ${slot.cx - 4} ${yPx(slot.st.mean)} Z`}
        fill="#c0392b"
        stroke="#7b241c"
      />
    {/if}
    {#each slot.points || [] as point, j (`${slot.name}-${j}`)}
      <circle
        cx={slot.cx + jitter(i, j)}
        cy={yPx(point.pka)}
        r={frame.marker}
        fill={point.protonated ? slot.color : 'none'}
        stroke={point.protonated ? '#111' : slot.color}
        stroke-width={point.protonated ? 0.8 : 1.6}
      />
    {/each}
    <text
      x={slot.cx}
      y={H - 16}
      text-anchor="middle"
      fill={textColor}
      font-size={axisFontSize}
      font-family={fontFamily}
      font-weight={axisFontBold ? 700 : 400}>{slot.name}</text
    >
  {/each}
  {#each referenceBands as band, i (`band-${i}`)}
    {@const lo = Number(band.min)}
    {@const hi = Number(band.max)}
    {#if Number.isFinite(lo) && Number.isFinite(hi)}
      <rect
        x={frame.padL}
        y={yPx(Math.max(lo, hi))}
        width={frame.plotW}
        height={Math.abs(yPx(lo) - yPx(hi))}
        fill={band.color || '#94a3b8'}
        opacity={band.opacity ?? 0.15}
      />
    {/if}
  {/each}
  {#if legendBox}
    <g transform={`translate(${legendBox.x}, ${legendBox.y})`}>
      <circle cx={frame.swatch / 2} cy={frame.swatch / 2} r={frame.swatch / 2} fill="#4b5563" />
      <text
        x={frame.swatch + 6}
        y={frame.swatch * 0.75}
        fill={textColor}
        font-size={frame.legendFs}
        font-family={fontFamily}>Protonated (pH &lt; pKa)</text
      >
      <circle
        cx={frame.swatch / 2}
        cy={frame.swatch + 8 + frame.swatch / 2}
        r={frame.swatch / 2 - 0.7}
        fill="none"
        stroke="#4b5563"
        stroke-width="1.4"
      />
      <text
        x={frame.swatch + 6}
        y={frame.swatch + 8 + frame.swatch * 0.75}
        fill={textColor}
        font-size={frame.legendFs}
        font-family={fontFamily}>Deprotonated (pH ≥ pKa)</text
      >
    </g>
  {/if}
</svg>
</div>

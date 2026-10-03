<script>
  import { onMount } from 'svelte'
  import { strokeDashForStyle } from '../lib/analysisGridLayout.js'
  import { axisTicks, formatAxisTick } from '../lib/titration.js'

  let {
    /** @type {Array<{ name: string, color: string, fraction: number }>} */
    types = [],
    yLabel = 'Protonated Fraction',
    xLabel = 'Residue Type',
    title = '',
    plotBg = '#ffffff',
    textColor = '#222222',
    gridColor = '#d4d4d4',
    showGrid = true,
    fontFamily = 'Roboto, sans-serif',
    axisFontSize = 12,
    titleFontSize = 13,
    /** @type {Array<{ axis: string, value: number, color: string, width: number, style: string, opacity: number }>} */
    referenceLines = [],
    /** @type {Array<{ axis?: string, min?: number, max?: number, color?: string, opacity?: number }>} */
    referenceBands = [],
    legendFontSize = 11,
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
    yTickStep = '',
    yTickCount = '',
    yTickDecimals = '',
    yMin = null,
    yMax = null,
    interactionMode = 'none',
    /** @type {((range: { yMin?: number, yMax?: number }) => void) | undefined} */
    onAxisRange = undefined,
    selected = false,
    /** @type {((panel: 'b') => void) | undefined} */
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
  const H = $derived(measuredH > 16 ? measuredH : 280)
  const yLo = $derived(
    yMin != null && yMin !== '' && Number.isFinite(Number(yMin)) ? Number(yMin) : 0
  )
  const yHi = $derived(
    yMax != null && yMax !== '' && Number.isFinite(Number(yMax)) ? Number(yMax) : 1.15
  )

  /** @param {unknown} value @param {number} [fallback] */
  function px(value, fallback = 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const frame = $derived.by(() => {
    const padL = 58 + px(extraLeftMargin)
    const padR = 16 + px(extraRightMargin)
    const padT = 34 + px(extraTopMargin)
    const padB = 46 + px(extraBottomMargin)
    return {
      padL,
      padR,
      padT,
      padB,
      plotW: Math.max(24, W - padL - padR),
      plotH: Math.max(24, H - padT - padB),
      spine: Math.max(0.4, px(spineWidth, 1)),
      tickLen: Math.max(0, px(tickLength, 4)),
      tickW: Math.max(0.2, px(tickWidth, 1)),
      legendFs: Math.max(7, px(legendFontSize, 11)),
      spineDash: strokeDashForStyle(lineStyle, Math.max(0.4, px(spineWidth, 1))) || undefined
    }
  })

  /** @param {number} y */
  function yPx(y) {
    const span = yHi - yLo || 1
    return frame.padT + ((yHi - y) / span) * frame.plotH
  }

  const yTicks = $derived(axisTicks(yLo, yHi, yTickStep, yTickCount || 5))

  /** @type {{ mode: string, y: number, yMin: number, yMax: number } | null} */
  let drag = null

  /** @param {number} clientY */
  function dataY(clientY) {
    const svg = host?.querySelector('svg')
    if (!svg) return yLo
    const r = svg.getBoundingClientRect()
    if (r.height < 1) return yLo
    const yUser = ((clientY - r.top) / r.height) * H
    return yHi - ((yUser - frame.padT) / frame.plotH) * (yHi - yLo || 1)
  }

  /** @param {number} y0 @param {number} y1 */
  function emitY(y0, y1) {
    onAxisRange?.({ yMin: Math.min(y0, y1), yMax: Math.max(y0, y1) })
  }

  /** @param {PointerEvent} e */
  function onPointerDown(e) {
    onSelect?.('b')
    if (interactionMode === 'none' || interactionMode === 'rangeSelect') return
    if (e.button != null && e.button !== 0) return
    drag = { mode: interactionMode, y: dataY(e.clientY), yMin: yLo, yMax: yHi }
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
      if (Math.abs(y - drag.y) > (yHi - yLo) * 0.02) emitY(drag.y, y)
    }
    drag = null
  }

  /** @param {WheelEvent} e */
  function onWheel(e) {
    if (interactionMode === 'none') return
    e.preventDefault()
    const y = dataY(e.clientY)
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    emitY(y - (y - yLo) * factor, y + (yHi - y) * factor)
  }

  const bars = $derived.by(() => {
    const n = Math.max(types.length, 1)
    return types.map((t, i) => {
      const slot = frame.plotW / n
      const bw = Math.min(48, slot * 0.62)
      const cx = frame.padL + (i + 0.5) * slot
      const frac = Math.max(0, Math.min(1.15, Number(t.fraction) || 0))
      return { ...t, cx, bw, frac, top: yPx(frac), h: yPx(0) - yPx(frac) }
    })
  })
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
  role="img"
  aria-label={title || 'Protonation fraction'}
  style={interactionMode === 'pan' ? 'cursor:grab' : interactionMode === 'boxZoom' ? 'cursor:crosshair' : ''}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={() => (drag = null)}
  onwheel={onWheel}
>
  <rect width={W} height={H} fill={plotBg} />
  {#if title}
    <text
      x={W / 2}
      y="18"
      text-anchor="middle"
      fill={textColor}
      font-size={titleFontSize}
      font-family={fontFamily}
      font-weight="600">{title}</text
    >
  {/if}
  {#each referenceBands as band, i (`bband-${i}`)}
    {@const lo = Number(band.min)}
    {@const hi = Number(band.max)}
    {#if Number.isFinite(lo) && Number.isFinite(hi) && Math.min(lo, hi) < yHi && Math.max(lo, hi) > yLo}
      <rect
        x={frame.padL}
        y={yPx(Math.min(yHi, Math.max(lo, hi)))}
        width={frame.plotW}
        height={Math.abs(yPx(Math.max(yLo, Math.min(lo, hi))) - yPx(Math.min(yHi, Math.max(lo, hi))))}
        fill={band.color || '#94a3b8'}
        opacity={band.opacity ?? 0.15}
      />
    {/if}
  {/each}
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
    {#if showTicks}
      <line
        x1={frame.padL - frame.tickLen}
        x2={frame.padL}
        y1={yPx(tick)}
        y2={yPx(tick)}
        stroke={textColor}
        stroke-width={frame.tickW}
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
  {#each referenceLines.filter((l) => l.axis === 'y' && l.value >= yLo && l.value <= yHi) as line, i (`b-${i}`)}
    <line
      x1={frame.padL}
      x2={W - frame.padR}
      y1={yPx(line.value)}
      y2={yPx(line.value)}
      stroke={line.color || '#888'}
      stroke-width={line.width || 1}
      stroke-dasharray={strokeDashForStyle(line.style, line.width || 1)}
      opacity={line.opacity ?? 0.7}
    />
  {/each}
  {#each bars as bar (bar.name)}
    <rect
      x={bar.cx - bar.bw / 2}
      y={bar.top}
      width={bar.bw}
      height={Math.max(0, bar.h)}
      fill={bar.color}
      fill-opacity="0.75"
      stroke="#111"
      stroke-width="1"
    />
    <text
      x={bar.cx}
      y={bar.top - 4}
      text-anchor="middle"
      fill={textColor}
      font-size={frame.legendFs}
      font-weight="700"
      font-family={fontFamily}>{(bar.frac * 100).toFixed(0)}%</text
    >
    <text
      x={bar.cx}
      y={H - frame.padB + 18}
      text-anchor="middle"
      fill={textColor}
      font-size={axisFontSize}
      font-family={fontFamily}
      font-weight={axisFontBold ? 700 : 400}>{bar.name}</text
    >
  {/each}
  <text
    x="16"
    y={frame.padT + frame.plotH / 2}
    fill={textColor}
    font-size={axisFontSize}
    font-family={fontFamily}
    font-weight={axisFontBold ? 700 : 600}
    transform={`rotate(-90 16 ${frame.padT + frame.plotH / 2})`}
    text-anchor="middle">{yLabel}</text
  >
  <text
    x={frame.padL + frame.plotW / 2}
    y={H - 4}
    text-anchor="middle"
    fill={textColor}
    font-size={axisFontSize}
    font-family={fontFamily}
    font-weight={axisFontBold ? 700 : 600}>{xLabel}</text
  >
</svg>
</div>

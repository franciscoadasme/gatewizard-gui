<script>
  import ChartLegend from './ChartLegend.svelte'
  import LineChart from './LineChart.svelte'
  import TitrationBarChart from './TitrationBarChart.svelte'
  import TitrationBoxPlot from './TitrationBoxPlot.svelte'
  import {
    mosaicPanelLetterPadStyle,
    outsidePanelLetterBadge,
    panelLetterForCell,
    strokeDashForStyle
  } from '../lib/analysisGridLayout.js'

  let {
    /** @type {{ types: Array<any>, curves: Array<any> }} */
    view,
    showA = true,
    showB = true,
    showC = true,
    targetPh = 7,
    titles = { a: '', b: '', c: '' },
    yLabelA = 'pKa',
    yLabelB = 'Protonated Fraction',
    xLabelB = 'Residue Type',
    xLabelC = 'pH',
    yLabelC = 'Protonation State (1=protonated, 0=deprotonated)',
    plotBg = '#ffffff',
    textColor = '#222222',
    gridColor = '#e5e5e5',
    showGrid = true,
    fontFamily = 'Roboto, sans-serif',
    axisFontSize = 12,
    titleFontSize = 13,
    legendPosition = 'top-right',
    legendPositionA = 'top-left',
    legendFrameC = true,
    outsideLegend = false,
    legendSide = 'bottom',
    legendColumns = 1,
    legendTitle = '',
    /** @type {Array<{ key?: string, name?: string, color?: string }>} */
    legendItems = [],
    /** @type {Record<string, unknown>} */
    legendChrome = {},
    legendClass = '',
    legendWrapClass = 'flex-col',
    legendAnchorX = 62,
    legendAnchorY = 4,
    /** @type {((x: number, y: number) => void) | undefined} */
    onLegendAnchor = undefined,
    /** @type {Array<any>} */
    referenceLines = [],
    /** @type {object} */
    letterLayout = null,
    yMinA = null,
    yMaxA = null,
    yTickStepA = '',
    yTickCountA = '',
    yTickDecimalsA = '',
    yMinB = null,
    yMaxB = null,
    yTickStepB = '',
    yTickCountB = '',
    yTickDecimalsB = '',
    xMinC = null,
    xMaxC = null,
    yMinC = null,
    yMaxC = null,
    yPadC = 0.05,
    xTickStepC = '',
    yTickStepC = '',
    xTickCountC = '',
    yTickCountC = '',
    xTickDecimalsC = '',
    yTickDecimalsC = '',
    lineWidth = 1.6,
    lineStyle = 'solid',
    legendFontSize = 10,
    legendSwatchSize = 12,
    pkaMarkerSize = 5,
    curveMarkerSize = 4,
    /** Share of the figure width used by panels A and B (percent). */
    leftShare = 52,
    heightA = 1.65,
    heightB = 1,
    panelGap = 4,
    columnGap = 12,
    extraLeftMargin = 0,
    extraRightMargin = 0,
    extraTopMargin = 0,
    extraBottomMargin = 0,
    showTicks = true,
    tickLength = 4,
    tickWidth = 1,
    spineWidth = 1,
    showSpineLeft = true,
    showSpineBottom = true,
    showSpineTop = false,
    showSpineRight = false,
    axisFontBold = false,
    /** @type {Array<any>} */
    referenceBands = [],
    interactionMode = 'none',
    /** @type {'all' | 'a' | 'b' | 'c'} */
    selectedPanel = 'all',
    /** @type {((panel: 'a' | 'b' | 'c') => void) | undefined} */
    onSelectPanel = undefined,
    /** @type {((panel: 'a' | 'b' | 'c', range: { xMin?: number, xMax?: number, yMin?: number, yMax?: number }) => void) | undefined} */
    onAxisRange = undefined,
    /** @type {{ axisFontSize?: number, titleFontSize?: number, legendFontSize?: number, axisFontBold?: boolean }} */
    fontsA = {},
    /** @type {{ axisFontSize?: number, titleFontSize?: number, legendFontSize?: number, axisFontBold?: boolean }} */
    fontsB = {},
    /** @type {{ axisFontSize?: number, titleFontSize?: number, legendFontSize?: number, axisFontBold?: boolean }} */
    fontsC = {}
  } = $props()

  const titleA = $derived(
    titles.a || `pKa Distribution and Protonation States at pH ${targetPh}`
  )
  const titleB = $derived(titles.b || `Protonation State Distribution at pH ${targetPh}`)
  const titleC = $derived(titles.c || 'Protein Titration Curves')

  /** @param {unknown} value */
  function finiteOrNull(value) {
    if (value == null || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  const curveY = $derived.by(() => {
    const lo = finiteOrNull(yMinC)
    const hi = finiteOrNull(yMaxC)
    const padRaw = Number(yPadC)
    const pad = Number.isFinite(padRaw) && padRaw > 0 ? padRaw : 0
    if (lo == null || hi == null) {
      return { viewLo: lo ?? -0.05, viewHi: hi ?? 1.08, tickLo: null, tickHi: null }
    }
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)
    return { viewLo: a - pad, viewHi: b + pad, tickLo: a, tickHi: b }
  })

  const curveSeries = $derived(
    (view?.curves || []).map((c) => ({
      name: c.label,
      key: c.id,
      x: c.ph,
      y: c.y,
      color: c.color,
      strokeWidth: lineWidth,
      strokeDasharray: strokeDashForStyle(lineStyle, lineWidth),
      marker: 'circle',
      markerSize: Number(curveMarkerSize) || 4,
      markerEvery: Math.max(1, Math.round((c.ph?.length || 1) / 14))
    }))
  )

  const legendDraw = $derived({
    ...legendChrome,
    fontSize: Number(legendFontSize) > 0 ? Number(legendFontSize) : legendChrome.fontSize,
    swatchSize: Number(legendSwatchSize) > 0 ? Number(legendSwatchSize) : legendChrome.swatchSize,
    swatchWidth: Number(legendSwatchSize) > 0 ? Number(legendSwatchSize) : legendChrome.swatchWidth,
    swatchHeight:
      Number(legendSwatchSize) > 0 ? Number(legendSwatchSize) : legendChrome.swatchHeight
  })

  /** @param {unknown} value @param {number} fallback @param {number} lo @param {number} hi */
  function clampNum(value, fallback, lo, hi) {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(lo, Math.min(hi, n))
  }

  let cW = $state(0)
  let cH = $state(0)
  const curveAspect = $derived(cW > 16 && cH > 16 ? cW / cH : 1.15)

  const panelGridStyle = $derived.by(() => {
    const ha = clampNum(heightA, 1.65, 0.25, 8)
    const hb = clampNum(heightB, 1, 0.25, 8)
    const gap = clampNum(panelGap, 4, 0, 64)
    const col = clampNum(columnGap, 12, 0, 80)
    const left = clampNum(leftShare, 52, 20, 80)
    const right = Math.max(15, 100 - left)
    if (!(showC && (showA || showB))) {
      const rows = []
      if (showA) rows.push(`minmax(0, ${ha}fr)`)
      if (showA && showB) rows.push(`${gap}px`)
      if (showB) rows.push(`minmax(0, ${hb}fr)`)
      if (showC) rows.push('minmax(0, 1fr)')
      return `grid-template-columns:minmax(0,1fr);grid-template-rows:${rows.join(' ') || 'auto'};`
    }
    const rows = [
      showA ? `minmax(0, ${ha}fr)` : '0px',
      showA && showB ? `${gap}px` : '0px',
      showB ? `minmax(0, ${hb}fr)` : '0px'
    ]
    return `grid-template-columns:minmax(0,${left}fr) minmax(0,${right}fr);grid-template-rows:${rows.join(' ')};column-gap:${col}px;`
  })

  /**
   * @param {'a' | 'b' | 'c'} which
   */
  function panelCellStyle(which) {
    const side = showC && (showA || showB)
    if (which === 'c') {
      if (side) return 'grid-column:2;grid-row:1 / span 3;'
      let row = 1
      if (showA) row += 1
      if (showA && showB) row += 1
      if (showB) row += 1
      return `grid-column:1;grid-row:${row};`
    }
    if (which === 'a') return 'grid-column:1;grid-row:1;'
    if (side || showA) return 'grid-column:1;grid-row:3;'
    return 'grid-column:1;grid-row:1;'
  }

  const sideBySide = $derived(showC && (showA || showB))
  const xRefs = $derived((referenceLines || []).filter((line) => line.axis === 'x'))
  const yBands = $derived((referenceBands || []).filter((band) => band.axis !== 'x'))
  const xBands = $derived((referenceBands || []).filter((band) => band.axis === 'x'))

  /**
   * @param {'a' | 'b' | 'c'} panel
   * @param {KeyboardEvent} event
   */
  function onPanelKeydown(panel, event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelectPanel?.(panel)
  }

  /**
   * @param {number} index
   */
  function letterBadge(index) {
    if (!letterLayout?.panelLetterShow) return null
    const outside = outsidePanelLetterBadge(
      letterLayout,
      index,
      titleFontSize,
      textColor,
      fontFamily
    )
    if (outside) return outside
    const letter = panelLetterForCell(letterLayout, index)
    if (!letter) return null
    const color = String(letterLayout.panelLetterColor || '').trim() || textColor
    return {
      letter,
      style: `left:0.45rem;top:0.15rem;font-weight:${letterLayout.panelLetterBold === false ? 400 : 700};font-size:${titleFontSize + 3}px;color:${color};font-family:${fontFamily};`
    }
  }
</script>

<div
  class={`relative flex h-full min-h-0 w-full flex-1 gap-2 overflow-visible ${outsideLegend ? legendWrapClass : 'flex-col'}`}
  data-titration-figure="1"
  data-chart-mosaic="1"
  style={mosaicPanelLetterPadStyle(letterLayout)}
>
  {#if outsideLegend && legendSide === 'custom'}
    <ChartLegend
      exportNode
      series={legendItems}
      swatchShape="circle"
      columns={legendColumns}
      title={legendTitle}
      {fontFamily}
      {...legendDraw}
      {textColor}
      anchorX={legendAnchorX}
      anchorY={legendAnchorY}
      onAnchor={onLegendAnchor}
    />
  {/if}
  {#if outsideLegend && legendSide === 'top'}
    <ChartLegend
      exportNode
      className={legendClass}
      series={legendItems}
      swatchShape="circle"
      columns={legendColumns}
      title={legendTitle}
      {fontFamily}
      {...legendDraw}
      {textColor}
    />
  {/if}
  {#if outsideLegend && legendSide === 'left'}
    <ChartLegend
      exportNode
      series={legendItems}
      swatchShape="circle"
      columns={1}
      title={legendTitle}
      {fontFamily}
      {...legendDraw}
      {textColor}
      boxed
    />
  {/if}
  <div class="grid min-h-0 min-w-0 flex-1 overflow-visible" style={panelGridStyle}>
  {#if showA}
    <div
      class="relative min-h-0 min-w-0 overflow-visible"
      data-chart-export="titration-a"
      style={panelCellStyle('a')}
      role="button"
      tabindex="0"
      aria-label="Select panel A"
      aria-pressed={selectedPanel === 'a'}
      onclick={() => onSelectPanel?.('a')}
      onkeydown={(event) => onPanelKeydown('a', event)}
    >
      {#if letterBadge(0)}
        <span
          class="pointer-events-none absolute z-10 select-none"
          data-chart-export="panel-letter"
          style={letterBadge(0).style}
          aria-hidden="true">{letterBadge(0).letter}</span
        >
      {/if}
      <TitrationBoxPlot
        types={view?.types || []}
        yMin={yMinA}
        yMax={yMaxA}
        yLabel={yLabelA}
        title={titleA}
        {plotBg}
        {textColor}
        {gridColor}
        {showGrid}
        {fontFamily}
        axisFontSize={fontsA.axisFontSize || axisFontSize}
        titleFontSize={fontsA.titleFontSize || titleFontSize}
        axisFontBold={fontsA.axisFontBold ?? axisFontBold}
        {referenceLines}
        referenceBands={yBands}
        showMarkerLegend={!outsideLegend}
        legendPosition={legendPositionA}
        yTickStep={yTickStepA}
        yTickCount={yTickCountA}
        yTickDecimals={yTickDecimalsA}
        markerSize={pkaMarkerSize}
        legendFontSize={fontsA.legendFontSize || legendFontSize}
        legendSwatchSize={legendSwatchSize}
        {interactionMode}
        selected={selectedPanel === 'a'}
        onSelect={() => onSelectPanel?.('a')}
        onAxisRange={(range) => onAxisRange?.('a', range)}
        {extraLeftMargin}
        {extraRightMargin}
        {extraTopMargin}
        {extraBottomMargin}
        {showTicks}
        {tickLength}
        {tickWidth}
        {spineWidth}
        {lineStyle}
        {showSpineLeft}
        {showSpineBottom}
        {showSpineTop}
        {showSpineRight}
      />
    </div>
  {/if}
  {#if showB}
    <div
      class="relative min-h-0 min-w-0 overflow-visible"
      data-chart-export="titration-b"
      style={panelCellStyle('b')}
      role="button"
      tabindex="0"
      aria-label="Select panel B"
      aria-pressed={selectedPanel === 'b'}
      onclick={() => onSelectPanel?.('b')}
      onkeydown={(event) => onPanelKeydown('b', event)}
    >
      {#if letterBadge(1)}
        <span
          class="pointer-events-none absolute z-10 select-none"
          data-chart-export="panel-letter"
          style={letterBadge(1).style}
          aria-hidden="true">{letterBadge(1).letter}</span
        >
      {/if}
      <TitrationBarChart
        types={view?.types || []}
        yMin={yMinB}
        yMax={yMaxB}
        yLabel={yLabelB}
        xLabel={xLabelB}
        title={titleB}
        {plotBg}
        {textColor}
        {gridColor}
        {showGrid}
        {fontFamily}
        axisFontSize={fontsB.axisFontSize || axisFontSize}
        titleFontSize={fontsB.titleFontSize || titleFontSize}
        axisFontBold={fontsB.axisFontBold ?? axisFontBold}
        {referenceLines}
        referenceBands={yBands}
        legendFontSize={fontsB.legendFontSize || legendFontSize}
        yTickStep={yTickStepB}
        yTickCount={yTickCountB}
        yTickDecimals={yTickDecimalsB}
        {interactionMode}
        selected={selectedPanel === 'b'}
        onSelect={() => onSelectPanel?.('b')}
        onAxisRange={(range) => onAxisRange?.('b', range)}
        {extraLeftMargin}
        {extraRightMargin}
        {extraTopMargin}
        {extraBottomMargin}
        {showTicks}
        {tickLength}
        {tickWidth}
        {spineWidth}
        {lineStyle}
        {showSpineLeft}
        {showSpineBottom}
        {showSpineTop}
        {showSpineRight}
      />
    </div>
  {/if}
  {#if showC}
    <div
      class="relative min-h-0 min-w-0 overflow-visible {selectedPanel === 'c' ? 'ring-2 ring-amber-400' : ''}"
      data-chart-export="titration-c"
      style={panelCellStyle('c')}
      bind:clientWidth={cW}
      bind:clientHeight={cH}
      role="button"
      tabindex="0"
      aria-label="Select panel C"
      aria-pressed={selectedPanel === 'c'}
      onclick={() => onSelectPanel?.('c')}
      onkeydown={(event) => onPanelKeydown('c', event)}
    >
      {#if letterBadge(2)}
        <span
          class="pointer-events-none absolute z-10 select-none"
          data-chart-export="panel-letter"
          style={letterBadge(2).style}
          aria-hidden="true">{letterBadge(2).letter}</span
        >
      {/if}
      <LineChart
        fillContainer
        series={curveSeries}
        xLabel={xLabelC}
        yLabel={yLabelC}
        chartTitle={titleC}
        {plotBg}
        tickColor={textColor}
        labelColor={textColor}
        axisColor={textColor}
        {gridColor}
        {showGrid}
        {fontFamily}
        axisFontSize={fontsC.axisFontSize || axisFontSize}
        titleFontSize={fontsC.titleFontSize || titleFontSize}
        axisFontBold={fontsC.axisFontBold ?? axisFontBold}
        {legendPosition}
        legendFrame={legendFrameC}
        legendSwatchShape="circle"
        legendFontSize={fontsC.legendFontSize || Number(legendFontSize) || 10}
        legendSwatchSize={Number(legendSwatchSize) || 12}
        {extraLeftMargin}
        {extraRightMargin}
        {extraTopMargin}
        {extraBottomMargin}
        {showTicks}
        tickLength={tickLength}
        tickWidth={tickWidth}
        {spineWidth}
        {lineStyle}
        {showSpineLeft}
        {showSpineBottom}
        {showSpineTop}
        {showSpineRight}
        aspectRatio={curveAspect}
        interactionMode={interactionMode}
        onAxisRange={(range) => onAxisRange?.('c', range)}
        xMinOverride={xMinC != null && xMinC !== '' && Number.isFinite(Number(xMinC)) ? Number(xMinC) : null}
        xMaxOverride={xMaxC != null && xMaxC !== '' && Number.isFinite(Number(xMaxC)) ? Number(xMaxC) : null}
        yMinOverride={curveY.viewLo}
        yMaxOverride={curveY.viewHi}
        yTickMin={curveY.tickLo}
        yTickMax={curveY.tickHi}
        referenceLines={xRefs}
        referenceBands={xBands}
        xTickStep={xTickStepC}
        yTickStep={yTickStepC}
        xTicks={Number(xTickCountC) > 1 ? Number(xTickCountC) : 5}
        yTicks={Number(yTickCountC) > 1 ? Number(yTickCountC) : 5}
        xTickDecimals={xTickDecimalsC}
        yTickDecimals={yTickDecimalsC}
      />
    </div>
  {/if}
  </div>
  {#if outsideLegend && legendSide === 'right'}
    <ChartLegend
      exportNode
      series={legendItems}
      swatchShape="circle"
      columns={1}
      title={legendTitle}
      {fontFamily}
      {...legendDraw}
      {textColor}
      boxed
    />
  {/if}
  {#if outsideLegend && legendSide === 'bottom'}
    <ChartLegend
      exportNode
      className={legendClass}
      series={legendItems}
      swatchShape="circle"
      columns={legendColumns}
      title={legendTitle}
      {fontFamily}
      {...legendDraw}
      {textColor}
    />
  {/if}
</div>

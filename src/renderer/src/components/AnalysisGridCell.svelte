<script>
  import LineChart from './LineChart.svelte'
  import OrderedSetChips from './OrderedSetChips.svelte'
  import Input from './ui/Input.svelte'
  import Checkbox from './ui/Checkbox.svelte'
  import ListOrdered from './icons/ListOrdered.svelte'
  import {
    aspectPaddingBottom,
    cellAxisReservation,
    cellLabelVisibility,
    cellShowsLegend,
    lineChartAxisProps,
    lineChartExtraMarginProps
  } from '../lib/analysisGridLayout.js'

  let {
    panel,
    gridLayout,
    gridCellAspect,
    selected = false,
    editing = false,
    cps,
    series = [],
    displayXLabel,
    displayYLabel,
    displayXTickLabels,
    resolvedStructColors,
    ps,
    plotEdit,
    xMinO = null,
    xMaxO = null,
    yMinO = null,
    yMaxO = null,
    hasChartTimeAxis = false,
    chartInteractionMode = 'none',
    statsRange = null,
    xTickStep = '',
    yTickStep = '',
    structReferenceLines = [],
    cellTitle = '',
    cellSetIds = [],
    sets = [],
    propertyKeys = [],
    availableProperties = [],
    onSelectCell = null,
    onEditCell = null,
    onCloseEditor = null,
    onCellSetIds = null,
    onCellTitle = null,
    onCellPropertyKeys = null,
    onAxisRange = null,
    onStatsRange = null
  } = $props()

  let rootEl = $state(/** @type {HTMLElement | null} */ (null))

  const idx = $derived(panel.cellIndex ?? 0)
  const labels = $derived(cellLabelVisibility(gridLayout, idx))
  const gutters = $derived(cellAxisReservation(gridLayout))
  const showLegend = $derived(cellShowsLegend(gridLayout, idx))
  const gridColor = $derived.by(() => {
    const c = String(cps?.gridColor || '').trim()
    return c || `${resolvedStructColors.textColor}40`
  })

  $effect(() => {
    if (!editing) return
    /** @param {PointerEvent} e */
    function onPointerDown(e) {
      const t = e.target
      if (rootEl && t instanceof Node && rootEl.contains(t)) return
      onCloseEditor?.()
    }
    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key === 'Escape') onCloseEditor?.()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={rootEl}
  class="relative min-w-0 cursor-pointer p-1"
  class:z-30={editing}
  class:rounded-lg={gridLayout.cellBorder || selected || editing}
  class:border={gridLayout.cellBorder && !gridLayout.cellBorderColor}
  class:border-neutral-800={gridLayout.cellBorder && !gridLayout.cellBorderColor}
  class:ring-2={selected || editing}
  class:ring-amber-400={selected || editing}
  style={`${gridLayout.cellBorder && gridLayout.cellBorderColor ? `border: 1px solid ${gridLayout.cellBorderColor};` : ''} ${gridLayout.cellBg ? `background:${gridLayout.cellBg};` : ''}`}
  onclick={() => onSelectCell?.(idx)}
>
  <!-- Height from width only. CSS aspect-ratio inside flex+overflow freezes Chromium with no console error. -->
  <div class="relative w-full" style={`padding-bottom: ${aspectPaddingBottom(gridCellAspect)};`}>
    <div class="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
      {#if panel.empty}
        <div class="flex h-full items-center justify-center text-xs text-neutral-500">
          {#if panel.emptyReason === 'hidden'}
            Hidden
          {:else if (panel.setIds || []).length || (panel.propertyKeys || []).length}
            Waiting for data…
          {:else}
            No sets
          {/if}
        </div>
      {:else}
        <LineChart
          fillContainer
          {series}
          xLabel={displayXLabel}
          yLabel={displayYLabel}
          plotBg={gridLayout.cellBg || resolvedStructColors.plotBg}
          tickColor={resolvedStructColors.textColor}
          labelColor={resolvedStructColors.textColor}
          axisColor={resolvedStructColors.textColor}
          gridColor={gridColor}
          showGrid={cps.showGrid !== false}
          aspectRatio={gridCellAspect}
          transparentBg={ps.transparentBg}
          fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
          chartTitle={panel.title}
          chartSubtitle=""
          xTickLabels={displayXTickLabels}
          xTicks={Number(ps.xTickCount) || 5}
          yTicks={Number(ps.yTickCount) || 5}
          xTickDecimals={ps.xTickDecimals}
          yTickDecimals={ps.yTickDecimals}
          {...lineChartExtraMarginProps(cps)}
          tickLabelGap={Number(cps.tickLabelGap) || 8}
          legendPosition={showLegend ? cps.legendPosition || 'top-left' : 'none'}
          legendSwatchSize={Number(cps.legendSwatchSize) || 12}
          legendFontSize={Number(cps.legendFontSize) || 10}
          axisFontSize={Number(cps.axisFontSize) || 12}
          titleFontSize={Number(cps.titleFontSize) || 13}
          showXLabel={labels.showXLabel}
          showYLabel={labels.showYLabel}
          showXTickLabels={labels.showXTickLabels}
          showYTickLabels={labels.showYTickLabels}
          reserveXLabel={gutters.reserveXLabel}
          reserveYLabel={gutters.reserveYLabel}
          reserveXTickLabels={gutters.reserveXTickLabels}
          reserveYTickLabels={gutters.reserveYTickLabels}
          {...lineChartAxisProps(plotEdit)}
          {xTickStep}
          {yTickStep}
          referenceLines={structReferenceLines}
          xMinOverride={xMinO}
          xMaxOverride={xMaxO}
          yMinOverride={yMinO}
          yMaxOverride={yMaxO}
          interactionMode={hasChartTimeAxis ? chartInteractionMode : 'pan'}
          statsRange={hasChartTimeAxis ? statsRange : null}
          {onAxisRange}
          {onStatsRange}
        />
      {/if}
    </div>
  </div>

  <button
    type="button"
    data-grid-cell-chrome="1"
    class="absolute top-1.5 right-1.5 z-20 flex size-7 items-center justify-center rounded-md border border-neutral-300 bg-white/95 text-neutral-700 shadow-sm hover:bg-neutral-100 dark:border-neutral-600/80 dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:bg-neutral-800"
    class:ring-1={editing}
    class:ring-amber-400={editing}
    title={availableProperties.length ? 'Sets and properties in this square' : 'Sets and order in this square'}
    aria-label={availableProperties.length ? 'Sets and properties in this square' : 'Sets and order in this square'}
    aria-expanded={editing}
    onclick={(e) => {
      e.stopPropagation()
      onEditCell?.()
    }}
  >
    <ListOrdered className="size-3.5" />
  </button>

  {#if editing}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-grid-cell-chrome="1"
      class="absolute top-9 right-1.5 z-30 w-[min(18rem,calc(100%-0.75rem))] space-y-1.5 rounded-md border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      onclick={(e) => e.stopPropagation()}
    >
      <p class="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">Sets in this square</p>
      <Input
        size="sm"
        value={cellTitle}
        placeholder="Title (optional)"
        className="w-full"
        oninput={(e) =>
          onCellTitle?.(/** @type {HTMLInputElement} */ (e.currentTarget).value)
        }
      />
      <OrderedSetChips
        setIds={cellSetIds}
        {sets}
        onchange={(ids) => onCellSetIds?.(ids)}
      />
      {#if availableProperties.length}
        <p class="sidebar-label mt-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-300">Properties</p>
        <div class="max-h-36 space-y-0.5 overflow-y-auto">
          {#each availableProperties as prop (prop)}
            {@const implicitKeys = propertyKeys.length > 0 ? propertyKeys : availableProperties}
            <label class="flex items-center gap-1.5 text-[11px] text-neutral-700 dark:text-neutral-300">
              <Checkbox
                name={`cell-prop-${idx}-${prop}`}
                checked={implicitKeys.includes(prop)}
                onchange={(e) => {
                  const checked = /** @type {HTMLInputElement} */ (e.currentTarget).checked
                  const base = propertyKeys.length > 0 ? propertyKeys : availableProperties
                  const next = checked
                    ? base.includes(prop)
                      ? [...base]
                      : [...base, prop]
                    : base.filter((p) => p !== prop)
                  onCellPropertyKeys?.(next)
                }}
              />
              <span class="min-w-0 truncate" title={prop}>{prop}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

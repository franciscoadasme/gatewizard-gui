<script>
  let {
    /** @type {Array<{ key?: string, name?: string, color?: string }>} */
    series = [],
    columns = 1,
    title = '',
    fontFamily = 'Roboto, sans-serif',
    fontSize = 10,
    swatchSize = 12,
    textColor = '#d4d4d4',
    /** Mark this node for on-screen PNG/SVG export */
    exportNode = false,
    className = '',
    /** Compact boxed strip (right/left of a mosaic) */
    boxed = false
  } = $props()

  const palette = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']
  const fs = $derived(Math.max(7, Number(fontSize) || 10))
  const swatch = $derived(Math.max(6, Number(swatchSize) || 12))
  const cols = $derived(Math.max(1, Math.min(8, Math.round(Number(columns) || 1))))
  const items = $derived(Array.isArray(series) ? series.filter((s) => s && (s.name || s.key)) : [])
  const titleText = $derived(String(title || '').trim())
  const itemH = $derived(Math.max(16, swatch + 8))
  const itemW = $derived.by(() => {
    const maxLen = Math.max(...items.map((s) => String(s.name || '').length), 4)
    return Math.min(maxLen * fs * 0.62 + swatch + 16, 320)
  })
  const rows = $derived(Math.max(1, Math.ceil(items.length / cols) || 1))
  const titleBand = $derived(titleText ? fs + 8 : 0)
  const svgW = $derived(Math.max(40, cols * itemW + 8))
  const svgH = $derived(titleBand + rows * itemH + 8)
</script>

{#if items.length > 0}
  <div
    class={`shrink-0 ${boxed ? 'rounded-lg border border-neutral-700 bg-neutral-950/80 p-2' : ''} ${className}`.trim()}
    data-chart-export={exportNode ? 'legend' : undefined}
    style={boxed ? 'max-width: 16rem;' : ''}
  >
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style="max-width: 100%; height: auto;"
      role="img"
      aria-label={titleText || 'Legend'}
    >
      {#if titleText}
        <text
          x="4"
          y={fs + 2}
          font-size={fs}
          font-family={fontFamily}
          font-weight="600"
          fill={textColor}>{titleText}</text
        >
      {/if}
      {#each items as s, i (s.key ?? `${s.name}-${i}`)}
        {@const col = i % cols}
        {@const row = Math.floor(i / cols)}
        {@const x = 4 + col * itemW}
        {@const y = titleBand + 4 + row * itemH}
        <rect
          x={x}
          y={y + (itemH - swatch) / 2}
          width={swatch}
          height={swatch}
          rx="1"
          fill={s.color || palette[i % palette.length]}
        />
        <text
          x={x + swatch + 6}
          y={y + itemH / 2 + fs * 0.35}
          font-size={fs}
          font-family={fontFamily}
          fill={textColor}>{s.name}</text
        >
      {/each}
    </svg>
  </div>
{/if}

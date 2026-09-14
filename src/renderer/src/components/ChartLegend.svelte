<script>
  let {
    /** @type {Array<{ key?: string, name?: string, color?: string, marker?: string, markerSize?: number }>} */
    series = [],
    columns = 1,
    title = '',
    fontFamily = 'Roboto, sans-serif',
    fontSize = 10,
    /** Title font size (px); empty/0 → fontSize */
    titleFontSize = 0,
    /** Extra space (px) between title baseline and first legend row */
    titleGap = 8,
    /** Legacy square size; used when width/height omitted */
    swatchSize = 12,
    /** Independent swatch width (px); empty/0 → swatchSize */
    swatchWidth = 0,
    /** Independent swatch height (px); empty/0 → swatchSize */
    swatchHeight = 0,
    /** Rounded color squares (rx) vs sharp */
    swatchRound = true,
    /** Rounded outer box vs sharp */
    boxRound = true,
    /** Frame border color (empty → theme default when boxed) */
    boxBorderColor = '',
    /** Frame border width in px (0 = no border) */
    boxBorderWidth = 1,
    /** Inner padding of the legend frame (px); default 8 */
    boxPadding = 8,
    /** Outer frame width (px); 0 = content-sized */
    boxMinWidth = 0,
    /** Outer frame height (px); 0 = content-sized */
    boxMinHeight = 0,
    /** Frame background (empty → theme) */
    boxBackground = '',
    textColor = '#d4d4d4',
    /** Mark this node for on-screen PNG/SVG export */
    exportNode = false,
    className = '',
    /**
     * Draw a framed strip box. When false, still applies border if boxBorderWidth > 0
     * so top/bottom strips can share the same chrome controls.
     */
    boxed = false
  } = $props()

  const palette = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']
  const fs = $derived(Math.max(1, Number(fontSize) || 10))
  const tfs = $derived(
    Math.max(1, Number(titleFontSize) > 0 ? Number(titleFontSize) : fs)
  )
  const tGap = $derived(
    Number.isFinite(Number(titleGap)) ? Math.max(0, Number(titleGap)) : 8
  )
  const fallbackSw = $derived(Math.max(1, Number(swatchSize) || 12))
  const swW = $derived(
    Math.max(1, Number(swatchWidth) > 0 ? Number(swatchWidth) : fallbackSw)
  )
  const swH = $derived(
    Math.max(1, Number(swatchHeight) > 0 ? Number(swatchHeight) : fallbackSw)
  )
  const swRx = $derived(swatchRound ? Math.min(2.5, Math.min(swW, swH) * 0.25) : 0)
  const cols = $derived(Math.max(1, Math.min(8, Math.round(Number(columns) || 1))))
  const items = $derived(Array.isArray(series) ? series.filter((s) => s && (s.name || s.key)) : [])
  const titleText = $derived(String(title || '').trim())
  const itemH = $derived(Math.max(14, swH + 6, fs + 4))
  const itemW = $derived.by(() => {
    const maxLen = Math.max(...items.map((s) => String(s.name || '').length), 4)
    return maxLen * fs * 0.62 + swW + 16
  })
  const rows = $derived(Math.max(1, Math.ceil(items.length / cols) || 1))
  const titleBand = $derived(titleText ? tfs + tGap : 0)
  const contentW = $derived(Math.max(40, cols * itemW + 8))
  const contentH = $derived(titleBand + rows * itemH + 8)

  const borderW = $derived(Math.max(0, Number(boxBorderWidth) || 0))
  const pad = $derived(
    Number.isFinite(Number(boxPadding)) ? Math.max(0, Number(boxPadding)) : 8
  )
  /** Outer frame size from Overlay/Grid box width/height (0 = fit content).
   * Values are true CSS *minimums*: content may grow larger. Never force a
   * fixed width/height (that collapsed legends when sessions stored "1"). */
  const boxW = $derived(Math.max(0, Number(boxMinWidth) || 0))
  const boxH = $derived(Math.max(0, Number(boxMinHeight) || 0))
  const sized = $derived(boxW > 0 || boxH > 0)
  const showFrame = $derived(boxed || borderW > 0 || sized)
  /** Natural outer size including padding + border (content-fit). */
  const naturalOuterW = $derived(contentW + pad * 2 + borderW * 2)
  const naturalOuterH = $derived(contentH + pad * 2 + borderW * 2)
  const outerW = $derived(Math.max(boxW > 0 ? boxW : 0, naturalOuterW))
  const outerH = $derived(Math.max(boxH > 0 ? boxH : 0, naturalOuterH))
  const frameStyle = $derived.by(() => {
    if (!showFrame && !sized) return ''
    const radius = boxRound ? '0.5rem' : '0'
    /** @type {string[]} */
    const parts = [
      `border-radius: ${radius};`,
      `padding: ${pad}px;`,
      'box-sizing: border-box;',
      'display: flex;',
      'align-items: center;',
      'justify-content: center;',
      'flex-shrink: 0;',
      'overflow: visible;'
    ]
    if (boxW > 0) {
      parts.push(`min-width: ${boxW}px;`)
    }
    if (boxH > 0) {
      parts.push(`min-height: ${boxH}px;`)
    }
    if (borderW > 0) {
      parts.push(`border: ${borderW}px solid ${boxBorderColor || 'currentColor'};`)
    }
    if (boxBackground) parts.push(`background: ${boxBackground};`)
    return parts.join(' ')
  })
  const frameClass = $derived(
    showFrame
      ? [
          'shrink-0',
          borderW > 0
            ? boxBorderColor
              ? ''
              : 'text-neutral-400 dark:text-neutral-500'
            : 'border border-neutral-300 text-neutral-400 dark:border-neutral-700 dark:text-neutral-500',
          boxBackground ? '' : 'bg-white/90 dark:bg-neutral-950/80'
        ]
          .filter(Boolean)
          .join(' ')
      : 'shrink-0'
  )
  /** Inner draw area when the outer box is explicitly sized. */
  const svgStyle = $derived.by(() => {
    if (!sized) return 'max-width: none; height: auto; display: block;'
    const innerW = Math.max(8, outerW - pad * 2 - borderW * 2)
    const innerH = Math.max(8, outerH - pad * 2 - borderW * 2)
    if (boxW > 0 && boxH <= 0) {
      return `width: ${innerW}px; height: auto; display: block;`
    }
    if (boxH > 0 && boxW <= 0) {
      return `height: ${innerH}px; width: auto; display: block;`
    }
    return `width: ${innerW}px; height: ${innerH}px; display: block;`
  })

  /**
   * @param {string | undefined} marker
   * @param {number} cx
   * @param {number} cy
   * @param {number} size
   */
  function markerPath(marker, cx, cy, size) {
    const r = Math.max(1.5, size)
    switch (marker) {
      case 'circle':
        return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
      case 'square': {
        const h = r * 0.9
        return `M ${cx - h} ${cy - h} h ${h * 2} v ${h * 2} h ${-h * 2} z`
      }
      case 'diamond': {
        const h = r * 1.1
        return `M ${cx} ${cy - h} L ${cx + h} ${cy} L ${cx} ${cy + h} L ${cx - h} ${cy} z`
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
</script>

{#if items.length > 0}
  <div
    class={`${frameClass} ${className}`.trim()}
    data-chart-export={exportNode ? 'legend' : undefined}
    style={frameStyle}
  >
    <svg
      width={sized ? undefined : contentW}
      height={sized ? undefined : contentH}
      viewBox={`0 0 ${contentW} ${contentH}`}
      preserveAspectRatio="xMidYMid meet"
      style={svgStyle}
      role="img"
      aria-label={titleText || 'Legend'}
    >
      {#if titleText}
        <text
          x="4"
          y={tfs + 2}
          font-size={tfs}
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
        {@const cy = y + (itemH - 4) / 2}
        {@const color = s.color || palette[i % palette.length]}
        <rect
          x={x}
          y={cy - swH / 2}
          width={swW}
          height={swH}
          rx={swRx}
          fill={color}
        />
        {#if s.marker && s.marker !== 'none'}
          <path
            d={markerPath(
              s.marker,
              x + swW / 2,
              cy,
              Math.max(2, Number(s.markerSize) || Math.min(swW, swH) * 0.35)
            )}
            fill={s.marker === 'cross' ? 'none' : '#fff'}
            stroke={s.marker === 'cross' ? '#fff' : 'none'}
            stroke-width={s.marker === 'cross' ? 1.5 : 0}
          />
        {/if}
        <text
          x={x + swW + 6}
          y={cy + fs * 0.35}
          font-size={fs}
          font-family={fontFamily}
          fill={textColor}>{s.name}</text
        >
      {/each}
    </svg>
  </div>
{/if}

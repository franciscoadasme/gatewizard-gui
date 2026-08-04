<script>
  /**
   * Inline stage SVG with optional per-icon stroke tweaks.
   *
   * Modes (set from ActivitySidebar):
   * - absolute: force one stroke-width (viewBox units, ~0–1200 on these ~10k boxes)
   * - relative: multiply existing stroke-widths by `stroke`; fill-only icons get an
   *   extra stroke of RELATIVE_FILL_BASE * (stroke - 1) when stroke > 1
   *
   * CorelDRAW exports are mostly filled compound outlines (not real strokes).
   * Absolute/relative stroke overlays thicken those edges; thinning fill-outlines
   * below original needs a re-export from Corel.
   */
  /** @type {{
   *   markup: string,
   *   className?: string,
   *   title?: string,
   *   strokeMode?: 'absolute' | 'relative',
   *   stroke?: number | null,
   * }} */
  let {
    markup = '',
    className = '',
    title,
    strokeMode = 'absolute',
    stroke = null
  } = $props()

  /** Baseline used when relative-scaling fill-only outlines (no native stroke-width). */
  const RELATIVE_FILL_BASE = 500

  const processedMarkup = $derived(processSvg(markup, strokeMode, stroke, className, title))

  /**
   * @param {string} raw
   * @param {'absolute' | 'relative'} mode
   * @param {number | null} value
   * @param {string} cls
   * @param {string | undefined} label
   */
  function processSvg(raw, mode, value, cls, label) {
    if (!raw || typeof DOMParser === 'undefined') return ''

    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg) return ''

    // Drop fixed physical size; size comes from className (e.g. size-8).
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.setAttribute('class', `pointer-events-none ${cls}`.trim())
    svg.setAttribute('focusable', 'false')
    if (label) {
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', label)
    } else {
      svg.setAttribute('role', 'presentation')
      svg.setAttribute('aria-hidden', 'true')
    }

    // Theme via currentColor (parent sets text color).
    for (const el of svg.querySelectorAll('[class], path, circle, rect, line, polyline, polygon, ellipse')) {
      const style = el.getAttribute('style') || ''
      if (style) {
        el.setAttribute(
          'style',
          style
            .replace(/stroke\s*:\s*black/gi, 'stroke:currentColor')
            .replace(/fill\s*:\s*black/gi, 'fill:currentColor')
        )
      }
    }
    for (const styleEl of svg.querySelectorAll('style')) {
      styleEl.textContent = (styleEl.textContent || '')
        .replace(/stroke\s*:\s*black/gi, 'stroke:currentColor')
        .replace(/fill\s*:\s*black/gi, 'fill:currentColor')
    }
    for (const el of svg.querySelectorAll('[stroke]')) {
      if (el.getAttribute('stroke')?.toLowerCase() === 'black') {
        el.setAttribute('stroke', 'currentColor')
      }
    }
    for (const el of svg.querySelectorAll('[fill]')) {
      const f = el.getAttribute('fill')?.toLowerCase()
      if (f === 'black' || f === '#000' || f === '#000000') {
        el.setAttribute('fill', 'currentColor')
      }
    }

    if (value == null || Number.isNaN(Number(value))) {
      return svg.outerHTML
    }

    const num = Number(value)
    const shapes = [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')].filter(
      (el) => !isSpacerRect(el)
    )

    for (const el of shapes) {
      const current = readStrokeWidth(el)

      if (mode === 'absolute') {
        applyStrokeWidth(el, num)
      } else if (current != null) {
        applyStrokeWidth(el, current * num)
      } else if (num > 1) {
        // Fill-only outline: thicken when scale > 1; scale < 1 can't thin without re-export.
        applyStrokeWidth(el, RELATIVE_FILL_BASE * (num - 1))
      }
    }

    return svg.outerHTML
  }

  /** Transparent full-bleed spacer from Corel exports — skip stroke tweaks. */
  /** @param {Element} el */
  function isSpacerRect(el) {
    if (el.tagName.toLowerCase() !== 'rect') return false
    const cls = el.getAttribute('class') || ''
    return cls.includes('fil0') || el.getAttribute('fill') === 'none'
  }

  /** @param {Element} el */
  function readStrokeWidth(el) {
    const attr = el.getAttribute('stroke-width')
    if (attr != null && attr !== '') {
      const n = parseFloat(attr)
      return Number.isFinite(n) ? n : null
    }
    const style = el.getAttribute('style') || ''
    const m = style.match(/stroke-width\s*:\s*([\d.]+)/i)
    if (m) return parseFloat(m[1])

    // Class-based stroke (e.g. tools.svg .str0)
    const cls = el.getAttribute('class') || ''
    const svgRoot = el.ownerDocument?.querySelector('svg')
    if (svgRoot && cls) {
      for (const styleEl of svgRoot.querySelectorAll('style')) {
        const css = styleEl.textContent || ''
        for (const name of cls.split(/\s+/)) {
          if (!name) continue
          const re = new RegExp(`\\.${name}\\s*\\{[^}]*stroke-width\\s*:\\s*([\\d.]+)`, 'i')
          const cm = css.match(re)
          if (cm) return parseFloat(cm[1])
        }
      }
    }
    return null
  }

  /** @param {Element} el @param {number} width */
  function applyStrokeWidth(el, width) {
    const w = Math.max(0, width)
    el.setAttribute('stroke', 'currentColor')
    el.setAttribute('stroke-width', String(w))
    if (!el.getAttribute('stroke-linecap')) el.setAttribute('stroke-linecap', 'round')
    if (!el.getAttribute('stroke-linejoin')) el.setAttribute('stroke-linejoin', 'round')

    const style = el.getAttribute('style') || ''
    const cleaned = style
      .replace(/stroke-width\s*:\s*[^;]+;?/gi, '')
      .replace(/stroke\s*:\s*[^;]+;?/gi, '')
      .trim()
    const next = `${cleaned}${cleaned && !cleaned.endsWith(';') ? ';' : ''}stroke:currentColor;stroke-width:${w}`
    el.setAttribute('style', next)
  }
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html processedMarkup}

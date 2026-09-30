/**
 * Clamp and snap a numeric value to slider bounds.
 * @param {number | string} raw
 * @param {number} min
 * @param {number} max
 * @param {number} step
 */
export function clampNumber(raw, min, max, step) {
  const num = Number(raw)
  if (!Number.isFinite(num)) return min
  const stepped = step > 0 ? Math.round(num / step) * step : num
  const clamped = Math.max(min, Math.min(max, stepped))
  const dec = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2)
  return Number(clamped.toFixed(dec))
}

/**
 * Format a numeric value for display in a number input.
 * @param {number} value
 * @param {number} decimals
 */
export function formatRangeValue(value, decimals) {
  return Number(value).toFixed(decimals)
}

/**
 * True while the primary button is held on this range.
 * Used so Svelte value updates do not fight the thumb mid-drag.
 * @param {HTMLInputElement} node
 */
export function isRangeDragging(node) {
  return Boolean(/** @type {HTMLInputElement & { __gwRangeDragging?: boolean }} */ (node).__gwRangeDragging)
}

/**
 * Svelte action for range inputs: sets the initial value on mount and blocks Svelte's
 * reactive DOM updates while the user is dragging, preventing the "sticky slider" bug.
 * Also blocks mouse-wheel nudges on hover.
 * @param {HTMLInputElement} node
 * @param {number} value
 */
export function setRangeValue(node, value) {
  node.value = String(value)
  const tagged = /** @type {HTMLInputElement & { __gwRangeDragging?: boolean }} */ (node)
  tagged.__gwRangeDragging = false

  /** @param {PointerEvent | MouseEvent} e */
  const onDown = (e) => {
    // Only primary button (left click / touch).
    if ('button' in e && e.button !== 0) return
    tagged.__gwRangeDragging = true
  }
  const onUp = () => {
    tagged.__gwRangeDragging = false
  }
  /** @param {PointerEvent} e */
  const onMove = (e) => {
    // Keep drag armed while primary is held (covers track-jump then drag).
    if (e.buttons & 1) tagged.__gwRangeDragging = true
  }
  /** @param {WheelEvent} e */
  const onWheel = (e) => {
    // Native range inputs change value on wheel when hovered/focused — block that.
    e.preventDefault()
    e.stopPropagation()
  }

  // Do not use setPointerCapture — it breaks native thumb dragging on <input type="range">.
  node.addEventListener('pointerdown', onDown)
  node.addEventListener('pointermove', onMove)
  node.addEventListener('wheel', onWheel, { passive: false })
  const win = typeof window !== 'undefined' ? window : null
  win?.addEventListener('pointerup', onUp)
  win?.addEventListener('pointercancel', onUp)
  win?.addEventListener('mouseup', onUp)
  return {
    update(v) {
      if (!tagged.__gwRangeDragging) node.value = String(v)
    },
    destroy() {
      tagged.__gwRangeDragging = false
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('wheel', onWheel)
      win?.removeEventListener('pointerup', onUp)
      win?.removeEventListener('pointercancel', onUp)
      win?.removeEventListener('mouseup', onUp)
    }
  }
}

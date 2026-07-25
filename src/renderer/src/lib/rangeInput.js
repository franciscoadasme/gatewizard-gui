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
 * Svelte action for range inputs: sets the initial value on mount and blocks Svelte's
 * reactive DOM updates while the user is dragging, preventing the "sticky slider" bug.
 * @param {HTMLInputElement} node
 * @param {number} value
 */
export function setRangeValue(node, value) {
  node.value = String(value)
  let dragging = false
  const onDown = () => {
    dragging = true
  }
  const onUp = () => {
    dragging = false
  }
  node.addEventListener('pointerdown', onDown)
  node.addEventListener('mousedown', onDown)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('mouseup', onUp)
  return {
    update(v) {
      if (!dragging) node.value = String(v)
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('mousedown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('mouseup', onUp)
    }
  }
}

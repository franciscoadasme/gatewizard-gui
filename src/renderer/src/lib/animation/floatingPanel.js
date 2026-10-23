/** Last dragged position of the easing and fade cards, for this session. */
/** @type {{ x: number, y: number } | null} */
let panelPos = null

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 */
export function clampFloatingPanelPos(x, y, width, height) {
  const margin = 8
  const maxX = Math.max(margin, window.innerWidth - width - margin)
  const maxY = Math.max(margin, window.innerHeight - height - margin)
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y))
  }
}

/**
 * Drag a fixed card from its `[data-panel-drag]` title. The close button does not drag.
 * A stored position is restored; otherwise the card keeps its CSS place (right side).
 * @param {HTMLElement} node
 */
export function floatingPanel(node) {
  const placeStored = () => {
    if (!panelPos) return
    const rect = node.getBoundingClientRect()
    const next = clampFloatingPanelPos(panelPos.x, panelPos.y, rect.width, rect.height)
    panelPos = next
    node.style.right = 'auto'
    node.style.bottom = 'auto'
    node.style.left = `${next.x}px`
    node.style.top = `${next.y}px`
  }
  const frame = requestAnimationFrame(placeStored)

  /** @param {PointerEvent} event */
  function onDown(event) {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest('[data-panel-drag]') || target.closest('button')) return
    event.preventDefault()
    const rect = node.getBoundingClientRect()
    const originX = rect.left
    const originY = rect.top
    const startX = event.clientX
    const startY = event.clientY
    /** @param {PointerEvent} ev */
    const onMove = (ev) => {
      const next = clampFloatingPanelPos(
        originX + ev.clientX - startX,
        originY + ev.clientY - startY,
        rect.width,
        rect.height
      )
      panelPos = next
      node.style.right = 'auto'
      node.style.bottom = 'auto'
      node.style.left = `${next.x}px`
      node.style.top = `${next.y}px`
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  node.addEventListener('pointerdown', onDown)
  return {
    destroy() {
      cancelAnimationFrame(frame)
      node.removeEventListener('pointerdown', onDown)
    }
  }
}

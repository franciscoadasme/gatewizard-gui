/**
 * Largest axis-aligned rectangle with the target aspect ratio inside the canvas.
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} frameW
 * @param {number} frameH
 */
export function computeSafeAreaInCanvas(canvasW, canvasH, frameW, frameH) {
  if (!canvasW || !canvasH || !frameW || !frameH) {
    return { x: 0, y: 0, width: canvasW || 0, height: canvasH || 0 }
  }
  const targetAspect = frameW / frameH
  const canvasAspect = canvasW / canvasH
  let width
  let height
  if (canvasAspect > targetAspect) {
    height = canvasH
    width = height * targetAspect
  } else {
    width = canvasW
    height = width / targetAspect
  }
  return {
    x: (canvasW - width) / 2,
    y: (canvasH - height) / 2,
    width,
    height
  }
}

/**
 * Safe area in canvas pixel coordinates (accounts for devicePixelRatio).
 * @param {HTMLCanvasElement} canvas
 * @param {number} frameW
 * @param {number} frameH
 */
export function computeSafeAreaForCanvas(canvas, frameW, frameH) {
  const displayW = canvas.clientWidth || canvas.width
  const displayH = canvas.clientHeight || canvas.height
  const rect = computeSafeAreaInCanvas(displayW, displayH, frameW, frameH)
  const scaleX = canvas.width / displayW
  const scaleY = canvas.height / displayH
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   sourceRect?: { x: number, y: number, width: number, height: number }
 *   outputWidth?: number
 *   outputHeight?: number
 * }} [opts]
 */
export async function captureCanvasPng(canvas, opts = {}) {
  if (!canvas) throw new Error('Viewport canvas not found')
  const sourceRect = opts.sourceRect
  if (!sourceRect) {
    return canvas.toDataURL('image/png').split(',')[1]
  }

  const outW = Math.max(1, Math.round(opts.outputWidth ?? sourceRect.width))
  const outH = Math.max(1, Math.round(opts.outputHeight ?? sourceRect.height))
  const sx = Math.max(0, Math.round(sourceRect.x))
  const sy = Math.max(0, Math.round(sourceRect.y))
  const sw = Math.max(1, Math.round(sourceRect.width))
  const sh = Math.max(1, Math.round(sourceRect.height))

  const tmp = document.createElement('canvas')
  tmp.width = outW
  tmp.height = outH
  const ctx = tmp.getContext('2d')
  if (!ctx) throw new Error('Could not create export canvas')
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH)
  return tmp.toDataURL('image/png').split(',')[1]
}

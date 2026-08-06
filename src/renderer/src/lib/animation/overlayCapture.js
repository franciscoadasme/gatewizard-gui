import { worldToScreen } from '../viewer/picking.js'
import { measureDistance, measureAngle, measureDihedral } from '../viewer/measure.js'
import {
  labelBackgroundCss,
  labelExportBoxOrigin,
  labelPadding,
  labelRadius
} from '../viewer/labelStyle.js'

/**
 * Map display-space overlay coordinates into export output pixels.
 * @param {number} sx display x
 * @param {number} sy display y
 * @param {number} displayW
 * @param {number} displayH
 * @param {number} canvasW buffer width
 * @param {number} canvasH buffer height
 * @param {{ x: number, y: number, width: number, height: number }} sourceRect canvas buffer rect
 * @param {number} outW
 * @param {number} outH
 */
function mapOverlayPoint(sx, sy, displayW, displayH, canvasW, canvasH, sourceRect, outW, outH) {
  const bx = (sx / displayW) * canvasW
  const by = (sy / displayH) * canvasH
  return {
    x: ((bx - sourceRect.x) / sourceRect.width) * outW,
    y: ((by - sourceRect.y) / sourceRect.height) * outH
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {string} color
 * @param {{ background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number }} style
 * @param {number} [scale=1]
 */
function drawMeasurementLabel(ctx, text, cx, cy, size, color, style = {}, scale = 1) {
  ctx.font = `${size}px monospace`
  const pad = labelPadding(style) * scale
  const padY = Math.max(1, Math.round(pad * 0.45))
  const rad = labelRadius(style) * scale
  const tw = ctx.measureText(text).width
  const rw = tw + pad * 2
  const rh = size + padY * 2
  const { ox, oy } = labelExportBoxOrigin(style, rw, rh, scale)
  const rx = cx + ox
  const ry = cy + oy
  ctx.fillStyle = labelBackgroundCss(style)
  roundRect(ctx, rx, ry, rw, rh, rad)
  ctx.fill()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, rx + rw / 2, ry + rh / 2)
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/**
 * @param {{ type: string, atoms: { x: number, y: number, z: number }[] }} m
 */
function measurementValueStr(m) {
  if (m.type === 'distance') return `${measureDistance(m.atoms[0], m.atoms[1]).toFixed(2)} Å`
  if (m.type === 'angle') return `${measureAngle(m.atoms[0], m.atoms[1], m.atoms[2]).toFixed(1)}°`
  return `${measureDihedral(m.atoms[0], m.atoms[1], m.atoms[2], m.atoms[3]).toFixed(1)}°`
}

/**
 * Draw labels and measurements onto an export canvas (2D context already has the WebGL frame).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   measurements?: Array<{ type: string, atoms: { x: number, y: number, z: number }[], color?: string, size?: number, lineWidth?: number, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number, visible?: boolean, opacity?: number }>
 *   atomLabels?: Array<{ atom: { x: number, y: number, z: number }, text: string, size?: number, color?: string, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number, visible?: boolean, opacity?: number }>
 *   camera: import('three').Camera
 *   displayW: number
 *   displayH: number
 *   canvasW: number
 *   canvasH: number
 *   sourceRect: { x: number, y: number, width: number, height: number }
 *   outW: number
 *   outH: number
 * }} opts
 */
export function drawMeasureOverlayOnContext(ctx, opts) {
  const {
    measurements = [],
    atomLabels = [],
    camera,
    displayW,
    displayH,
    canvasW,
    canvasH,
    sourceRect,
    outW,
    outH
  } = opts
  if (!camera || !displayW || !displayH) return

  const map = (sx, sy) =>
    mapOverlayPoint(sx, sy, displayW, displayH, canvasW, canvasH, sourceRect, outW, outH)
  const scale = Math.max(outW / sourceRect.width, outH / sourceRect.height)

  for (const m of measurements) {
    if (m.visible === false) continue
    const op = typeof m.opacity === 'number' ? m.opacity : 1
    if (op <= 0.001) continue
    const pts = m.atoms.map((a) => {
      const s = worldToScreen(a, camera, displayW, displayH)
      return map(s.x, s.y)
    })
    const color = m.color ?? '#facc15'
    const lineWidth = (m.lineWidth ?? 1.5) * scale
    const size = (m.size ?? 11) * scale

    ctx.save()
    ctx.globalAlpha = op
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = lineWidth
    ctx.setLineDash([5 * scale, 3 * scale])
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath()
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
      ctx.lineTo(pts[i].x, pts[i].y)
      ctx.globalAlpha = op * 0.9
      ctx.stroke()
    }
    ctx.setLineDash([])
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4 * scale, 0, Math.PI * 2)
      ctx.globalAlpha = op * 0.8
      ctx.fill()
    }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    ctx.globalAlpha = op
    drawMeasurementLabel(
      ctx,
      measurementValueStr(m),
      cx,
      cy,
      size,
      color,
      {
        background: m.background ?? '#000000',
        backgroundOpacity: m.backgroundOpacity ?? 0.75,
        padding: m.padding ?? 6,
        radius: m.radius ?? 4,
        offsetY: typeof m.offsetY === 'number' ? m.offsetY : 0,
        liftDir: m.liftDir ?? 'up',
        screenDX: m.screenDX,
        screenDY: m.screenDY
      },
      scale
    )
    ctx.restore()
  }

  for (const l of atomLabels) {
    if (l.visible === false) continue
    const op = typeof l.opacity === 'number' ? l.opacity : 1
    if (op <= 0.001) continue
    const s = worldToScreen(l.atom, camera, displayW, displayH)
    const { x, y } = map(s.x, s.y)
    const size = (l.size ?? 12) * scale
    const color = l.color ?? '#ffffff'
    const text = l.text ?? ''
    const pad = labelPadding(l) * scale
    const padY = Math.max(1, Math.round(pad * 0.45))
    const rad = labelRadius(l) * scale
    ctx.save()
    ctx.globalAlpha = op
    ctx.font = `${size}px monospace`
    const tw = ctx.measureText(text).width
    const rw = tw + pad * 2
    const rh = size + padY * 2
    const { ox, oy } = labelExportBoxOrigin(l, rw, rh, scale)
    const rx = x + ox
    const ry = y + oy
    ctx.fillStyle = labelBackgroundCss(l)
    roundRect(ctx, rx, ry, rw, rh, rad)
    ctx.fill()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, rx + rw / 2, ry + rh / 2)
    ctx.restore()
  }
}

/**
 * Capture WebGL canvas plus measurement/label overlay as PNG base64.
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   measurements?: Array<{ type: string, atoms: { x: number, y: number, z: number }[], color?: string, size?: number, lineWidth?: number, visible?: boolean }>
 *   atomLabels?: Array<{ atom: { x: number, y: number, z: number }, text: string, size?: number, color?: string, visible?: boolean }>
 *   camera?: import('three').Camera | null
 *   displayW?: number
 *   displayH?: number
 *   sourceRect?: { x: number, y: number, width: number, height: number }
 *   outputWidth?: number
 *   outputHeight?: number
 * }} opts
 */
export async function captureCanvasWithOverlayPng(canvas, opts = {}) {
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

  const hasOverlay =
    (opts.measurements?.length ?? 0) > 0 ||
    (opts.atomLabels?.length ?? 0) > 0
  if (hasOverlay && opts.camera) {
    drawMeasureOverlayOnContext(ctx, {
      measurements: opts.measurements ?? [],
      atomLabels: opts.atomLabels ?? [],
      camera: opts.camera,
      displayW: opts.displayW ?? canvas.clientWidth ?? sw,
      displayH: opts.displayH ?? canvas.clientHeight ?? sh,
      canvasW: canvas.width,
      canvasH: canvas.height,
      sourceRect,
      outW,
      outH
    })
  }

  return tmp.toDataURL('image/png').split(',')[1]
}

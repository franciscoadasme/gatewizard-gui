/** Defaults match the long-standing hardcoded label chip look (`bg-black/75`). */
export const DEFAULT_LABEL_BACKGROUND = '#000000'
export const DEFAULT_LABEL_BACKGROUND_OPACITY = 0.75
export const DEFAULT_LABEL_COLOR = '#ffffff'
export const DEFAULT_LABEL_SIZE = 12
/** Horizontal/vertical padding of the background chip around the text (px). */
export const DEFAULT_LABEL_PADDING = 6
/** Corner radius of the background chip (px). */
export const DEFAULT_LABEL_RADIUS = 4
/** Screen-space lift distance from the atom (px). */
export const DEFAULT_LABEL_OFFSET_Y = 22
/** @typedef {'up' | 'down' | 'left' | 'right'} LabelLiftDir */
export const DEFAULT_LABEL_LIFT_DIR = /** @type {LabelLiftDir} */ ('up')
export const LABEL_LIFT_DIRS = /** @type {const} */ (['up', 'down', 'left', 'right'])

/**
 * @param {unknown} raw
 * @returns {LabelLiftDir}
 */
export function normalizeLabelLiftDir(raw) {
  if (raw === 'up' || raw === 'down' || raw === 'left' || raw === 'right') return raw
  return DEFAULT_LABEL_LIFT_DIR
}

/**
 * Drop runtime animation offsets so lift/direction UI edits take effect again.
 * Animation playback re-sets these each frame via interpolation.
 * @param {Record<string, unknown> | null | undefined} label
 */
export function clearLabelScreenOffset(label) {
  if (!label) return
  delete label.screenDX
  delete label.screenDY
}

/**
 * Convert saved lift magnitude + direction into a screen-space vector
 * from the atom to the label chip center.
 * @param {{ offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number } | null | undefined} label
 * @returns {{ x: number, y: number }}
 */
export function labelLiftVector(label) {
  if (
    label &&
    typeof label.screenDX === 'number' &&
    typeof label.screenDY === 'number' &&
    Number.isFinite(label.screenDX) &&
    Number.isFinite(label.screenDY)
  ) {
    return { x: label.screenDX, y: label.screenDY }
  }
  const lift = labelOffsetY(label)
  const dir = normalizeLabelLiftDir(label?.liftDir)
  if (dir === 'down') return { x: 0, y: lift }
  if (dir === 'left') return { x: -lift, y: 0 }
  if (dir === 'right') return { x: lift, y: 0 }
  return { x: 0, y: -lift }
}

/**
 * Nearest cardinal direction for a screen-space lift vector (for saving UI state).
 * @param {number} dx
 * @param {number} dy
 * @returns {LabelLiftDir}
 */
export function nearestLabelLiftDir(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }
  return dy >= 0 ? 'down' : 'up'
}

/**
 * Interpolate label lift between two keyframe states in continuous screen space.
 * @param {{ offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number } | null | undefined} a
 * @param {{ offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number } | null | undefined} b
 * @param {number} t 0..1
 */
export function interpolateLabelLift(a, b, t) {
  // Keyframe endpoints must use stored liftDir/offsetY, not a previous frame's
  // screenDX/DY (those are playback-only and would poison the lerp).
  const va = labelLiftVector({
    offsetY: a?.offsetY,
    liftDir: a?.liftDir
  })
  const vb = labelLiftVector({
    offsetY: b?.offsetY,
    liftDir: b?.liftDir
  })
  const u = typeof t === 'number' && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  const screenDX = va.x + (vb.x - va.x) * u
  const screenDY = va.y + (vb.y - va.y) * u
  return {
    screenDX,
    screenDY,
    offsetY: Math.hypot(screenDX, screenDY),
    liftDir: nearestLabelLiftDir(screenDX, screenDY)
  }
}

/**
 * Screen-space placement of a label relative to its atom projection.
 * Chip is centered on atom + lift vector (supports smooth animation via screenDX/DY).
 * @param {{ offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number } | null | undefined} label
 * @param {number} [scale=1]
 * @returns {{ left: number, top: number, transform: string }}
 *   Offsets are relative to the atom's screen (x, y); add those in the caller.
 */
export function labelScreenPlacement(label, scale = 1) {
  const v = labelLiftVector(label)
  return {
    left: v.x * scale,
    top: v.y * scale,
    transform: 'translate(-50%, -50%)'
  }
}

/**
 * Axis-aligned box for canvas export (origin at atom screen point).
 * @param {{ offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number } | null | undefined} label
 * @param {number} boxW
 * @param {number} boxH
 * @param {number} [scale=1]
 */
export function labelExportBoxOrigin(label, boxW, boxH, scale = 1) {
  const v = labelLiftVector(label)
  return {
    ox: v.x * scale - boxW / 2,
    oy: v.y * scale - boxH / 2
  }
}

/**
 * @param {string} hex
 * @param {number} alpha 0..1
 * @returns {string} css rgba(...)
 */
export function hexToRgba(hex, alpha) {
  const raw = String(hex ?? '').replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(0,0,0,${clamp01(alpha)})`
  }
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${clamp01(alpha)})`
}

/** @param {number} a */
function clamp01(a) {
  if (typeof a !== 'number' || Number.isNaN(a)) return DEFAULT_LABEL_BACKGROUND_OPACITY
  return Math.min(1, Math.max(0, a))
}

/**
 * @param {unknown} n
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
export function clampLabelNumber(n, fallback, min, max) {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * @param {{ background?: string, backgroundOpacity?: number } | null | undefined} label
 * @param {number} [opacityMul] overall label opacity (fade)
 */
export function labelBackgroundCss(label, opacityMul = 1) {
  const hex = typeof label?.background === 'string' ? label.background : DEFAULT_LABEL_BACKGROUND
  const base =
    typeof label?.backgroundOpacity === 'number'
      ? label.backgroundOpacity
      : DEFAULT_LABEL_BACKGROUND_OPACITY
  return hexToRgba(hex, base * clamp01(opacityMul))
}

/**
 * @param {{ padding?: number } | null | undefined} label
 */
export function labelPadding(label) {
  return clampLabelNumber(label?.padding, DEFAULT_LABEL_PADDING, 0, 24)
}

/**
 * @param {{ radius?: number } | null | undefined} label
 */
export function labelRadius(label) {
  return clampLabelNumber(label?.radius, DEFAULT_LABEL_RADIUS, 0, 24)
}

/**
 * @param {{ offsetY?: number } | null | undefined} label
 */
export function labelOffsetY(label) {
  return clampLabelNumber(label?.offsetY, DEFAULT_LABEL_OFFSET_Y, 0, 80)
}

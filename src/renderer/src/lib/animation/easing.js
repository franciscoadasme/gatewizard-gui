/** @typedef {'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'easeInOutCubic' | 'bezier'} AnimationEasingKind */

/**
 * @typedef {Object} EasingPreset
 * @property {string} label
 * @property {string} [hint]
 * @property {AnimationEasingKind} kind
 * @property {[number, number, number, number]} bezier
 */

/** @type {Record<AnimationEasingKind, EasingPreset>} */
export const EASING_PRESETS = {
  linear: {
    label: 'Linear',
    hint: 'Constant speed — best for turntable rotations',
    kind: 'linear',
    bezier: [0, 0, 1, 1]
  },
  easeIn: {
    label: 'Ease in',
    hint: 'Starts slow, ends fast',
    kind: 'easeIn',
    bezier: [0.42, 0, 1, 1]
  },
  easeOut: {
    label: 'Ease out',
    hint: 'Starts fast, ends slow',
    kind: 'easeOut',
    bezier: [0, 0, 0.58, 1]
  },
  easeInOut: {
    label: 'Ease in-out',
    hint: 'Slow at both ends',
    kind: 'easeInOut',
    bezier: [0.42, 0, 0.58, 1]
  },
  easeInOutCubic: {
    label: 'Smooth out',
    hint: 'Legacy default — decelerates toward the keyframe',
    kind: 'easeInOutCubic',
    bezier: [0.33, 1, 0.68, 1]
  },
  bezier: {
    label: 'Custom',
    hint: 'Drag the handles to shape the curve',
    kind: 'bezier',
    bezier: [0.25, 0.1, 0.25, 1]
  }
}

export const DEFAULT_EASING_KIND = /** @type {AnimationEasingKind} */ ('easeInOutCubic')

const NEWTON_ITER = 4
const NEWTON_EPS = 1e-6
const SUBDIVISIONS = 10
const SUBDIVISION_EPS = 1e-7

/**
 * @param {number} a
 * @param {number} b
 * @param {number} m
 */
function clamp(a, b, m) {
  return Math.max(a, Math.min(b, m))
}

/**
 * @param {number} t
 * @param {[number, number, number, number]} bezier
 */
function bezierX(t, bezier) {
  const [x1, , x2] = bezier
  const u = 1 - t
  return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t
}

/**
 * @param {number} t
 * @param {[number, number, number, number]} bezier
 */
function bezierY(t, bezier) {
  const [, y1, , y2] = bezier
  const u = 1 - t
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
}

/**
 * @param {number} t
 * @param {[number, number, number, number]} bezier
 */
function bezierDX(t, bezier) {
  const [x1, , x2] = bezier
  const u = 1 - t
  return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2)
}

/**
 * @param {number} x
 * @param {[number, number, number, number]} bezier
 */
function solveBezierT(x, bezier) {
  let t = x
  for (let i = 0; i < NEWTON_ITER; i++) {
    const dx = bezierX(t, bezier) - x
    const slope = bezierDX(t, bezier)
    if (Math.abs(dx) < NEWTON_EPS) return t
    if (Math.abs(slope) < 1e-8) break
    t -= dx / slope
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < SUBDIVISIONS; i++) {
    const bx = bezierX(t, bezier)
    if (Math.abs(bx - x) < SUBDIVISION_EPS) return t
    if (bx > x) hi = t
    else lo = t
    t = (lo + hi) * 0.5
  }
  return t
}

/**
 * @param {number} t
 * @param {[number, number, number, number]} bezier
 */
export function evaluateBezierEasing(t, bezier) {
  const x = clamp(0, 1, t)
  if (x <= 0) return 0
  if (x >= 1) return 1
  const u = solveBezierT(x, bezier)
  return clamp(0, 1, bezierY(u, bezier))
}

/**
 * @param {number} t
 * @param {[number, number, number, number]} bezier
 */
export function evaluateBezierVelocity(t, bezier) {
  const x = clamp(0, 1, t)
  const dt = 0.004
  const y0 = evaluateBezierEasing(Math.max(0, x - dt * 0.5), bezier)
  const y1 = evaluateBezierEasing(Math.min(1, x + dt * 0.5), bezier)
  return (y1 - y0) / dt
}

/**
 * @param {unknown} kind
 * @returns {AnimationEasingKind}
 */
export function normalizeEasingKind(kind) {
  if (typeof kind === 'string' && kind in EASING_PRESETS) {
    return /** @type {AnimationEasingKind} */ (kind)
  }
  return DEFAULT_EASING_KIND
}

/**
 * @param {unknown} raw
 * @param {AnimationEasingKind} kind
 * @returns {[number, number, number, number]}
 */
export function normalizeBezier(raw, kind) {
  const preset = EASING_PRESETS[kind] ?? EASING_PRESETS[DEFAULT_EASING_KIND]
  if (Array.isArray(raw) && raw.length === 4 && raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [
      clamp(0, 1, raw[0]),
      clamp(-0.5, 1.5, raw[1]),
      clamp(0, 1, raw[2]),
      clamp(-0.5, 1.5, raw[3])
    ]
  }
  return [...preset.bezier]
}

/**
 * @param {AnimationEasingKind} kind
 * @param {[number, number, number, number] | undefined | null} bezier
 * @returns {[number, number, number, number]}
 */
export function bezierForKeyframe(kind, bezier) {
  if (kind === 'bezier') return normalizeBezier(bezier, 'bezier')
  return [...EASING_PRESETS[kind].bezier]
}

/**
 * @param {number} t
 * @param {AnimationEasingKind} kind
 * @param {[number, number, number, number] | undefined | null} [bezier]
 */
export function applyEasing(t, kind = DEFAULT_EASING_KIND, bezier) {
  const x = clamp(0, 1, t)
  const k = normalizeEasingKind(kind)
  if (k === 'linear') return x
  // Legacy polynomial ease-out (exact match for old projects using easeInOutCubic)
  if (k === 'easeInOutCubic' && !bezier) return 1 - Math.pow(1 - x, 3)
  const curve = bezierForKeyframe(k, bezier)
  return evaluateBezierEasing(x, curve)
}

/**
 * @param {AnimationEasingKind} kind
 * @param {[number, number, number, number] | undefined | null} [bezier]
 */
export function easingLabel(kind, bezier) {
  const k = normalizeEasingKind(kind)
  if (k === 'bezier') return 'Custom curve'
  return EASING_PRESETS[k].label
}

/**
 * Sample points for drawing position / velocity curves.
 * @param {AnimationEasingKind} kind
 * @param {[number, number, number, number] | undefined | null} bezier
 * @param {number} [count]
 */
export function sampleEasingCurves(kind, bezier, count = 64) {
  const k = normalizeEasingKind(kind)
  const curve = bezierForKeyframe(k, bezier)
  const position = []
  const velocity = []
  const dt = 1 / count
  for (let i = 0; i <= count; i++) {
    const t = i / count
    position.push({ t, y: applyEasing(t, k, k === 'bezier' ? bezier : null) })
    const y0 = applyEasing(Math.max(0, t - dt * 0.5), k, k === 'bezier' ? bezier : null)
    const y1 = applyEasing(Math.min(1, t + dt * 0.5), k, k === 'bezier' ? bezier : null)
    velocity.push({ t, y: (y1 - y0) / dt })
  }
  return { position, velocity, bezier: curve }
}

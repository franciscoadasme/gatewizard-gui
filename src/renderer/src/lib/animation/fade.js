import { applyEasing, normalizeBezier, normalizeEasingKind } from './easing.js'

/** @typedef {import('./easing.js').AnimationEasingKind} AnimationEasingKind */

/**
 * @typedef {Object} AnimationFadeSettings
 * @property {boolean} [fadeEnabled]
 * @property {number} [fadeIn_s]
 * @property {number} [fadeOut_s]
 * @property {AnimationEasingKind} [fadeInEasing]
 * @property {AnimationEasingKind} [fadeOutEasing]
 * @property {[number, number, number, number]} [fadeInBezier]
 * @property {[number, number, number, number]} [fadeOutBezier]
 */

export const DEFAULT_FADE_IN_S = 0.35
export const DEFAULT_FADE_OUT_S = 0.35
export const DEFAULT_FADE_EASING = /** @type {AnimationEasingKind} */ ('easeInOut')

/** @param {unknown} raw */
export function isFadeEnabled(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw ?? {})
  return r.fadeEnabled !== false
}

/** @param {unknown} raw */
export function fadeSummary(raw) {
  if (!isFadeEnabled(raw)) return 'Off (instant show/hide)'
  const s = normalizeFadeSettings(raw)
  return `In ${(s.fadeIn_s ?? DEFAULT_FADE_IN_S).toFixed(2)}s · Out ${(s.fadeOut_s ?? DEFAULT_FADE_OUT_S).toFixed(2)}s`
}

/** @returns {Required<Pick<AnimationFadeSettings, 'fadeIn_s' | 'fadeOut_s' | 'fadeInEasing' | 'fadeOutEasing'>> & AnimationFadeSettings} */
export function defaultFadeSettings() {
  return {
    fadeEnabled: true,
    fadeIn_s: DEFAULT_FADE_IN_S,
    fadeOut_s: DEFAULT_FADE_OUT_S,
    fadeInEasing: DEFAULT_FADE_EASING,
    fadeOutEasing: DEFAULT_FADE_EASING
  }
}

/**
 * @param {unknown} raw
 * @returns {AnimationFadeSettings}
 */
export function normalizeFadeSettings(raw) {
  const d = defaultFadeSettings()
  const r = /** @type {Record<string, unknown>} */ (raw ?? {})
  const fadeInEasing = normalizeEasingKind(r.fadeInEasing ?? d.fadeInEasing)
  const fadeOutEasing = normalizeEasingKind(r.fadeOutEasing ?? d.fadeOutEasing)
  return {
    fadeEnabled: r.fadeEnabled !== false,
    fadeIn_s:
      typeof r.fadeIn_s === 'number' && r.fadeIn_s >= 0
        ? r.fadeIn_s
        : d.fadeIn_s,
    fadeOut_s:
      typeof r.fadeOut_s === 'number' && r.fadeOut_s >= 0
        ? r.fadeOut_s
        : d.fadeOut_s,
    fadeInEasing,
    fadeOutEasing,
    fadeInBezier:
      fadeInEasing === 'bezier' ? normalizeBezier(r.fadeInBezier, fadeInEasing) : undefined,
    fadeOutBezier:
      fadeOutEasing === 'bezier' ? normalizeBezier(r.fadeOutBezier, fadeOutEasing) : undefined
  }
}

/**
 * @param {AnimationFadeSettings | undefined} item
 * @param {number} rawT segment linear 0..1
 * @param {number} segmentDuration
 */
export function fadeInOpacity(item, rawT, segmentDuration) {
  if (!isFadeEnabled(item)) return rawT >= 1 ? 1 : 0
  const settings = normalizeFadeSettings(item)
  const dur = Math.min(settings.fadeIn_s ?? DEFAULT_FADE_IN_S, segmentDuration)
  if (dur <= 0) return 1
  const segTime = rawT * segmentDuration
  if (segTime >= dur) return 1
  const linearT = segTime / dur
  return applyEasing(
    linearT,
    settings.fadeInEasing ?? DEFAULT_FADE_EASING,
    settings.fadeInBezier
  )
}

/**
 * @param {AnimationFadeSettings | undefined} item
 * @param {number} rawT segment linear 0..1
 * @param {number} segmentDuration
 */
export function fadeOutOpacity(item, rawT, segmentDuration) {
  if (!isFadeEnabled(item)) return rawT < 1 ? 1 : 0
  const settings = normalizeFadeSettings(item)
  const dur = Math.min(settings.fadeOut_s ?? DEFAULT_FADE_OUT_S, segmentDuration)
  if (dur <= 0) return rawT < 1 ? 1 : 0
  const segTime = rawT * segmentDuration
  const fadeStart = segmentDuration - dur
  if (segTime <= fadeStart) return 1
  const linearT = (segTime - fadeStart) / dur
  return 1 - applyEasing(
    Math.min(1, Math.max(0, linearT)),
    settings.fadeOutEasing ?? DEFAULT_FADE_EASING,
    settings.fadeOutBezier
  )
}

/**
 * @param {{
 *   fadeEnabled?: boolean
 *   visible?: boolean
 *   fadeIn_s?: number
 *   fadeOut_s?: number
 *   fadeInEasing?: AnimationEasingKind
 *   fadeOutEasing?: AnimationEasingKind
 *   fadeInBezier?: [number, number, number, number]
 *   fadeOutBezier?: [number, number, number, number]
 * } | undefined} fromItem
 * @param {typeof fromItem} toItem
 * @param {number} rawT
 * @param {number} segmentDuration
 */
export function computeOverlayOpacity(fromItem, toItem, rawT, segmentDuration) {
  const visFrom = fromItem?.visible !== false
  const visTo = toItem?.visible !== false

  if (!fromItem && toItem) {
    return visTo ? fadeInOpacity(toItem, rawT, segmentDuration) : 0
  }
  if (fromItem && !toItem) {
    return visFrom ? fadeOutOpacity(fromItem, rawT, segmentDuration) : 0
  }
  if (fromItem && toItem) {
    if (visFrom && visTo) return 1
    if (!visFrom && visTo) return fadeInOpacity(toItem, rawT, segmentDuration)
    if (visFrom && !visTo) return fadeOutOpacity(toItem, rawT, segmentDuration)
    return 0
  }
  return 0
}

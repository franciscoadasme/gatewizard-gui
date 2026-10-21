import { applyEasing, DEFAULT_EASING_KIND } from './easing.js'
import { motionEasingForStructure } from './schema.js'

/**
 * Camera and molecule sample the same straight segment with different curves.
 * @param {number} rawT
 * @param {import('./schema.js').AnimationKeyframe | {
 *   cameraEasing?: import('./easing.js').AnimationEasingKind
 *   cameraEasingBezier?: [number, number, number, number]
 *   motionEasing?: import('./easing.js').AnimationEasingKind
 *   motionEasingBezier?: [number, number, number, number]
 *   motionEasings?: Record<string, { easing: import('./easing.js').AnimationEasingKind, easingBezier?: [number, number, number, number] }>
 * } | null | undefined} to
 * @param {string | null} [structureId] structure whose motion curve to sample
 */
export function channelClock(rawT, to, structureId = null) {
  const motion = motionEasingForStructure(/** @type {import('./schema.js').AnimationKeyframe} */ (to), structureId)
  return {
    cameraT: applyEasing(rawT, to?.cameraEasing ?? DEFAULT_EASING_KIND, to?.cameraEasingBezier),
    motionT: applyEasing(rawT, motion.easing ?? DEFAULT_EASING_KIND, motion.easingBezier)
  }
}

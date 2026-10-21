import { normalizeFadeSettings } from './fade.js'
import { cloneSerializedView } from './tracks.js'

/**
 * Write fade settings onto a view snapshot on a keyframe (creates the entry if missing).
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {string} keyframeId
 * @param {string} viewId
 * @param {import('./fade.js').AnimationFadeSettings} next
 * @param {import('./schema.js').SerializedView | null} [template]
 * @returns {boolean}
 */
export function writeViewFadeOnKeyframe(keyframes, keyframeId, viewId, next, template = null) {
  const kf = keyframes.find((k) => k.id === keyframeId)
  if (!kf) return false
  const id = String(viewId)
  const fade = normalizeFadeSettings(next)
  const idx = (kf.views || []).findIndex((v) => String(v.id) === id)
  if (idx >= 0) {
    kf.views[idx] = { ...kf.views[idx], ...fade }
    return true
  }
  if (!template) return false
  kf.views = [...(kf.views || []), { ...cloneSerializedView(template), id, ...fade }]
  return true
}

/**
 * Whether a view appears or disappears across a segment (fade-relevant).
 * @param {import('./schema.js').SerializedView | null | undefined} fromView
 * @param {import('./schema.js').SerializedView | null | undefined} toView
 */
export function viewPresenceChanges(fromView, toView) {
  const fromVis = fromView ? fromView.visible !== false : false
  const toVis = toView ? toView.visible !== false : false
  if (!fromView && toView && toVis) return 'in'
  if (fromView && !toView && fromVis) return 'out'
  if (fromView && toView && fromVis !== toVis) return toVis ? 'in' : 'out'
  return null
}

import { applyCameraPose } from './cameraPose.js'
import { mainViewerFramingAnchor } from '../../components/viewer/CameraRig.svelte'
import { interpolateAtTime } from './interpolate.js'
import {
  applySceneSettings,
  deserializeAtomLabels,
  deserializeMeasurements,
  deserializeView,
  mergeSerializedViewInto
} from './serialize.js'
import {
  deriveViewTracks,
  firstViewSnapshot,
  mergeTrackOrder,
  viewSnapshotAtOrBeforeTime
} from './tracks.js'

/**
 * @param {Record<string, unknown>} live
 * @param {import('./schema.js').SerializedView | undefined} stateView
 * @param {import('./schema.js').SerializedView | null | undefined} template
 * @param {boolean} hasSnapshotAtOrBeforeTime
 */
function applyViewVisibilityFromState(live, stateView, template, hasSnapshotAtOrBeforeTime) {
  if (stateView) {
    const opacity = typeof stateView.opacity === 'number' ? stateView.opacity : 1
    live.visible = opacity > 0.001
    if (typeof stateView.opacity === 'number') live.opacity = stateView.opacity
    else delete live.opacity
    return
  }
  if (hasSnapshotAtOrBeforeTime && template) {
    live.visible = template.visible !== false
    if (live.visible) delete live.opacity
    else live.opacity = 0
    return
  }
  live.visible = false
  live.opacity = 0
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 * @param {{
 *   getViews: () => Record<string, unknown>[]
 *   setViews: (views: Record<string, unknown>[]) => void
 *   structureCtx: { path: string | null, atoms?: unknown[], bonds?: unknown[], residues?: unknown[] }
 *   applyFraming?: (framing: import('./schema.js').AnimationCameraFraming) => void
 *   applyViewport?: (viewport: import('./schema.js').AnimationViewport) => void
 *   setLabels?: (labels: Record<string, unknown>[]) => void
 *   setMeasurements?: (measurements: Record<string, unknown>[]) => void
 * }} ctx
 * @param {{
 *   views: import('./schema.js').SerializedView[]
 *   camera: import('./schema.js').AnimationCameraPose
 *   scene: Record<string, unknown>
 *   viewport?: import('./schema.js').AnimationViewport
 *   labels?: import('./schema.js').SerializedAtomLabel[]
 *   measurements?: import('./schema.js').SerializedMeasurement[]
 * }} state
 * @param {string[]} viewTracks
 */
function applyViewsFromAnimation(keyframes, time_s, ctx, state, viewTracks) {
  const liveViews = ctx.getViews()
  const stateById = new Map(state.views.map((v) => [String(v.id), v]))
  const liveById = new Map(liveViews.map((v) => [String(v.id), v]))
  const trackOrder = mergeTrackOrder(viewTracks, [
    ...state.views,
    ...deriveViewTracks(keyframes).map((id) => ({ id })),
    ...liveViews.map((v) => ({ id: String(v.id) }))
  ])
  const result = []
  const processed = new Set()

  for (const id of trackOrder) {
    const stateView = stateById.get(id)
    const live = liveById.get(id)
    const snapshotAtTime = viewSnapshotAtOrBeforeTime(keyframes, id, time_s)
    const template = stateView ?? snapshotAtTime ?? firstViewSnapshot(keyframes, id)
    const hasSnapshot = snapshotAtTime != null

    if (!template && !live) continue

    if (template) {
      if (live) {
        mergeSerializedViewInto(live, template)
        applyViewVisibilityFromState(live, stateView, template, hasSnapshot)
        result.push(live)
      } else {
        const view = deserializeView(template, ctx.structureCtx)
        applyViewVisibilityFromState(view, stateView, template, hasSnapshot)
        result.push(view)
      }
    } else if (live) {
      live.visible = false
      live.opacity = 0
      result.push(live)
    }
    processed.add(id)
  }

  for (const serialized of state.views) {
    const id = String(serialized.id)
    if (processed.has(id)) continue
    const live = liveById.get(id)
    const snapshotAtTime = viewSnapshotAtOrBeforeTime(keyframes, id, time_s)
    const template = serialized
    const hasSnapshot = snapshotAtTime != null
    if (live) {
      mergeSerializedViewInto(live, template)
      applyViewVisibilityFromState(live, serialized, template, hasSnapshot)
      result.push(live)
    } else {
      const view = deserializeView(template, ctx.structureCtx)
      applyViewVisibilityFromState(view, serialized, template, hasSnapshot)
      result.push(view)
    }
    processed.add(id)
  }

  if (typeof window !== 'undefined' && window.__gwAnimDebug) {
    const now = Date.now()
    if (!applyViewsFromAnimation._lastLog || now - applyViewsFromAnimation._lastLog > 400) {
      applyViewsFromAnimation._lastLog = now
      console.debug(
        '[animation] t=' + time_s.toFixed(2),
        result.map((v) => ({
          id: String(v.id).slice(0, 8),
          visible: v.visible,
          opacity: v.opacity,
          atomsLen: /** @type {{ length?: number }} */ (v.atoms)?.length
        }))
      )
    }
  }

  ctx.setViews(result)
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 * @param {{
 *   getViews: () => Record<string, unknown>[]
 *   setViews: (views: Record<string, unknown>[]) => void
 *   structureCtx: { path: string | null, atoms?: unknown[], bonds?: unknown[], residues?: unknown[] }
 *   applyFraming?: (framing: import('./schema.js').AnimationCameraFraming) => void
 *   applyViewport?: (viewport: import('./schema.js').AnimationViewport) => void
 *   setLabels?: (labels: Record<string, unknown>[]) => void
 *   setMeasurements?: (measurements: Record<string, unknown>[]) => void
 * }} ctx
 * @param {string[]} [viewTracks]
 */
export function applyAnimationAtTime(keyframes, time_s, ctx, viewTracks = []) {
  const state = interpolateAtTime(keyframes, time_s, viewTracks)
  if (!state) return

  if (state.camera.framing) {
    ctx.applyFraming?.(state.camera.framing)
    const f = state.camera.framing
    mainViewerFramingAnchor.fn(f.center[0], f.center[1], f.center[2], f.extent)
  }

  applyCameraPose(state.camera)
  applySceneSettings(state.scene)
  if (state.viewport) ctx.applyViewport?.(state.viewport)

  applyViewsFromAnimation(keyframes, time_s, ctx, state, viewTracks)

  const atoms = /** @type {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} */ (
    ctx.structureCtx.atoms ?? []
  )
  if (ctx.setLabels) {
    ctx.setLabels(deserializeAtomLabels(state.labels ?? [], atoms))
  }
  if (ctx.setMeasurements) {
    ctx.setMeasurements(deserializeMeasurements(state.measurements ?? [], atoms))
  }
}

/**
 * @param {{
 *   keyframes: import('./schema.js').AnimationKeyframe[]
 *   duration_s: number
 *   fps: number
 *   getPlayhead: () => number
 *   setPlayhead: (t: number) => void
 *   isPlaying: () => boolean
 *   setPlaying: (v: boolean) => void
 *   onFrame: (time_s: number) => void
 *   onDone?: () => void
 * }} opts
 */
export function startPlayback(opts) {
  let raf = 0
  let startWall = 0
  let startPlayhead = opts.getPlayhead()

  const tick = (now) => {
    if (!opts.isPlaying()) return
    if (!startWall) startWall = now
    const elapsed = (now - startWall) / 1000
    let t = startPlayhead + elapsed
    if (t >= opts.duration_s) {
      t = opts.duration_s
      opts.setPlayhead(t)
      Promise.resolve()
        .then(() => opts.onFrame(t))
        .catch((err) => console.error('[animation] onFrame failed (final frame)', err))
        .then(() => {
          opts.setPlaying(false)
          opts.onDone?.()
        })
      return
    }
    opts.setPlayhead(t)
    Promise.resolve()
      .then(() => opts.onFrame(t))
      .catch((err) => console.error('[animation] onFrame failed', err))
      .then(() => {
        if (opts.isPlaying()) raf = requestAnimationFrame(tick)
      })
  }

  raf = requestAnimationFrame(tick)
  return () => {
    if (raf) cancelAnimationFrame(raf)
  }
}

/** @typedef {import('./schema.js').AnimationKeyframe} AnimationKeyframe */
/** @typedef {import('./schema.js').AnimationProject} AnimationProject */
/** @typedef {import('./schema.js').SerializedView} SerializedView */

/**
 * @param {SerializedView[]} views
 * @returns {Map<string, SerializedView>}
 */
export function viewsById(views) {
  return new Map(views.map((v) => [String(v.id), v]))
}

/**
 * Stable track order from keyframes (first appearance order).
 * @param {AnimationKeyframe[]} keyframes
 * @returns {string[]}
 */
export function deriveViewTracks(keyframes) {
  const order = []
  const seen = new Set()
  for (const kf of keyframes) {
    for (const v of kf.views) {
      const id = String(v.id)
      if (!seen.has(id)) {
        seen.add(id)
        order.push(id)
      }
    }
  }
  return order
}

/**
 * Keep saved track order for ids still present in keyframes; drop orphaned ids; append new ones.
 * @param {string[] | undefined} saved
 * @param {AnimationKeyframe[]} keyframes
 * @returns {string[]}
 */
export function reconcileViewTracks(saved, keyframes) {
  const derived = deriveViewTracks(keyframes)
  const derivedSet = new Set(derived)
  const ordered = []
  const seen = new Set()
  for (const id of saved ?? []) {
    if (derivedSet.has(id) && !seen.has(id)) {
      ordered.push(id)
      seen.add(id)
    }
  }
  for (const id of derived) {
    if (!seen.has(id)) {
      ordered.push(id)
      seen.add(id)
    }
  }
  return ordered
}

/**
 * @param {AnimationProject} project
 */
export function syncProjectViewTracks(project) {
  project.viewTracks = reconcileViewTracks(project.viewTracks, project.keyframes)
}

/**
 * @param {AnimationProject} project
 * @param {string} trackId
 * @param {string[]} [panelOrder] live view ids for panel order hint
 */
export function registerViewTrack(project, trackId, panelOrder = []) {
  if (!project.viewTracks) project.viewTracks = []
  if (project.viewTracks.includes(trackId)) return
  const idx = panelOrder.indexOf(trackId)
  if (idx <= 0) {
    project.viewTracks.push(trackId)
    return
  }
  const prevId = panelOrder[idx - 1]
  const prevIdx = project.viewTracks.indexOf(prevId)
  if (prevIdx >= 0) {
    project.viewTracks.splice(prevIdx + 1, 0, trackId)
  } else {
    project.viewTracks.push(trackId)
  }
}

/**
 * @param {AnimationProject} project
 * @param {string} trackId
 */
export function removeViewTrackFromProject(project, trackId) {
  project.viewTracks = (project.viewTracks ?? []).filter((id) => id !== trackId)
  project.keyframes = project.keyframes.map((kf) => ({
    ...kf,
    views: kf.views.filter((v) => String(v.id) !== trackId)
  }))
}

/**
 * @param {AnimationProject} project
 * @param {string} trackId
 */
export function isTrackInAnimation(project, trackId) {
  if (project.viewTracks?.includes(trackId)) return true
  return project.keyframes.some((kf) => kf.views.some((v) => String(v.id) === trackId))
}

/**
 * @param {SerializedView[]} views
 * @param {string[]} trackOrder
 * @returns {SerializedView[]}
 */
export function sortViewsByTracks(views, trackOrder) {
  if (!trackOrder.length) return views
  const byId = viewsById(views)
  const out = []
  const seen = new Set()
  for (const id of trackOrder) {
    const v = byId.get(id)
    if (v) {
      out.push(v)
      seen.add(id)
    }
  }
  for (const v of views) {
    const id = String(v.id)
    if (!seen.has(id)) out.push(v)
  }
  return out
}

/**
 * @param {string[]} trackOrder
 * @param {SerializedView[]} views
 * @returns {string[]}
 */
export function mergeTrackOrder(trackOrder, views) {
  const out = [...trackOrder]
  const seen = new Set(out)
  for (const v of views) {
    const id = String(v.id)
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

/**
 * @param {SerializedView} view
 * @returns {SerializedView}
 */
export function cloneSerializedView(view) {
  return JSON.parse(JSON.stringify(view))
}

/**
 * Latest serialized view for a track at or before time_s (stepped hold between keyframes).
 * @param {AnimationKeyframe[]} keyframes
 * @param {string} viewId
 * @param {number} time_s
 * @returns {SerializedView | null}
 */
export function viewSnapshotAtOrBeforeTime(keyframes, viewId, time_s) {
  const sorted = [...keyframes].sort((a, b) => a.time_s - b.time_s)
  let found = null
  for (const kf of sorted) {
    if (kf.time_s > time_s + 1e-6) break
    const v = kf.views.find((x) => String(x.id) === viewId)
    if (v) found = v
  }
  return found
}

/**
 * First keyframe that defines a representation track (for panel setup before it is visible).
 * @param {AnimationKeyframe[]} keyframes
 * @param {string} viewId
 * @returns {SerializedView | null}
 */
export function firstViewSnapshot(keyframes, viewId) {
  const sorted = [...keyframes].sort((a, b) => a.time_s - b.time_s)
  for (const kf of sorted) {
    const v = kf.views.find((x) => String(x.id) === viewId)
    if (v) return cloneSerializedView(v)
  }
  return null
}

/**
 * Keyframes where a representation track should appear on the timeline
 * (from first capture through all later keyframes).
 * @param {AnimationKeyframe[]} keyframes
 * @param {string} trackId
 */
export function keyframesForTrackTimeline(keyframes, trackId) {
  const sorted = [...keyframes].sort((a, b) => a.time_s - b.time_s)
  const firstIdx = sorted.findIndex((kf) => kf.views.some((v) => String(v.id) === trackId))
  if (firstIdx < 0) return []
  return sorted.slice(firstIdx)
}

/**
 * When a keyframe introduces new representation tracks, copy them into all later keyframes.
 * @param {AnimationKeyframe[]} keyframes
 * @param {string} sourceKeyframeId
 * @param {string[]} [viewTracks]
 */
export function propagateNewViewsToLaterKeyframes(keyframes, sourceKeyframeId, viewTracks = []) {
  propagateKeyframeStateToLaterKeyframes(keyframes, sourceKeyframeId, viewTracks, {
    views: 'new-only',
    scene: false,
    viewport: false
  })
}

/**
 * Push view/scene state from a captured keyframe into all later keyframes.
 * @param {AnimationKeyframe[]} keyframes
 * @param {string} sourceKeyframeId
 * @param {string[]} [viewTracks]
 * @param {{ views?: 'all' | 'new-only' | 'none', scene?: boolean, viewport?: boolean, labels?: boolean, measurements?: boolean }} [opts]
 */
export function propagateKeyframeStateToLaterKeyframes(
  keyframes,
  sourceKeyframeId,
  viewTracks = [],
  opts = {}
) {
  const {
    views: viewsMode = 'all',
    scene = true,
    viewport = true,
    labels = true,
    measurements = true
  } = opts
  const sorted = [...keyframes].sort((a, b) => a.time_s - b.time_s)
  const source = sorted.find((k) => k.id === sourceKeyframeId)
  if (!source) return

  const sourceTime = source.time_s
  const earlierIds = new Set()
  for (const kf of sorted) {
    if (kf.time_s >= sourceTime - 1e-6) break
    for (const v of kf.views) earlierIds.add(String(v.id))
  }

  const newlyIntroduced = source.views
    .map((v) => String(v.id))
    .filter((id) => !earlierIds.has(id))

  for (const kf of sorted) {
    if (kf.time_s <= sourceTime + 1e-6) continue

    if (viewsMode !== 'none') {
      const nextViews = [...kf.views]
      for (const sv of source.views) {
        const id = String(sv.id)
        if (viewsMode === 'new-only' && !newlyIntroduced.includes(id)) continue
        const idx = nextViews.findIndex((v) => String(v.id) === id)
        if (idx >= 0) {
          // In 'new-only' mode a later keyframe that already defines this track has its
          // own explicit, independently-captured state (e.g. a representation becoming
          // visible) — never clobber it with the source keyframe's state. 'all' mode is
          // an explicit "propagate everything forward" action, so it does overwrite.
          if (viewsMode === 'new-only') continue
          nextViews[idx] = cloneSerializedView(sv)
        } else {
          nextViews.push(cloneSerializedView(sv))
        }
      }
      kf.views = sortViewsByTracks(nextViews, viewTracks)
    }

    if (scene && source.scene) {
      kf.scene = JSON.parse(JSON.stringify(source.scene))
    }
    if (viewport && source.viewport) {
      kf.viewport = { ...source.viewport }
    }
    if (labels) {
      kf.labels = source.labels ? source.labels.map((l) => ({ ...l })) : []
    }
    if (measurements) {
      kf.measurements = source.measurements
        ? source.measurements.map((m) => ({ ...m, atomIndices: [...m.atomIndices] }))
        : []
    }
  }
}

/**
 * Repair older projects: propagate each keyframe forward in time order.
 * Only fills in newly-introduced view tracks — never touches scene/viewport,
 * which must remain independent per keyframe.
 * @param {AnimationKeyframe[]} keyframes
 * @param {string[]} [viewTracks]
 */
export function repairForwardViewInheritance(keyframes, viewTracks = []) {
  const sorted = [...keyframes].sort((a, b) => a.time_s - b.time_s)
  for (const kf of sorted) {
    propagateKeyframeStateToLaterKeyframes(keyframes, kf.id, viewTracks, {
      views: 'new-only',
      scene: false,
      viewport: false,
      labels: false,
      measurements: false
    })
  }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  persistViewVisibilityInKeyframes,
  persistViewSelectionEachFrameInKeyframes,
  persistViewTrajSmoothRestoreHInKeyframes,
  repairForwardViewInheritance,
  restoreViewsAfterLeavingAnimate,
  propagateNewViewsToLaterKeyframes,
  viewSnapshotAtOrBeforeTime
} from './tracks.js'

/**
 * @param {string} id
 * @param {boolean} visible
 * @returns {import('./schema.js').SerializedView}
 */
function view(id, visible) {
  return /** @type {any} */ ({ id, selection: 'x', baseSelection: 'x', visible })
}

/**
 * @param {string} id
 * @param {number} time_s
 * @param {import('./schema.js').SerializedView[]} views
 * @returns {import('./schema.js').AnimationKeyframe}
 */
function keyframe(id, time_s, views) {
  return /** @type {any} */ ({ id, time_s, views, scene: {}, labels: [], measurements: [] })
}

test('repairForwardViewInheritance does not clobber explicit later-keyframe view state', () => {
  // Regression test for a bug where loading a saved animation project made every
  // representation "freeze" at its keyframe-0 state during playback: because the
  // very first keyframe has no earlier keyframe to diff against, ALL of its views
  // were treated as "newly introduced" and force-copied into every later keyframe,
  // overwriting visibility changes the user had explicitly captured (e.g. an ion
  // representation turning visible partway through the animation).
  const keyframes = [
    keyframe('kf0', 0, [view('protein', true), view('ion', false)]),
    keyframe('kf1', 2, [view('protein', true), view('ion', true)]), // ion becomes visible here
    keyframe('kf2', 4, [view('protein', true), view('ion', true)])
  ]

  repairForwardViewInheritance(keyframes, ['protein', 'ion'])

  assert.equal(
    keyframes[1].views.find((v) => v.id === 'ion')?.visible,
    true,
    'kf1 ion visibility must remain true (independently captured), not be reset to kf0 value'
  )
  assert.equal(
    keyframes[2].views.find((v) => v.id === 'ion')?.visible,
    true,
    'kf2 ion visibility must remain true (independently captured), not be reset to kf0 value'
  )

  // Sanity check via the same lookup path playback uses: a query at t=3 (between
  // kf1 and kf2) must resolve to the "visible" snapshot captured at kf1, not fall
  // back to kf0's "hidden" state.
  assert.equal(viewSnapshotAtOrBeforeTime(keyframes, 'ion', 3)?.visible, true)
})

test('repairForwardViewInheritance still fills in tracks missing from later keyframes', () => {
  // Older projects (or keyframes captured before a track existed) may simply be
  // missing an entry for a track entirely — that case must still be repaired by
  // copying the nearest earlier definition forward, so the track doesn't disappear
  // from the timeline.
  const keyframes = [
    keyframe('kf0', 0, [view('protein', true), view('ion', false)]),
    keyframe('kf1', 2, [view('protein', true)]) // 'ion' missing entirely
  ]

  repairForwardViewInheritance(keyframes, ['protein', 'ion'])

  const ionInKf1 = keyframes[1].views.find((v) => v.id === 'ion')
  assert.ok(ionInKf1, 'missing track should be backfilled into later keyframe')
  assert.equal(ionInKf1?.visible, false)
})

test('propagateNewViewsToLaterKeyframes adds a brand-new track without touching existing tracks', () => {
  const keyframes = [
    keyframe('kf0', 0, [view('protein', true)]),
    keyframe('kfNew', 1, [view('protein', true), view('water', false)]), // 'water' introduced here
    keyframe('kf1', 2, [view('protein', false)]) // protein explicitly toggled off here
  ]

  propagateNewViewsToLaterKeyframes(keyframes, 'kfNew', ['protein', 'water'])

  const kf1 = keyframes[2]
  assert.equal(
    kf1.views.find((v) => v.id === 'protein')?.visible,
    false,
    'pre-existing track state in later keyframe must not be overwritten'
  )
  assert.equal(
    kf1.views.find((v) => v.id === 'water')?.visible,
    false,
    'newly introduced track must be propagated into later keyframes'
  )
})

test('persistViewVisibilityInKeyframes writes from the playhead snapshot forward', () => {
  const keyframes = [
    keyframe('kf0', 0, [view('ion', true), view('water', true)]),
    keyframe('kf1', 2, [view('ion', true), view('water', true)])
  ]
  assert.equal(persistViewVisibilityInKeyframes(keyframes, 'ion', false, 0), true)
  assert.equal(keyframes[0].views.find((v) => v.id === 'ion')?.visible, false)
  assert.equal(keyframes[1].views.find((v) => v.id === 'ion')?.visible, false)
  assert.equal(keyframes[0].views.find((v) => v.id === 'water')?.visible, true)

  const later = [
    keyframe('kf0', 0, [view('ion', false)]),
    keyframe('kf1', 2, [view('ion', false)])
  ]
  persistViewVisibilityInKeyframes(later, 'ion', true, 2)
  assert.equal(later[0].views[0].visible, false)
  assert.equal(later[1].views[0].visible, true)
})

test('persistViewSelectionEachFrameInKeyframes writes from the playhead snapshot forward', () => {
  const keyframes = [
    keyframe('kf0', 0, [view('lipid', true), view('protein', true)]),
    keyframe('kf1', 2, [view('lipid', true), view('protein', true)])
  ]
  assert.equal(persistViewSelectionEachFrameInKeyframes(keyframes, 'lipid', true, 0), true)
  assert.equal(keyframes[0].views.find((v) => v.id === 'lipid')?.selectionEachFrame, true)
  assert.equal(keyframes[1].views.find((v) => v.id === 'lipid')?.selectionEachFrame, true)
  assert.equal(keyframes[0].views.find((v) => v.id === 'protein')?.selectionEachFrame, undefined)

  persistViewSelectionEachFrameInKeyframes(keyframes, 'lipid', false, 2)
  assert.equal(keyframes[0].views.find((v) => v.id === 'lipid')?.selectionEachFrame, true)
  assert.equal(keyframes[1].views.find((v) => v.id === 'lipid')?.selectionEachFrame, false)
})

test('persistViewTrajSmoothRestoreHInKeyframes writes from the playhead snapshot forward', () => {
  const keyframes = [
    keyframe('kf0', 0, [view('lipid', true), view('protein', true)]),
    keyframe('kf1', 2, [view('lipid', true), view('protein', true)])
  ]
  assert.equal(persistViewTrajSmoothRestoreHInKeyframes(keyframes, 'lipid', false, 0), true)
  assert.equal(keyframes[0].views.find((v) => v.id === 'lipid')?.trajSmoothRestoreH, false)
  assert.equal(keyframes[1].views.find((v) => v.id === 'lipid')?.trajSmoothRestoreH, false)
  assert.equal(keyframes[0].views.find((v) => v.id === 'protein')?.trajSmoothRestoreH, undefined)

  persistViewTrajSmoothRestoreHInKeyframes(keyframes, 'lipid', true, 2)
  assert.equal(keyframes[0].views.find((v) => v.id === 'lipid')?.trajSmoothRestoreH, false)
  assert.equal(keyframes[1].views.find((v) => v.id === 'lipid')?.trajSmoothRestoreH, true)
})

test('restoreViewsAfterLeavingAnimate does not unhide faded or authored-hidden rows', () => {
  const views = [
    { id: 'shown', visible: true, opacity: 0.8 },
    { id: 'fadedInLater', visible: false, opacity: 0 },
    { id: 'hiddenBefore', visible: false, opacity: 0 }
  ]
  const keyframes = [
    keyframe('kf0', 0, [
      { ...view('shown', true), opacity: 0.4 },
      { ...view('fadedInLater', true), opacity: 1 },
      { ...view('hiddenBefore', false), opacity: 1 }
    ])
  ]

  restoreViewsAfterLeavingAnimate(views, keyframes, 0)

  assert.equal(views[0].visible, true)
  assert.equal(views[0].opacity, 0.4)
  assert.equal(views[1].visible, false)
  assert.equal(views[1].opacity, 1)
  assert.equal(views[2].visible, false)
  assert.equal(views[2].opacity, 1)
})

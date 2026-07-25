import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  repairForwardViewInheritance,
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

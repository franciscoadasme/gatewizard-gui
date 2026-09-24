import assert from 'node:assert/strict'
import test from 'node:test'
import { startPlayback } from './playbackClock.js'

test('startPlayback does not wait for onFrame before the next tick', async () => {
  const prevRaf = globalThis.requestAnimationFrame
  const prevCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 8)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)

  let playhead = 0
  let playing = true
  let frames = 0
  let blocked = 0
  const stop = startPlayback({
    keyframes: [],
    duration_s: 10,
    fps: 30,
    getPlayhead: () => playhead,
    setPlayhead: (t) => {
      playhead = t
    },
    isPlaying: () => playing,
    setPlaying: (v) => {
      playing = v
    },
    onFrame: () =>
      new Promise(() => {
        blocked += 1
      })
  })

  await new Promise((resolve) => setTimeout(resolve, 50))
  frames = playhead
  playing = false
  stop()
  globalThis.requestAnimationFrame = prevRaf
  globalThis.cancelAnimationFrame = prevCancel
  assert.ok(playhead > 0, `playhead should advance while onFrame hangs (got ${frames})`)
  assert.ok(blocked >= 1)
})

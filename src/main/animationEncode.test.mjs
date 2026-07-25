import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFfmpegEncodeArgs, formatFfmpegError } from './animationEncode.js'

test('gif encode uses filter_complex with palette pads', () => {
  const args = buildFfmpegEncodeArgs({
    framesDir: '/tmp/frames',
    outputPath: '/tmp/out.gif',
    fps: 12,
    format: 'gif'
  })
  assert.ok(args.includes('-filter_complex'))
  assert.ok(!args.includes('-vf'))
  const fc = args[args.indexOf('-filter_complex') + 1]
  assert.match(fc, /palettegen/)
  assert.match(fc, /\[s1\]\[p\]paletteuse/)
  assert.ok(args.includes('-start_number'))
  assert.equal(args[args.indexOf('-start_number') + 1], '1')
  assert.ok(args.includes('-loop'))
})

test('mp4 encode starts at frame 1', () => {
  const args = buildFfmpegEncodeArgs({
    framesDir: '/tmp/frames',
    outputPath: '/tmp/out.mp4',
    fps: 30,
    format: 'mp4'
  })
  assert.equal(args[args.indexOf('-start_number') + 1], '1')
  assert.ok(args.includes('libx264'))
})

test('formatFfmpegError keeps the useful tail', () => {
  const banner = 'A'.repeat(2500) + '\nError opening output files: Invalid argument'
  const msg = formatFfmpegError(banner, 80)
  assert.ok(msg.startsWith('…\n'))
  assert.ok(msg.includes('Invalid argument'))
})

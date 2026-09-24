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
  assert.ok(!fc.includes('reserve_transparent'))
})

test('gif encode reserves a transparent palette when requested', () => {
  const args = buildFfmpegEncodeArgs({
    framesDir: '/tmp/frames',
    outputPath: '/tmp/out.gif',
    fps: 12,
    format: 'gif',
    transparentBg: true
  })
  const fc = args[args.indexOf('-filter_complex') + 1]
  assert.match(fc, /reserve_transparent=1/)
  assert.match(fc, /alpha_threshold=128/)
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

test('webm encode stays yuv420p when opaque', () => {
  const args = buildFfmpegEncodeArgs({
    framesDir: '/tmp/frames',
    outputPath: '/tmp/out.webm',
    fps: 30,
    format: 'webm'
  })
  assert.ok(args.includes('libvpx-vp9'))
  assert.ok(args.includes('yuv420p'))
  assert.ok(!args.includes('yuva420p'))
  assert.ok(args.includes('-nostdin'))
  assert.equal(args[args.indexOf('-auto-alt-ref') + 1], '0')
  assert.equal(args[args.indexOf('-lag-in-frames') + 1], '0')
})

test('webm encode uses yuva420p when transparent', () => {
  const args = buildFfmpegEncodeArgs({
    framesDir: '/tmp/frames',
    outputPath: '/tmp/out.webm',
    fps: 30,
    format: 'webm',
    transparentBg: true
  })
  assert.ok(args.includes('yuva420p'))
  assert.ok(!args.includes('yuv420p'))
  assert.ok(args.includes('-nostdin'))
  assert.equal(args[args.indexOf('-auto-alt-ref') + 1], '0')
  assert.equal(args[args.indexOf('-lag-in-frames') + 1], '0')
})

test('mp4 encode stays yuv420p even when transparent is requested', () => {
  const args = buildFfmpegEncodeArgs({
    framesDir: '/tmp/frames',
    outputPath: '/tmp/out.mp4',
    fps: 30,
    format: 'mp4',
    transparentBg: true
  })
  assert.ok(args.includes('libx264'))
  assert.ok(args.includes('yuv420p'))
  assert.ok(!args.includes('yuva420p'))
})

test('formatFfmpegError keeps the useful tail', () => {
  const banner = 'A'.repeat(2500) + '\nError opening output files: Invalid argument'
  const msg = formatFfmpegError(banner, 80)
  assert.ok(msg.startsWith('…\n'))
  assert.ok(msg.includes('Invalid argument'))
})

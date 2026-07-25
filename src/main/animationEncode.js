import { join } from 'path'

/** @typedef {'mp4' | 'webm' | 'mov' | 'gif'} FfmpegAnimationFormat */

/**
 * Build ffmpeg argv for encoding a PNG frame sequence.
 * Frames are written as frame_000001.png … (1-based).
 *
 * @param {{ framesDir: string, outputPath: string, fps: number, format?: string }} opts
 * @returns {string[]}
 */
export function buildFfmpegEncodeArgs({ framesDir, outputPath, fps, format = 'mp4' }) {
  const input = [
    '-y',
    '-framerate',
    String(fps),
    '-start_number',
    '1',
    '-i',
    join(framesDir, 'frame_%06d.png')
  ]

  switch (format) {
    case 'webm':
      return [
        ...input,
        '-c:v',
        'libvpx-vp9',
        '-crf',
        '32',
        '-b:v',
        '0',
        '-pix_fmt',
        'yuv420p',
        outputPath
      ]
    case 'mov':
      return [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath]
    case 'gif':
      // palettegen/paletteuse needs a complex graph (labeled pads), not -vf.
      return [
        ...input,
        '-filter_complex',
        `fps=${fps},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`,
        '-loop',
        '0',
        outputPath
      ]
    case 'mp4':
    default:
      return [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath]
  }
}

/**
 * Prefer the useful end of ffmpeg stderr (banner is huge; the error is at the bottom).
 * @param {string} text
 * @param {number} [max=1800]
 */
export function formatFfmpegError(text, max = 1800) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 'ffmpeg failed to encode video'
  if (trimmed.length <= max) return trimmed
  return `…\n${trimmed.slice(-max)}`
}

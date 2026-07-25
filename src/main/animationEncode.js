import { join } from 'path'

/** @typedef {'mp4' | 'webm' | 'mov' | 'gif'} FfmpegAnimationFormat */

/**
 * @param {{ framesDir: string, outputPath: string, fps: number, format?: string }} opts
 * @returns {string[]}
 */
export function buildFfmpegEncodeArgs({ framesDir, outputPath, fps, format = 'mp4' }) {
  const input = [
    '-y',
    '-framerate',
    String(fps),
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
      return [
        ...input,
        '-vf',
        `fps=${fps},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1]paletteuse=dither=bayer`,
        outputPath
      ]
    case 'mp4':
    default:
      return [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath]
  }
}

import { outputFolderPath } from '../outputFolders.js'
import { mainViewerInvalidate } from '../../components/viewer/CameraRig.svelte'
import {
  DEFAULT_ANIMATION_EXPORT_FORMAT,
  animationOutputFileName
} from './exportFormats.js'
export { captureCanvasPng, computeSafeAreaInCanvas, computeSafeAreaForCanvas } from './safeArea.js'
export { ANIMATION_EXPORT_FORMATS, exportFormatMeta, normalizeExportFormat } from './exportFormats.js'

/** @typedef {{ workingDir: string, folderName: string }} AnimationOutputPaths */

/**
 * @param {string} workingDir
 * @param {string} folderName
 */
export function resolveAnimationOutputDir(workingDir, folderName) {
  const name = folderName.trim() || 'animation'
  if (workingDir) return outputFolderPath(workingDir, name)
  return ''
}

/**
 * @param {AnimationOutputPaths} paths
 */
export function animationProjectPath(paths) {
  const base = resolveAnimationOutputDir(paths.workingDir, paths.folderName)
  return base ? `${base}/animation.json` : ''
}

/**
 * @param {AnimationOutputPaths} paths
 */
export function animationFramesDir(paths) {
  const base = resolveAnimationOutputDir(paths.workingDir, paths.folderName)
  return base ? `${base}/frames` : ''
}

/**
 * @param {AnimationOutputPaths} paths
 * @param {import('./exportFormats.js').AnimationExportFormat} [format]
 */
export function animationVideoPath(paths, format = DEFAULT_ANIMATION_EXPORT_FORMAT) {
  const base = resolveAnimationOutputDir(paths.workingDir, paths.folderName)
  const name = animationOutputFileName(format)
  return base && name ? `${base}/${name}` : ''
}

/**
 * @param {number} index
 */
export function frameFileName(index) {
  return `frame_${String(index + 1).padStart(6, '0')}.png`
}

/**
 * @param {() => void} applyFrame
 * @param {() => Promise<void>} [waitFrame]
 */
export async function renderFrame(applyFrame, waitFrame) {
  applyFrame()
  mainViewerInvalidate.fn()
  if (waitFrame) {
    await waitFrame()
  } else {
    await new Promise((r) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(r))
      )
    )
  }
}

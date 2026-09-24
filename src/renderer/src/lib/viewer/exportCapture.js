import { Color } from 'three'

/** True while a figure or animation export has cleared the scene background. */
let exportCaptureActive = false

const _clearColor = new Color()

export function isExportCaptureActive() {
  return exportCaptureActive
}

/**
 * @param {{ scene?: import('three').Scene | null, renderer?: import('three').WebGLRenderer | null }} ctx
 * @returns {{
 *   scene: import('three').Scene,
 *   renderer: import('three').WebGLRenderer,
 *   prevBackground: import('three').Color | import('three').Texture | null,
 *   prevClear: import('three').Color,
 *   prevAlpha: number
 * }}
 */
export function beginTransparentCapture({ scene, renderer }) {
  if (!scene || !renderer) {
    throw new Error('Viewer is not ready for a transparent export')
  }
  const prevBackground = scene.background ?? null
  const prevClear = renderer.getClearColor(_clearColor).clone()
  const prevAlpha = renderer.getClearAlpha()
  exportCaptureActive = true
  scene.background = null
  renderer.setClearColor(0x000000, 0)
  return { scene, renderer, prevBackground, prevClear, prevAlpha }
}

/**
 * @param {ReturnType<typeof beginTransparentCapture> | null | undefined} handle
 */
export function endTransparentCapture(handle) {
  exportCaptureActive = false
  if (!handle) return
  const { scene, renderer, prevBackground, prevClear, prevAlpha } = handle
  scene.background = prevBackground
  renderer.setClearColor(prevClear, prevAlpha)
}

/**
 * Temporarily set the drawing buffer to `width` × `height` CSS pixels at 1× DPR.
 * @param {{
 *   renderer?: import('three').WebGLRenderer | null
 *   camera?: import('three').Camera | null
 *   width: number
 *   height: number
 *   adjustFrustum?: boolean
 * }} opts
 * @returns {{
 *   renderer: import('three').WebGLRenderer
 *   camera: import('three').Camera | null
 *   prevPixelRatio: number
 *   prevCssW: number
 *   prevCssH: number
 *   prevStyleW: string
 *   prevStyleH: string
 *   prevFrustum: { left: number, right: number, top: number, bottom: number } | null
 * } | null}
 */
export function beginExportRendererSize({
  renderer,
  camera = null,
  width,
  height,
  adjustFrustum = true
}) {
  if (!renderer) return null
  const canvas = renderer.domElement
  const outW = Math.max(1, Math.round(width))
  const outH = Math.max(1, Math.round(height))
  const prevPixelRatio = renderer.getPixelRatio()
  const prevCssW = canvas.clientWidth || canvas.width / (prevPixelRatio || 1) || outW
  const prevCssH = canvas.clientHeight || canvas.height / (prevPixelRatio || 1) || outH
  const prevStyleW = canvas.style.width
  const prevStyleH = canvas.style.height

  /** @type {{ left: number, right: number, top: number, bottom: number } | null} */
  let prevFrustum = null
  if (
    adjustFrustum &&
    camera &&
    'isOrthographicCamera' in camera &&
    camera.isOrthographicCamera
  ) {
    const ortho = /** @type {import('three').OrthographicCamera} */ (camera)
    prevFrustum = { left: ortho.left, right: ortho.right, top: ortho.top, bottom: ortho.bottom }
    const halfH = (ortho.top - ortho.bottom) / 2
    const aspect = outW / outH
    ortho.left = -halfH * aspect
    ortho.right = halfH * aspect
    ortho.updateProjectionMatrix()
  }

  renderer.setPixelRatio(1)
  renderer.setSize(outW, outH, false)
  return {
    renderer,
    camera,
    prevPixelRatio,
    prevCssW,
    prevCssH,
    prevStyleW,
    prevStyleH,
    prevFrustum
  }
}

/**
 * @param {ReturnType<typeof beginExportRendererSize>} handle
 */
export function endExportRendererSize(handle) {
  if (!handle) return
  const {
    renderer,
    camera,
    prevPixelRatio,
    prevCssW,
    prevCssH,
    prevStyleW,
    prevStyleH,
    prevFrustum
  } = handle
  renderer.setPixelRatio(prevPixelRatio)
  renderer.setSize(prevCssW, prevCssH, false)
  renderer.domElement.style.width = prevStyleW
  renderer.domElement.style.height = prevStyleH
  if (prevFrustum && camera && 'isOrthographicCamera' in camera && camera.isOrthographicCamera) {
    const ortho = /** @type {import('three').OrthographicCamera} */ (camera)
    ortho.left = prevFrustum.left
    ortho.right = prevFrustum.right
    ortho.top = prevFrustum.top
    ortho.bottom = prevFrustum.bottom
    ortho.updateProjectionMatrix()
  }
}

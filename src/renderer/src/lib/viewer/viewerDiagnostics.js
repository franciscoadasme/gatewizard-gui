/** Dev-only viewer warnings (surface in DevTools console). */
const ENABLED = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

/**
 * @param {string} tag
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export function viewerWarn(tag, message, data) {
  if (!ENABLED) return
  if (data) {
    console.warn(`[gatewizard-viewer:${tag}] ${message}`, data)
  } else {
    console.warn(`[gatewizard-viewer:${tag}] ${message}`)
  }
}

/**
 * @param {string} tag
 * @param {number} atomCount
 * @param {import('three').Object3D | null | undefined} mesh
 * @param {Record<string, unknown>} [extra]
 */
export function checkRepresentationMounted(tag, atomCount, mesh, extra) {
  if (!ENABLED || atomCount < 1) return
  if (!mesh) {
    viewerWarn(tag, 'atoms loaded but nothing is mounted in the scene', {
      atomCount,
      ...extra
    })
  }
}

/**
 * @param {string} tag
 * @param {{ replaced?: boolean, wantsGlowShader?: boolean, emissiveIntensity?: number }} syncResult
 * @param {Record<string, unknown>} [extra]
 */
export function logMaterialSync(tag, syncResult, extra) {
  if (!ENABLED || !syncResult.replaced) return
  viewerWarn(
    tag,
    syncResult.wantsGlowShader
      ? 'recreated material with glow shader'
      : 'recreated material after glow shader removed (Surface glow = 0)',
    { emissiveIntensity: syncResult.emissiveIntensity, ...extra }
  )
}

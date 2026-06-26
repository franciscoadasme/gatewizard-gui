/** Dev-only detailed warnings. */
const DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

import { GLOW_LIGHTS_HARD_MAX } from './glowLights.js'

/** Soft cap — above this we warn about UI jank (still below WebGL hard max). */
export const GLOW_LIGHTS_PERF_WARN = 32

/** @type {string | null} */
let lastGlowWarnSignature = null

/**
 * @param {string} tag
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export function viewerWarn(tag, message, data) {
  if (!DEV) return
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
  if (!DEV || atomCount < 1) return
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
  if (!DEV || !syncResult.replaced) return
  viewerWarn(
    tag,
    syncResult.wantsGlowShader
      ? 'recreated material with glow shader'
      : 'recreated material after glow shader removed (Surface glow = 0)',
    { emissiveIntensity: syncResult.emissiveIntensity, ...extra }
  )
}

/**
 * Performance / UX warnings — always logged (useful in packaged app with F12).
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export function viewerPerfWarn(message, data) {
  if (data) {
    console.warn(`[gatewizard-viewer] ${message}`, data)
  } else {
    console.warn(`[gatewizard-viewer] ${message}`)
  }
}

/**
 * @param {number} bulbCount Active bulbs after GPU cap
 * @param {number} poolSize Eligible atom pool
 * @param {number} [requestedMax] User slider value before cap
 */
export function warnIfManyGlowLights(bulbCount, poolSize, requestedMax = bulbCount) {
  const signature = `${bulbCount}|${requestedMax}|${poolSize}`
  if (signature === lastGlowWarnSignature) return

  if (requestedMax > GLOW_LIGHTS_HARD_MAX) {
    lastGlowWarnSignature = signature
    viewerPerfWarn(
      `Max bulbs ${requestedMax} exceeds the WebGL limit — only ${GLOW_LIGHTS_HARD_MAX} scene bulbs are used. Higher values break rendering (fragment shader uniform overflow). Raise Surface glow or Light power instead.`,
      { requestedMax, effectiveMax: GLOW_LIGHTS_HARD_MAX, poolSize, bulbCount }
    )
    return
  }

  if (bulbCount <= GLOW_LIGHTS_PERF_WARN) {
    lastGlowWarnSignature = null
    return
  }

  lastGlowWarnSignature = signature
  viewerPerfWarn(
    `${bulbCount} scene bulbs active (pool ${poolSize}). This can slow the UI while lights are placed — try ≤${GLOW_LIGHTS_PERF_WARN}, or “Selected atoms only” for a few bright sources.`,
    { bulbCount, poolSize, gpuMax: GLOW_LIGHTS_HARD_MAX }
  )
}

export { GLOW_LIGHTS_HARD_MAX }

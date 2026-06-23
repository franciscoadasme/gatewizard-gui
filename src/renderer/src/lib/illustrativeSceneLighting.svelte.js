/**
 * Saves / restores global scene lighting when Illustrative views request flat lighting.
 */
import { persistViewerSettings, viewerSettings } from './viewerSettings.svelte.js'

/** Whether flat illustrative lighting is currently applied to the scene. */
export const illustrativeLightingState = $state({ active: false })

/** @type {null | {
 *   ambientIntensity: number,
 *   hemisphereIntensity: number,
 *   hemisphereSky: string,
 *   hemisphereGround: string,
 *   directionalLights: Array<{ enabled: boolean, position: [number, number, number], intensity: number }>
 * }} */
let savedLightingSnapshot = null

function snapshotLighting() {
  return {
    ambientIntensity: viewerSettings.ambientIntensity,
    hemisphereIntensity: viewerSettings.hemisphereIntensity,
    hemisphereSky: viewerSettings.hemisphereSky,
    hemisphereGround: viewerSettings.hemisphereGround,
    directionalLights: viewerSettings.directionalLights.map((l) => ({
      enabled: l.enabled,
      position: [...l.position],
      intensity: l.intensity
    }))
  }
}

function applyFlatLighting() {
  viewerSettings.ambientIntensity = 0.88
  viewerSettings.hemisphereIntensity = 0.42
  viewerSettings.hemisphereSky = '#ffffff'
  viewerSettings.hemisphereGround = '#d8dce8'
  viewerSettings.directionalLights = viewerSettings.directionalLights.map((l) => ({
    enabled: l.enabled,
    position: [...l.position],
    intensity: l.enabled ? Math.min(l.intensity, 0.12) : l.intensity
  }))
}

function restoreLighting() {
  if (!savedLightingSnapshot) return
  viewerSettings.ambientIntensity = savedLightingSnapshot.ambientIntensity
  viewerSettings.hemisphereIntensity = savedLightingSnapshot.hemisphereIntensity
  viewerSettings.hemisphereSky = savedLightingSnapshot.hemisphereSky
  viewerSettings.hemisphereGround = savedLightingSnapshot.hemisphereGround
  viewerSettings.directionalLights = savedLightingSnapshot.directionalLights.map((l) => ({
    enabled: l.enabled,
    position: [...l.position],
    intensity: l.intensity
  }))
  savedLightingSnapshot = null
}

/** @param {boolean} active */
export function syncIllustrativeSceneLighting(active) {
  if (active) {
    if (!illustrativeLightingState.active) {
      savedLightingSnapshot = snapshotLighting()
      applyFlatLighting()
      illustrativeLightingState.active = true
      persistViewerSettings()
    }
  } else if (illustrativeLightingState.active) {
    restoreLighting()
    illustrativeLightingState.active = false
    persistViewerSettings()
  }
}

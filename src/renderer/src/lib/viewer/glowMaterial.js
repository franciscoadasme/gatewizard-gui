import { MeshStandardMaterial } from 'three'

/** @param {MeshStandardMaterial} material */
export function clearGlowMaterial(material) {
  material.emissive.setHex(0x000000)
  material.emissiveIntensity = 0
  material.toneMapped = true
  material.onBeforeCompile = null
  material.customProgramCacheKey = undefined
  material.needsUpdate = true
}

/**
 * Apply bulb-style emissive glow (Glowing preset only). Caller must skip when
 * emissiveIntensity <= 0 — rebuild the mesh with a fresh material instead.
 *
 * @param {MeshStandardMaterial} material
 * @param {number} emissiveIntensity
 * @param {{ useSurfaceColor?: boolean }} [options]
 */
export function applyGlowMaterial(material, emissiveIntensity, options = {}) {
  const { useSurfaceColor = true } = options

  if (emissiveIntensity <= 0.001) {
    return
  }

  material.emissiveIntensity = emissiveIntensity
  material.toneMapped = emissiveIntensity > 1

  if (useSurfaceColor) {
    material.emissive.setHex(0xffffff)
    material.customProgramCacheKey = () => `glow_bulb_${emissiveIntensity.toFixed(3)}`
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= diffuseColor.rgb;`
      )
    }
  } else {
    material.emissive.copy(material.color)
    material.onBeforeCompile = null
    material.customProgramCacheKey = undefined
  }

  material.needsUpdate = true
}

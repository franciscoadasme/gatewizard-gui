import { MeshStandardMaterial, MeshToonMaterial } from 'three'

/**
 * Patch a standard/toon material so each stick instance can carry two colors
 * (instanceColor = atom i / −Y, instanceColorEnd = atom j / +Y) and blends them
 * across a screen-space–AA plane at the bond midpoint. Avoids the jagged seam
 * from butting two half-cylinders together.
 *
 * @param {MeshStandardMaterial | MeshToonMaterial} material
 */
export function applySplitBondColors(material) {
  material.customProgramCacheKey = () => 'split_bond_aa_v1'
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 instanceColorEnd;
varying vec3 vBondColorA;
varying vec3 vBondColorB;
varying float vBondY;`
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vBondColorA = instanceColor.rgb;
#else
  vBondColorA = vec3(1.0);
#endif
vBondColorB = instanceColorEnd;
vBondY = position.y;`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBondColorA;
varying vec3 vBondColorB;
varying float vBondY;`
      )
      .replace(
        '#include <color_fragment>',
        `// AA hard split at local Y=0 (bond midpoint) — one mesh, no dual-cylinder z-fight
float bondSplitW = max(fwidth(vBondY) * 1.5, 1e-5);
float bondSplitT = smoothstep(-bondSplitW, bondSplitW, vBondY);
diffuseColor.rgb *= mix(vBondColorA, vBondColorB, bondSplitT);`
      )
  }
  material.needsUpdate = true
}

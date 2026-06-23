import {
  ClampToEdgeWrapping,
  DataTexture,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  BackSide
} from 'three'

/** @type {DataTexture | null} */
let toonGradientMap = null

/** Two-step gradient → soft cel shading (Goodsell-like). */
export function getToonGradientMap() {
  if (toonGradientMap) return toonGradientMap
  const colors = new Uint8Array([0, 255])
  toonGradientMap = new DataTexture(colors, 2, 1, RedFormat)
  toonGradientMap.minFilter = NearestFilter
  toonGradientMap.magFilter = NearestFilter
  toonGradientMap.wrapS = ClampToEdgeWrapping
  toonGradientMap.needsUpdate = true
  return toonGradientMap
}

/** @param {boolean} [vertexColors] */
export function createIllustrativeSurfaceMaterial(vertexColors = true) {
  return new MeshToonMaterial({
    vertexColors,
    gradientMap: getToonGradientMap()
  })
}

/** Instanced-sphere / ball-and-stick silhouette outlines (BackSide hull). */
export function createInstancedOutlineMaterial(hex) {
  return new MeshBasicMaterial({
    color: hex,
    side: BackSide,
    depthWrite: false
  })
}

/** @param {string} hex — solid-color silhouette (tube outlines: render behind surface). */
export function createSilhouetteOutlineMaterial(hex) {
  return new MeshBasicMaterial({
    color: hex,
    depthWrite: true,
    depthTest: true
  })
}

/** @param {string} hex — expanded-hull outlines (cartoon ribbon). */
export function createOutlineMaterial(hex) {
  return new MeshBasicMaterial({
    color: hex,
    side: BackSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
}

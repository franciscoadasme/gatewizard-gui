import { BufferGeometry, Vector3 } from 'three'

/**
 * Expand mesh vertices along their normals to build a silhouette hull for outlines.
 * @param {BufferGeometry} geometry
 * @param {number} width — expansion distance in structure coordinates (Å)
 */
export function expandGeometryForOutline(geometry, width) {
  const src = geometry.clone()
  const pos = src.getAttribute('position')
  const norm = src.getAttribute('normal')
  if (!pos || !norm || width <= 0) return src

  const offset = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    offset.fromBufferAttribute(norm, i).multiplyScalar(width)
    pos.setXYZ(i, pos.getX(i) + offset.x, pos.getY(i) + offset.y, pos.getZ(i) + offset.z)
  }
  pos.needsUpdate = true
  if (src.boundingSphere) src.computeBoundingSphere()
  if (src.boundingBox) src.computeBoundingBox()
  return src
}

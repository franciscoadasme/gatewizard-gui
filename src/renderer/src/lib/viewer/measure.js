/**
 * Euclidean distance between two 3-D points (returns Å when coords are in Å).
 * @param {{ x:number, y:number, z:number }} a
 * @param {{ x:number, y:number, z:number }} b
 * @returns {number}
 */
export function measureDistance(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2)
}

/**
 * Angle at vertex b formed by atoms a-b-c (degrees).
 * @param {{ x:number, y:number, z:number }} a
 * @param {{ x:number, y:number, z:number }} b
 * @param {{ x:number, y:number, z:number }} c
 * @returns {number}
 */
export function measureAngle(a, b, c) {
  const ba = _sub(a, b)
  const bc = _sub(c, b)
  const cos = _dot(ba, bc) / (_len(ba) * _len(bc) || 1)
  return Math.acos(_clamp(cos, -1, 1)) * (180 / Math.PI)
}

/**
 * Dihedral (torsion) angle for atoms a-b-c-d (degrees).
 * @param {{ x:number, y:number, z:number }} a
 * @param {{ x:number, y:number, z:number }} b
 * @param {{ x:number, y:number, z:number }} c
 * @param {{ x:number, y:number, z:number }} d
 * @returns {number}
 */
export function measureDihedral(a, b, c, d) {
  const b1 = _sub(b, a)
  const b2 = _sub(c, b)
  const b3 = _sub(d, c)
  const n1 = _cross(b1, b2)
  const n2 = _cross(b2, b3)
  const m = _cross(n1, b2)
  const y = _dot(m, n2) / (_len(m) * _len(n2) || 1)
  const x = _dot(n1, n2) / (_len(n1) * _len(n2) || 1)
  return Math.atan2(y, x) * (180 / Math.PI)
}

/**
 * Format atom coordinates as a readable label string.
 * Uses chain_id / res_name / res_id / name fields if present.
 * @param {object} atom
 * @returns {string}
 */
export function formatAtomLabel(atom) {
  const parts = [atom.chain_id, `${atom.res_name ?? ''}${atom.res_id ?? ''}`, atom.name]
  return parts.filter(Boolean).join(':')
}

// ── Private helpers ──────────────────────────────────────────────────
function _sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function _cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
function _dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }
function _len(v) { return Math.sqrt(_dot(v, v)) }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

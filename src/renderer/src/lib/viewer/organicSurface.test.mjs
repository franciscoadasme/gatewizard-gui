import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_GRID_SAMPLES,
  applySurfaceMeshSmoothing,
  buildBackboneSurfaceProbes,
  buildOrganicSurface,
  filterSurfaceAtoms,
  inflateParams,
  meshBboxExtent,
  resolveGridStep,
  resolveSurfaceSmoothPlan,
  ssProbeRadius,
  vdwRadius
} from './organicSurface.js'

test('vdwRadius resolves common elements', () => {
  assert.equal(vdwRadius('C'), 1.7)
  assert.equal(vdwRadius('cl'), 1.75)
  assert.ok(vdwRadius('Xx') > 0)
})

test('inflateParams: tight ≈ vdW, puffy expands, isolevel does not rise', () => {
  const tight = inflateParams(0)
  const puffy = inflateParams(1)
  assert.ok(Math.abs(tight.radiusScale - 1) < 1e-9)
  assert.ok(puffy.radiusScale > tight.radiusScale)
  assert.ok(puffy.isolevel <= tight.isolevel + 1e-9)
  assert.ok(tight.sigmaFactor < puffy.sigmaFactor)
  assert.equal(tight.blend, 0)
  assert.ok(puffy.blend > 0.9)
  assert.ok(tight.isoRadiusFactor > 0.95 && tight.isoRadiusFactor < 1.08)
})

test('inflate 0 single carbon ≈ vdW diameter', () => {
  const mesh = buildOrganicSurface({
    atoms: [{ x: 0, y: 0, z: 0, element: 'C', index: 0 }],
    quality: 4,
    surfaceInflate: 0
  })
  assert.ok(mesh)
  const ext = meshBboxExtent(mesh.positions)
  // C vdW diameter = 3.4 Å; allow marching-cubes / grid slack
  assert.ok(ext > 3.0 && ext < 3.85, `extent ${ext}`)
})

test('backbone probes follow CA with SS radii', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', name: 'CA', index: 0 },
    { x: 3.8, y: 0, z: 0, element: 'C', name: 'CA', index: 1 },
    { x: 7.6, y: 0, z: 0, element: 'C', name: 'CA', index: 2 },
    { x: 1, y: 1, z: 0, element: 'C', name: 'CB', index: 3 }
  ]
  const residues = [
    { ca_index: 0, sec: 'H', chain: 'A', number: 1, atom_indices: [0, 3] },
    { ca_index: 1, sec: 'H', chain: 'A', number: 2, atom_indices: [1] },
    { ca_index: 2, sec: 'E', chain: 'A', number: 3, atom_indices: [2] }
  ]
  const probes = buildBackboneSurfaceProbes(atoms, residues, { pathSamples: 2 })
  assert.ok(probes.length >= 3)
  assert.ok(probes.some((p) => Math.abs(p.radius - ssProbeRadius('H')) < 1e-9))
  assert.ok(probes.some((p) => Math.abs(p.radius - ssProbeRadius('E')) < 1e-9))
  const mesh = buildOrganicSurface({
    atoms,
    residues,
    quality: 2,
    surfaceInflate: 0.2,
    surfaceSource: 'backbone'
  })
  assert.ok(mesh)
  assert.ok(mesh.indices.length >= 3)
})

test('surface smooth uses finer grid (no post-mesh holes)', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', index: 0 },
    { x: 1.5, y: 0, z: 0, element: 'O', index: 1 },
    { x: 0.7, y: 1.2, z: 0, element: 'N', index: 2 }
  ]
  const coarse = buildOrganicSurface({
    atoms,
    quality: 2,
    surfaceInflate: 0.2,
    surfaceSubdivision: 0
  })
  const fine = buildOrganicSurface({
    atoms,
    quality: 2,
    surfaceInflate: 0.2,
    surfaceSubdivision: 2
  })
  assert.ok(coarse && fine)
  assert.ok(fine.step < coarse.step * 0.95, `step ${fine.step} vs ${coarse.step}`)
  assert.ok(fine.indices.length > coarse.indices.length)
})

test('resolveGridStep smoothLevel shrinks step', () => {
  const bounds = { minX: 0, maxX: 20, minY: 0, maxY: 20, minZ: 0, maxZ: 20 }
  const base = resolveGridStep(3, 50, bounds, 0)
  const mid = resolveGridStep(3, 50, bounds, 4)
  const hi = resolveGridStep(3, 50, bounds, 8)
  assert.ok(mid < base)
  assert.ok(hi < mid)
})

test('marching cubes welds shared edge vertices', () => {
  const mesh = buildOrganicSurface({
    atoms: [
      { x: 0, y: 0, z: 0, element: 'C', index: 0 },
      { x: 1.4, y: 0, z: 0, element: 'O', index: 1 }
    ],
    quality: 3,
    surfaceInflate: 0.15,
    surfaceSubdivision: 0
  })
  assert.ok(mesh)
  const verts = mesh.positions.length / 3
  const tris = mesh.indices.length / 3
  assert.ok(verts < tris * 2, `unwelded mesh? verts=${verts} tris=${tris}`)
  let outward = 0
  let counted = 0
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const px = mesh.positions[i] - 0.7
    const py = mesh.positions[i + 1]
    const pz = mesh.positions[i + 2]
    const pl = Math.hypot(px, py, pz) || 1
    const d =
      (px / pl) * mesh.normals[i] + (py / pl) * mesh.normals[i + 1] + (pz / pl) * mesh.normals[i + 2]
    outward += d
    counted++
  }
  assert.ok(outward / counted > 0.35, `normals not outward: ${outward / counted}`)
})

test('mesh smooth rounds mid levels without topology change; max subdivides once', () => {
  const offPlan = resolveSurfaceSmoothPlan(0)
  const midPlan = resolveSurfaceSmoothPlan(3)
  const hiPlan = resolveSurfaceSmoothPlan(8, 12_000)
  const densePlan = resolveSurfaceSmoothPlan(8, 200_000)
  assert.equal(offPlan.taubinIters, 0)
  assert.equal(offPlan.normalBlend, 0)
  assert.equal(midPlan.subdivPasses, 0)
  assert.ok(midPlan.taubinIters > 0)
  assert.ok(midPlan.normalBlend > 0.3 && midPlan.normalBlend < 0.5)
  assert.equal(hiPlan.subdivPasses, 1)
  assert.equal(hiPlan.normalBlend, 1)
  assert.equal(densePlan.subdivPasses, 0)
  assert.ok(hiPlan.taubinIters > midPlan.taubinIters)

  const mesh = buildOrganicSurface({
    atoms: [
      { x: 0, y: 0, z: 0, element: 'C', index: 0 },
      { x: 1.5, y: 0, z: 0, element: 'O', index: 1 },
      { x: 0.7, y: 1.2, z: 0, element: 'N', index: 2 }
    ],
    quality: 2,
    surfaceInflate: 0.2,
    surfaceSubdivision: 0
  })
  assert.ok(mesh)
  const mid = applySurfaceMeshSmoothing(mesh.positions, mesh.colors, mesh.indices, 3)
  assert.equal(mid.indices.length, mesh.indices.length)
  let moved = 0
  for (let i = 0; i < mesh.positions.length; i++) {
    moved += Math.abs(mid.positions[i] - mesh.positions[i])
  }
  assert.ok(moved > 1e-4, 'Taubin should move interior vertices')

  const hi = applySurfaceMeshSmoothing(mesh.positions, mesh.colors, mesh.indices, 8)
  assert.equal(hi.indices.length, mesh.indices.length * 4)
})

test('smooth slider 0 vs 8 changes lighting and rounds geometry', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', index: 0 },
    { x: 1.5, y: 0, z: 0, element: 'O', index: 1 },
    { x: 0.6, y: 1.3, z: 0.2, element: 'N', index: 2 },
    { x: 0.2, y: 0.4, z: 1.1, element: 'C', index: 3 }
  ]
  const off = buildOrganicSurface({
    atoms,
    quality: 3,
    surfaceInflate: 0.2,
    surfaceSubdivision: 0
  })
  const hi = buildOrganicSurface({
    atoms,
    quality: 3,
    surfaceInflate: 0.2,
    surfaceSubdivision: 8
  })
  assert.ok(off && hi)
  assert.ok(hi.step < off.step * 0.85, `step ${hi.step} vs ${off.step}`)

  const rounded = applySurfaceMeshSmoothing(off.positions, off.colors, off.indices, 5)
  assert.equal(rounded.indices.length, off.indices.length)
  let moved = 0
  const n = off.positions.length / 3
  for (let i = 0; i < off.positions.length; i += 3) {
    moved += Math.hypot(
      rounded.positions[i] - off.positions[i],
      rounded.positions[i + 1] - off.positions[i + 1],
      rounded.positions[i + 2] - off.positions[i + 2]
    )
  }
  assert.ok(moved / n > 0.04, `Taubin too weak: mean move ${moved / n}`)

  const offAlign = meanNeighborNormalDot(off)
  const hiAlign = meanNeighborNormalDot(hi)
  assert.ok(hiAlign > offAlign + 0.02, `normals not creamier at 8: off=${offAlign} hi=${hiAlign}`)
})

/**
 * @param {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }} mesh
 * @returns {number}
 */
function meanNeighborNormalDot(mesh) {
  let sum = 0
  let count = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const vs = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
    for (let k = 0; k < 3; k++) {
      const a = vs[k] * 3
      const b = vs[(k + 1) % 3] * 3
      sum +=
        mesh.normals[a] * mesh.normals[b] +
        mesh.normals[a + 1] * mesh.normals[b + 1] +
        mesh.normals[a + 2] * mesh.normals[b + 2]
      count++
    }
  }
  return count ? sum / count : 0
}

test('filterSurfaceAtoms drops hydrogens by default', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', index: 0 },
    { x: 1, y: 0, z: 0, element: 'H', index: 1 },
    { x: 2, y: 0, z: 0, element: 'O', index: 2 }
  ]
  assert.equal(filterSurfaceAtoms(atoms).length, 2)
  assert.equal(filterSurfaceAtoms(atoms, { includeHydrogen: true }).length, 3)
})

test('two-atom surface produces a closed-ish mesh', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', index: 0 },
    { x: 1.5, y: 0, z: 0, element: 'O', index: 1 }
  ]
  const mesh = buildOrganicSurface({
    atoms,
    quality: 2,
    surfaceInflate: 0.45,
    getColor: (a) => (a.element === 'O' ? { r: 1, g: 0, b: 0 } : { r: 0.4, g: 0.4, b: 0.4 })
  })
  assert.ok(mesh)
  assert.ok(mesh.positions.length >= 9)
  assert.ok(mesh.indices.length >= 3)
  assert.equal(mesh.positions.length, mesh.normals.length)
  assert.equal(mesh.positions.length, mesh.colors.length)
  assert.equal(mesh.indices.length % 3, 0)
})

test('higher inflate increases mesh bbox', () => {
  const atoms = [
    { x: 0, y: 0, z: 0, element: 'C', index: 0 },
    { x: 1.4, y: 0, z: 0, element: 'C', index: 1 },
    { x: 0.7, y: 1.2, z: 0, element: 'N', index: 2 }
  ]
  const tight = buildOrganicSurface({ atoms, quality: 2, surfaceInflate: 0 })
  const puffy = buildOrganicSurface({ atoms, quality: 2, surfaceInflate: 1 })
  assert.ok(tight && puffy)
  assert.ok(meshBboxExtent(puffy.positions) > meshBboxExtent(tight.positions) * 1.05)
})

test('resolveGridStep stays under MAX_GRID_SAMPLES', () => {
  const bounds = { minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 200 }
  const step = resolveGridStep(5, 100, bounds)
  assert.ok(step >= 0.34)
  const nx = Math.floor(200 / step) + 1
  assert.ok(nx * nx * nx <= MAX_GRID_SAMPLES * 1.01)
})

test('protein-sized atom count builds without hanging (smoke)', () => {
  /** @type {Array<{ x: number, y: number, z: number, element: string, index: number }>} */
  const atoms = []
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 30; j++) {
      atoms.push({
        x: i * 1.5,
        y: j * 1.5,
        z: (i + j) % 5,
        element: i % 5 === 0 ? 'O' : 'C',
        index: atoms.length
      })
    }
  }
  const t0 = Date.now()
  const mesh = buildOrganicSurface({ atoms, quality: 2, surfaceInflate: 0.4 })
  const ms = Date.now() - t0
  assert.ok(mesh)
  assert.ok(mesh.indices.length > 0)
  assert.ok(ms < 8000, `surface build took ${ms}ms`)
})

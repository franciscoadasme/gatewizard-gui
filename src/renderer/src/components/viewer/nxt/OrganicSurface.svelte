<script>
  import { T, useThrelte } from '@threlte/core'
  import {
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    FrontSide,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    MeshToonMaterial
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { getToonGradientMap } from '../../../lib/viewer/goodsellMaterial.js'
  import { applyGlowMaterial, clearGlowMaterial } from '../../../lib/viewer/glowMaterial.js'
  import { buildOrganicSurface, SURFACE_SMOOTH_MAX } from '../../../lib/viewer/organicSurface.js'
  import { beginViewerBusy, endViewerBusy } from '../../../lib/viewer/viewerBusy.svelte.js'
  import { untrack } from 'svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string, index?: number }} Atom */
  /** @typedef {(atom: Atom) => import('three').Color} ColorScheme */

  /**
   * @type {{
   *   atoms: Atom[],
   *   residues?: any[],
   *   getColor?: ColorScheme,
   *   quality?: number,
   *   surfaceInflate?: number,
   *   surfaceSource?: 'atoms' | 'backbone',
   *   surfaceSubdivision?: number,
   *   metalness?: number,
   *   roughness?: number,
   *   emissiveIntensity?: number,
   *   renderOrder?: number,
   *   depthTest?: boolean,
   *   opacity?: number,
   *   goodsell?: boolean,
   *   outlinesEnabled?: boolean,
   *   outlineColor?: string,
   *   outlineWidth?: number,
   *   glowBulb?: boolean,
   *   highlightIndices?: Set<number>,
   *   xyzEpoch?: number,
   *   deferRemesh?: boolean
   * }}
   */
  let {
    atoms = [],
    xyzEpoch = 0,
    deferRemesh = false,
    residues = [],
    getColor = defaultColorScheme,
    quality = 3,
    surfaceInflate = 0.25,
    surfaceSource = 'atoms',
    surfaceSubdivision = 0,
    metalness = 0.08,
    roughness = 0.52,
    emissiveIntensity = 0.0,
    renderOrder = 0,
    depthTest = true,
    opacity = 1.0,
    goodsell = false,
    outlinesEnabled = true,
    outlineColor = '#000000',
    outlineWidth = 0.12,
    highlightIndices = new Set(),
    glowBulb = false
  } = $props()

  const { invalidate } = useThrelte()

  let meshRef = $state(/** @type {Mesh | null} */ (null))
  let outlineMeshRef = $state(/** @type {Mesh | null} */ (null))

  /** Debounced tessellation params so Inflate / Quality / Smooth stay fluid while dragging. */
  let appliedQuality = $state(3)
  let appliedInflate = $state(0.25)
  let appliedSource = $state(/** @type {'atoms' | 'backbone'} */ ('atoms'))
  let appliedSubdivision = $state(0)
  $effect(() => {
    const q = quality
    const inf = surfaceInflate
    const src = surfaceSource === 'backbone' ? 'backbone' : 'atoms'
    const sub = Math.max(0, Math.min(SURFACE_SMOOTH_MAX, Number(surfaceSubdivision) || 0))
    if (
      q === appliedQuality &&
      inf === appliedInflate &&
      src === appliedSource &&
      sub === appliedSubdivision
    )
      return
    // Long debounce: remesh is sync/CPU-heavy and freezes the Smooth slider mid-drag.
    const id = setTimeout(() => {
      appliedQuality = q
      appliedInflate = inf
      appliedSource = src
      appliedSubdivision = sub
    }, 380)
    return () => clearTimeout(id)
  })

  const _tmp = new Color()

  /**
   * @param {Atom} atom
   * @returns {{ r: number, g: number, b: number }}
   */
  function colorRgb(atom) {
    const c = getColor(atom)
    if (highlightIndices.size > 0 && typeof atom.index === 'number' && highlightIndices.has(atom.index)) {
      _tmp.setRGB(
        Math.min(1, c.r * 1.5 + 0.4),
        Math.min(1, c.g * 1.5 + 0.4),
        Math.min(1, c.b * 1.5 + 0.4)
      )
      return { r: _tmp.r, g: _tmp.g, b: _tmp.b }
    }
    return { r: c.r, g: c.g, b: c.b }
  }

  /**
   * Geometry rebuild only — never depend on opacity / glow / metalness here
   * (opacity slider used to remarch ~5k-atom proteins and freeze the UI).
   */
  $effect(() => {
    void xyzEpoch
    if (deferRemesh && meshRef) return
    const atomList = atoms
    const residueList = residues
    const q = appliedQuality
    const inflate = appliedInflate
    const source = appliedSource
    const subdiv = appliedSubdivision
    void getColor
    void highlightIndices

    if (!atomList?.length) {
      meshRef = null
      outlineMeshRef = null
      return
    }

    beginViewerBusy('Building surface…')
    let cancelled = false
    let busyHeld = true
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let tid

    // Yield one frame so the busy overlay / other views can paint before the CPU hit.
    tid = setTimeout(() => {
      if (cancelled) {
        if (busyHeld) {
          endViewerBusy('Building surface…')
          busyHeld = false
        }
        return
      }
      try {
        const built = buildOrganicSurface({
          atoms: atomList,
          residues: residueList,
          quality: q,
          surfaceInflate: inflate,
          surfaceSource: source,
          surfaceSubdivision: subdiv,
          getColor: colorRgb
        })

        if (cancelled) return
        if (!built?.indices?.length) {
          meshRef = null
          outlineMeshRef = null
          return
        }

        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
        geometry.setAttribute('normal', new BufferAttribute(built.normals, 3))
        geometry.setAttribute('color', new BufferAttribute(built.colors, 3))
        geometry.setIndex(new BufferAttribute(built.indices, 1))

        // Fresh material — style applied in the material effect below.
        const material = new MeshStandardMaterial({
          vertexColors: true,
          side: DoubleSide,
          metalness: 0.08,
          roughness: 0.52,
          transparent: false,
          opacity: 1,
          depthTest: true,
          depthWrite: true
        })

        const mesh = new Mesh(geometry, material)
        mesh.renderOrder = renderOrder

        meshRef = mesh
        outlineMeshRef = null
        invalidate()
      } finally {
        if (busyHeld) {
          endViewerBusy('Building surface…')
          busyHeld = false
        }
      }
    }, 0)

    return () => {
      cancelled = true
      if (tid != null) clearTimeout(tid)
      if (busyHeld) {
        endViewerBusy('Building surface…')
        busyHeld = false
      }
      const mesh = untrack(() => meshRef)
      if (mesh) {
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (mat && !Array.isArray(mat)) mat.dispose()
      }
      const outline = untrack(() => outlineMeshRef)
      if (outline) {
        outline.geometry?.dispose()
        const om = outline.material
        if (om && !Array.isArray(om)) om.dispose()
      }
      meshRef = null
      outlineMeshRef = null
    }
  })

  /**
   * Material / opacity / glow / Goodsell — cheap updates on the existing mesh.
   * Must track `meshRef` (do not untrack) so opacity applies after async mesh build.
   * Transparent surfaces use FrontSide (half the fill rate) so glowing neighbors
   * stay interactive; custom glow shader is skipped while translucent (still
   * uses emissive tint) to avoid shader+blend thrash on large meshes.
   */
  $effect(() => {
    const mesh = meshRef
    if (!mesh) return

    const op = Math.max(0, Math.min(1, typeof opacity === 'number' ? opacity : 1))
    const useGoodsell = goodsell
    const showOutlines = useGoodsell && outlinesEnabled && outlineWidth > 0
    const translucent = op < 0.999
    // Keep DoubleSide when translucent so a thin shell does not vanish from grazing angles.
    const side = DoubleSide

    /** @type {import('three').Material} */
    let mat = /** @type {import('three').Material} */ (mesh.material)

    const needsToon = useGoodsell && !(mat instanceof MeshToonMaterial)
    const needsStd = !useGoodsell && !(mat instanceof MeshStandardMaterial)
    if (needsToon || needsStd) {
      const old = mat
      if (useGoodsell) {
        mat = new MeshToonMaterial({
          gradientMap: getToonGradientMap(),
          vertexColors: true
        })
      } else {
        mat = new MeshStandardMaterial({ vertexColors: true })
      }
      mesh.material = mat
      old.dispose()
    }

    mat.side = side
    mat.transparent = translucent
    mat.opacity = op
    mat.depthTest = depthTest
    if ('depthWrite' in mat) mat.depthWrite = !translucent
    mesh.renderOrder = translucent ? renderOrder + 2 : renderOrder

    if (mat instanceof MeshStandardMaterial) {
      mat.metalness = metalness
      mat.roughness = roughness
      if (glowBulb && emissiveIntensity > 0.001) {
        // Opaque: full vertex-tinted glow shader (same as vdW / licorice).
        // Translucent: keep emissive without onBeforeCompile — large transparent
        // double-pass + custom shader was freezing the GUI with glowing neighbors.
        if (!translucent) {
          applyGlowMaterial(mat, emissiveIntensity, { useSurfaceColor: true })
        } else {
          clearGlowMaterial(mat)
          mat.emissive.setHex(0xffffff)
          mat.emissiveIntensity = Math.min(emissiveIntensity, 1.2)
          mat.toneMapped = true
          mat.needsUpdate = true
        }
      } else {
        clearGlowMaterial(mat)
        mat.emissiveIntensity = emissiveIntensity
      }
    }

    mat.needsUpdate = true

    // Outline mesh only for Goodsell opaque-ish looks.
    let outline = untrack(() => outlineMeshRef)
    if (showOutlines && !translucent) {
      if (!outline) {
        const outlineGeom = mesh.geometry.clone()
        const outlineMat = new MeshBasicMaterial({
          color: outlineColor,
          side: FrontSide,
          depthWrite: false,
          transparent: false,
          opacity: 1
        })
        outline = new Mesh(outlineGeom, outlineMat)
        outline.renderOrder = renderOrder - 1
        outline.scale.setScalar(1 + Math.min(0.08, outlineWidth * 0.35))
        outlineMeshRef = outline
      } else {
        const om = outline.material
        if (!Array.isArray(om) && om instanceof MeshBasicMaterial) {
          om.color.set(outlineColor)
        }
      }
    } else if (outline) {
      outline.geometry.dispose()
      const om = outline.material
      if (!Array.isArray(om)) om.dispose()
      outlineMeshRef = null
    }

    invalidate()
  })
</script>

{#if outlineMeshRef}
  <T is={outlineMeshRef} />
{/if}
{#if meshRef}
  <T is={meshRef} />
{/if}

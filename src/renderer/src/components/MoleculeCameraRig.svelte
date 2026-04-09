<script>
  import { useThrelte } from '@threlte/core'

  /**
   * @typedef {object} StructureLike
   * @property {number} [n_atoms]
   * @property {number[]} [positions]
   * @property {string[]} [elements]
   */

  /** @type {{ structure: StructureLike | null }} */
  let { structure = null } = $props()

  const { camera, invalidate } = useThrelte()

  /** Upper bound on VdW radius (Å) for framing when we only need a margin (matches heavy atoms). */
  const R_MAX = 2.3

  $effect(() => {
    const cam = camera.current
    if (!cam || !structure?.positions?.length) {
      return
    }

    const positions = structure.positions
    const n = Math.min(
      structure.n_atoms ?? Infinity,
      Math.floor(positions.length / 3),
      structure.elements?.length ?? Infinity
    )

    let maxExtent = 8
    for (let i = 0; i < n; i++) {
      const ix = i * 3
      const d = Math.hypot(positions[ix], positions[ix + 1], positions[ix + 2]) + R_MAX
      maxExtent = Math.max(maxExtent, d)
    }

    const dist = Math.max(18, maxExtent * 2.8)
    cam.position.set(dist * 0.85, dist * 0.55, dist * 0.95)
    if ('lookAt' in cam && typeof cam.lookAt === 'function') {
      cam.lookAt(0, 0, 0)
    }
    invalidate()
  })
</script>

<script>
  import { T, useThrelte } from '@threlte/core'
  import { Color, Group, PointLight } from 'three'
  import { selectGlowLightAtoms } from '../../lib/viewer/glowLights.js'
  import { viewerWarn } from '../../lib/viewer/viewerDiagnostics.js'
  import { untrack } from 'svelte'

  /**
   * @typedef {{ x: number, y: number, z: number, element?: string, index?: number }} Atom
   * @typedef {(atom: Atom) => import('three').Color} ColorScheme
   */

  /**
   * @type {{
   *   atoms?: Atom[],
   *   getColor?: ColorScheme,
   *   enabled?: boolean,
   *   intensity?: number,
   *   distance?: number,
   *   decay?: number,
   *   maxLights?: number,
   *   atomFilter?: import('../../lib/viewer/glowLights.js').GlowAtomFilter,
   *   highlightIndices?: Set<number>
   * }}
   */
  let {
    atoms = [],
    getColor,
    enabled = true,
    intensity = 18,
    distance = 24,
    decay = 2,
    maxLights = 48,
    atomFilter = 'highlighted',
    highlightIndices = new Set()
  } = $props()

  const { invalidate } = useThrelte()
  let groupRef = $state(/** @type {Group | null} */ (null))
  /** @type {PointLight[]} */
  let lights = []

  const _tmpColor = new Color()

  function disposeLights() {
    if (!groupRef) return
    for (const light of lights) {
      groupRef.remove(light)
      light.dispose()
    }
    lights = []
  }

  $effect(() => {
    const group = groupRef
    if (!group || !enabled || !getColor) {
      disposeLights()
      return
    }

    const picked = selectGlowLightAtoms(atoms, {
      filter: atomFilter,
      maxLights,
      highlightIndices
    })

    if (import.meta.env?.DEV && atoms.length > 0 && picked.length === 0) {
      viewerWarn(
        'glow-lights',
        atomFilter === 'highlighted'
          ? 'no bulbs active — filter is “Selected / hovered only” but nothing is selected'
          : 'no bulbs spawned for this view',
        { atomCount: atoms.length, filter: atomFilter, maxLights, intensity }
      )
    }

    disposeLights()

    const colorFn = untrack(() => getColor)
    for (let i = 0; i < picked.length; i++) {
      const atom = picked[i]
      const light = new PointLight(
        _tmpColor.copy(colorFn(atom)),
        intensity,
        distance,
        decay
      )
      light.position.set(atom.x, atom.y, atom.z)
      group.add(light)
      lights.push(light)
    }

    invalidate()

    return () => {
      disposeLights()
    }
  })
</script>

<T.Group bind:ref={groupRef} />

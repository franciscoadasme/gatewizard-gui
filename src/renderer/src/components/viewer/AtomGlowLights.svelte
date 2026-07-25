<script>
  import { T, useThrelte } from '@threlte/core'
  import { Color, Group, PointLight } from 'three'
  import { clampGlowMaxLights, selectGlowLightAtoms } from '../../lib/viewer/glowLights.js'
  import { viewerWarn, warnIfManyGlowLights } from '../../lib/viewer/viewerDiagnostics.js'
  import { beginViewerBusy, endViewerBusy } from '../../lib/viewer/viewerBusy.svelte.js'
  import { untrack } from 'svelte'

  /** Lights added per animation frame (keeps UI responsive). */
  const LIGHTS_PER_FRAME = 16

  /** Debounce Max bulbs before tearing down and rebuilding all lights. */
  const MAX_LIGHTS_DEBOUNCE_MS = 400

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
  /** @type {Atom[]} */
  let pickedAtoms = []
  let debouncedMaxLights = $state(0)
  let debounceInitialized = false

  $effect(() => {
    const requested = maxLights
    if (!debounceInitialized) {
      debouncedMaxLights = clampGlowMaxLights(requested)
      debounceInitialized = true
      return
    }
    const tid = setTimeout(() => {
      debouncedMaxLights = clampGlowMaxLights(requested)
    }, MAX_LIGHTS_DEBOUNCE_MS)
    return () => clearTimeout(tid)
  })

  const _tmpColor = new Color()
  let buildGeneration = 0

  function disposeLights() {
    if (!groupRef) return
    for (const light of lights) {
      groupRef.remove(light)
      light.dispose()
    }
    lights = []
    pickedAtoms = []
  }

  /** Rebuild bulb positions when pool / cap / filter changes — not on color or power tweaks. */
  $effect(() => {
    const group = groupRef
    const filter = atomFilter
    const hi = highlightIndices
    const atomList = atoms
    const requestedMax = maxLights
    const max = debouncedMaxLights || clampGlowMaxLights(requestedMax)
    const on = enabled

    if (!group || !on) {
      disposeLights()
      return
    }

    const colorFn = untrack(() => getColor)
    if (!colorFn) {
      disposeLights()
      return
    }

    const picked = selectGlowLightAtoms(atomList, {
      filter,
      maxLights: max,
      highlightIndices: hi
    })

    if (import.meta.env?.DEV && atomList.length > 0 && picked.length === 0) {
      viewerWarn(
        'glow-lights',
        filter === 'highlighted'
          ? 'no bulbs active — filter is “Selected / hovered only” but nothing is selected'
          : 'no bulbs spawned for this view',
        { atomCount: atomList.length, filter, maxLights: max }
      )
    }

    warnIfManyGlowLights(picked.length, atomList.length, requestedMax)

    const gen = ++buildGeneration
    disposeLights()
    pickedAtoms = picked

    if (picked.length === 0) {
      invalidate()
      return
    }

    beginViewerBusy(
      picked.length > 24 ? 'Preparing glow lighting…' : 'Updating glow lights…'
    )
    let buildBusy = true

    let index = 0
    const pow = untrack(() => intensity)
    const reach = untrack(() => distance)
    const falloff = untrack(() => decay)

    function finishBusy() {
      if (buildBusy) {
        buildBusy = false
        endViewerBusy()
      }
    }

    function addBatch() {
      if (gen !== buildGeneration || !groupRef) {
        return
      }

      const end = Math.min(index + LIGHTS_PER_FRAME, picked.length)
      for (; index < end; index++) {
        const atom = picked[index]
        const light = new PointLight(
          _tmpColor.copy(colorFn(atom)),
          pow,
          reach,
          falloff
        )
        light.position.set(atom.x, atom.y, atom.z)
        groupRef.add(light)
        lights.push(light)
      }

      if (index < picked.length) {
        requestAnimationFrame(addBatch)
      } else {
        invalidate()
        finishBusy()
      }
    }

    requestAnimationFrame(addBatch)

    return () => {
      buildGeneration += 1
      disposeLights()
      finishBusy()
    }
  })

  /** Live-tune bulb color when the scheme changes (no rebuild). */
  $effect(() => {
    const colorFn = getColor
    if (!colorFn || !lights.length || pickedAtoms.length !== lights.length) return
    for (let i = 0; i < lights.length; i++) {
      lights[i].color.copy(colorFn(pickedAtoms[i]))
    }
    invalidate()
  })

  /** Live-tune existing bulbs without rebuilding (cheap). */
  $effect(() => {
    const pow = intensity
    const reach = distance
    const falloff = decay
    if (!lights.length) return
    for (const light of lights) {
      light.intensity = pow
      light.distance = reach
      light.decay = falloff
    }
    invalidate()
  })
</script>

<T.Group bind:ref={groupRef} />

<script>
  import { T, useThrelte } from '@threlte/core'
  import { Color, Group, PointLight } from 'three'
  import { onDestroy } from 'svelte'
  import { clampGlowMaxLights, selectGlowLightAtoms } from '../../lib/viewer/glowLights.js'
  import { viewerWarn, warnIfManyGlowLights } from '../../lib/viewer/viewerDiagnostics.js'
  import { beginViewerBusy, endViewerBusy } from '../../lib/viewer/viewerBusy.svelte.js'
  import { untrack } from 'svelte'

  /** Lights added per animation frame (keeps UI responsive). */
  const LIGHTS_PER_FRAME = 16

  /** Debounce Max bulbs before tearing down and rebuilding all lights. */
  const MAX_LIGHTS_DEBOUNCE_MS = 400

  const EMPTY_HIGHLIGHT = new Set()

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
  /** @type {string} */
  let lastPickKey = ''
  let buildGeneration = 0

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

  function disposeLights() {
    if (!groupRef) return
    for (const light of lights) {
      groupRef.remove(light)
      light.dispose()
    }
    lights = []
    pickedAtoms = []
  }

  /**
   * Stable signature of which bulbs exist and where — ignores array identity so
   * select-mode hover re-renders (new atoms[] each time) do not tear down lights.
   * @param {Atom[]} picked
   * @param {string} filter
   * @param {number} max
   */
  function pickKeyFor(picked, filter, max) {
    let key = `${filter}|${max}|${picked.length}`
    for (const a of picked) {
      key += `|${a.index ?? -1}:${a.x.toFixed(2)}:${a.y.toFixed(2)}:${a.z.toFixed(2)}`
    }
    return key
  }

  /** Rebuild bulb positions when pool / cap / filter / pose changes — not on hover noise. */
  $effect(() => {
    const group = groupRef
    const filter = atomFilter
    const requestedMax = maxLights
    const max = debouncedMaxLights || clampGlowMaxLights(requestedMax)
    const on = enabled
    const atomList = atoms
    // Hover/selection only matter for the “highlighted” filter; ignore otherwise so
    // pointer motion in select mode does not rebuild all / non-hydrogen bulbs.
    const hi = filter === 'highlighted' ? highlightIndices : EMPTY_HIGHLIGHT
    if (filter === 'highlighted') void [...hi].join(',')

    if (!group || !on) {
      lastPickKey = ''
      disposeLights()
      return
    }

    const colorFn = untrack(() => getColor)
    if (!colorFn) {
      lastPickKey = ''
      disposeLights()
      return
    }

    const picked = selectGlowLightAtoms(atomList, {
      filter,
      maxLights: max,
      highlightIndices: hi
    })
    const pickKey = pickKeyFor(picked, filter, max)

    // Same bulbs + positions: keep existing PointLights (avoids flicker).
    if (pickKey === lastPickKey && lights.length === picked.length) {
      return
    }
    lastPickKey = pickKey

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
        finishBusy()
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

    // Do not dispose in effect cleanup — that re-ran on every hover and caused flicker.
    // Cancel only an in-flight batched build when inputs truly change (gen bump above).
    return () => {
      buildGeneration += 1
      finishBusy()
    }
  })

  onDestroy(() => {
    buildGeneration += 1
    disposeLights()
    lastPickKey = ''
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

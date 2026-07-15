<script module>
  /**
   * View IDs added here will have their next path-change-triggered
   * updateStructure() call suppressed (used by applyGizmoResult).
   */
  export const skipNextPathFetch = new Set()
</script>

<script>
  import {
    constantScheme,
    cpkScheme,
    defaultColorScheme,
    chainScheme,
    goodsellChainScheme,
    residueNatureScheme,
    ssScheme,
    COLOR_PALETTE,
    SS_COLORS_DEFAULT,
    SS_LABELS,
    MATERIAL_PRESETS,
    buildMaterialFromPreset,
    isGoodsellMaterial,
    isGlowingMaterial,
    resolveGlowingMaterial,
    GLOWING_MATERIAL_DEFAULTS,
    GLOWING_UI_SLIDERS,
    GOODSELL_CHAIN_PALETTE_HEX
  } from '../lib/colorSchemes.js'
  import { countGlowPool, selectGlowLightAtoms, clampGlowMaxLights, GLOW_LIGHTS_HARD_MAX } from '../lib/viewer/glowLights.js'
  import { GLOW_LIGHTS_PERF_WARN } from '../lib/viewer/viewerDiagnostics.js'
  import { viewerBusy } from '../lib/viewer/viewerBusy.svelte.js'
  import { getStructure } from '../lib/backendApi'
  import { onDestroy, untrack } from 'svelte'
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Focus from './icons/Focus.svelte'
  import Gear from './icons/Gear.svelte'
  import Input from './ui/Input.svelte'
  import Select from './ui/Select.svelte'
  import Spinner from './ui/Spinner.svelte'

  const NAMED_SELECTIONS = [
    'all',
    'protein',
    'backbone',
    'sidechain',
    'water',
    'lipid',
    'ion',
    'ligand',
    'other'
  ]
  const REPR_TYPES = ['points', 'ball-stick', 'cartoon', 'tube', 'vdw']
  const REPR_LABELS = {
    points: 'Points',
    'ball-stick': 'Ball & Stick',
    cartoon: 'Cartoon',
    tube: 'Tube',
    vdw: 'vdW'
  }

  const MDA_HELP = `Basic:
  protein · backbone · nucleic · water
  resname ALA GLY       (residue names)
  resid 1 to 20         (residue numbers)
  name CA CB            (atom names)
  element C N O         (elements)
  all / none

Chain / Segment:
  segid A               (segment / chain A)
  chainID A             (MDAnalysis 2+)

Logic:
  protein and backbone
  protein or nucleic
  not water
  (resid 1 to 10) and name CA

Distance:
  around 5.0 protein    (within 5 Å of protein)
  byres (around 5 resname LIG)   (whole residues)`

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string, index?: number, res_name?: string, chain_id?: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' | 'tube' | 'points' }} Representation */
  /** @typedef {{ name: string, color?: string, resolver: (atom: Atom) => import('three').Color }} ColorScheme */
  /**
   * @typedef {{
   *   id: string, path: string, selection: string,
   *   representation: Representation,
   *   atoms: Atom[], bonds?: [number,number][], residues?: Residue[],
   *   visible: boolean, colorScheme: ColorScheme,
   *   helixWidth: number, sheetWidth: number, coilWidth: number,
   *   ssColors: Record<string,string>|null,
   *   tubeRadius: number,
   *   atomScale: number,
   *   bondScale: number,
   *   pointSize: number,
   *   material: { preset?: string, metalness: number, roughness: number, emissiveIntensity: number },
   *   quality: number
   * }} View
   */

  /**
   * @type {{
   *   view: View,
   *   onremove: () => void,
   *   onduplicate?: () => void,
   *   onsplitbychain?: () => void,
   *   oncenter?: () => void,
   *   sourceBonds?: [number, number][] | null,
   *   topology?: string | null
   * }}
   */
  let {
    view = $bindable(),
    onremove,
    onduplicate,
    onsplitbychain,
    oncenter,
    sourceBonds = null,
    topology = null
  } = $props()

  let colorPickerOpen = $state(false)
  /** @type {{ x: number, y: number } | null} */
  let rowCtxMenu = $state(null)
  /** @type {HTMLDialogElement|null} */
  let gearDialog = $state(null)
  /** @type {HTMLDialogElement|null} */
  let helpDialog = $state(null)

  let colorSchemeName = $state(view.colorScheme.name)
  let constantColorHex = $state(view.colorScheme.color || '#00aaff')
  let invalidSelection = $state(false)
  let loadingStructure = $state(false)
  let namedSelection = $state(NAMED_SELECTIONS.includes(view.selection) ? view.selection : 'other')
  let gearBackdropPointerDown = $state(false)
  let helpBackdropPointerDown = $state(false)
  /** Inline selection edit (double-click the label). */
  let editingSelection = $state(false)
  let selectionDraft = $state('')
  /** @type {HTMLInputElement | null} */
  let selectionInputEl = $state(null)
  /** Ignore stale /get-structure responses when a newer request was started. */
  let structureFetchGen = 0

  // ── Reactivity ────────────────────────────────────────────────────────────

  $effect(() => {
    const sel = view.selection
    if (sel === '' || view._isSelHighlight) return
    const tid = setTimeout(scheduleStructureUpdate, 500)
    return () => clearTimeout(tid)
  })

  let _pathInitialized = false
  $effect(() => {
    const p = view.path
    if (!_pathInitialized) {
      _pathInitialized = true
      return
    }
    if (view._isSelHighlight) return
    if (skipNextPathFetch.has(view.id)) {
      skipNextPathFetch.delete(view.id)
      return
    }
    const tid = setTimeout(scheduleStructureUpdate, 300)
    return () => clearTimeout(tid)
  })

  let _namedSelInit = false
  $effect(() => {
    const sel = namedSelection
    untrack(() => {
      if (sel !== 'other') view.selection = ''
      if (!_namedSelInit) {
        _namedSelInit = true
        // Parent (load / auto-generate) already populated atoms — skip redundant fetch.
        if (!view._prefetched && !view.atoms?.length) scheduleStructureUpdate()
        return
      }
      scheduleStructureUpdate()
    })
  })

  /** @param {Atom[] | undefined | null} atoms */
  function filterSourceBonds(atoms) {
    if (!sourceBonds?.length || !atoms?.length) return null
    const idx = new Set(atoms.map((a) => a.index))
    return sourceBonds.filter(([i, j]) => idx.has(i) && idx.has(j))
  }

  /** @param {Atom[] | undefined | null} atoms @param {[number,number][] | undefined | null} bonds */
  function bondsLookSparse(atoms, bonds) {
    const n = atoms?.length || 0
    if (!n) return true
    return (bonds?.length || 0) < n / 2
  }

  /** Prefer bonds already loaded with the full structure (e.g. from prmtop). */
  function tryApplySourceBonds() {
    if (!bondsLookSparse(view.atoms, view.bonds)) return true
    const filtered = filterSourceBonds(view.atoms)
    if (filtered && !bondsLookSparse(view.atoms, filtered)) {
      view.bonds = filtered
      return true
    }
    return false
  }

  $effect(() => {
    const repr = view.representation.type
    // Track source bonds / current atoms so switching to ball-stick reuses prmtop bonds.
    void sourceBonds
    void view.atoms
    void view.bonds
    const needsFetch = untrack(() => {
      if ((repr === 'cartoon' || repr === 'tube') && !(view.residues?.length)) return true
      if (repr === 'ball-stick' && bondsLookSparse(view.atoms, view.bonds)) {
        // Reuse global structure bonds first — avoid a second /get-structure.
        if (tryApplySourceBonds()) return false
        return true
      }
      return false
    })
    if (!needsFetch) return
    scheduleStructureUpdate()
  })

  $effect(() => {
    let colorScheme = { name: colorSchemeName }
    if (colorSchemeName === 'constant') {
      colorScheme.color = constantColorHex
      colorScheme.resolver = constantScheme(constantColorHex)
    } else if (colorSchemeName === 'cpk') {
      colorScheme.resolver = cpkScheme()
    } else if (colorSchemeName === 'cpk-carbon') {
      colorScheme.color = constantColorHex
      colorScheme.resolver = cpkScheme({ carbonColor: constantColorHex })
    } else if (colorSchemeName === 'chain') {
      colorScheme.resolver = chainScheme()
    } else if (colorSchemeName === 'goodsell') {
      colorScheme.resolver = goodsellChainScheme()
    } else if (colorSchemeName === 'residue_nature') {
      colorScheme.resolver = residueNatureScheme()
    } else if (colorSchemeName === 'ss') {
      const residues = view.residues
      const ssColors = view.ssColors
      colorScheme.resolver = residues?.length ? ssScheme(residues, ssColors ?? {}) : cpkScheme()
    } else {
      colorScheme.name = 'default'
      colorScheme.resolver = defaultColorScheme
    }
    untrack(() => (view.colorScheme = colorScheme))
  })

  // ── API ──────────────────────────────────────────────────────────────────

  function updateStructure() {
    if (view._isSelHighlight) return
    const needsSS =
      view.representation.type === 'cartoon' ||
      view.representation.type === 'tube' ||
      colorSchemeName === 'ss'
    const wantsBallStick = view.representation.type === 'ball-stick'
    // If we already have (or can filter) enough bonds, skip needs_bonds on the server.
    const canReuseBonds = wantsBallStick && tryApplySourceBonds()
    const fetchGen = ++structureFetchGen
    loadingStructure = true
    getStructure({
      path: view.path,
      topology: topology || null,
      selection: namedSelection === 'other' ? view.selection : namedSelection,
      needs_bonds: wantsBallStick && !canReuseBonds,
      needs_secondary_structure: needsSS
    })
      .then((structure) => {
        if (fetchGen !== structureFetchGen) return
        if (structure.atoms?.length) view.atoms = structure.atoms
        if (structure.bonds?.length) {
          view.bonds = structure.bonds
        } else if (wantsBallStick || bondsLookSparse(view.atoms, view.bonds)) {
          const filtered = filterSourceBonds(view.atoms)
          if (filtered?.length) view.bonds = filtered
        }
        if (structure.residues?.length) view.residues = structure.residues
        invalidSelection = false
        loadingStructure = false
      })
      .catch(() => {
        if (fetchGen !== structureFetchGen) return
        invalidSelection = true
        loadingStructure = false
      })
  }

  /** Skip redundant /get-structure while auto-generate data is still settling in. */
  function scheduleStructureUpdate() {
    if (view._prefetched) return
    updateStructure()
  }

  $effect(() => {
    if (!view._prefetched) return
    const tid = setTimeout(() => {
      view._prefetched = false
    }, 0)
    return () => clearTimeout(tid)
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  function cycleRepr() {
    const idx = REPR_TYPES.indexOf(view.representation.type)
    view.representation = { type: REPR_TYPES[(idx + 1) % REPR_TYPES.length] }
  }

  function currentSelectionLabel() {
    if (namedSelection === 'other' && view.selection) return view.selection
    if (namedSelection && namedSelection !== 'other') return namedSelection
    return view.selection || view.baseSelection || 'all'
  }

  function beginSelectionEdit() {
    selectionDraft = currentSelectionLabel()
    editingSelection = true
    requestAnimationFrame(() => {
      selectionInputEl?.focus()
      selectionInputEl?.select()
    })
  }

  function cancelSelectionEdit() {
    editingSelection = false
    selectionDraft = ''
  }

  function commitSelectionEdit() {
    if (!editingSelection) return
    const next = selectionDraft.trim()
    editingSelection = false
    if (!next) {
      selectionDraft = ''
      return
    }
    if (NAMED_SELECTIONS.includes(next) && next !== 'other') {
      namedSelection = next
      view.baseSelection = next
    } else {
      namedSelection = 'other'
      view.selection = next
      view.baseSelection = next
    }
    selectionDraft = ''
  }

  function applyMaterialPreset(preset) {
    view.material = buildMaterialFromPreset(preset)
    if (preset === 'Goodsell') {
      view.colorScheme = { name: 'goodsell', resolver: goodsellChainScheme() }
      colorSchemeName = 'goodsell'
    }
  }

  /** @param {HTMLDialogElement | null} dialog */
  function mountDialogToBody(dialog) {
    if (dialog && dialog.parentElement !== document.body) {
      document.body.appendChild(dialog)
    }
  }

  function openGearDialog() {
    mountDialogToBody(gearDialog)
    gearDialog?.showModal()
  }

  function closeGearDialog() {
    gearDialog?.close()
  }

  function openHelpDialog() {
    mountDialogToBody(helpDialog)
    helpDialog?.showModal()
  }

  function closeHelpDialog() {
    helpDialog?.close()
  }

  /** @param {MouseEvent} event */
  function onGearDialogClick(event) {
    if (event.target === gearDialog && gearBackdropPointerDown) closeGearDialog()
    gearBackdropPointerDown = false
  }

  /** @param {PointerEvent} event */
  function onGearDialogPointerDown(event) {
    gearBackdropPointerDown = event.target === gearDialog
  }

  /** @param {MouseEvent} event */
  function onHelpDialogClick(event) {
    if (event.target === helpDialog && helpBackdropPointerDown) closeHelpDialog()
    helpBackdropPointerDown = false
  }

  /** @param {PointerEvent} event */
  function onHelpDialogPointerDown(event) {
    helpBackdropPointerDown = event.target === helpDialog
  }

  onDestroy(() => {
    if (gearDialog?.open) gearDialog.close()
    if (helpDialog?.open) helpDialog.close()
  })

  const swatchColors = $derived(() => {
    if (colorSchemeName === 'chain') {
      return ['#e6194b', '#3cb44b', '#ffe119', '#0082c8']
    }
    if (colorSchemeName === 'goodsell') {
      return GOODSELL_CHAIN_PALETTE_HEX.slice(0, 4)
    }
    if (colorSchemeName === 'residue_nature') {
      return ['#e6c832', '#dc3c3c', '#4664dc', '#f09632']
    }
    if (colorSchemeName === 'ss') {
      const c = view.ssColors ?? SS_COLORS_DEFAULT
      return [c.H ?? '#7259ea', c.E ?? '#2196a6', c.C ?? '#e8e8e8', c.G ?? '#3fb4ea']
    }
    return null
  })

  const glowingBulbStats = $derived.by(() => {
    if (!isGlowingMaterial(view.material)) return null
    const m = resolveGlowingMaterial(view.material)
    if (!m.glowEmitLight) return { disabled: true }
    const atoms = view.atoms ?? []
    const maxRequested = m.glowMaxLights ?? GLOWING_MATERIAL_DEFAULTS.glowMaxLights
    const maxLights = clampGlowMaxLights(maxRequested)
    const filter = m.glowAtomFilter ?? GLOWING_MATERIAL_DEFAULTS.glowAtomFilter
    if (filter === 'highlighted') {
      return { filter, maxLights, maxRequested, needsSelection: true }
    }
    const pool = countGlowPool(atoms, filter)
    const active = selectGlowLightAtoms(atoms, {
      filter,
      maxLights,
      highlightIndices: new Set()
    }).length
    return {
      filter,
      pool,
      active,
      maxLights,
      maxRequested,
      gpuLimited: maxRequested > GLOW_LIGHTS_HARD_MAX,
      capped: pool > maxLights
    }
  })

  const glowingBulbsHeavy = $derived(
    glowingBulbStats &&
      !glowingBulbStats.disabled &&
      !glowingBulbStats.needsSelection &&
      glowingBulbStats.active > GLOW_LIGHTS_PERF_WARN
  )

  const SWATCH_ATOMS = [
    { element: 'C', name: 'CA', res_name: 'ALA', chain_id: 'A', index: 0 },
    { element: 'H', name: 'H', res_name: 'ALA', chain_id: 'A', index: 1 },
    { element: 'O', name: 'O', res_name: 'ALA', chain_id: 'A', index: 2 },
    { element: 'N', name: 'N', res_name: 'ALA', chain_id: 'A', index: 3 }
  ]
</script>

<!-- ── Main row ─────────────────────────────────────────────────────────────-->
{#if view._isSelHighlight}
  <!-- Compact read-only row for temporary selection highlight views -->
  <div
    class="flex items-center gap-2 border-b border-neutral-200 bg-yellow-500/5 px-2 py-1.5 select-none dark:border-neutral-800"
  >
    <div class="size-2 shrink-0 rounded-full bg-yellow-400/70"></div>
    <div class="min-w-0 flex-1 truncate text-[10px] text-yellow-300/80 italic">
      Selection ({view.atoms?.length ?? 0} atoms)
    </div>
    <button
      type="button"
      class="shrink-0 text-neutral-500 hover:text-red-400"
      aria-label="Remove selection view"
      onclick={onremove}>&times;</button
    >
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative gap-2 border-b border-neutral-200 p-2 select-none dark:border-neutral-800 {view.visible
      ? 'bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-white'
      : 'text-neutral-500 dark:text-neutral-400'}"
    oncontextmenu={(e) => {
      e.preventDefault()
      e.stopPropagation()
      rowCtxMenu = { x: e.clientX, y: e.clientY }
    }}
  >
    <div class="flex items-center gap-2">
      <!-- Visibility toggle -->
      <div class="relative size-3 shrink-0">
        <input
          type="checkbox"
          class="peer absolute inset-0 z-10 cursor-pointer opacity-0"
          checked={view.visible}
          aria-label="Show/hide"
          onchange={() => {
            view.visible = !view.visible
          }}
        />
        <div
          class="pointer-events-none h-full w-full rounded-full border-2 border-neutral-400 bg-transparent transition-[background-color,border-color] peer-checked:border-neutral-800 peer-checked:bg-neutral-800 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400 dark:border-neutral-500 dark:peer-checked:border-neutral-100 dark:peer-checked:bg-neutral-100 dark:peer-focus-visible:ring-neutral-600"
          aria-hidden="true"
        ></div>
      </div>

      <!-- Selection label — double-click to edit inline -->
      {#if editingSelection}
        <input
          bind:this={selectionInputEl}
          type="text"
          class="min-w-0 flex-1 rounded border border-yellow-500/70 bg-white px-1 py-0.5 font-mono text-xs text-neutral-900 outline-none select-text dark:bg-neutral-950 dark:text-neutral-100 {invalidSelection
            ? 'border-red-500'
            : ''}"
          bind:value={selectionDraft}
          placeholder="chainID A · resid 1:20"
          title="Enter MDAnalysis selection · Enter to apply · Esc to cancel"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitSelectionEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelSelectionEdit()
            }
          }}
          onblur={() => commitSelectionEdit()}
        />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="min-w-0 flex-1 cursor-text truncate text-xs {namedSelection === 'other' &&
          view.selection
            ? 'font-mono'
            : 'capitalize'}"
          title="Double-click to edit selection"
          ondblclick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            beginSelectionEdit()
          }}
        >
          {currentSelectionLabel()}
        </div>
      {/if}

      <!-- Repr badge — click to cycle; spinner shown while loading -->
      <div class="relative flex shrink-0 items-center">
        <button
          type="button"
          class="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-800 transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
          onclick={cycleRepr}
          title="Click to cycle representation"
        >
          {REPR_LABELS[view.representation.type]}
        </button>
        {#if loadingStructure}
          <Spinner className="absolute -right-4 size-3 text-neutral-400" />
        {/if}
      </div>

      <!-- Color swatch — click to toggle quick picker -->
      <button
        type="button"
        class="flex h-4 shrink-0 items-stretch overflow-hidden rounded ring-1 ring-transparent transition-all hover:ring-neutral-600"
        onclick={() => (colorPickerOpen = !colorPickerOpen)}
        title="Click to change color scheme"
      >
        {#if swatchColors()}
          {#each swatchColors() as hex (hex)}
            <div class="w-2" style="background-color: {hex};"></div>
          {/each}
        {:else}
          {#each SWATCH_ATOMS as atom (atom.element)}
            <div
              class="w-2"
              style="background-color: #{view.colorScheme.resolver(atom).getHexString()};"
            ></div>
          {/each}
        {/if}
      </button>

      <!-- Focus -->
      <button
        type="button"
        onclick={() => oncenter?.()}
        class="focus-visible:outline-none active:translate-y-0.5 disabled:opacity-50"
        title="Center on this view"
        disabled={!view.atoms?.length}
      >
        <Focus className="size-4" />
      </button>

      <!-- Gear → opens dialog -->
      <button
        type="button"
        onclick={openGearDialog}
        class="focus-visible:outline-none active:translate-y-0.5"
        title="View settings"
      >
        <Gear className="size-4" />
      </button>
    </div>

    <!-- Quick color scheme picker ──────────────────────────────────────────-->
    {#if colorPickerOpen}
      <div class="mt-2 flex flex-col gap-2">
        <div class="flex flex-wrap gap-1">
          {#each [{ v: 'cpk', l: 'CPK' }, { v: 'chain', l: 'Chain' }, { v: 'goodsell', l: 'Pastel' }, { v: 'residue_nature', l: 'Residue' }, { v: 'ss', l: 'SS' }, { v: 'cpk-carbon', l: 'CPK+C' }, { v: 'constant', l: 'Uniform' }] as opt (opt.v)}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[10px] transition-colors {colorSchemeName === opt.v
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
              onclick={() => {
                colorSchemeName = opt.v
              }}
            >
              {opt.l}
            </button>
          {/each}
        </div>
        {#if ['constant', 'cpk-carbon'].includes(colorSchemeName)}
          <div class="flex items-center gap-1">
            <ColorInput size="sm" bind:value={constantColorHex} />
            <Input type="text" size="sm" className="flex-1" bind:value={constantColorHex} />
          </div>
          <div class="grid grid-cols-8 gap-1">
            {#each COLOR_PALETTE as color (color.getHexString())}
              <button
                class="aspect-square w-full rounded-sm border border-neutral-200 bg-white p-0.5 hover:border-neutral-400 active:translate-y-0.5 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600"
                aria-label="Select color #{color.getHexString()}"
                onclick={() => (constantColorHex = `#${color.getHexString()}`)}
              >
                <div
                  class="size-full rounded-sm"
                  style="background-color: #{color.getHexString()};"
                ></div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if rowCtxMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50"
      onpointerdown={() => {
        rowCtxMenu = null
      }}
    >
      <div
        class="absolute z-50 min-w-40 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        style="left:{rowCtxMenu.x}px;top:{rowCtxMenu.y}px"
        role="menu"
        tabindex="-1"
        onpointerdown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
          onclick={() => {
            rowCtxMenu = null
            onduplicate?.()
          }}
        >
          Duplicate representation
        </button>
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
          onclick={() => {
            rowCtxMenu = null
            onsplitbychain?.()
          }}
        >
          Split by chain
        </button>
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          onclick={() => {
            rowCtxMenu = null
            onremove()
          }}
        >
          Remove
        </button>
      </div>
    </div>
  {/if}

  <!-- ── Gear dialog ──────────────────────────────────────────────────────────-->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={gearDialog}
    class="fixed top-10 bottom-10 left-16 z-50 m-0 w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl backdrop:bg-black/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
    onpointerdown={onGearDialogPointerDown}
    onclick={onGearDialogClick}
    oncancel={(e) => {
      e.preventDefault()
      closeGearDialog()
    }}
  >
    <div class="flex flex-col gap-0">
      <div
        class="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <span class="text-sm font-medium">View settings</span>
        <button
          type="button"
          class="relative z-20 -mr-1 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={(e) => {
            e.stopPropagation()
            closeGearDialog()
          }}>&times;</button
        >
      </div>

      <div class="flex flex-col gap-4 p-3">
        <!-- Selection -->
        <section class="space-y-1.5">
          <div class="flex items-center justify-between">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Selection</p>
            <span class="text-neutral-500">{view.atoms?.length ?? 0} atoms</span>
          </div>
          <Select size="sm" className="w-full capitalize" bind:value={namedSelection}>
            {#each NAMED_SELECTIONS as sel (sel)}
              <option value={sel} class="capitalize">{sel}</option>
            {/each}
          </Select>
          {#if namedSelection === 'other'}
            <div class="flex gap-1">
              <Input
                type="text"
                size="sm"
                className="flex-1 {invalidSelection ? 'border-red-500!' : ''}"
                placeholder="chainID A  ·  resid 1:20  ·  ..."
                bind:value={view.selection}
              />
              <button
                type="button"
                class="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-400 dark:hover:text-white"
                title="MDAnalysis selection help"
                onclick={openHelpDialog}>?</button
              >
            </div>
          {/if}
          <button
            type="button"
            class="w-full rounded border border-neutral-300 px-2 py-1 text-left text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
            title="Replace this representation with one per chainID, keeping the same style"
            onclick={() => {
              closeGearDialog()
              onsplitbychain?.()
            }}
          >
            Split by chain
          </button>
        </section>

        <!-- Representation -->
        <section class="space-y-1.5">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Representation</p>
          <Select
            size="sm"
            className="w-full"
            bind:value={
              () => view.representation.type,
              (reprType) => {
                view.representation = { type: reprType }
              }
            }
          >
            <option value="points">Points</option>
            <option value="ball-stick">Ball &amp; Stick</option>
            <option value="cartoon">Cartoon</option>
            <option value="tube">Tube</option>
            <option value="vdw">vdW</option>
          </Select>
        </section>

        <!-- Points size -->
        {#if view.representation.type === 'points'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Point size</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Size</span>
              <input
                type="range"
                class="flex-1 accent-blue-500"
                min={1}
                max={10}
                step={0.5}
                value={view.pointSize ?? 3}
                oninput={(e) => {
                  view.pointSize = +e.target.value
                }}
              />
              <span class="w-8 text-right tabular-nums">{(view.pointSize ?? 3).toFixed(1)}</span>
            </div>
          </section>
        {/if}

        <!-- VdW atom size -->
        {#if view.representation.type === 'vdw'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Atom size</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Scale</span>
              <input
                type="range"
                class="flex-1 accent-blue-500"
                min={0.3}
                max={2.0}
                step={0.05}
                value={view.atomScale ?? 1.0}
                oninput={(e) => {
                  view.atomScale = +e.target.value
                }}
              />
              <span class="w-8 text-right tabular-nums">{(view.atomScale ?? 1.0).toFixed(2)}</span>
            </div>
          </section>
        {/if}

        <!-- Ball-stick atom & bond size -->
        {#if view.representation.type === 'ball-stick'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Atom &amp; Bond size</p>
            {#each [{ label: 'Atom', key: 'atomScale', min: 0.2, max: 2.0, step: 0.05, def: 1.0 }, { label: 'Bond', key: 'bondScale', min: 0.1, max: 4.0, step: 0.1, def: 1.0 }] as s (s.key)}
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                <input
                  type="range"
                  class="flex-1 accent-blue-500"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={view[s.key] ?? s.def}
                  oninput={(e) => {
                    view[s.key] = +e.target.value
                  }}
                />
                <span class="w-8 text-right tabular-nums">{(view[s.key] ?? s.def).toFixed(2)}</span>
              </div>
            {/each}
          </section>
        {/if}

        <!-- Cartoon dimensions / Tube radius -->
        {#if view.representation.type === 'cartoon'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Cartoon dimensions</p>
            {#each [{ label: 'Helix', key: 'helixWidth', min: 0.1, max: 2.5, step: 0.05 }, { label: 'Sheet', key: 'sheetWidth', min: 0.1, max: 2.5, step: 0.05 }, { label: 'Coil', key: 'coilWidth', min: 0.03, max: 0.5, step: 0.01 }] as s (s.key)}
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                <input
                  type="range"
                  class="flex-1 accent-blue-500"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={view[s.key]}
                  oninput={(e) => {
                    view[s.key] = +e.target.value
                  }}
                />
                <span class="w-8 text-right tabular-nums">{(view[s.key] ?? 0).toFixed(2)}</span>
              </div>
            {/each}
          </section>
        {/if}

        <!-- SS colors (cartoon and tube) -->
        {#if view.representation.type === 'cartoon' || view.representation.type === 'tube'}
          <section class="space-y-2">
            <div class="flex items-center justify-between">
              <p class="font-medium text-neutral-800 dark:text-neutral-300">SS colors</p>
              <button
                type="button"
                class="text-[10px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
                onclick={() => {
                  view.ssColors = null
                }}>Reset</button
              >
            </div>
            {#each Object.entries(SS_LABELS) as [code, label] (code)}
              {@const currentHex =
                (view.ssColors ?? SS_COLORS_DEFAULT)[code] ?? SS_COLORS_DEFAULT[code] ?? '#888888'}
              <div class="flex items-center gap-2">
                <div
                  class="size-3 shrink-0 rounded-sm border border-neutral-300 dark:border-neutral-700"
                  style="background-color: {currentHex};"
                ></div>
                <span class="w-20 shrink-0 text-neutral-600 dark:text-neutral-400">{label}</span>
                <input
                  type="color"
                  class="h-5 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  value={currentHex}
                  oninput={(e) => {
                    const prev = view.ssColors ?? { ...SS_COLORS_DEFAULT }
                    const updated = { ...prev, [code]: e.target.value }
                    if (code === 'H') updated.h = e.target.value
                    if (code === 'G') {
                      updated.g = e.target.value
                      updated.I = e.target.value
                      updated.i = e.target.value
                    }
                    view.ssColors = updated
                  }}
                />
              </div>
            {/each}
          </section>
        {/if}

        <!-- Tube radius -->
        {#if view.representation.type === 'tube'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Tube radius</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Radius</span>
              <input
                type="range"
                class="flex-1 accent-blue-500"
                min={0.05}
                max={2.0}
                step={0.05}
                value={view.tubeRadius ?? 0.9}
                oninput={(e) => {
                  view.tubeRadius = +e.target.value
                }}
              />
              <span class="w-8 text-right tabular-nums">{(view.tubeRadius ?? 0.9).toFixed(2)}</span>
            </div>
          </section>
        {/if}

        <!-- Material -->
        <section class="space-y-2">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Material</p>
          <div class="flex flex-wrap gap-1">
            {#each Object.keys(MATERIAL_PRESETS) as preset (preset)}
              <button
                type="button"
                class="rounded px-2 py-0.5 text-[10px] capitalize transition-colors {(view.material?.preset ??
                'Default') === preset
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
                onclick={() => applyMaterialPreset(preset)}>{preset}</button
              >
            {/each}
          </div>
          {#if isGoodsellMaterial(view.material)}
            <div class="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <p class="text-[10px] font-medium text-neutral-700 dark:text-neutral-300">Outlines</p>
              <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" bind:checked={view.material.outlinesEnabled} />
                Show outlines
              </label>
              <div class="flex items-center gap-2">
                <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Color</span>
                <ColorInput size="sm" bind:value={view.material.outlineColor} />
                <Input type="text" size="sm" className="field-input flex-1" bind:value={view.material.outlineColor} />
              </div>
              <div class="flex items-center gap-2">
                <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Width</span>
                <input
                  type="range"
                  class="flex-1 accent-blue-500"
                  min={0.04}
                  max={0.35}
                  step={0.01}
                  bind:value={view.material.outlineWidth}
                />
                <span class="w-10 text-right tabular-nums">{view.material.outlineWidth.toFixed(2)}</span>
              </div>
              <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" bind:checked={view.material.useGoodsellLighting} />
                Flat Goodsell lighting
              </label>
              <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
                Lighting is restored automatically when you switch to another material or disable this
                option.
              </p>
            </div>
          {:else if isGlowingMaterial(view.material)}
            <div class="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
                Atoms act as colored bulbs: they emit light into the scene and tint nearby
                surfaces. Use a tight selection (e.g. ligand) or “Selected atoms only” for a few
                bright sources inside a protein.
              </p>
              <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" bind:checked={view.material.glowEmitLight} />
                Emit scene light from atoms
              </label>
              <div class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">Bulb filter</span>
                <select
                  class="field-input flex-1 rounded px-1.5 py-0.5 text-[11px]"
                  bind:value={view.material.glowAtomFilter}
                >
                  <option value="non_hydrogen">Heavy atoms (no H)</option>
                  <option value="all">All atoms</option>
                  <option value="highlighted">Selected / hovered only</option>
                </select>
              </div>
              {#if glowingBulbStats}
                <p class="text-[10px] tabular-nums text-neutral-600 dark:text-neutral-400">
                  {#if glowingBulbStats.disabled}
                    Scene bulbs off (enable “Emit scene light”).
                  {:else if glowingBulbStats.needsSelection}
                    Scene bulbs: select atoms in the viewer (max {glowingBulbStats.maxLights}).
                  {:else}
                    Scene bulbs: {glowingBulbStats.active} active
                    {#if glowingBulbStats.capped}
                      (pool {glowingBulbStats.pool}, capped at {glowingBulbStats.maxLights})
                    {:else}
                      of {glowingBulbStats.pool} eligible atoms
                    {/if}
                  {/if}
                </p>
              {/if}
              {#if glowingBulbsHeavy}
                <p class="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  Many scene bulbs can slow placement. For full proteins prefer Surface glow and
                  Light power; use “Selected atoms only” for localized highlights.
                </p>
              {/if}
              {#if glowingBulbStats?.gpuLimited}
                <p class="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  Saved Max bulbs ({glowingBulbStats.maxRequested}) exceeds the GPU limit — only
                  {GLOW_LIGHTS_HARD_MAX} are used (higher values break WebGL shaders).
                </p>
              {/if}
              {#if viewerBusy.active && isGlowingMaterial(view.material)}
                <p class="flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400">
                  <Spinner className="size-3" />
                  {viewerBusy.label || 'Updating material…'}
                </p>
              {/if}
              {#each GLOWING_UI_SLIDERS as s (s.key)}
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                  <input
                    type="range"
                    class="flex-1 accent-blue-500"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={view.material[s.key] ??
                      (s.key === 'emissiveIntensity' ? 2.5 : GLOWING_MATERIAL_DEFAULTS[s.key])}
                    oninput={(e) => {
                      let val = +e.target.value
                      if (s.key === 'glowMaxLights') val = clampGlowMaxLights(val)
                      view.material = {
                        ...view.material,
                        preset: 'Glowing',
                        [s.key]: val
                      }
                    }}
                  />
                  <span class="w-10 text-right tabular-nums"
                    >{(
                      view.material[s.key] ??
                      (s.key === 'emissiveIntensity' ? 2.5 : GLOWING_MATERIAL_DEFAULTS[s.key]) ??
                      0
                    ).toFixed(s.decimals)}</span
                  >
                </div>
              {/each}
              {#each [{ label: 'Metalness', key: 'metalness' }, { label: 'Roughness', key: 'roughness' }] as s (s.key)}
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                  <input
                    type="range"
                    class="flex-1 accent-blue-500"
                    min={0}
                    max={1}
                    step={0.01}
                    value={view.material[s.key] ?? (s.key === 'roughness' ? 0.15 : 0)}
                    oninput={(e) => {
                      view.material = {
                        ...view.material,
                        preset: 'Glowing',
                        [s.key]: +e.target.value
                      }
                    }}
                  />
                  <span class="w-8 text-right tabular-nums">{(view.material[s.key] ?? 0).toFixed(2)}</span>
                </div>
              {/each}
              <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
                Surface glow = self-lit atoms; scene bulbs = point lights (max {GLOW_LIGHTS_HARD_MAX}
                — WebGL shader limit). Max bulbs only matters when eligible atoms exceed the cap.
                Lower Surface glow to see metalness / roughness.
              </p>
            </div>
          {:else}
            {#each [{ label: 'Metalness', key: 'metalness', min: 0, max: 1, step: 0.01 }, { label: 'Roughness', key: 'roughness', min: 0, max: 1, step: 0.01 }, { label: 'Glow', key: 'emissiveIntensity', min: 0, max: 2, step: 0.05 }] as s (s.key)}
              <div class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                <input
                  type="range"
                  class="flex-1 accent-blue-500"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={view.material[s.key]}
                  oninput={(e) => {
                    view.material = { ...view.material, preset: view.material?.preset ?? 'Default', [s.key]: +e.target.value }
                  }}
                />
                <span class="w-8 text-right tabular-nums"
                  >{(view.material[s.key] ?? 0).toFixed(2)}</span
                >
              </div>
            {/each}
          {/if}
        </section>

        <!-- Quality -->
        <section class="space-y-2">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Quality</p>
          <div class="flex gap-1">
            {#each [{ v: 1, l: 'Low' }, { v: 2, l: 'Med' }, { v: 3, l: 'High' }, { v: 4, l: 'Ultra' }, { v: 5, l: 'Max' }] as q (q.v)}
              <button
                type="button"
                class="flex-1 rounded px-1 py-0.5 text-xs transition-colors
                {(view.quality ?? 3) === q.v
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'}"
                onclick={() => {
                  view.quality = q.v
                }}>{q.l}</button
              >
            {/each}
          </div>
        </section>

        <!-- Remove -->
        <Button
          variant="danger"
          size="sm"
          type="button"
          className="w-full"
          onclick={() => {
            closeGearDialog()
            onremove()
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  </dialog>

  <!-- ── MDAnalysis help dialog ────────────────────────────────────────────────-->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={helpDialog}
    class="fixed top-1/2 left-1/2 m-0 max-h-[80vh] w-96 max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
    onpointerdown={onHelpDialogPointerDown}
    onclick={onHelpDialogClick}
    oncancel={(e) => {
      e.preventDefault()
      closeHelpDialog()
    }}
  >
    <div class="flex flex-col">
      <div class="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span class="text-sm font-medium">MDAnalysis Selection Language</span>
        <button
          type="button"
          class="relative z-20 -mr-1 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={(e) => {
            e.stopPropagation()
            closeHelpDialog()
          }}>&times;</button
        >
      </div>
      <pre
        class="p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{MDA_HELP}</pre>
    </div>
  </dialog>
{/if}

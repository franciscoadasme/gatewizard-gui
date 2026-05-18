<script>
  import {
    constantScheme,
    cpkScheme,
    defaultColorScheme,
    chainScheme,
    residueNatureScheme,
    ssScheme,
    COLOR_PALETTE,
    SS_COLORS_DEFAULT,
    SS_LABELS,
    MATERIAL_PRESETS
  } from '../lib/colorSchemes.js'
  import { getStructure } from '../lib/backendApi'
  import { untrack } from 'svelte'
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Focus from './icons/Focus.svelte'
  import Gear from './icons/Gear.svelte'
  import Input from './ui/Input.svelte'
  import Select from './ui/Select.svelte'

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
  const REPR_TYPES = ['ball-stick', 'cartoon', 'tube', 'vdw']
  const REPR_LABELS = { 'ball-stick': 'Ball & Stick', cartoon: 'Cartoon', tube: 'Tube', vdw: 'vdW' }

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
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' | 'tube' }} Representation */
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
   *   material: { metalness: number, roughness: number, emissiveIntensity: number },
   *   quality: number
   * }} View
   */

  /** @type {{ view: View, onremove: () => void, oncenter?: () => void }} */
  let { view = $bindable(), onremove, oncenter } = $props()

  let colorPickerOpen = $state(false)
  /** @type {HTMLDialogElement|null} */
  let gearDialog = $state(null)
  /** @type {HTMLDialogElement|null} */
  let helpDialog = $state(null)

  let colorSchemeName = $state(view.colorScheme.name)
  let constantColorHex = $state(view.colorScheme.color || '#00aaff')
  let invalidSelection = $state(false)
  let namedSelection = $state(NAMED_SELECTIONS.includes(view.selection) ? view.selection : 'other')

  // ── Reactivity ────────────────────────────────────────────────────────────

  $effect(() => {
    const sel = view.selection
    if (sel === '') return
    const tid = setTimeout(updateStructure, 300)
    return () => clearTimeout(tid)
  })

  $effect(() => {
    const sel = namedSelection
    untrack(() => {
      if (sel !== 'other') {
        view.selection = ''
        updateStructure()
      }
    })
  })

  $effect(() => {
    const repr = view.representation.type
    const needsFetch = untrack(
      () =>
        (repr === 'ball-stick' && (view.bonds?.length || 0) < view.atoms.length / 2) ||
        ((repr === 'cartoon' || repr === 'tube') && !view.residues)
    )
    if (!needsFetch) return
    const tid = setTimeout(updateStructure, 300)
    return () => clearTimeout(tid)
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
    const needsSS =
      view.representation.type === 'cartoon' ||
      view.representation.type === 'tube' ||
      colorSchemeName === 'ss'
    getStructure({
      path: view.path,
      selection: namedSelection === 'other' ? view.selection : namedSelection,
      needs_bonds: view.representation.type === 'ball-stick',
      needs_secondary_structure: needsSS
    })
      .then((structure) => {
        view.atoms = structure.atoms
        view.bonds = structure.bonds
        view.residues = structure.residues
        invalidSelection = false
      })
      .catch(() => {
        invalidSelection = true
      })
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function cycleRepr() {
    const idx = REPR_TYPES.indexOf(view.representation.type)
    view.representation = { type: REPR_TYPES[(idx + 1) % REPR_TYPES.length] }
  }

  function applyMaterialPreset(preset) {
    const [m, r, e] = MATERIAL_PRESETS[preset]
    view.material = { metalness: m, roughness: r, emissiveIntensity: e }
  }

  const swatchColors = $derived(() => {
    if (colorSchemeName === 'chain') {
      return ['#e6194b', '#3cb44b', '#ffe119', '#0082c8']
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

  const SWATCH_ATOMS = [
    { element: 'C', name: 'CA', res_name: 'ALA', chain_id: 'A', index: 0 },
    { element: 'H', name: 'H', res_name: 'ALA', chain_id: 'A', index: 1 },
    { element: 'O', name: 'O', res_name: 'ALA', chain_id: 'A', index: 2 },
    { element: 'N', name: 'N', res_name: 'ALA', chain_id: 'A', index: 3 }
  ]
</script>

<!-- ── Main row ─────────────────────────────────────────────────────────────-->
<div
  class="gap-2 border-b border-neutral-800 p-2 select-none {view.visible
    ? 'white bg-neutral-900'
    : 'text-neutral-400'}"
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
        class="pointer-events-none h-full w-full rounded-full border-2 border-neutral-500 bg-transparent transition-[background-color,border-color] peer-checked:border-neutral-100 peer-checked:bg-neutral-100 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400"
        aria-hidden="true"
      ></div>
    </div>

    <!-- Selection label -->
    <div
      class="min-w-0 flex-1 truncate text-xs {namedSelection === 'other' && view.selection
        ? 'font-mono'
        : 'capitalize'}"
    >
      {namedSelection === 'other' && view.selection ? view.selection : namedSelection}
    </div>

    <!-- Repr badge — click to cycle -->
    <button
      type="button"
      class="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-neutral-700"
      onclick={cycleRepr}
      title="Click to cycle representation"
    >
      {REPR_LABELS[view.representation.type]}
    </button>

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
      onclick={() => gearDialog?.showModal()}
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
        {#each [{ v: 'cpk', l: 'CPK' }, { v: 'chain', l: 'Chain' }, { v: 'residue_nature', l: 'Residue' }, { v: 'ss', l: 'SS' }, { v: 'cpk-carbon', l: 'CPK+C' }, { v: 'constant', l: 'Uniform' }] as opt (opt.v)}
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[10px] transition-colors {colorSchemeName === opt.v
              ? 'bg-blue-600 text-white'
              : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}"
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
              class="aspect-square w-full rounded-sm border border-neutral-800 bg-neutral-950 p-0.5 hover:border-neutral-600 active:translate-y-0.5"
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

<!-- ── Gear dialog ──────────────────────────────────────────────────────────-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={gearDialog}
  class="max-h-[85vh] w-80 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-xs text-neutral-100 shadow-2xl backdrop:bg-black/60"
  onclick={(e) => {
    if (e.target === gearDialog) gearDialog?.close()
  }}
>
  <form method="dialog" class="flex flex-col gap-0">
    <div
      class="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-700 bg-neutral-900 px-3 py-2"
    >
      <span class="text-sm font-medium">View settings</span>
      <button type="submit" class="text-lg leading-none text-neutral-400 hover:text-white"
        >&times;</button
      >
    </div>

    <div class="flex flex-col gap-4 p-3">
      <!-- Selection -->
      <section class="space-y-1.5">
        <div class="flex items-center justify-between">
          <p class="font-medium text-neutral-300">Selection</p>
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
              placeholder="chain A  ·  resid 1:20  ·  ..."
              bind:value={view.selection}
            />
            <button
              type="button"
              class="shrink-0 rounded border border-neutral-600 px-2 py-0.5 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-white"
              title="MDAnalysis selection help"
              onclick={() => helpDialog?.showModal()}>?</button
            >
          </div>
        {/if}
      </section>

      <!-- Representation -->
      <section class="space-y-1.5">
        <p class="font-medium text-neutral-300">Representation</p>
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
          <option value="ball-stick">Ball &amp; Stick</option>
          <option value="cartoon">Cartoon</option>
          <option value="tube">Tube</option>
          <option value="vdw">vdW</option>
        </Select>
      </section>

      <!-- VdW atom size -->
      {#if view.representation.type === 'vdw'}
        <section class="space-y-2">
          <p class="font-medium text-neutral-300">Atom size</p>
          <div class="flex items-center gap-2">
            <span class="w-10 shrink-0 text-neutral-400">Scale</span>
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
          <p class="font-medium text-neutral-300">Atom &amp; Bond size</p>
          {#each [{ label: 'Atom', key: 'atomScale', min: 0.2, max: 2.0, step: 0.05, def: 1.0 }, { label: 'Bond', key: 'bondScale', min: 0.1, max: 4.0, step: 0.1, def: 1.0 }] as s (s.key)}
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-400">{s.label}</span>
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
          <p class="font-medium text-neutral-300">Cartoon dimensions</p>
          {#each [{ label: 'Helix', key: 'helixWidth', min: 0.1, max: 2.5, step: 0.05 }, { label: 'Sheet', key: 'sheetWidth', min: 0.1, max: 2.5, step: 0.05 }, { label: 'Coil', key: 'coilWidth', min: 0.03, max: 0.5, step: 0.01 }] as s (s.key)}
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-400">{s.label}</span>
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
            <p class="font-medium text-neutral-300">SS colors</p>
            <button
              type="button"
              class="text-[10px] text-neutral-500 hover:text-neutral-300"
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
                class="size-3 shrink-0 rounded-sm border border-neutral-700"
                style="background-color: {currentHex};"
              ></div>
              <span class="w-20 shrink-0 text-neutral-400">{label}</span>
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
          <p class="font-medium text-neutral-300">Tube radius</p>
          <div class="flex items-center gap-2">
            <span class="w-10 shrink-0 text-neutral-400">Radius</span>
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
        <p class="font-medium text-neutral-300">Material</p>
        <div class="flex flex-wrap gap-1">
          {#each Object.keys(MATERIAL_PRESETS) as preset (preset)}
            <button
              type="button"
              class="rounded bg-neutral-800 px-2 py-0.5 text-[10px] transition-colors hover:bg-neutral-700"
              onclick={() => applyMaterialPreset(preset)}>{preset}</button
            >
          {/each}
        </div>
        {#each [{ label: 'Metalness', key: 'metalness', min: 0, max: 1, step: 0.01 }, { label: 'Roughness', key: 'roughness', min: 0, max: 1, step: 0.01 }, { label: 'Ambient', key: 'emissiveIntensity', min: 0, max: 0.4, step: 0.01 }] as s (s.key)}
          <div class="flex items-center gap-2">
            <span class="w-16 shrink-0 text-neutral-400">{s.label}</span>
            <input
              type="range"
              class="flex-1 accent-blue-500"
              min={s.min}
              max={s.max}
              step={s.step}
              value={view.material[s.key]}
              oninput={(e) => {
                view.material[s.key] = +e.target.value
              }}
            />
            <span class="w-8 text-right tabular-nums">{(view.material[s.key] ?? 0).toFixed(2)}</span
            >
          </div>
        {/each}
      </section>

      <!-- Quality -->
      <section class="space-y-2">
        <p class="font-medium text-neutral-300">Quality</p>
        <div class="flex gap-1">
          {#each [{ v: 1, l: 'Low' }, { v: 2, l: 'Med' }, { v: 3, l: 'High' }, { v: 4, l: 'Ultra' }, { v: 5, l: 'Max' }] as q (q.v)}
            <button
              type="button"
              class="flex-1 rounded px-1 py-0.5 text-xs transition-colors
                {(view.quality ?? 3) === q.v
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}"
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
          gearDialog?.close()
          onremove()
        }}
      >
        Remove
      </Button>
    </div>
  </form>
</dialog>

<!-- ── MDAnalysis help dialog ────────────────────────────────────────────────-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={helpDialog}
  class="max-h-[80vh] w-96 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-xs text-neutral-100 shadow-2xl backdrop:bg-black/60"
  onclick={(e) => {
    if (e.target === helpDialog) helpDialog?.close()
  }}
>
  <form method="dialog" class="flex flex-col">
    <div class="flex items-center justify-between border-b border-neutral-700 px-3 py-2">
      <span class="text-sm font-medium">MDAnalysis Selection Language</span>
      <button type="submit" class="text-lg leading-none text-neutral-400 hover:text-white"
        >&times;</button
      >
    </div>
    <pre
      class="p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-neutral-300">{MDA_HELP}</pre>
  </form>
</dialog>

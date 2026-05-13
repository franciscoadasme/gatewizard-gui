<script>
  import { Color } from 'three'
  import { constantScheme, cpkScheme, defaultColorScheme } from '../lib/colorSchemes.js'
  import { getStructure } from '../lib/backendApi'
  import { untrack } from 'svelte'
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Focus from './icons/Focus.svelte'
  import Gear from './icons/Gear.svelte'
  import Input from './ui/Input.svelte'
  import Select from './ui/Select.svelte'

  const COLOR_PALETTE = [
    // lighter colors
    new Color().setRGB(1.0, 0.6, 0.6), // salmon
    new Color().setRGB(1.0, 0.87, 0.37), // yellow orange
    new Color().setRGB(1.0, 0.65, 0.85), // pink
    new Color().setRGB(0.75, 1.0, 0.25), // limon
    new Color().setRGB(0.75, 0.75, 1.0), // light blue
    new Color().setRGB(0.5, 1.0, 1.0), // aquamarine
    new Color().setRGB(1.0, 0.7, 0.2), // bright orange
    new Color().setRGB(0.9, 0.9, 0.9), // light gray
    // darker colors
    new Color().setRGB(0.698, 0.13, 0.13), // firebrick
    new Color().setRGB(0.65, 0.32, 0.17), // brown
    new Color().setRGB(0.55, 0.25, 0.6), // violet purple
    new Color().setRGB(0.2, 0.6, 0.2), // forest
    new Color().setRGB(0.25, 0.25, 0.65), // deep blue
    new Color().setRGB(0.1, 0.6, 0.6), // deep teal
    new Color().setRGB(1.0, 0.55, 0.15), // tv orange
    new Color().setRGB(0.3, 0.3, 0.3), // dark gray
    // intense colors
    new Color().setRGB(1.0, 0.05, 0.05), // red
    new Color().setRGB(1.0, 1.0, 0.05), // yellow
    new Color().setRGB(1.0, 0.2, 0.8), // magenta
    new Color().setRGB(0.05, 1.0, 0.05), // green
    new Color().setRGB(0.05, 0.05, 1.0), // blue
    new Color().setRGB(0.05, 1.0, 1.0), // cyan
    new Color().setRGB(1.0, 0.5, 0.05), // orange
    new Color().setRGB(0.6, 0.6, 0.6) // light gray
  ]
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

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' }} Representation */
  /** @typedef {{ name: string, color?: string, resolver: (atom: Atom) => import('three').Color }} ColorScheme */
  /** @typedef {{ id: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean, colorScheme: ColorScheme }} View */

  /** @type {{ view: View, onremove: () => void, oncenter?: () => void }} */
  let { view = $bindable(), onremove, oncenter } = $props()

  let collapsed = $state(true)
  let colorSchemeName = $state(view.colorScheme.name)
  let constantColorHex = $state(view.colorScheme.color || '#00aaff')
  let invalidSelection = $state(false)
  let namedSelection = $state(NAMED_SELECTIONS.includes(view.selection) ? view.selection : 'other')

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
      // else updateStructure will be called by the effect on view.selection
    })
  })

  $effect(() => {
    const repr = view.representation.type
    const needsFetch = untrack(
      () =>
        // This is a heuristic to avoid fetching bonds if they are already present
        (repr === 'ball-stick' && (view.bonds?.length || 0) < view.atoms.length / 2) ||
        (repr === 'cartoon' && !view.residues)
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
    } else {
      colorScheme.name = 'default'
      colorScheme.resolver = defaultColorScheme
    }
    untrack(() => (view.colorScheme = colorScheme))
  })

  function updateStructure() {
    getStructure({
      path: view.path,
      selection: namedSelection === 'other' ? view.selection : namedSelection,
      needs_bonds: view.representation.type === 'ball-stick',
      needs_secondary_structure: view.representation.type === 'cartoon'
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
</script>

<div
  class="gap-2 border-b border-neutral-800 p-2 select-none {view.visible
    ? 'white bg-neutral-900'
    : 'text-neutral-400'}"
>
  <div class="flex items-center gap-2">
    <div class="relative size-3 shrink-0">
      <input
        type="checkbox"
        class="peer absolute inset-0 z-10 cursor-pointer opacity-0"
        checked={view.visible}
        aria-label={`Show ${view.name} in viewer`}
        onchange={() => {
          view.visible = !view.visible
        }}
      />
      <div
        class="pointer-events-none h-full w-full rounded-full border-2 border-neutral-500 bg-transparent transition-[background-color,border-color] peer-checked:border-neutral-100 peer-checked:bg-neutral-100 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-neutral-950"
        aria-hidden="true"
      ></div>
    </div>
    <div
      class="flex-1 text-xs {namedSelection === 'other' && view.selection
        ? 'font-mono'
        : 'capitalize'}"
    >
      {namedSelection === 'other' && view.selection ? view.selection : namedSelection}
    </div>
    {#if collapsed}
      <span class="text-xs text-neutral-500">
        {#if view.representation.type === 'ball-stick'}
          Ball & Stick
        {:else if view.representation.type === 'cartoon'}
          Cartoon
        {:else if view.representation.type === 'vdw'}
          vdW
        {/if}
      </span>
      <div class="flex h-4 items-stretch divide-x divide-neutral-900">
        {#each ['C', 'H', 'O', 'N'] as element (element)}
          <div
            class="w-1.5"
            style="background-color: #{view.colorScheme.resolver({ element }).getHexString()};"
          ></div>
        {/each}
      </div>
    {/if}
    <div class="flex items-center gap-1">
      <button
        type="button"
        onclick={() => oncenter?.()}
        class="focus-visible:outline-none active:translate-y-0.5 disabled:opacity-50"
        title="Center on this view"
        aria-label="Center on this view"
        disabled={!view.atoms?.length}
      >
        <Focus className="size-4" />
      </button>
      <button
        type="button"
        onclick={() => {
          collapsed = !collapsed
        }}
        class="focus-visible:outline-none active:translate-y-0.5"
        title="View settings"
        aria-label="View settings"
      >
        <Gear className="size-4" />
      </button>
    </div>
  </div>
  {#if !collapsed}
    <div class="mt-2 flex flex-col gap-2">
      <div class="space-y-1">
        <div class="flex justify-between">
          <label for="selection" class="text-xs">Selection:</label>
          <span class="text-xs text-neutral-500">{view.atoms.length} atoms</span>
        </div>
        <Select size="sm" className="w-full capitalize" bind:value={namedSelection}>
          {#each NAMED_SELECTIONS as sel (sel)}
            <option value={sel} class="capitalize">{sel}</option>
          {/each}
        </Select>
        {#if namedSelection === 'other'}
          <Input
            type="text"
            size="sm"
            className="w-full {invalidSelection ? 'border-red-500!' : ''} "
            placeholder="Enter selection ('chain A' or 'resid 1:20')"
            bind:value={view.selection}
          />
        {/if}
      </div>
      <div class="space-y-1">
        <label for="representation" class="flex text-xs">Representation:</label>
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
          <option value="ball-stick">Ball & Stick</option>
          <option value="cartoon">Cartoon</option>
          <option value="vdw">vdW</option>
        </Select>
      </div>
      <div class="space-y-1">
        <label for="color-scheme" class="flex text-xs">Color scheme:</label>
        <Select size="sm" className="w-full" bind:value={colorSchemeName}>
          <option value="cpk">CPK (by element)</option>
          <option value="cpk-carbon">CPK (custom carbon)</option>
          <option value="constant">Constant color</option>
        </Select>
        {#if ['constant', 'cpk-carbon'].includes(colorSchemeName)}
          <div class="flex items-center gap-1">
            <ColorInput size="sm" bind:value={constantColorHex} />
            <Input
              type="text"
              size="sm"
              className="flex-1"
              bind:value={constantColorHex}
              oninput={(e) => {
                if (e.target.value.length > 7) {
                  constantColorHex = e.target.value.slice(0, 7)
                }
              }}
            />
          </div>
          <div class="grid grid-cols-8 gap-1">
            {#each COLOR_PALETTE as color (color.getHexString())}
              <button
                class="aspect-square w-full rounded-sm border border-neutral-800 bg-neutral-950 p-1 transition-colors hover:border-neutral-700 active:translate-y-0.5"
                onclick={() => (constantColorHex = `#${color.getHexString()}`)}
                title={color.getHexString()}
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
      <Button
        variant="danger"
        size="sm"
        type="button"
        className="w-full flex items-center gap-1"
        onclick={onremove}
      >
        Remove
      </Button>
    </div>
  {/if}
</div>

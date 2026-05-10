<script>
  import { getStructure } from '../lib/backendApi'
  import { untrack } from 'svelte'
  import Input from './ui/Input.svelte'
  import Select from './ui/Select.svelte'
  import Gear from './icons/Gear.svelte'
  import Button from './ui/Button.svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' }} Representation */
  /** @typedef {{ id: string, name: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean }} View */

  /** @type {{ view: View, onremove: () => void }} */
  let { view = $bindable(), onremove } = $props()

  let collapsed = $state(true)
  let invalidSelection = $state(false)

  $effect(() => {
    const sel = view.selection
    const tid = setTimeout(updateStructure, 300)
    return () => clearTimeout(tid)
  })

  $effect(() => {
    const repr = view.representation.type
    const needsFetch = untrack(
      () => (repr === 'ball-stick' && !view.bonds) || (repr === 'cartoon' && !view.residues)
    )
    if (!needsFetch) return
    const tid = setTimeout(updateStructure, 300)
    return () => clearTimeout(tid)
  })

  function updateStructure() {
    getStructure({
      path: view.path,
      selection: view.selection,
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
  <div class="flex items-center justify-between gap-2">
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
      <div class="flex items-baseline gap-1">
        <span class="text-sm">{view.name}</span>
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
        {/if}
      </div>
    </div>
    <button
      type="button"
      onclick={() => {
        collapsed = !collapsed
      }}
      class="focus-visible:outline-none active:translate-y-0.5"
    >
      <Gear className="size-4" />
    </button>
  </div>
  {#if !collapsed}
    <div class="mt-2 flex flex-col gap-2">
      <div class="space-y-1">
        <label for="name" class="text-xs">Name:</label>
        <Input type="text" size="sm" className="w-full" bind:value={view.name} />
      </div>
      <div class="space-y-1">
        <div class="flex justify-between">
          <label for="selection" class="text-xs">Selection:</label>
          <span class="text-xs text-neutral-500">{view.atoms.length} atoms</span>
        </div>
        <Input
          type="text"
          size="sm"
          className="w-full {invalidSelection ? 'border-red-500!' : ''} "
          bind:value={view.selection}
        />
      </div>
      <div class="space-y-1">
        <label for="representation" class="flex text-xs">Representation:</label>
        <Select
          type="text"
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

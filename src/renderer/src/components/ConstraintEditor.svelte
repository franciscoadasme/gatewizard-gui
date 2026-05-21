<script>
  import { onDestroy, onMount, tick } from 'svelte'
  import Input from './ui/Input.svelte'
  import Button from './ui/Button.svelte'

  /** @typedef {{ id: string, name: string, force_constant: number, selection: string }} Constraint */

  /** @type {{ source: Constraint | null, onDismiss: () => void, onAccept: (draft: Constraint) => void, onDelete?: () => void, onSelect: (selection: string) => Promise<number|null> }} */
  let { source, onDismiss, onAccept, onDelete, onSelect } = $props()

  const uid = $props.id()

  /** @type {HTMLDialogElement | null} */
  let dialog = $state(null)
  /** @type {Constraint} */
  let draft = $state(newConstraint())

  let debouncedSelection = $state('all')

  const editing = $derived(source != null)
  const selectedAtoms = $derived(onSelect(debouncedSelection))

  $effect(() => {
    const sel = draft.selection
    if (sel === debouncedSelection) return
    const tid = window.setTimeout(() => {
      debouncedSelection = sel
    }, 500)
    return () => window.clearTimeout(tid)
  })

  onMount(async () => {
    draft = source ? { ...source } : newConstraint()
    debouncedSelection = draft.selection
    await tick()
    dialog?.showModal()
  })

  onDestroy(() => {
    if (dialog?.open) dialog.close()
  })

  function newConstraint() {
    return {
      id: crypto.randomUUID(),
      name: 'New constraint',
      force_constant: 0.0,
      selection: 'all'
    }
  }

  function onDialogCancel(/** @type {Event} */ e) {
    e.preventDefault()
    onDismiss()
  }

  function onDialogClick(/** @type {MouseEvent} */ event) {
    if (event.target === dialog) onDismiss()
  }

  function onSubmit() {
    onAccept(draft)
  }
</script>

<dialog
  bind:this={dialog}
  class="fixed top-1/2 left-1/2 m-0 max-h-[90vh] w-lg max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-0 text-neutral-100 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
  onclick={onDialogClick}
  oncancel={onDialogCancel}
>
  <form
    class="flex flex-col gap-2 p-4 text-sm"
    onsubmit={(e) => {
      e.preventDefault()
      onSubmit()
    }}
  >
    <h3 class="text-base font-semibold">{editing ? 'Edit constraint' : 'Add constraint'}</h3>

    <div class="space-y-1">
      <label for="{uid}-name" class="text-xs text-neutral-400">Name</label>
      <Input id="{uid}-name" className="w-full" bind:value={draft.name} />
    </div>

    <div class="space-y-1">
      <label for="{uid}-selection" class="text-xs text-neutral-400">Selection</label>
      <textarea
        id="{uid}-selection"
        required
        rows="4"
        class="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-50 transition-colors placeholder:text-neutral-500 hover:border-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:outline-none"
        bind:value={draft.selection}
      ></textarea>
      {#await selectedAtoms}
        <p class="text-xs text-neutral-500">Evaluating selection...</p>
      {:then n}
        {#if n === null}
          <p class="text-xs text-red-500">Invalid selection</p>
        {:else}
          <p class="text-xs text-neutral-500">{n.toLocaleString()} atoms selected</p>
        {/if}
      {/await}
    </div>

    <div class="flex items-center gap-1">
      <label for="{uid}-value" class="text-xs text-neutral-400">Force constant:</label>
      <Input
        id="{uid}-value"
        type="number"
        min="0.0"
        max="20.0"
        step="0.1"
        className="w-20"
        bind:value={draft.force_constant}
      />
      <span class="text-xs text-neutral-500">kcal/mol/Å²</span>
    </div>

    <div class="mt-2 flex items-center justify-end gap-2">
      {#if editing && onDelete}
        <Button type="button" variant="danger" onclick={onDelete} className="me-auto">Delete</Button
        >
      {/if}
      <Button type="button" variant="outline" onclick={onDismiss}>Cancel</Button>
      <Button type="submit">{editing ? 'Save' : 'Accept'}</Button>
    </div>
  </form>
</dialog>

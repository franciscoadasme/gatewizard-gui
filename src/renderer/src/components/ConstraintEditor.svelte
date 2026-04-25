<script>
  import Input from './ui/Input.svelte'
  import Button from './ui/Button.svelte'

  /**
   * @type {{
   *   constraint: { id: string, name: string, force_constant: number, selection: string } | null,
   *   onClose: () => void
   * }}
   */
  let { constraint, onClose } = $props()

  const uid = $props.id()

  /** @type {HTMLDialogElement | null} */
  let dialog = $state(null)

  $effect(() => {
    if (!dialog) return
    if (constraint && !dialog.open) dialog.showModal()
    else if (!constraint && dialog.open) dialog.close()
  })

  function onDialogClick(/** @type {MouseEvent} */ event) {
    if (event.target === dialog) onClose()
  }
</script>

<dialog
  bind:this={dialog}
  class="fixed top-1/2 left-1/2 m-0 max-h-[90vh] w-lg max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-0 text-neutral-100 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
  onclick={onDialogClick}
  onclose={onClose}
>
  {#if constraint}
    <form method="dialog" class="flex flex-col gap-2 p-4">
      <h3 class="text-base font-semibold">Edit constraint</h3>

      <div class="space-y-1">
        <label for="{uid}-name" class="text-xs text-neutral-400">Name</label>
        <Input id="{uid}-name" className="w-full" bind:value={constraint.name} />
      </div>

      <div class="space-y-1">
        <label for="{uid}-selection" class="text-xs text-neutral-400">Selection</label>
        <textarea
          id="{uid}-selection"
          rows="4"
          class="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-50 transition-colors placeholder:text-neutral-500 hover:border-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:outline-none"
          bind:value={constraint.selection}
        ></textarea>
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
          bind:value={constraint.force_constant}
        />
        <span class="text-xs text-neutral-500">kcal/mol/Å²</span>
      </div>

      <div class="flex justify-end">
        <Button type="button" onclick={onClose}>Done</Button>
      </div>
    </form>
  {/if}
</dialog>

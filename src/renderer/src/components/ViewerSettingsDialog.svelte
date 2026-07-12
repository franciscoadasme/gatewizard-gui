<script>
  import SceneDefaultsForm from './SceneDefaultsForm.svelte'

  /** @type {{ open?: boolean }} */
  let { open = $bindable(false) } = $props()

  /** @type {HTMLDialogElement | null} */
  let dialogEl = $state(null)
  let backdropPointerDown = $state(false)

  /** @param {HTMLDialogElement | null} dialog */
  function mountDialogToBody(dialog) {
    if (dialog && dialog.parentElement !== document.body) {
      document.body.appendChild(dialog)
    }
  }

  function closeDialog() {
    open = false
    dialogEl?.close()
  }

  $effect(() => {
    if (!dialogEl) return
    if (open) {
      mountDialogToBody(dialogEl)
      if (!dialogEl.open) dialogEl.showModal()
    } else if (dialogEl.open) {
      dialogEl.close()
    }
  })

  /** @param {MouseEvent} event */
  function onDialogClick(event) {
    if (event.target === dialogEl && backdropPointerDown) closeDialog()
    backdropPointerDown = false
  }

  /** @param {PointerEvent} event */
  function onDialogPointerDown(event) {
    backdropPointerDown = event.target === dialogEl
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="fixed top-10 bottom-10 left-16 z-50 m-0 w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl backdrop:bg-black/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
  onpointerdown={onDialogPointerDown}
  onclick={onDialogClick}
  oncancel={(e) => {
    e.preventDefault()
    closeDialog()
  }}
>
  <div class="flex flex-col gap-0">
    <div
      class="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <span class="text-sm font-medium">Scene rendering</span>
      <button
        type="button"
        class="relative z-20 -mr-1 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
        aria-label="Close"
        onclick={(e) => {
          e.stopPropagation()
          closeDialog()
        }}>&times;</button
      >
    </div>

    <div class="flex flex-col gap-3 p-3">
      <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
        Changes apply to this session only. Save startup defaults in Settings.
      </p>
      <SceneDefaultsForm persistOnChange={false} />
    </div>
  </div>
</dialog>

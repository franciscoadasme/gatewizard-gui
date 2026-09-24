<script>
  /**
   * In-app confirm. Native window.confirm() trips GLib/GTK on WSLg/Electron.
   */
  import { themeState } from '../../lib/theme.svelte.js'

  /** @type {{
   *   open: boolean,
   *   title: string,
   *   message: string,
   *   confirmLabel?: string,
   *   onCancel?: () => void,
   *   onConfirm?: () => void
   * }} */
  let {
    open = false,
    title,
    message,
    confirmLabel = 'Remove',
    onCancel,
    onConfirm
  } = $props()

  const isDark = $derived(themeState.current === 'dark')

  function cancel() {
    onCancel?.()
  }

  function confirm() {
    onConfirm?.()
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      confirm()
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 {isDark ? 'dark' : ''}"
    role="presentation"
    onkeydown={onKeydown}
    onclick={(e) => {
      if (e.target === e.currentTarget) cancel()
    }}
  >
    <div
      class="w-full max-w-sm rounded-lg border border-neutral-300 bg-white p-4 text-sm text-neutral-900 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
    >
      <p class="font-semibold">{title}</p>
      <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{message}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="dialog-btn-outline" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-500"
          onclick={confirm}
        >{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}

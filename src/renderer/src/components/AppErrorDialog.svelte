<script>
  import Button from './ui/Button.svelte'
  import { appErrorDialog, closeAppError } from '../lib/appDialog.svelte.js'

  let copyBusy = $state(false)

  async function onCopy() {
    const text = appErrorDialog.message
    if (!text) return
    copyBusy = true
    try {
      await navigator.clipboard.writeText(text)
      appErrorDialog.copied = true
      setTimeout(() => {
        appErrorDialog.copied = false
      }, 2000)
    } catch {
      // Fallback for environments without clipboard API
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        appErrorDialog.copied = true
        setTimeout(() => {
          appErrorDialog.copied = false
        }, 2000)
      } catch {
        /* ignore */
      }
    } finally {
      copyBusy = false
    }
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAppError()
    }
  }
</script>

{#if appErrorDialog.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
    role="presentation"
    onkeydown={onKeydown}
    onclick={(e) => {
      if (e.target === e.currentTarget) closeAppError()
    }}
  >
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-error-title"
      tabindex="-1"
      class="flex max-h-[min(70vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div class="shrink-0 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h2 id="app-error-title" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {appErrorDialog.title}
        </h2>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <pre
          class="select-text whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-800 dark:text-neutral-200"
        >{appErrorDialog.message}</pre>
      </div>

      <div
        class="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <Button type="button" variant="outline" size="sm" onclick={onCopy} disabled={copyBusy}>
          {appErrorDialog.copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type="button" size="sm" onclick={closeAppError}>OK</Button>
      </div>
    </div>
  </div>
{/if}

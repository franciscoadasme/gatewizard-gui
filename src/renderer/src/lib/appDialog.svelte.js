/** Shared app dialogs (errors, etc.) — replaces oversized native alert() on Mac. */

/** @type {{ open: boolean, title: string, message: string, copied: boolean }} */
export const appErrorDialog = $state({
  open: false,
  title: 'Error',
  message: '',
  copied: false
})

/**
 * Show a scrollable, copyable error dialog (preferred over window.alert for long text).
 * @param {string} message
 * @param {string} [title]
 */
export function showAppError(message, title = 'Error') {
  appErrorDialog.title = title
  appErrorDialog.message = String(message ?? '')
  appErrorDialog.copied = false
  appErrorDialog.open = true
}

export function closeAppError() {
  appErrorDialog.open = false
  appErrorDialog.copied = false
}

/**
 * Install a window.alert override that routes to {@link showAppError}.
 * Call once from App.svelte onMount. Returns a restore function.
 */
export function installAppAlertOverride() {
  const previous = window.alert.bind(window)
  window.alert = (message) => {
    // Route all alerts through the scrollable/copyable dialog (native alert is
    // unusable on Mac for long tracebacks — dialog taller than the window).
    showAppError(message == null ? '' : String(message), 'Alert')
  }
  return () => {
    window.alert = previous
  }
}

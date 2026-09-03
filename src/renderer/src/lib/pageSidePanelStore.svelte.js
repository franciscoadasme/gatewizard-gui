/**
 * Activity-bar re-click on the current stage toggles that page’s side panel.
 */
export const pageSidePanelStore = $state({
  /** Page / storage key to toggle (e.g. preparation, visualize). */
  pageId: '',
  /** Monotonic token; listeners react when this changes for their pageId. */
  toggleToken: 0
})

/** @param {string} pageId */
export function requestSidePanelToggle(pageId) {
  const id = String(pageId || '').trim()
  if (!id) return
  pageSidePanelStore.pageId = id
  pageSidePanelStore.toggleToken += 1
}

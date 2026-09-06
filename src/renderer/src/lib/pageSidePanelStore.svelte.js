/**
 * Activity-bar re-click on the current stage toggles that page’s side panel.
 * Visualize can also request an expand after a structure loads.
 */
export const pageSidePanelStore = $state({
  /** Page / storage key to toggle (e.g. preparation, visualize). */
  pageId: '',
  /** Monotonic token; listeners react when this changes for their pageId. */
  toggleToken: 0,
  /** Monotonic expand-only token (does not collapse). */
  expandToken: 0
})

/** @param {string} pageId */
export function requestSidePanelToggle(pageId) {
  const id = String(pageId || '').trim()
  if (!id) return
  pageSidePanelStore.pageId = id
  pageSidePanelStore.toggleToken += 1
}

/** Expand the side panel for *pageId* if it is currently collapsed. */
/** @param {string} pageId */
export function requestSidePanelExpand(pageId) {
  const id = String(pageId || '').trim()
  if (!id) return
  pageSidePanelStore.pageId = id
  pageSidePanelStore.expandToken += 1
}

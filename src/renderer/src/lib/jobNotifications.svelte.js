/**
 * Job-finish notifications.
 * Show an in-app banner when the window is unfocused/minimized, or when the user
 * is on a different app tab than the one that produced the event.
 * OS system notifications are only attempted when the window is away (unreliable on WSL).
 * Clicking a toast (or OS notification) navigates to the source tab.
 */

import { appSettings } from './appSettings.svelte.js'

/**
 * @typedef {{ id: string, title: string, body: string, createdAt: number, sourcePage: string }} JobToast
 * @typedef {'visualize'|'preparation'|'builder'|'equilibration'|'analysis'} AppPageId
 */

/** @type {{ items: JobToast[] }} */
export const jobToastState = $state({
  items: []
})

/** Updated by App.svelte when the active sidebar tab changes. */
export const notificationNav = $state({
  /** @type {string} */
  currentPageId: ''
})

/**
 * @param {{ title: string, body: string, sourcePage?: string }} payload
 */
export function pushJobToast(payload) {
  const title = typeof payload.title === 'string' ? payload.title : 'GateWizard'
  const body = typeof payload.body === 'string' ? payload.body : ''
  const sourcePage = typeof payload.sourcePage === 'string' ? payload.sourcePage : ''
  jobToastState.items = [
    ...jobToastState.items,
    { id: crypto.randomUUID(), title, body, createdAt: Date.now(), sourcePage }
  ]
}

/** @param {string} id */
export function dismissJobToast(id) {
  jobToastState.items = jobToastState.items.filter((t) => t.id !== id)
}

/**
 * @param {{
 *   id: string,
 *   title: string,
 *   body: string,
 *   sourcePage?: AppPageId | string
 * }} payload
 */
export async function notifyJobFinishedIfUnfocused(payload) {
  if (!appSettings.jobNotificationsEnabled) return

  let windowFocused = true
  try {
    windowFocused = (await window.api?.isWindowFocused?.()) ?? document.hasFocus()
  } catch {
    windowFocused = document.hasFocus()
  }

  const sourcePage = payload.sourcePage ?? ''
  const onOtherTab =
    Boolean(sourcePage) &&
    Boolean(notificationNav.currentPageId) &&
    sourcePage !== notificationNav.currentPageId

  const windowAway = !windowFocused
  if (!windowAway && !onOtherTab) return

  pushJobToast({ title: payload.title, body: payload.body, sourcePage })

  // System tray/OS toast only when the whole window is away
  if (!windowAway) return

  try {
    await window.api?.showJobNotification?.({
      title: payload.title,
      body: payload.body,
      taskId: payload.id,
      sourcePage
    })
  } catch {
    /* ignore — in-app toast already shown */
  }
}

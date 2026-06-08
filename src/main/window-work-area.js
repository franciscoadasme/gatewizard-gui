import { screen } from 'electron'

const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480

/**
 * @param {import('electron').BrowserWindow} win
 * @returns {Electron.Display}
 */
function getDisplayForWindow(win) {
  const bounds = win.getBounds()
  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  })
}

/**
 * Compute bounds that fill the monitor work area without covering the taskbar.
 * Frameless windows on Windows must respect the taskbar work area when maximized.
 *
 * @param {import('electron').BrowserWindow} win
 * @returns {Electron.Rectangle}
 */
export function getWorkAreaMaximizeBounds(win) {
  const display = getDisplayForWindow(win)
  const { bounds, workArea, scaleFactor } = display
  const sf = scaleFactor || 1

  let x = workArea.x
  let y = workArea.y
  let width = workArea.width
  let height = workArea.height

  // When the OS reports a work area that still reaches the monitor edge, reserve
  // space for the taskbar (common on Windows 11 with frameless windows).
  const gapBottom = bounds.y + bounds.height - (workArea.y + workArea.height)
  const gapTop = workArea.y - bounds.y
  const taskbarReserve = Math.round(48 * sf)

  if (gapBottom < Math.round(4 * sf)) {
    if (gapTop > Math.round(4 * sf)) {
      // Taskbar likely at the top.
      y += taskbarReserve
      height = Math.max(MIN_WINDOW_HEIGHT, height - taskbarReserve)
    } else {
      // Taskbar likely at the bottom (default on Windows).
      height = Math.max(MIN_WINDOW_HEIGHT, height - taskbarReserve)
    }
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(height))
  }
}

/**
 * @param {import('electron').BrowserWindow} win
 */
export function applyWorkAreaMaximize(win) {
  const bounds = getWorkAreaMaximizeBounds(win)
  win.setMaximumSize(bounds.width, bounds.height)
  win.setBounds(bounds)
}

/**
 * @param {import('electron').BrowserWindow} win
 */
export function clearWorkAreaMaximizeLimits(win) {
  win.setMaximumSize(0, 0)
}

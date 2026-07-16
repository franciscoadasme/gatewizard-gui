import { accessSync, readFileSync } from 'fs'
import { screen } from 'electron'

const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480

/**
 * Detect WSL/WSLg. Desktop/.deb launches often lack WSL_* env vars that a
 * terminal `npm run` `dev` session has, so also check kernel identity files.
 * @returns {boolean}
 */
function isRunningUnderWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    if (readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')) return true
  } catch {
    /* ignore */
  }
  try {
    // Present on WSL2 even when env vars are stripped by a .desktop launcher.
    accessSync('/proc/sys/fs/binfmt_misc/WSLInterop')
    return true
  } catch {
    return false
  }
}

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
 *
 * - Native Linux (Pop/Ubuntu): trust Electron workArea (already excludes panel/dock).
 * - win32: if workArea looks full-bleed, reserve space for the taskbar.
 * - WSL/WSLg: always keep the host Windows taskbar visible. `npm run` `dev` from a
 *   WSL shell inherits WSL_* env vars; installed .deb launches often do not — so
 *   we must not depend on env alone, and we force a bottom margin from the monitor.
 *
 * @param {import('electron').BrowserWindow} win
 * @returns {Electron.Rectangle}
 */
export function getWorkAreaMaximizeBounds(win) {
  const display = getDisplayForWindow(win)
  const { bounds, workArea, scaleFactor } = display
  const sf = scaleFactor || 1
  const nearZero = (gap) => gap < Math.round(4 * sf)
  const taskbarReserve = Math.round(48 * sf)

  let x = workArea.x
  let y = workArea.y
  let width = workArea.width
  let height = workArea.height

  const gapBottom = bounds.y + bounds.height - (workArea.y + workArea.height)
  const gapTop = workArea.y - bounds.y
  const gapLeft = workArea.x - bounds.x
  const gapRight = bounds.x + bounds.width - (workArea.x + workArea.width)
  const fullBleed =
    nearZero(gapBottom) && nearZero(gapTop) && nearZero(gapLeft) && nearZero(gapRight)

  const underWsl = process.platform === 'linux' && isRunningUnderWsl()

  if (underWsl) {
    // Keep the Windows host taskbar clear even when workArea already claims an
    // inset (WSLg maximize can still paint over the host bar).
    const maxBottom = bounds.y + bounds.height - taskbarReserve
    const workBottom = y + height
    if (workBottom > maxBottom) {
      height = Math.max(MIN_WINDOW_HEIGHT, height - (workBottom - maxBottom))
    }
  } else if (process.platform === 'win32' || fullBleed) {
    // Windows frameless, or any full-bleed workArea report: reserve taskbar strip.
    if (nearZero(gapBottom)) {
      if (!nearZero(gapTop)) {
        y += taskbarReserve
        height = Math.max(MIN_WINDOW_HEIGHT, height - taskbarReserve)
      } else {
        height = Math.max(MIN_WINDOW_HEIGHT, height - taskbarReserve)
      }
    }
  }
  // else: native Linux with a proper workArea inset — leave as-is (Pop/Ubuntu).

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
  // Bounds first — some Linux/WSLg builds ignore size if MaxSize is set earlier.
  win.setBounds(bounds)
  win.setMaximumSize(bounds.width, bounds.height)
}

/**
 * @param {import('electron').BrowserWindow} win
 */
export function clearWorkAreaMaximizeLimits(win) {
  win.setMaximumSize(0, 0)
}

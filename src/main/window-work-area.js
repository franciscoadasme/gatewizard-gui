import { accessSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { screen } from 'electron'

const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480

/**
 * Detect WSL/WSLg. Desktop/.deb launches often lack WSL_* env vars that a
 * terminal `npm run` `dev` session has, so also check kernel identity files.
 * @returns {boolean}
 */
export function isRunningUnderWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    if (readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')) return true
  } catch {
    /* ignore */
  }
  try {
    accessSync('/proc/sys/fs/binfmt_misc/WSLInterop')
    return true
  } catch {
    return false
  }
}

/**
 * Under WSLg, Electron defaults to Wayland which ignores BrowserWindow x/y.
 * Force X11 (XWayland) so placement works. Call before app.ready.
 * Prefer setting ELECTRON_OZONE_PLATFORM_HINT=x11 before the Electron process starts
 * (see scripts/electron-vite-wsl.mjs). Override with GATEWIZARD_OZONE_PLATFORM.
 * @param {import('electron').App} electronApp
 */
export function applyWslDisplayPlatformSwitches(electronApp) {
  if (process.platform !== 'linux' || !isRunningUnderWsl()) return
  const forced = (process.env.GATEWIZARD_OZONE_PLATFORM || '').trim().toLowerCase()
  if (forced) {
    electronApp.commandLine.appendSwitch('ozone-platform', forced)
    return
  }
  if (!process.env.ELECTRON_OZONE_PLATFORM_HINT) {
    process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  }
  electronApp.commandLine.appendSwitch('ozone-platform', 'x11')
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number, workX: number, workY: number, workWidth: number, workHeight: number, primary: boolean }} WinMonitor
 * @typedef {{ monitors: WinMonitor[], anchorX: number, anchorY: number, originX: number, originY: number }} WinLayout
 */

/** @type {WinLayout | null | undefined} */
let cachedWinLayout = undefined

/**
 * Read Windows monitor layout + launch anchor (foreground window, else cursor).
 * WSLg exposes one wide X11 screen (e.g. 3840×1080); Windows still has per-monitor
 * rects — we need those to place on the console's monitor, not the virtual midpoint.
 * @returns {WinLayout | null}
 */
function probeWindowsLayout() {
  const psClean = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GwLaunchAnchor {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$h = [GwLaunchAnchor]::GetForegroundWindow()
$r = New-Object GwLaunchAnchor+RECT
[void][GwLaunchAnchor]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
if ($w -gt 120 -and $hgt -gt 80) {
  $ax = [int](($r.Left + $r.Right) / 2)
  $ay = [int](($r.Top + $r.Bottom) / 2)
} else {
  $p = [System.Windows.Forms.Cursor]::Position
  $ax = $p.X
  $ay = $p.Y
}
# Prefer cursor when it sits on a different monitor than the foreground window
# (common when the IDE is on the primary and the user works on the secondary).
$cursor = [System.Windows.Forms.Cursor]::Position
$fgScreen = [System.Windows.Forms.Screen]::FromPoint((New-Object System.Drawing.Point $ax, $ay))
$curScreen = [System.Windows.Forms.Screen]::FromPoint($cursor)
if ($curScreen.DeviceName -ne $fgScreen.DeviceName) {
  $ax = $cursor.X
  $ay = $cursor.Y
}
Write-Output ("ANCHOR={0},{1}" -f $ax, $ay)
$i = 0
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  $b = $s.Bounds
  $wa = $s.WorkingArea
  $prim = if ($s.Primary) { 1 } else { 0 }
  Write-Output ("MON={0},{1},{2},{3},{4},{5},{6},{7},{8},{9}" -f $i, $b.X, $b.Y, $b.Width, $b.Height, $wa.X, $wa.Y, $wa.Width, $wa.Height, $prim)
  $i++
}
`.trim()

  try {
    const encoded = Buffer.from(psClean, 'utf16le').toString('base64')
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    const text = String(out)
    const anchorMatch = text.match(/ANCHOR=(-?\d+),(-?\d+)/)
    if (!anchorMatch) return null
    const anchorX = Number(anchorMatch[1])
    const anchorY = Number(anchorMatch[2])
    /** @type {WinMonitor[]} */
    const monitors = []
    for (const m of text.matchAll(
      /MON=(\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),([01])/g
    )) {
      monitors.push({
        x: Number(m[2]),
        y: Number(m[3]),
        width: Number(m[4]),
        height: Number(m[5]),
        workX: Number(m[6]),
        workY: Number(m[7]),
        workWidth: Number(m[8]),
        workHeight: Number(m[9]),
        primary: m[10] === '1'
      })
    }
    if (monitors.length === 0) return null
    const originX = Math.min(...monitors.map((mon) => mon.x))
    const originY = Math.min(...monitors.map((mon) => mon.y))
    return { monitors, anchorX, anchorY, originX, originY }
  } catch {
    return null
  }
}

/**
 * Capture Windows monitor layout before Electron steals focus.
 */
export function captureLaunchAnchorEarly() {
  if (cachedWinLayout !== undefined) return
  if (process.platform === 'linux' && isRunningUnderWsl()) {
    cachedWinLayout = probeWindowsLayout()
    if (cachedWinLayout) {
      process.stderr.write(
        `[display] wsl layout monitors=${cachedWinLayout.monitors.length} ` +
          `origin=(${cachedWinLayout.originX},${cachedWinLayout.originY}) ` +
          `anchor=(${cachedWinLayout.anchorX},${cachedWinLayout.anchorY})\n`
      )
    } else {
      process.stderr.write('[display] wsl layout probe failed\n')
    }
  }
}

/**
 * @param {WinLayout} layout
 * @param {number} ax
 * @param {number} ay
 * @returns {WinMonitor}
 */
function monitorFromPoint(layout, ax, ay) {
  const hit = layout.monitors.find(
    (m) => ax >= m.x && ax < m.x + m.width && ay >= m.y && ay < m.y + m.height
  )
  return hit || layout.monitors.find((m) => m.primary) || layout.monitors[0]
}

/**
 * Center width×height on the Windows monitor under the launch anchor, converted
 * into the WSLg X11 virtual-screen coordinate space.
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function boundsFromWindowsLayout(width, height) {
  if (cachedWinLayout === undefined && process.platform === 'linux' && isRunningUnderWsl()) {
    cachedWinLayout = probeWindowsLayout()
  }
  const layout = cachedWinLayout
  if (!layout) return null

  const mon = monitorFromPoint(layout, layout.anchorX, layout.anchorY)
  const winX = Math.round(mon.workX + (mon.workWidth - width) / 2)
  const winY = Math.round(mon.workY + (mon.workHeight - height) / 2)
  // WSLg X11 origin = top-left of the bounding box of all Windows monitors.
  const x = winX - layout.originX
  const y = winY - layout.originY
  process.stderr.write(
    `[display] place ${width}x${height} on Windows (${winX},${winY}) → X11 (${x},${y}) ` +
      `monitor=${mon.primary ? 'primary' : 'secondary'} ` +
      `work=${mon.workX},${mon.workY} ${mon.workWidth}x${mon.workHeight}\n`
  )
  return { x, y, width, height }
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
 * @returns {Electron.Display}
 */
export function getPreferredLaunchDisplay() {
  try {
    const layout = cachedWinLayout
    if (layout) {
      const mon = monitorFromPoint(layout, layout.anchorX, layout.anchorY)
      const x11x = mon.workX + mon.workWidth / 2 - layout.originX
      const x11y = mon.workY + mon.workHeight / 2 - layout.originY
      return screen.getDisplayNearestPoint({
        x: Math.round(x11x),
        y: Math.round(x11y)
      })
    }
    const point = screen.getCursorScreenPoint()
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return screen.getDisplayNearestPoint(point)
    }
  } catch {
    /* ignore */
  }
  return screen.getPrimaryDisplay()
}

/**
 * Center a width×height window for launch (WSL-aware).
 * @param {number} width
 * @param {number} height
 * @param {Electron.Display} [display] ignored on WSL when Windows layout is known
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function centerWindowOnDisplay(width, height, display) {
  if (process.platform === 'linux' && isRunningUnderWsl()) {
    const wslBounds = boundsFromWindowsLayout(width, height)
    if (wslBounds) return wslBounds
  }

  const target = display || getPreferredLaunchDisplay()
  const area = target.workArea
  // When Electron reports one wide virtual display (WSLg), prefer centering on
  // the half that contains the cursor / left-right split if we lack Windows data.
  if (area.width >= 3000 && screen.getAllDisplays().length === 1) {
    try {
      const cursor = screen.getCursorScreenPoint()
      const half = Math.floor(area.width / 2)
      const onRight = cursor.x >= area.x + half
      const sectorX = area.x + (onRight ? half : 0)
      return {
        x: Math.round(sectorX + (half - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width,
        height
      }
    } catch {
      /* fall through */
    }
  }

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  }
}

/**
 * @param {import('electron').BrowserWindow} win
 * @returns {Electron.Rectangle}
 */
export function getWorkAreaMaximizeBounds(win) {
  // On WSL with a combined virtual screen, maximize to the Windows monitor
  // that currently contains the window center (not the full 3840-wide span).
  if (process.platform === 'linux' && isRunningUnderWsl()) {
    if (cachedWinLayout === undefined) cachedWinLayout = probeWindowsLayout()
    const layout = cachedWinLayout
    if (layout) {
      const b = win.getBounds()
      const cx = b.x + b.width / 2 + layout.originX
      const cy = b.y + b.height / 2 + layout.originY
      const mon = monitorFromPoint(layout, cx, cy)
      const taskbarReserve = 48
      let workH = mon.workHeight
      let workY = mon.workY
      if (mon.workHeight >= mon.height - 4) {
        workH = Math.max(MIN_WINDOW_HEIGHT, mon.height - taskbarReserve)
      }
      return {
        x: Math.round(mon.workX - layout.originX),
        y: Math.round(workY - layout.originY),
        width: Math.max(MIN_WINDOW_WIDTH, Math.round(mon.workWidth)),
        height: Math.max(MIN_WINDOW_HEIGHT, Math.round(workH))
      }
    }
  }

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
    const maxBottom = bounds.y + bounds.height - taskbarReserve
    const workBottom = y + height
    if (workBottom > maxBottom) {
      height = Math.max(MIN_WINDOW_HEIGHT, height - (workBottom - maxBottom))
    }
  } else if (process.platform === 'win32' || fullBleed) {
    if (nearZero(gapBottom)) {
      if (!nearZero(gapTop)) {
        y += taskbarReserve
        height = Math.max(MIN_WINDOW_HEIGHT, height - taskbarReserve)
      } else {
        height = Math.max(MIN_WINDOW_HEIGHT, height - taskbarReserve)
      }
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
  win.setBounds(bounds)
  win.setMaximumSize(bounds.width, bounds.height)
}

/**
 * @param {import('electron').BrowserWindow} win
 */
export function clearWorkAreaMaximizeLimits(win) {
  win.setMaximumSize(0, 0)
}

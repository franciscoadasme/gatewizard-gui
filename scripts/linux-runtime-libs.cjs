'use strict'

/**
 * Electron/Chromium always links these sonames. Fresh Ubuntu (esp. 24.04+ t64
 * and minimal 26.04) often lacks ALSA even though the GUI never plays audio.
 *
 * @typedef {{
 *   aptPrimary: string,
 *   aptFallback?: string,
 *   dnf: string
 * }} LinuxLibHint
 */

/** @type {Record<string, LinuxLibHint>} */
const SONAME_HINTS = {
  'libasound.so.2': {
    aptPrimary: 'libasound2t64',
    aptFallback: 'libasound2',
    dnf: 'alsa-lib'
  },
  'libnss3.so': { aptPrimary: 'libnss3', dnf: 'nss' },
  'libnssutil3.so': { aptPrimary: 'libnss3', dnf: 'nss' },
  'libgtk-3.so.0': {
    aptPrimary: 'libgtk-3-0t64',
    aptFallback: 'libgtk-3-0',
    dnf: 'gtk3'
  },
  'libgbm.so.1': { aptPrimary: 'libgbm1', dnf: 'mesa-libgbm' },
  'libdrm.so.2': { aptPrimary: 'libdrm2', dnf: 'libdrm' },
  'libatk-1.0.so.0': { aptPrimary: 'libatk1.0-0', dnf: 'atk' },
  'libXss.so.1': { aptPrimary: 'libxss1', dnf: 'libXScrnSaver' },
  'libsecret-1.so.0': { aptPrimary: 'libsecret-1-0', dnf: 'libsecret' },
  'libatspi.so.0': {
    aptPrimary: 'libatspi2.0-0t64',
    aptFallback: 'libatspi2.0-0',
    dnf: 'at-spi2-core'
  }
}

/**
 * Parse `ldd` stdout for unresolved sonames.
 * @param {string} lddOutput
 * @returns {string[]}
 */
function parseLddMissing(lddOutput) {
  const missing = []
  for (const line of String(lddOutput || '').split(/\r?\n/)) {
    if (!/not found/.test(line)) continue
    const name = line.trim().split(/\s+/)[0]
    if (name) missing.push(name)
  }
  return [...new Set(missing)]
}

/**
 * @param {string} soname
 * @returns {string}
 */
function aptInstallLine(soname) {
  const hint = SONAME_HINTS[soname]
  if (!hint) return ''
  if (hint.aptFallback) {
    return `sudo apt install ${hint.aptPrimary} || sudo apt install ${hint.aptFallback}`
  }
  return `sudo apt install ${hint.aptPrimary}`
}

/**
 * @param {string} soname
 * @returns {string}
 */
function dnfInstallPkg(soname) {
  return SONAME_HINTS[soname]?.dnf || ''
}

/**
 * Human-readable install instructions for a list of missing sonames.
 * @param {string[]} sonames
 * @returns {string}
 */
function formatMissingLibsHelp(sonames) {
  const libs = [...new Set((sonames || []).map((s) => String(s || '').trim()).filter(Boolean))]
  if (libs.length === 0) return ''

  const aptLines = []
  const dnfPkgs = []
  const unknown = []
  for (const lib of libs) {
    const apt = aptInstallLine(lib)
    const dnf = dnfInstallPkg(lib)
    if (apt) aptLines.push(apt)
    else unknown.push(lib)
    if (dnf && !dnfPkgs.includes(dnf)) dnfPkgs.push(dnf)
  }

  const lines = [
    'GateWizard cannot start. Electron needs these system libraries',
    '(Chromium links them even if the app does not play sound):',
    '',
    ...libs.map((lib) => `  ${lib}`),
    '',
    'Debian / Ubuntu / WSL:',
    '  sudo apt update',
    ...aptLines.map((cmd) => `  ${cmd}`)
  ]
  if (unknown.length) {
    lines.push('  # for any other .so:  apt-file search <soname>')
  }
  lines.push('', 'Fedora:', `  sudo dnf install ${dnfPkgs.length ? dnfPkgs.join(' ') : 'alsa-lib'}`, '', 'Then run GateWizard again.')
  return lines.join('\n')
}

/**
 * POSIX sh wrapper. `realBinName` is the renamed Electron ELF next to this script.
 * @param {string} realBinName
 * @returns {string}
 */
/**
 * Run `ldd` on an Electron ELF and return unresolved sonames.
 * No-op on non-Linux unless `lddFn` is injected (tests).
 * @param {string} binPath
 * @param {(binPath: string) => string} [lddFn]
 * @returns {string[]}
 */
function missingLibsForBinary(binPath, lddFn) {
  if (process.platform !== 'linux' && typeof lddFn !== 'function') return []
  const fs = require('fs')
  if (!binPath || !fs.existsSync(binPath)) return []
  let text = ''
  if (typeof lddFn === 'function') {
    text = lddFn(binPath)
  } else {
    const { spawnSync } = require('child_process')
    const out = spawnSync('ldd', [binPath], { encoding: 'utf8' })
    text = `${out.stdout || ''}\n${out.stderr || ''}`
  }
  return parseLddMissing(text)
}

/**
 * Print apt/dnf install commands and exit if the Electron binary cannot load.
 * Used by `npm run dev` (ensure-electron / electron-vite-wsl) and the packaged wrapper.
 * @param {string} binPath
 * @returns {void}
 */
function assertLinuxElectronLibs(binPath) {
  const missing = missingLibsForBinary(binPath)
  if (!missing.length) return
  process.stderr.write(`\n${formatMissingLibsHelp(missing)}\n\n`)
  process.exit(1)
}

function buildWrapperScript(realBinName) {
  const { buildDisplayGpuShell } = require('./display-gpu-policy.cjs')
  const { buildGpuCacheShell } = require('./gpu-cache.cjs')
  const { buildDbusEnsureShell } = require('./session-dbus.cjs')
  const bin = String(realBinName || '').replace(/[^A-Za-z0-9._+-]/g, '')
  if (!bin) throw new Error('realBinName is required')

  const caseArms = Object.keys(SONAME_HINTS)
    .map((so) => {
      const apt = aptInstallLine(so).replace(/"/g, '\\"')
      const dnf = dnfInstallPkg(so).replace(/"/g, '\\"')
      return `    ${so}) apt_line="${apt}"; dnf_line="${dnf}" ;;`
    })
    .join('\n')

  return `#!/bin/sh
# Generated by scripts/linux-runtime-libs.cjs — do not edit in dist/.
# Checks Electron's linked .so files before exec so a missing ALSA/GTK
# library prints install commands instead of a raw loader error.
set -eu

resolve_dir() {
  p=$0
  if command -v readlink >/dev/null 2>&1; then
    resolved=\`readlink -f "$p" 2>/dev/null || true\`
    if [ -n "$resolved" ]; then
      p=$resolved
    fi
  fi
  CDPATH= cd -- "\`dirname -- "$p"\`" && pwd
}

here=\`resolve_dir\`
bin="$here/${bin}"

if [ ! -x "$bin" ]; then
  echo "GateWizard: missing Electron binary: $bin" >&2
  exit 1
fi

missing=""
if command -v ldd >/dev/null 2>&1; then
  missing=\`ldd "$bin" 2>/dev/null | awk '/not found/{print $1}' | sort -u || true\`
fi

if [ -n "$missing" ]; then
  echo "GateWizard cannot start. Electron needs these system libraries" >&2
  echo "(Chromium links them even if the app does not play sound):" >&2
  echo >&2
  apt_cmds=""
  dnf_pkgs=""
  for lib in $missing; do
    echo "  $lib" >&2
    apt_line=""
    dnf_line=""
    case $lib in
${caseArms}
    esac
    if [ -n "$apt_line" ]; then
      apt_cmds="$apt_cmds
  $apt_line"
    fi
    if [ -n "$dnf_line" ]; then
      case " $dnf_pkgs " in
        *" $dnf_line "*) ;;
        *) dnf_pkgs="$dnf_pkgs $dnf_line" ;;
      esac
    fi
  done
  echo >&2
  echo "Debian / Ubuntu / WSL:" >&2
  echo "  sudo apt update" >&2
  if [ -n "$apt_cmds" ]; then
    printf "%s\\n" "$apt_cmds" >&2
  else
    echo "  # apt-file search <soname>" >&2
  fi
  echo >&2
  echo "Fedora:" >&2
  echo "  sudo dnf install\${dnf_pkgs:- alsa-lib}" >&2
  echo >&2
  echo "Then run GateWizard again." >&2

  dialog_text="GateWizard cannot start: missing system libraries.
$missing

Debian / Ubuntu / WSL:
  sudo apt update
  sudo apt install libasound2t64 || sudo apt install libasound2

See the terminal for the full list."
  if [ -n "\${DISPLAY-}\${WAYLAND_DISPLAY-}" ]; then
    if command -v zenity >/dev/null 2>&1; then
      zenity --error --title="GateWizard" --width=480 --text="$dialog_text" 2>/dev/null || true
    elif command -v kdialog >/dev/null 2>&1; then
      kdialog --error "$dialog_text" 2>/dev/null || true
    elif command -v notify-send >/dev/null 2>&1; then
      notify-send "GateWizard" "Missing system libraries (e.g. libasound.so.2). See the terminal for apt/dnf install commands." 2>/dev/null || true
    fi
  fi
  exit 1
fi
${buildDbusEnsureShell()}${buildDisplayGpuShell()}${buildGpuCacheShell()}
# Detach stdin so Chromium does not stop the shell job (SIGTSTP) when launched from a terminal.
exec "$bin" "$@" </dev/null
`
}

module.exports = {
  SONAME_HINTS,
  parseLddMissing,
  aptInstallLine,
  formatMissingLibsHelp,
  missingLibsForBinary,
  assertLinuxElectronLibs,
  buildWrapperScript
}

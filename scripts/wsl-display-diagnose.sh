#!/bin/sh
# Inspect a full WSLg display. Does not start GateWizard and does not change packages.
# Writes ~/gatewizard-diagnose.txt
case "$0" in
  *gatewizard-gui*)
    cp "$0" /tmp/gw-display-diagnose.sh
    exec /bin/sh /tmp/gw-display-diagnose.sh
    ;;
esac

out="${HOME:-/tmp}/gatewizard-diagnose.txt"
: >"$out"

note() {
  printf '%s\n' "$1" >>"$out"
}

note "=== GateWizard display diagnose $(date -Is 2>/dev/null || date) ==="
note "This file does not start the app."
note ""
note "=== what this means ==="
note "Maximum number of clients reached means Windows WSLg refused another window."
note "That display is shared by every Ubuntu distro. Installing 24.04 or 26.04 does not empty it."
note "The text Too many open files (24) is Linux error number 24. It is not a count of 24 files."
note "If a GateWizard splash is already visible, leave it. Starting the app again only adds windows."
note "From Windows PowerShell, run: wsl.exe --shutdown"
note "Then open one Ubuntu and run gatewizard-gui-linux once."
note ""
note "=== system ==="
uname -a >>"$out" 2>&1 || true
cat /etc/os-release >>"$out" 2>&1 || true
note "WSL_DISTRO_NAME=${WSL_DISTRO_NAME:-}"
note "DISPLAY=${DISPLAY:-}"
note "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}"
note "GALLIUM_DRIVER=${GALLIUM_DRIVER:-}"
if [ -r /proc/version ]; then
  note "--- /proc/version ---"
  cat /proc/version >>"$out"
fi
note ""
note "=== file limits (soft nofile is the open-file cap for this shell) ==="
ulimit -Sn >>"$out" 2>&1 || true
ulimit -Hn >>"$out" 2>&1 || true
if [ -r /proc/self/limits ]; then
  cat /proc/self/limits >>"$out"
fi
note "inotify max_user_instances=$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || echo missing)"
note "inotify max_user_watches=$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo missing)"
note ""
note "=== GateWizard and micromamba processes ==="
ps -ww -eo pid,ppid,stat,args | grep -E 'gatewizard|micromamba' | grep -v grep >>"$out" || note "(none)"
note ""
note "=== install lock ==="
lock="${XDG_CONFIG_HOME:-$HOME/.config}/gatewizard-gui/runtime-install.lock"
if [ -f "$lock" ]; then
  note "lock file: $lock"
  cat "$lock" >>"$out" 2>&1 || true
else
  note "no install lock at $lock"
fi
note ""
note "=== X11 / Wayland sockets held by processes in this distro ==="
count=0
for fd in /proc/[0-9]*/fd/*; do
  target=$(readlink "$fd" 2>/dev/null) || continue
  case "$target" in
    *X11*|*wayland*|*WSL*|*wslg*)
      pid=${fd#/proc/}
      pid=${pid%%/*}
      comm=$(cat "/proc/$pid/comm" 2>/dev/null || echo '?')
      note "pid=$pid comm=$comm fd=$target"
      count=$((count + 1))
      ;;
  esac
done
note "socket fds counted: $count"
note ""
note "=== xlsclients (fails when the display is already full) ==="
if command -v xlsclients >/dev/null 2>&1; then
  xlsclients -a >>"$out" 2>&1 || note "xlsclients failed"
else
  note "xlsclients is not installed"
fi
note ""
note "=== font cache (a separate warning, not the full display) ==="
for d in /var/cache/fontconfig "$HOME/.cache/fontconfig" "$HOME/.fontconfig"; do
  if [ -d "$d" ]; then
    ls -ld "$d" >>"$out" 2>&1 || true
  else
    note "missing $d"
  fi
done
note "=== end ==="
printf 'Wrote %s\n' "$out"

#!/bin/sh
# .deb preinst. Also inlined into the Linux launcher by scripts/linux-runtime-libs.cjs.
# Abort only on WSL + Ubuntu older than 24.04. Native Ubuntu 22.04 stays allowed.
set -eu

# True when $1 is a numeric release older than $2 (for example 22.04 vs 24.04).
ubuntu_release_before() {
  rel=$1
  min=$2
  case $rel in
    ''|*[!0-9.]*) return 1 ;;
  esac
  case $min in
    ''|*[!0-9.]*) return 1 ;;
  esac
  rel_maj=${rel%%.*}
  rel_rest=${rel#*.}
  if [ "$rel_rest" = "$rel" ]; then
    rel_min=0
  else
    rel_min=${rel_rest%%.*}
  fi
  rel_min=${rel_min#0}
  [ -n "$rel_min" ] || rel_min=0
  min_maj=${min%%.*}
  min_rest=${min#*.}
  if [ "$min_rest" = "$min" ]; then
    min_min=0
  else
    min_min=${min_rest%%.*}
  fi
  min_min=${min_min#0}
  [ -n "$min_min" ] || min_min=0
  if [ "$rel_maj" -lt "$min_maj" ]; then
    return 0
  fi
  if [ "$rel_maj" -gt "$min_maj" ]; then
    return 1
  fi
  if [ "$rel_min" -lt "$min_min" ]; then
    return 0
  fi
  return 1
}

# Exit 1 on WSL Ubuntu before 24.04. Optional env overrides are for tests:
# GATEWIZARD_PROC_VERSION, GATEWIZARD_WSL_INTEROP, GATEWIZARD_OS_RELEASE.
refuse_old_wsl_ubuntu() {
  version_file=${GATEWIZARD_PROC_VERSION:-/proc/version}
  interop_file=${GATEWIZARD_WSL_INTEROP:-/proc/sys/fs/binfmt_misc/WSLInterop}
  os_release=${GATEWIZARD_OS_RELEASE:-/etc/os-release}

  is_wsl=0
  if [ -e "$interop_file" ]; then
    is_wsl=1
  elif [ -r "$version_file" ] && grep -qi microsoft "$version_file"; then
    is_wsl=1
  fi
  if [ "$is_wsl" -eq 0 ]; then
    return 0
  fi
  if [ ! -r "$os_release" ]; then
    return 0
  fi

  id=`awk -F= '$1=="ID"{gsub(/"/,"",$2); print $2; exit}' "$os_release"`
  version_id=`awk -F= '$1=="VERSION_ID"{gsub(/"/,"",$2); print $2; exit}' "$os_release"`
  if [ "$id" != "ubuntu" ]; then
    return 0
  fi
  if ubuntu_release_before "$version_id" "24.04"; then
    echo "------------------------------------------------------------" >&2
    echo "GateWizard GUI on WSL requires Ubuntu 24.04 or newer." >&2
    echo "This distro is Ubuntu ${version_id}." >&2
    echo "Install Ubuntu 24.04 (or 26.04) from the Microsoft Store and install the .deb there." >&2
    echo "Native Linux desktops can stay on Ubuntu 22.04." >&2
    echo "------------------------------------------------------------" >&2
    exit 1
  fi
}

# One of these names counts as present. dpkg-query is absent on Fedora; skip there.
# Two installed records (two versions, or amd64 and i386) print the status twice.
# Any line that is "install ok installed" counts. "not-installed" does not.
deb_pkg_installed() {
  dpkg-query -W -f '${Status}
' "$1" 2>/dev/null | {
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        *'install ok installed'*) exit 0 ;;
      esac
    done
    exit 1
  }
}

# Exit 1 before apt downloads Electron's libraries. A stale index otherwise
# 404s (alsa-ucm-conf and similar) and GateWizard never gets to print a hint.
# GATEWIZARD_SKIP_DEB_LIBS=1 skips this in tests.
refuse_missing_deb_libraries() {
  if [ "${GATEWIZARD_SKIP_DEB_LIBS:-}" = "1" ]; then
    return 0
  fi
  command -v dpkg-query >/dev/null 2>&1 || return 0

  missing=""
  install_pkgs=""
  note_missing() {
    label=$1
    shift
    for pkg in "$@"; do
      if deb_pkg_installed "$pkg"; then
        return 0
      fi
    done
    missing="${missing}
  ${label}"
    install_pkgs="${install_pkgs} $1"
  }

  note_missing "libgtk-3-0t64 or libgtk-3-0" libgtk-3-0t64 libgtk-3-0
  note_missing "libnotify4" libnotify4
  note_missing "libnss3" libnss3
  note_missing "libxss1" libxss1
  note_missing "libxtst6" libxtst6
  note_missing "xdg-utils" xdg-utils
  note_missing "libatspi2.0-0t64 or libatspi2.0-0" libatspi2.0-0t64 libatspi2.0-0
  note_missing "libuuid1" libuuid1
  note_missing "libsecret-1-0" libsecret-1-0
  note_missing "libasound2t64 or libasound2" libasound2t64 libasound2
  note_missing "libgbm1" libgbm1
  note_missing "libdrm2" libdrm2

  compiler_missing=0
  if ! command -v cc >/dev/null 2>&1; then
    compiler_missing=1
    install_pkgs="${install_pkgs} build-essential"
  fi

  if [ -z "$missing" ] && [ "$compiler_missing" -eq 0 ]; then
    return 0
  fi

  echo "------------------------------------------------------------" >&2
  echo "GateWizard GUI cannot install yet." >&2
  if [ -n "$missing" ]; then
    echo "These system packages are not installed:" >&2
    echo "$missing" >&2
    echo >&2
    echo "Chromium needs them even though GateWizard does not play sound." >&2
  fi
  if [ "$compiler_missing" -eq 1 ]; then
    echo "A C compiler (the cc command) is not installed." >&2
    echo "The first launch compiles a Python package. Without cc that step fails after several minutes." >&2
    echo "build-essential provides the compiler." >&2
  fi
  echo "Do these steps, in order:" >&2
  echo "  1. sudo apt update" >&2
  echo "  2. sudo apt install${install_pkgs}" >&2
  echo "  3. Run the GateWizard install or gatewizard-gui-linux again." >&2
  if [ -n "$missing" ]; then
    echo >&2
    echo "If apt says a t64 package was not found, install the older name instead (libgtk-3-0, libatspi2.0-0, libasound2)." >&2
    echo "If apt says 404 Not Found or Unable to fetch some archives, the package list is stale. Step 1 fixes that. Then repeat step 2." >&2
  fi
  echo "------------------------------------------------------------" >&2
  exit 1
}

# Fedora and other non-deb systems never reach the apt list above.
refuse_missing_c_compiler() {
  if [ "${GATEWIZARD_SKIP_DEB_LIBS:-}" = "1" ]; then
    return 0
  fi
  command -v cc >/dev/null 2>&1 && return 0
  command -v dpkg-query >/dev/null 2>&1 && return 0

  echo "------------------------------------------------------------" >&2
  echo "GateWizard GUI cannot start yet. A C compiler (the cc command) is not installed." >&2
  echo "The first launch compiles a Python package. Without cc that step fails after several minutes." >&2
  if command -v dnf >/dev/null 2>&1; then
    echo "  sudo dnf install gcc gcc-c++ make" >&2
  elif command -v pacman >/dev/null 2>&1; then
    echo "  sudo pacman -S --needed base-devel" >&2
  else
    echo "Install gcc so that the cc command exists, then start GateWizard again." >&2
  fi
  echo "------------------------------------------------------------" >&2
  exit 1
}

refuse_old_wsl_ubuntu
refuse_missing_deb_libraries
refuse_missing_c_compiler

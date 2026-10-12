#!/bin/sh
# .deb postrm. apt remove keeps the Python environment. apt purge deletes it
# for the user who ran sudo. System libraries (ALSA, GTK, …) are not removed.
action=${1:-}

config_name=".config/gatewizard-gui"

sudo_user_home() {
  user=${SUDO_USER:-}
  if [ -z "$user" ] || [ "$user" = "root" ]; then
    return 1
  fi
  getent passwd "$user" 2>/dev/null | cut -d: -f6
}

config_dir() {
  if [ -n "${GATEWIZARD_PURGE_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$GATEWIZARD_PURGE_CONFIG_DIR"
    return 0
  fi
  home=`sudo_user_home || true`
  if [ -z "$home" ]; then
    return 1
  fi
  printf '%s\n' "$home/$config_name"
}

case $action in
  remove)
    dir=`config_dir || true`
    echo "------------------------------------------------------------" >&2
    echo "GateWizard GUI was removed. Its Python environment is still on disk" >&2
    echo "and can be several GB. System libraries such as ALSA and GTK were kept." >&2
    if [ -n "$dir" ]; then
      echo "  $dir" >&2
    else
      echo "  ~/.config/gatewizard-gui" >&2
    fi
    echo "Delete it with:" >&2
    echo "  sudo apt purge gatewizard-gui-linux" >&2
    echo "------------------------------------------------------------" >&2
    ;;
  purge)
    dir=`config_dir || true`
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      rm -rf "$dir"
      echo "------------------------------------------------------------" >&2
      echo "Removed the GateWizard Python environment:" >&2
      echo "  $dir" >&2
      echo "------------------------------------------------------------" >&2
    elif [ -n "$dir" ]; then
      echo "GateWizard Python environment was already absent ($dir)." >&2
    else
      echo "------------------------------------------------------------" >&2
      echo "GateWizard GUI was purged. To delete the Python environment for" >&2
      echo "your user, run: rm -rf ~/.config/gatewizard-gui" >&2
      echo "------------------------------------------------------------" >&2
    fi
    ;;
esac

exit 0

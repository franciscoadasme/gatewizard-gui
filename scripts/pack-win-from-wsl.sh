#!/usr/bin/env bash
# After `npm run build` in WSL, pack the Windows installer via native Windows Node.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIN_ROOT="$(wslpath -w "$ROOT")"

if [[ ! -f "$ROOT/out/main/index.js" ]]; then
  echo "Run npm run build first." >&2
  exit 1
fi

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WIN_ROOT\\scripts\\pack-win.ps1" "$@"

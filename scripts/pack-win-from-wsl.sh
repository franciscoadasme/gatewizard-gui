#!/usr/bin/env bash
# Deprecated wrapper — use: node scripts/pack-win-from-wsl.mjs
exec node "$(dirname "$0")/pack-win-from-wsl.mjs" "$@"

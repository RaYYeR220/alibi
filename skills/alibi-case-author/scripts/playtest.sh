#!/usr/bin/env bash
# Plays an Alibi case in the terminal against the real disclosure engine.
# usage: playtest.sh <case.json>
set -euo pipefail
case_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
[ -f "$repo/packages/canon/dist/cli.js" ] || (cd "$repo" && pnpm --filter @alibi/canon build >/dev/null)
node "$repo/packages/canon/dist/cli.js" playtest "$case_file"

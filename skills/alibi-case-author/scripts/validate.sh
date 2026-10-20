#!/usr/bin/env bash
# Checks an Alibi case: schema, fair-play proof (Z3), and fingerprint lint.
# usage: validate.sh <case.json>
set -euo pipefail
case_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
[ -f "$repo/packages/canon/dist/cli.js" ] || (cd "$repo" && pnpm --filter @alibi/canon build >/dev/null)
echo "== proof"
uv run --project "$repo/casegen" alibi-validate "$case_file"
echo "== lint"
node "$repo/packages/canon/dist/cli.js" lint "$case_file"

#!/usr/bin/env bash
# Engine conformance for the Cataclysm: DDA port:
#
# 1. Key coverage: every command the page sends is one of upstream's actions
#    with one of its default keys; every keyed action of normal play is
#    offered; every default key of every screen can be sent
#    (data/raw/keybindings.json).
# 2. Upstream drift: the parts of upstream's web build and the functions the
#    port wraps at link time are unchanged.
# 3. The runtime: the build exports the page's interface and the link-time
#    wrappers are in place.
#
# Native vs WebAssembly replay of a seeded session is not done yet: see
# games/cataclysm-dda/PORTING.md ("Verification") for why and what it needs.
#
# Needs: games/cataclysm-dda/scripts/build.sh run first.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/cataclysm-dda"
SRC="$WORK/src-$UPSTREAM_COMMIT"
OUT="$GAME_DIR/dist"

if [ ! -f "$OUT/runtime-manifest.json" ] || [ ! -d "$SRC" ]; then
  echo "error: run games/cataclysm-dda/scripts/build.sh first" >&2
  exit 1
fi

echo "== 1. Key coverage"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC"

echo "== 2. Upstream drift"
if [ -n "$RA_CANARY" ]; then
  node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC" ||
    echo "(canary: drift reported above)"
else
  node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC"
fi

echo "== 3. Runtime"
node --no-warnings "$GAME_DIR/tests/conformance/runtime-check.mjs" "$OUT"

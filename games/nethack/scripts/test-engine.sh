#!/usr/bin/env bash
# Engine checks for the NetHack port:
#
# 1. Upstream drift: the shim window port's calls and argument formats, and
#    the game structures the glue reads, are as the port expects.
# 2. Play: the built module (dist/) under Node with the port's own window
#    port: character creation, the map and status lines, a turn, the
#    inventory, saving with S, and continuing in a new run at the same place.
#
# Needs: games/nethack/scripts/build.sh run first.
# Not yet: a native-versus-WebAssembly comparison of seeded games.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
SRC="$RA_CACHE/nethack/src-$UPSTREAM_COMMIT"

if [ ! -f "$GAME_DIR/dist/nethack.wasm" ] || [ ! -d "$SRC" ]; then
  echo "error: run games/nethack/scripts/build.sh first" >&2
  exit 1
fi

echo "== 1. Upstream drift"
if [ -n "$RA_CANARY" ]; then
  node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC" ||
    echo "(canary: drift reported above)"
else
  node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC"
fi

echo "== 2. Play"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/play.ts" "$GAME_DIR/dist"

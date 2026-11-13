#!/usr/bin/env bash
# Engine conformance for the HyperRogue port:
#
# 1. Key coverage: every command the page sends is bound, in upstream's
#    control.cpp, to the action it claims.
# 2. Upstream drift: the functions of upstream's web main file (and the
#    Android app's background save) the port relies on are unchanged.
# 3. Native vs WebAssembly: tests/conformance/harness.cpp, built natively
#    (upstream's desktop configuration, no window) and as WebAssembly
#    (upstream's web build as shipped, under Node), plays the same seeded
#    games; both must print the same digest after every turn.
#
# Needs: games/hyperrogue/scripts/build.sh run first (it builds the WebAssembly
# harness); a native C++ compiler with SDL 1.2, OpenGL and zlib headers
# (Debian/Ubuntu: libsdl1.2-dev libgl-dev zlib1g-dev).
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/hyperrogue"
SRC="$WORK/src-$UPSTREAM_COMMIT"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
CXX="${CXX:-c++}"

if [ ! -f "$HARNESS/hyperrogue-node.cjs" ]; then
  echo "error: run games/hyperrogue/scripts/build.sh first (no harness at $HARNESS)" >&2
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

echo "== 3. Native build"
STAMP="$(cat "$GAME_DIR/tests/conformance/harness.cpp" <(echo "$CXX") | sha256sum | cut -c1-16)"
NATIVE="$HARNESS/hyperrogue-native-$STAMP"
if [ ! -x "$NATIVE" ]; then
  rm -f "$HARNESS"/hyperrogue-native-*
  echo "Compiling the native harness (a few minutes)..."
  (cd "$SRC" && "$CXX" -std=c++17 -O1 -w -I. "$GAME_DIR/tests/conformance/harness.cpp" -o "$NATIVE" -lSDL -lGL -lz)
fi

echo "== 4. Native vs WebAssembly"
# seed:turns. Each game is played to its end or the turn limit.
SCENARIOS=(1:400 42:400 2026:400)
failed=0
OUTDIR="$(mktemp -d)"
for scenario in "${SCENARIOS[@]}"; do
  seed="${scenario%%:*}"
  turns="${scenario##*:}"
  # Only the harness's own lines: upstream also logs start-up timings.
  (cd "$OUTDIR" && "$NATIVE" "$seed" "$turns" 2>/dev/null | grep -E '^(start|turn=)' >"native-$seed.txt")
  (cd "$OUTDIR" && node "$HARNESS/hyperrogue-node.cjs" "$seed" "$turns" 2>/dev/null | grep -E '^(start|turn=)' >"wasm-$seed.txt")
  if cmp -s "$OUTDIR/native-$seed.txt" "$OUTDIR/wasm-$seed.txt"; then
    echo "ok   seed $seed: $(($(wc -l <"$OUTDIR/native-$seed.txt") - 1)) turns identical ($(tail -1 "$OUTDIR/native-$seed.txt" | cut -d' ' -f1-5))"
  else
    echo "FAIL seed $seed: native and WebAssembly differ"
    diff "$OUTDIR/native-$seed.txt" "$OUTDIR/wasm-$seed.txt" | head -6
    failed=1
  fi
done
rm -rf "$OUTDIR"
exit "$failed"

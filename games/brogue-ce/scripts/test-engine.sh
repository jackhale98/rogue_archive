#!/usr/bin/env bash
# Engine conformance checks for the Brogue CE port. Run after scripts/build.sh.
#
# These test the shipped code without anyone playing through the game:
#  1. Key coverage: every key code upstream defines (Rogue.h) is reachable
#     through our input mapping, and every touch/palette command sends the key
#     upstream's executeKeystroke / executePlaybackInput binds to its action.
#  2. Seed catalogs: the WASM engine (same object files as the browser build,
#     linked for Node) must reproduce upstream's committed regression catalogs
#     (test/seed_catalogs) for Brogue, Rapid Brogue and Bullet Brogue exactly:
#     every item on every level of 25 seeds.
#  3. Save/recording compatibility: every file in tests/recordings is replayed
#     by both native desktop Brogue (built from the same commit) and the WASM
#     engine; their output must be identical and must reach the end of the file
#     (no out-of-sync).
set -euo pipefail
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/brogue-ce"
SRC="$WORK/src-$UPSTREAM_COMMIT"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT/brogue-node.cjs"
NATIVE_DIR="$WORK/native-$UPSTREAM_COMMIT"
[ -f "$HARNESS" ] || { echo "error: run scripts/build.sh first" >&2; exit 1; }

echo "== 1. Key coverage and upstream drift"
node --experimental-strip-types "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC"
node --experimental-strip-types "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC"

echo "== 2. Seed catalogs (WASM engine vs upstream regression catalogs)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
run_catalog() { # name, depth, extra args...
  local name=$1 depth=$2; shift 2
  node "$HARNESS" "$@" --print-seed-catalog 1 25 "$depth" > "$TMP/$name.txt" 2> /dev/null
  if diff <(sed 1,4d "$SRC/test/seed_catalogs/seed_catalog_$name.txt") <(sed 1,4d "$TMP/$name.txt") > "$TMP/$name.diff"; then
    echo "✓ $name: 25 seeds identical through depth $depth"
  else
    echo "✗ $name differs from upstream:"; head -40 "$TMP/$name.diff"; return 1
  fi
}
run_catalog brogue 40 & p1=$!
run_catalog rapid_brogue 10 --variant rapid_brogue & p2=$!
run_catalog bullet_brogue 5 --variant bullet_brogue & p3=$!
status=0
for p in $p1 $p2 $p3; do wait "$p" || status=1; done
[ "$status" = 0 ] || exit 1

echo "== 3. Saves and recordings: native desktop Brogue vs WASM engine"
if [ ! -x "$NATIVE_DIR/bin/brogue" ]; then
  rm -rf "$NATIVE_DIR" && cp -r "$SRC" "$NATIVE_DIR"
  make -C "$NATIVE_DIR" -j"$(nproc)" GRAPHICS=NO TERMINAL=NO RELEASE=YES > "$TMP/native-build.log" 2>&1 \
    || { cat "$TMP/native-build.log"; exit 1; }
fi
shopt -s nullglob
count=0
for file in "$GAME_DIR"/tests/recordings/*.broguesave "$GAME_DIR"/tests/recordings/*.broguerec; do
  count=$((count + 1))
  name="$(basename "$file")"
  mkdir -p "$TMP/native" "$TMP/wasm"
  cp "$file" "$TMP/native/replay.broguerec"
  cp "$file" "$TMP/wasm/replay.broguerec"
  rc=0; (cd "$TMP/native" && "$NATIVE_DIR/bin/brogue" -vn replay.broguerec > out.txt 2>&1) || rc=$?
  echo "exit $rc" >> "$TMP/native/out.txt"
  rc=0; (cd "$TMP/wasm" && node "$HARNESS" -vn replay.broguerec > out.txt 2>&1) || rc=$?
  echo "exit $rc" >> "$TMP/wasm/out.txt"
  size=$(wc -c < "$file")
  if ! diff -q "$TMP/native/out.txt" "$TMP/wasm/out.txt" > /dev/null; then
    echo "✗ $name: native and WASM replays differ"; diff "$TMP/native/out.txt" "$TMP/wasm/out.txt" | head; exit 1
  fi
  if grep -qi "out of sync\|OOS" "$TMP/native/out.txt"; then
    echo "✗ $name: replay went out of sync"; cat "$TMP/native/out.txt"; exit 1
  fi
  # A finished recording exits 0; an unfinished save ends with a playback panic exactly at its last byte.
  if grep -q "^exit 0$" "$TMP/native/out.txt" || grep -q "location $size!" "$TMP/native/out.txt"; then
    echo "✓ $name: identical native/WASM replay to the end ($size bytes)"
  elif [ -n "$RA_CANARY" ]; then
    # A newer upstream may not replay saves from the pinned version (Brogue only
    # promises compatibility within a minor version). Native and WASM still agreed.
    echo "! $name: native and WASM agree, but this save from the pinned version does not replay in $UPSTREAM_TAG."
    echo "  Updating the pin to it would leave players' unfinished runs unloadable; regenerate fixtures when updating."
  else
    echo "✗ $name: replay stopped early"; cat "$TMP/native/out.txt"; exit 1
  fi
done
[ "$count" -gt 0 ] || { echo "✗ no recordings in tests/recordings"; exit 1; }
echo "All engine conformance checks passed."

#!/usr/bin/env bash
# Engine conformance for the Rogue port (run after scripts/build.sh):
#
# 1. Key coverage: every touch/palette command sends a key Rogue's command
#    loop (command.c) binds to the action it claims
#    (tests/conformance/key-coverage.ts).
# 2. Native vs WebAssembly: upstream's sources built natively with the host C
#    compiler, linked with our curses (port/curses-web.c) and the C replay host
#    (tests/conformance/replay-platform.c), against the Node harness build.sh
#    links from the deployed objects. Both replay the key scripts in
#    tests/conformance/scenarios.json from the same fixed seed; every screen
#    at every key wait, and every savefile and scoreboard, must match.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/rogue"
SRC="$WORK/src-$UPSTREAM_COMMIT"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
CC="${CC:-cc}"

if [ ! -f "$HARNESS/rogue-node.cjs" ]; then
  echo "error: run games/rogue/scripts/build.sh first (no harness at $HARNESS)" >&2
  exit 1
fi

echo "== 1. Key coverage"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC"

echo "== 2. Native build"
NATIVE="$WORK/native-$UPSTREAM_COMMIT"
rm -rf "$NATIVE" && mkdir -p "$NATIVE"
upstream_make_var() {
  make --no-print-directory -C "$SRC" -f Makefile.std -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t SOURCES < <(upstream_make_var CFILES | tr ' ' '\n' | grep '\.c$')
# As the WebAssembly build, except that the scoreboard is relative to the
# run's directory (in the browser it is /rogue/rogue54.scr).
CPPFLAGS=(-I"$GAME_DIR/port" -I"$SRC" -DHAVE_CONFIG_H -DSCOREFILE='"rogue54.scr"' -DLOCKFILE='"rogue54.lck"')
objects=()
for source in "${SOURCES[@]}"; do
  objects+=("$NATIVE/${source%.c}.o")
  "$CC" "${CPPFLAGS[@]}" -O2 -w -c "$SRC/$source" -o "$NATIVE/${source%.c}.o" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
"$CC" "${CPPFLAGS[@]}" -O2 -w -c "$GAME_DIR/port/platform.c" -o "$NATIVE/platform.o" &
"$CC" "${CPPFLAGS[@]}" -O2 -w -DRA_REPLAY -c "$GAME_DIR/port/curses-web.c" -o "$NATIVE/curses-replay.o" &
"$CC" -O2 -w -c "$GAME_DIR/tests/conformance/replay-platform.c" -o "$NATIVE/replay-platform.o" &
wait
"$CC" "${objects[@]}" "$NATIVE/platform.o" "$NATIVE/curses-replay.o" "$NATIVE/replay-platform.o" -o "$NATIVE/rogue"

echo "== 3. Native vs WebAssembly replays"
node "$GAME_DIR/tests/conformance/replay.mjs" \
  --native "$NATIVE/rogue" \
  --wasm "$HARNESS/rogue-node.cjs" \
  --runs "$WORK/runs" \
  --scenarios "$GAME_DIR/tests/conformance/scenarios.json"

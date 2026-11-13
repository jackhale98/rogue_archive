#!/usr/bin/env bash
# Engine conformance for the Sil-Q port (run after scripts/build.sh):
#
# 1. Key coverage: every touch/palette command sends a key that Sil-Q's
#    original keyset binds to the action it claims
#    (tests/conformance/key-coverage.ts).
# 2. Native vs WebAssembly: the upstream sources built natively with the host
#    C compiler, linked with our display module (port/main-web.c) and the C
#    replay host (tests/conformance/replay-platform.c), against the Node
#    harness build.sh links from the deployed objects. Both replay the key
#    scripts in tests/conformance/scenarios.json from the same fixed seed;
#    every screen at every key wait, and every message, must match.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/sil-q"
SRC="$WORK/src-$UPSTREAM_COMMIT"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
CC="${CC:-cc}"

if [ ! -f "$HARNESS/sil-node.cjs" ]; then
  echo "error: run games/sil-q/scripts/build.sh first (no harness at $HARNESS)" >&2
  exit 1
fi

echo "== 1. Key coverage"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC"

echo "== 2. Native build"
NATIVE="$WORK/native-$UPSTREAM_COMMIT"
RUN="$WORK/runs"
rm -rf "$NATIVE" && mkdir -p "$NATIVE"
upstream_make_var() {
  make --no-print-directory -C "$SRC/src" -f Makefile.std -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t SOURCES < <(upstream_make_var SRCS | tr ' ' '\n' | grep '\.c$' | grep -v '^main-\|^maid-')
# Same flags as the WebAssembly build, except where the game data lives.
CPPFLAGS=(-I"$SRC/src" -DDEFAULT_PATH="\"$RUN/native/lib/\"" -DUSE_GCU -Dinit_gcu=init_web -Dhelp_gcu=help_web)
objects=()
for source in "${SOURCES[@]}"; do
  objects+=("$NATIVE/${source%.c}.o")
  "$CC" "${CPPFLAGS[@]}" -O2 -w -c "$SRC/src/$source" -o "$NATIVE/${source%.c}.o" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
"$CC" "${CPPFLAGS[@]}" -O2 -w -DRA_REPLAY -c "$GAME_DIR/port/main-web.c" -o "$NATIVE/main-web-replay.o" &
"$CC" -O2 -w -c "$GAME_DIR/tests/conformance/replay-platform.c" -o "$NATIVE/replay-platform.o" &
wait
"$CC" "${objects[@]}" "$NATIVE/main-web-replay.o" "$NATIVE/replay-platform.o" -lm -o "$NATIVE/sil"

echo "== 3. Native vs WebAssembly replays"
node "$GAME_DIR/tests/conformance/replay.mjs" \
  --native "$NATIVE/sil" \
  --wasm "$HARNESS/sil-node.cjs" \
  --lib "$HARNESS/lib" \
  --runs "$RUN" \
  --scenarios "$GAME_DIR/tests/conformance/scenarios.json"

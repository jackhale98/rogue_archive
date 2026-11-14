#!/usr/bin/env bash
# Engine conformance for the Angband port (run after scripts/build.sh):
#
# 1. Key coverage: every touch/palette command sends keys that Angband's
#    original keyset binds to the action it claims, read from upstream's
#    command tables (src/ui-game.c) and keymaps (lib/customize/pref.prf)
#    (tests/conformance/key-coverage.ts).
# 2. Native vs WebAssembly: the upstream sources built natively with the host
#    C compiler, linked with our display module (port/main-web.c) and the C
#    replay host (tests/conformance/replay-platform.c), against the Node
#    harness build.sh links from the deployed objects. Both replay the event
#    scripts in tests/conformance/scenarios.json from the same fixed seed;
#    every screen at every key wait (text, colours, tiles, state snapshot),
#    every message and every savefile written must match.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/angband"
SRC="$WORK/src-$UPSTREAM_COMMIT"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
# Clang, as Emscripten: C leaves the order in which a call's arguments are
# evaluated unspecified, and Angband draws random numbers in arguments
# (z-type.c rand_loc), so GCC and Clang builds make different dungeons from
# the same seed.
CC="${CC:-clang}"

if [ ! -f "$HARNESS/angband-node.cjs" ]; then
  echo "error: run games/angband/scripts/build.sh first (no harness at $HARNESS)" >&2
  exit 1
fi

echo "== 1. Key coverage"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC"

echo "== 2. Native build"
NATIVE="$WORK/native-$UPSTREAM_COMMIT"
RUN="$WORK/runs"
rm -rf "$NATIVE" && mkdir -p "$NATIVE"
upstream_make_var() {
  make --no-print-directory -C "$SRC/src" -f Makefile.inc -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t SOURCES < <(upstream_make_var BASEOBJS | tr ' ' '\n' | grep '\.o$' | sed 's/\.o$/.c/')
SOURCES+=(main.c)
# Same flags as the WebAssembly build, except that the data and user
# directories are relative to the run's directory (replay.mjs gives each run
# a fresh copy), where the Node harness mounts them at /angband/lib and
# /angband/user.
NATIVE_CPPFLAGS=(
  -I"$SRC/src"
  -DDEFAULT_CONFIG_PATH='"angband/lib/"'
  -DDEFAULT_LIB_PATH='"angband/lib/"'
  -DDEFAULT_DATA_PATH='"angband/lib/"'
  -DPRIVATE_USER_PATH='"angband/user"'
  -DUSE_PRIVATE_PATHS
  -DUSE_GCU -Dinit_gcu=init_web -Dhelp_gcu=help_web
)
objects=()
for source in "${SOURCES[@]}"; do
  object="$NATIVE/${source%.c}.o"
  mkdir -p "$(dirname "$object")"
  objects+=("$object")
  "$CC" "${NATIVE_CPPFLAGS[@]}" -O2 -w -std=gnu17 -c "$SRC/src/$source" -o "$object" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
"$CC" "${NATIVE_CPPFLAGS[@]}" -O2 -w -std=gnu17 -DRA_REPLAY -c "$GAME_DIR/port/main-web.c" -o "$NATIVE/main-web-replay.o" &
"$CC" -O2 -w -std=gnu17 -c "$GAME_DIR/tests/conformance/replay-platform.c" -o "$NATIVE/replay-platform.o" &
wait
"$CC" "${objects[@]}" "$NATIVE/main-web-replay.o" "$NATIVE/replay-platform.o" -lm -o "$NATIVE/angband"

echo "== 3. Native vs WebAssembly replays"
node "$GAME_DIR/tests/conformance/replay.mjs" \
  --native "$NATIVE/angband" \
  --wasm "$HARNESS/angband-node.cjs" \
  --lib "$HARNESS/lib" \
  --runs "$RUN" \
  --scenarios "$GAME_DIR/tests/conformance/scenarios.json"

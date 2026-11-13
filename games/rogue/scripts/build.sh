#!/usr/bin/env bash
# Reproducible WebAssembly build of Rogue 5.4.4 for Rogue Archive.
#
#   games/rogue/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env);
#    applies games/rogue/patches/*.patch (currently none).
# 3. Compiles the sources upstream's Makefile.std lists, unchanged, with
#    port/config.h in place of the one upstream's configure would generate,
#    port/curses.h + curses-web.c (a small curses that hands the screen to the
#    page) and port/platform.c (the browser's "user", for the home directory).
# 4. Writes games/rogue/dist with runtime-manifest.json, and links the same
#    objects for Node as the conformance harness (not deployed). Copies the
#    tiles tiles/tiles.json names from the pinned CC0 crawl/tiles export.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/rogue"
SRC="$WORK/src-$UPSTREAM_COMMIT"
OBJ="$WORK/obj-$UPSTREAM_COMMIT"
OUT="$GAME_DIR/dist"

if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC"
  git clone --quiet --depth 1 --branch "$UPSTREAM_TAG" "$UPSTREAM_REPO" "$SRC"
fi
ACTUAL_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$UPSTREAM_COMMIT" ]; then
  echo "error: $UPSTREAM_TAG resolved to $ACTUAL_COMMIT, expected $UPSTREAM_COMMIT" >&2
  exit 1
fi
git -C "$SRC" checkout --quiet -- .
git -C "$SRC" clean --quiet -fdx
shopt -s nullglob
for patch in "$GAME_DIR"/patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git -C "$SRC" apply --whitespace=nowarn "$patch"
done
shopt -u nullglob

# The sources upstream's makefile builds.
upstream_make_var() {
  make --no-print-directory -C "$SRC" -f Makefile.std -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t SOURCES < <(upstream_make_var CFILES | tr ' ' '\n' | grep '\.c$')
if [ "${#SOURCES[@]}" -lt 25 ]; then
  echo "error: could not read the source list from upstream's Makefile.std" >&2
  exit 1
fi

# port/ comes first on the include path: its curses.h and config.h are used.
CPPFLAGS=(-I"$GAME_DIR/port" -I"$SRC" -DHAVE_CONFIG_H)
CFLAGS=(-O2 -w)

rm -rf "$OBJ" && mkdir -p "$OBJ"
objects=()
for source in "${SOURCES[@]}"; do
  object="$OBJ/${source%.c}.o"
  objects+=("$object")
  emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$SRC/$source" -o "$object" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$GAME_DIR/port/platform.c" -o "$OBJ/platform.o" &
emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$GAME_DIR/port/curses-web.c" -o "$OBJ/curses-web.o" &
wait
game_objects=("${objects[@]}" "$OBJ/platform.o")

rm -rf "$OUT" && mkdir -p "$OUT"
# Rogue is K&R C: its daemons and fuses are stored as void (*)() and called
# with an argument the functions don't declare (daemon.c do_daemons). Native
# code tolerates that; WebAssembly traps on any indirect call whose signature
# differs, so function pointer casts are emulated.
COMMON_LDFLAGS=(
  -O2
  -sEMULATE_FUNCTION_POINTER_CASTS=1
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=262144
  -sSTACK_SIZE=1048576
  -sINITIAL_MEMORY=16777216
  -sALLOW_MEMORY_GROWTH=1
)
emcc "${game_objects[@]}" "$OBJ/curses-web.o" "${COMMON_LDFLAGS[@]}" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createRogue \
  -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,ENV,callMain \
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,onExit,wasmBinary,preRun \
  -o "$OUT/rogue.mjs"

mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE.TXT" "$OUT/licenses/Rogue-LICENSE.txt"

# Display: Tiles. The files tiles/tiles.json names, from the pinned CC0 export
# of Dungeon Crawl Stone Soup's tiles (upstream.env TILES_*), copied as they are.
TILES="$WORK/tiles-$TILES_COMMIT"
if [ ! -d "$TILES/.git" ]; then
  rm -rf "$TILES" && mkdir -p "$TILES"
  git -C "$TILES" init --quiet
  git -C "$TILES" remote add origin "$TILES_REPO"
  git -C "$TILES" fetch --quiet --depth 1 origin "$TILES_COMMIT"
  git -C "$TILES" checkout --quiet FETCH_HEAD
fi
if [ "$(git -C "$TILES" rev-parse HEAD)" != "$TILES_COMMIT" ]; then
  echo "error: tiles checkout is not at $TILES_COMMIT" >&2
  exit 1
fi
node -e '
  const map = require(process.argv[1]);
  const paths = new Set([map.floor, ...Object.values(map.symbols)]);
  console.log([...paths].join("\n"));
' "$GAME_DIR/tiles/tiles.json" | while read -r tile; do
  mkdir -p "$OUT/tiles/$(dirname "$tile")"
  cp "$TILES/$TILES_RELEASE/$tile" "$OUT/tiles/$tile"
done
cp "$TILES/README.md" "$OUT/licenses/crawl-tiles-README.md"
cp "$TILES/ARTISTS.md" "$OUT/licenses/crawl-tiles-ARTISTS.md"

# Conformance harness: the same game objects for Node, with the curses host
# bridge written in C (tests/conformance/replay-platform.c) instead of
# JavaScript. scripts/test-engine.sh links the same files natively. Not
# deployed.
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
if [ "${ROGUE_ARCHIVE_HARNESS:-1}" != "0" ]; then
  rm -rf "$HARNESS" && mkdir -p "$HARNESS"
  emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -DRA_REPLAY -c "$GAME_DIR/port/curses-web.c" -o "$HARNESS/curses-replay.o"
  emcc "${CFLAGS[@]}" -c "$GAME_DIR/tests/conformance/replay-platform.c" -o "$HARNESS/replay-platform.o"
  emcc "${game_objects[@]}" "$HARNESS/curses-replay.o" "$HARNESS/replay-platform.o" \
    -O2 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sSTACK_SIZE=1048576 -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -lnodefs.js \
    -sEXPORTED_RUNTIME_METHODS=FS,NODEFS,ENV \
    --pre-js "$GAME_DIR/tests/conformance/replay-hooks.js" \
    -o "$HARNESS/rogue-node.cjs"
fi

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game rogue \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built Rogue $UPSTREAM_TAG into $OUT"

#!/usr/bin/env bash
# Reproducible WebAssembly build of Angband for Rogue Archive.
#
#   games/angband/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env);
#    applies games/angband/patches/*.patch (currently none).
# 3. Compiles the sources upstream's makefiles list (src/Makefile.src
#    BASEOBJS: the game, without any display module) and upstream's main.c,
#    plus port/main-web.c (the browser display module). main.c is compiled
#    unchanged: USE_GCU with init_gcu/help_gcu renamed makes its "gcu" entry
#    start our module.
# 4. Packs the game data (lib/, without fonts, sounds, icons and tile sheets;
#    only the tilesets whose licences allow it, see LICENSES.md) and writes
#    games/angband/dist with runtime-manifest.json; links the same objects for
#    Node as the conformance harness (not deployed).
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/angband"
SRC="$WORK/src-$UPSTREAM_COMMIT"
OBJ="$WORK/obj-$UPSTREAM_COMMIT"
OUT="$GAME_DIR/dist"
# Tilesets shipped (lib/tiles/<dir>): only those with clear redistribution terms.
TILESETS=(adam-bolt)

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

# The objects upstream's makefiles build for every front end (BASEOBJS in
# src/Makefile.inc: the game and its z-* library), plus main.c.
upstream_make_var() {
  make --no-print-directory -C "$SRC/src" -f Makefile.inc -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t SOURCES < <(upstream_make_var BASEOBJS | tr ' ' '\n' | grep '\.o$' | sed 's/\.o$/.c/')
if [ "${#SOURCES[@]}" -lt 100 ]; then
  echo "error: could not read the source list from upstream's src/Makefile.inc" >&2
  exit 1
fi
SOURCES+=(main.c)

CPPFLAGS=(
  -I"$SRC/src"
  # Game data at /angband/lib (read-only); the player's files (savefiles,
  # scores, character dumps, pref files) under /angband/user/Angband, kept
  # in IndexedDB.
  -DDEFAULT_CONFIG_PATH='"/angband/lib/"'
  -DDEFAULT_LIB_PATH='"/angband/lib/"'
  -DDEFAULT_DATA_PATH='"/angband/lib/"'
  -DPRIVATE_USER_PATH='"/angband/user"'
  -DUSE_PRIVATE_PATHS
  # Select our display module through upstream main.c's "gcu" entry.
  -DUSE_GCU
  -Dinit_gcu=init_web
  -Dhelp_gcu=help_web
)
CFLAGS=(-O2 -w -std=gnu17)

rm -rf "$OBJ" && mkdir -p "$OBJ"
objects=()
for source in "${SOURCES[@]}"; do
  object="$OBJ/${source%.c}.o"
  mkdir -p "$(dirname "$object")"
  objects+=("$object")
  emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$SRC/src/$source" -o "$object" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$GAME_DIR/port/main-web.c" -o "$OBJ/main-web.o" &
wait
game_objects=("${objects[@]}")
objects+=("$OBJ/main-web.o")

# Game data: lib/ as upstream installs it, minus what the browser build does
# not use (bitmap fonts, sounds, icons) and the tilesets not shipped.
STAGE="$WORK/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE/lib/tiles"
for dir in customize gamedata help screens user; do cp -r "$SRC/lib/$dir" "$STAGE/lib/"; done
cp "$SRC/lib/tiles/list.txt" "$STAGE/lib/tiles/"
for tileset in "${TILESETS[@]}"; do
  mkdir -p "$STAGE/lib/tiles/$tileset"
  cp "$SRC/lib/tiles/$tileset"/*.prf "$STAGE/lib/tiles/$tileset/"
done
find "$STAGE/lib" -name Makefile -delete

rm -rf "$OUT" && mkdir -p "$OUT/tiles"
python3 "$EMSDK/upstream/emscripten/tools/file_packager.py" "$OUT/angband-data.data" \
  --preload "$STAGE/lib@/angband/lib" --js-output="$WORK/angband-data.js" \
  --no-node --export-name=Module > /dev/null
# The tile sheets themselves are drawn by the page, not read by the game.
for tileset in "${TILESETS[@]}"; do
  sheet="$(sed -n "/^directory:$tileset\$/,/^size:/p" "$SRC/lib/tiles/list.txt" | sed -n 's/^size:[0-9]*:[0-9]*://p')"
  cp "$SRC/lib/tiles/$tileset/$sheet" "$OUT/tiles/$tileset.png"
done

COMMON_LDFLAGS=(
  -O2
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=262144
  -sSTACK_SIZE=4194304
  -sINITIAL_MEMORY=67108864
  -sALLOW_MEMORY_GROWTH=1
)
emcc "${objects[@]}" "${COMMON_LDFLAGS[@]}" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAngband \
  -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain \
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,onExit,wasmBinary,preRun \
  --pre-js "$WORK/angband-data.js" \
  -o "$OUT/angband.mjs"

# Licences: upstream's copying statement (code and each tileset), the GPL-2.0
# text it refers to, and the notices of the two BSD-licensed source files.
mkdir -p "$OUT/licenses"
cp "$SRC/docs/copying.rst" "$OUT/licenses/Angband-copying.rst"
cp "$GAME_DIR/licenses/GPL-2.0.txt" "$OUT/licenses/GPL-2.0.txt"
for source in message.c wiz-stats.c; do
  echo "src/$source:"
  sed -n '1,/\*\//p' "$SRC/src/$source"
  echo
done > "$OUT/licenses/Angband-BSD-notices.txt"

# Conformance harness: the same game objects for Node, with the display
# module's host bridge written in C (tests/conformance/replay-platform.c)
# instead of JavaScript, and the game data mounted from a directory
# (replay-hooks.js). scripts/test-engine.sh links the same files natively.
# Not deployed.
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
if [ "${ROGUE_ARCHIVE_HARNESS:-1}" != "0" ]; then
  rm -rf "$HARNESS" && mkdir -p "$HARNESS"
  emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -DRA_REPLAY -c "$GAME_DIR/port/main-web.c" -o "$HARNESS/main-web-replay.o"
  emcc "${CFLAGS[@]}" -c "$GAME_DIR/tests/conformance/replay-platform.c" -o "$HARNESS/replay-platform.o"
  emcc "${game_objects[@]}" "$HARNESS/main-web-replay.o" "$HARNESS/replay-platform.o" \
    -O2 -sSTACK_SIZE=4194304 -sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -lnodefs.js \
    -sEXPORTED_RUNTIME_METHODS=FS,NODEFS,ENV \
    --pre-js "$GAME_DIR/tests/conformance/replay-hooks.js" \
    -o "$HARNESS/angband-node.cjs"
  cp -r "$STAGE/lib" "$HARNESS/lib"
fi

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game angband \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built Angband $UPSTREAM_TAG into $OUT"

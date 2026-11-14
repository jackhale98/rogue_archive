#!/usr/bin/env bash
# Reproducible WebAssembly build of Sil-Q for Rogue Archive.
#
#   games/sil-q/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env);
#    applies games/sil-q/patches/*.patch (currently none).
# 3. Compiles the sources upstream's Makefile.std lists, except its display
#    modules, plus port/main-web.c (the browser display module). Upstream's
#    main.c is compiled unchanged: USE_GCU with init_gcu/help_gcu renamed
#    makes its "gcu" entry start our module.
# 4. Packs the game data (lib/, without manuals, sounds, fonts and tiles) and
#    writes games/sil-q/dist with runtime-manifest.json; links the same objects
#    for Node as the conformance harness (not deployed).
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/sil-q"
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

# The sources upstream's Unix makefile builds, without its display modules
# (main-*.c, maid-*.c), which our module replaces.
upstream_make_var() {
  make --no-print-directory -C "$SRC/src" -f Makefile.std -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t SOURCES < <(upstream_make_var SRCS | tr ' ' '\n' | grep '\.c$' | grep -v '^main-\|^maid-')
if [ "${#SOURCES[@]}" -lt 30 ]; then
  echo "error: could not read the source list from upstream's Makefile.std" >&2
  exit 1
fi

CPPFLAGS=(
  -I"$SRC/src"
  # Data lives at /sil/lib in the browser's file system.
  -DDEFAULT_PATH='"/sil/lib/"'
  # Select our display module through upstream main.c's "gcu" entry.
  -DUSE_GCU
  -Dinit_gcu=init_web
  -Dhelp_gcu=help_web
)
CFLAGS=(-O2 -w)

rm -rf "$OBJ" && mkdir -p "$OBJ"
objects=()
for source in "${SOURCES[@]}" ; do
  object="$OBJ/${source%.c}.o"
  objects+=("$object")
  emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$SRC/src/$source" -o "$object" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$GAME_DIR/port/main-web.c" -o "$OBJ/main-web.o" &
wait
game_objects=("${objects[@]}")
objects+=("$OBJ/main-web.o")

# Game data: lib/ as upstream ships it, minus what the browser build does not
# use (PDF manuals, sounds, bitmap fonts, tile sheets).
STAGE="$WORK/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE/lib"
for dir in apex data edit pref save user; do cp -r "$SRC/lib/$dir" "$STAGE/lib/"; done
mkdir -p "$STAGE/lib/xtra" && cp -r "$SRC/lib/xtra/tutorial" "$STAGE/lib/xtra/" 2>/dev/null || true

rm -rf "$OUT" && mkdir -p "$OUT"
# Run from the output directory with a relative name: the packager writes the
# package's path into the loader, and an absolute one would differ by checkout.
(cd "$OUT" && python3 "$EMSDK/upstream/emscripten/tools/file_packager.py" sil-data.data \
  --preload "$STAGE/lib@/sil/lib" --js-output="$WORK/sil-data.js" \
  --no-node --export-name=Module > /dev/null)

COMMON_LDFLAGS=(
  -O2
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=262144
  -sSTACK_SIZE=4194304
  -sINITIAL_MEMORY=67108864
  -sALLOW_MEMORY_GROWTH=1
)
emcc "${objects[@]}" "${COMMON_LDFLAGS[@]}" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createSil \
  -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain \
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,onExit,wasmBinary,preRun \
  --pre-js "$WORK/sil-data.js" \
  -o "$OUT/sil.mjs"

mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE.md" "$OUT/licenses/Sil-Q-LICENSE.md"

# MicroChasm's 16x16 tiles, as upstream's macOS build ships them (the PNG with
# transparency; the same art as lib/xtra/graf/16x16.bmp, which the X11 and
# Windows builds read with pixel 0,0 as the transparent colour). Fetched by
# the page only when the Display setting is Tiles. See LICENSES.md.
cp "$SRC/lib/xtra/graf/16x16_microchasm.png" "$OUT/tiles.png"

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
    -o "$HARNESS/sil-node.cjs"
  cp -r "$STAGE/lib" "$HARNESS/lib"
fi

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game sil-q \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built Sil-Q $UPSTREAM_TAG into $OUT"

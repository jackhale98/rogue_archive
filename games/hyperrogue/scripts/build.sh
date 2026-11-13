#!/usr/bin/env bash
# Reproducible WebAssembly build of HyperRogue for Rogue Archive.
#
#   games/hyperrogue/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env);
#    applies games/hyperrogue/patches/*.patch (currently none).
# 3. Generates the headers upstream's Makefile generates (autohdr.h,
#    language-data.cpp) with upstream's own tools, built natively.
# 4. Builds the pinned zlib with the pinned Emscripten.
# 5. Compiles upstream's web build (hyperweb.cpp, which includes the whole
#    game as one translation unit, as upstream's Makefile `emscripten` target
#    does) through port/rogue-archive-web.cpp, which adds the functions the
#    page calls. Upstream's own switches turn on saving and the config file
#    (off in upstream's web demo) and fix the command line.
# 6. Writes games/hyperrogue/dist with runtime-manifest.json.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/hyperrogue"
SRC="$WORK/src-$UPSTREAM_COMMIT"
OBJ="$WORK/obj-$UPSTREAM_COMMIT"
ZLIB="$WORK/zlib-$ZLIB_COMMIT"
OUT="$GAME_DIR/dist"
mkdir -p "$WORK"

# Fetches a pinned commit of a repository into a directory (once) and checks it.
fetch_pinned() {
  local repo="$1" commit="$2" dir="$3"
  if [ ! -d "$dir/.git" ]; then
    rm -rf "$dir" && mkdir -p "$dir"
    git -C "$dir" init --quiet
    git -C "$dir" remote add origin "$repo"
    git -C "$dir" fetch --quiet --depth 1 origin "$commit"
    git -C "$dir" checkout --quiet FETCH_HEAD
  fi
  if [ "$(git -C "$dir" rev-parse HEAD)" != "$commit" ]; then
    echo "error: $dir is not at $commit" >&2
    exit 1
  fi
}

# (A canary run resolves UPSTREAM_COMMIT to the ref it tries, so SRC differs.)
fetch_pinned "$UPSTREAM_REPO" "$UPSTREAM_COMMIT" "$SRC"
git -C "$SRC" checkout --quiet -- .
git -C "$SRC" clean --quiet -fdx
shopt -s nullglob
for patch in "$GAME_DIR"/patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git -C "$SRC" apply --whitespace=nowarn "$patch"
done
shopt -u nullglob

# Generated sources, made by upstream's Makefile with its own tools (native).
make --no-print-directory -s -C "$SRC" autohdr.h language-data.cpp

# zlib, pinned, built with the pinned Emscripten.
fetch_pinned "$ZLIB_REPO" "$ZLIB_COMMIT" "$ZLIB"
if [ ! -f "$ZLIB/libz-emscripten.a" ]; then
  mkdir -p "$ZLIB/obj"
  for source in adler32 compress crc32 deflate gzclose gzlib gzread gzwrite infback inffast inflate inftrees trees uncompr zutil; do
    emcc -O2 -DHAVE_UNISTD_H -c "$ZLIB/$source.c" -o "$ZLIB/obj/$source.o"
  done
  emar rcs "$ZLIB/libz-emscripten.a" "$ZLIB"/obj/*.o
fi

# Upstream's web build: hyperweb.cpp with upstream's flags (C++17 as its
# `mymake -web`; MAXMDIM=4, the full build, as hyperweb.cpp selects when
# MAXMDIM is given). Saving and the config file are switched back on with
# upstream's own CAP_ switches. The page makes /hyperrogue (IndexedDB) the
# working directory before the game starts, so upstream's default file names
# (hyperrogue.log for scores and the game in progress, hyperrogue.ini for the
# config) land there. The command line is fixed so the page's own URL is never
# read as arguments: -noscr starts the game directly (no "online demo" menu),
# -f1 fills the page's area ("fullscreen": the element with id this_wide;
# port/rogue-archive-web.cpp ra_resize).
FIXED_ARG='?a=-noscr+-f1'
CXXFLAGS=(
  -std=c++17 -O2 -fexceptions -Wno-invalid-offsetof
  -DMAXMDIM=4 -DCAP_SAVE=1 -DCAP_CONFIG=1
  "-DEMSCRIPTEN_FIXED_ARG=\"$FIXED_ARG\""
  -I"$SRC" -I"$ZLIB"
)
mkdir -p "$OBJ"
STAMP="$(cat "$GAME_DIR/port/rogue-archive-web.cpp" <(printf '%s\n' "${CXXFLAGS[@]}" "$EMSDK_VERSION") | sha256sum | cut -c1-16)"
if [ ! -f "$OBJ/hyperrogue-$STAMP.o" ]; then
  rm -f "$OBJ"/hyperrogue-*.o
  echo "Compiling HyperRogue (one translation unit; a few minutes)..."
  em++ "${CXXFLAGS[@]}" -c "$GAME_DIR/port/rogue-archive-web.cpp" -o "$OBJ/hyperrogue-$STAMP.o"
fi

rm -rf "$OUT" && mkdir -p "$OUT"
# Link settings from upstream's web build (Makefile `emscripten`, mymake -web):
# exceptions, a 1 MiB stack. It runs on the page (WebGL and SDL need the
# page's canvas), driven by the browser's animation frames. Upstream's
# Makefile also asks for LEGACY_GL_EMULATION; the web build draws only with
# OpenGL ES 2 calls (GLES_ONLY), so it is left out: the link would fail if any
# legacy GL function were used, and the game renders the same without the
# emulation layer (about 90 KB less JavaScript, no warnings).
em++ "$OBJ/hyperrogue-$STAMP.o" "$ZLIB/libz-emscripten.a" \
  -O2 -fexceptions \
  -sDISABLE_EXCEPTION_CATCHING=0 \
  -sSTACK_SIZE=1048576 \
  -sINITIAL_MEMORY=134217728 -sALLOW_MEMORY_GROWTH=1 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createHyperRogue \
  -sENVIRONMENT=web -sEXIT_RUNTIME=0 \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_FUNCTIONS=_main,_use_file,_ra_save,_ra_state,_ra_land_name,_ra_resize,_ra_log_size,_ra_log_text,_ra_log_quantity,_ra_log_turn,_ra_hover_text,_ra_set_touch_mode,_ra_item_name,_emscripten_cancel_main_loop,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,UTF8ToString,HEAP32,addRunDependency,removeRunDependency \
  -sINCOMING_MODULE_JS_API=canvas,keyboardListeningElement,wasmBinary,locateFile,print,printErr,onAbort,preRun,postRun \
  -o "$OUT/hyperrogue.mjs"

# Conformance harness: upstream's web build as shipped (hyperweb.cpp, the
# same flags), with tests/conformance/harness.cpp's headless main, for Node.
# scripts/test-engine.sh builds the same file natively and compares. Not
# deployed. (Another few minutes the first time; skip with
# ROGUE_ARCHIVE_HARNESS=0.)
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
if [ "${ROGUE_ARCHIVE_HARNESS:-1}" != "0" ]; then
  mkdir -p "$HARNESS"
  HSTAMP="$(cat "$GAME_DIR/tests/conformance/harness.cpp" <(printf '%s\n' "${CXXFLAGS[@]}" "$EMSDK_VERSION") | sha256sum | cut -c1-16)"
  if [ ! -f "$HARNESS/harness-$HSTAMP.o" ]; then
    rm -f "$HARNESS"/harness-*.o
    echo "Compiling the conformance harness (a few minutes)..."
    em++ "${CXXFLAGS[@]}" -w -c "$GAME_DIR/tests/conformance/harness.cpp" -o "$HARNESS/harness-$HSTAMP.o"
  fi
  em++ "$HARNESS/harness-$HSTAMP.o" "$ZLIB/libz-emscripten.a" \
    -O2 -fexceptions -sDISABLE_EXCEPTION_CATCHING=0 -sSTACK_SIZE=1048576 -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sNODERAWFS=1 \
    -o "$HARNESS/hyperrogue-node.cjs"
fi

mkdir -p "$OUT/licenses"
cp "$SRC/COPYING" "$OUT/licenses/HyperRogue-COPYING.txt"
# The built-in font (nofont.cpp) is rendered from DejaVu Sans Bold.
cp "$SRC/licenses/DejaVu Fonts License.txt" "$OUT/licenses/DejaVu-Fonts-License.txt"

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game hyperrogue \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built HyperRogue $UPSTREAM_TAG into $OUT"

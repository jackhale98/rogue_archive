#!/usr/bin/env bash
# Reproducible WebAssembly build of Cataclysm: Dark Days Ahead for Rogue Archive.
#
#   games/cataclysm-dda/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env) and
#    supplies the Emscripten ports upstream's web build uses (scripts/ports.sh).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env);
#    applies games/cataclysm-dda/patches/*.patch (currently none).
# 3. Compiles with upstream's own web build: `make NATIVE=emscripten TILES=1
#    RELEASE=1 ...` as upstream's build-scripts/build-emscripten.sh runs it.
#    Rogue Archive adds one file (port/rogue-archive-web.cpp, compiled with
#    the flags upstream's Makefile prints) and its link flags.
# 4. Packages the game data as upstream's build-scripts/prepare-web.sh does
#    (the same data directories and mods, LZ4-compressed with Emscripten's
#    file packager), but only the tilesets Rogue Archive ships (LICENSES.md).
# 5. Writes games/cataclysm-dda/dist with runtime-manifest.json.
#
# The first build compiles about 430 large C++ files: allow an hour on four
# cores. Later builds recompile only what changed (upstream's Makefile tracks
# dependencies); objects live in the cache, outside the source tree.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
export EMSDK_QUIET=1
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"
# shellcheck source=ports.sh
source "$GAME_DIR/scripts/ports.sh"

WORK="$RA_CACHE/cataclysm-dda"
SRC="$WORK/src-$UPSTREAM_COMMIT"
# Objects are keyed on the compiler (wrapper and Emscripten version): make
# tracks sources and headers, not flags.
COMPILER_STAMP="$(cat "$GAME_DIR/scripts/emcc-compile.sh" <(echo "$EMSDK_VERSION") | sha256sum | cut -c1-12)"
OBJ="$WORK/obj-$UPSTREAM_COMMIT-$COMPILER_STAMP"
OUT="$GAME_DIR/dist"
JOBS="${ROGUE_ARCHIVE_JOBS:-$(nproc)}"
# The tilesets shipped (each one's licence is recorded in LICENSES.md): the
# game's default tileset and its default overmap tileset.
TILESETS=(UltimateCataclysm Larwick_Overmap)
mkdir -p "$WORK" "$OBJ"

ra_seed_ports

# Upstream source, with its release tag (upstream's Makefile names the build
# after `git describe --exact-match`).
if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC" && mkdir -p "$SRC"
  git -C "$SRC" init --quiet
  git -C "$SRC" remote add origin "$UPSTREAM_REPO"
  # Without the translations (about 690 MB, not in the web bundle), the
  # documentation and screenshots: the build never reads them.
  git -C "$SRC" sparse-checkout set --no-cone '/*' '!/lang/' '!/doc/' '!/data/screenshots/'
  git -C "$SRC" fetch --quiet --depth 1 --filter=blob:none origin "$UPSTREAM_COMMIT"
  git -C "$SRC" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
fi
if [ "$(git -C "$SRC" rev-parse HEAD)" != "$UPSTREAM_COMMIT" ]; then
  echo "error: $SRC is not at $UPSTREAM_COMMIT" >&2
  exit 1
fi
if [ -z "$RA_CANARY" ] && ! git -C "$SRC" rev-parse --quiet --verify "refs/tags/$UPSTREAM_TAG" > /dev/null; then
  git -C "$SRC" fetch --quiet --depth 1 --filter=blob:none origin "refs/tags/$UPSTREAM_TAG:refs/tags/$UPSTREAM_TAG"
fi
# Tracked files as pinned; generated files upstream ignores (version.h, the
# precompiled header) stay, so a rebuild reuses them.
git -C "$SRC" checkout --quiet -- .
git -C "$SRC" clean --quiet -fd
shopt -s nullglob
for patch in "$GAME_DIR"/patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git -C "$SRC" apply --whitespace=nowarn "$patch"
done
shopt -u nullglob

# The precompiled header lives in the source tree and make does not rebuild
# it when the compiler changes: drop it then.
if [ "$(cat "$WORK/pch-compiler-$UPSTREAM_COMMIT" 2>/dev/null)" != "$COMPILER_STAMP" ]; then
  rm -f "$SRC/pch/main-pch.hpp.gch" "$SRC/pch/main-pch.hpp.d"
  echo "$COMPILER_STAMP" > "$WORK/pch-compiler-$UPSTREAM_COMMIT"
fi

# Upstream's web build (build-scripts/build-emscripten.sh), with objects
# outside the source tree. The compiler wrapper only turns -Werror off (the
# pinned Emscripten is newer than upstream's); the linker wrapper adds
# Rogue Archive's object and flags.
MAKE_VARS=(
  NATIVE=emscripten BACKTRACE=0 TILES=1 TESTS=0 RUNTESTS=0 RELEASE=1 CCACHE=0 LINTJSON=0
  "BUILD_PREFIX=$OBJ/"
  "CXX=$GAME_DIR/scripts/emcc-compile.sh"
  "LD=$GAME_DIR/scripts/emcc-link.sh"
)
upstream_var() {
  make -s --no-print-directory -C "$SRC" -f Makefile -f "$GAME_DIR/scripts/print.mk" \
    "${MAKE_VARS[@]}" "print-$1" | tail -n 1
}
echo "Compiling Cataclysm: DDA $UPSTREAM_TAG with upstream's Makefile ($JOBS jobs)..."
make -s --no-print-directory -C "$SRC" -j"$JOBS" "${MAKE_VARS[@]}" "$OBJ/cataclysm.a"

# Rogue Archive's added file, with upstream's flags (as make passes them, so
# through the shell's quoting).
eval "PORT_FLAGS=($(upstream_var CPPFLAGS) $(upstream_var DEFINES) $(upstream_var CXXFLAGS))"
PORT_STAMP="$(cat "$GAME_DIR/port/rogue-archive-web.cpp" <(printf '%s\n' "${PORT_FLAGS[@]}" "$EMSDK_VERSION") | sha256sum | cut -c1-16)"
PORT_OBJ="$OBJ/rogue-archive-web-$PORT_STAMP.o"
if [ ! -f "$PORT_OBJ" ]; then
  rm -f "$OBJ"/rogue-archive-web-*.o
  (cd "$SRC" && "$GAME_DIR/scripts/emcc-compile.sh" "${PORT_FLAGS[@]}" -c "$GAME_DIR/port/rogue-archive-web.cpp" -o "$PORT_OBJ")
fi

# Game data, as upstream's prepare-web.sh assembles it: the same directories,
# without obsolete mods and the MA mod; only the shipped tilesets.
STAGE="$WORK/stage-$UPSTREAM_COMMIT"
rm -rf "$STAGE" && mkdir -p "$STAGE/data" "$STAGE/gfx"
for item in core font fontdata.json json mods names raw motd credits title; do
  cp -R "$SRC/data/$item" "$STAGE/data/"
done
node "$GAME_DIR/scripts/drop-obsolete-mods.mjs" "$STAGE/data/mods"
rm -rf "$STAGE/data/mods/MA"
for tileset in "${TILESETS[@]}"; do cp -R "$SRC/gfx/$tileset" "$STAGE/gfx/"; done
# The files at the top of gfx/ (the game's own images, e.g. cdda.png shown
# while a new game starts, and the default tile configuration).
find "$SRC/gfx" -maxdepth 1 -type f -exec cp {} "$STAGE/gfx/" \;
find "$STAGE" -name .DS_Store -delete

rm -rf "$OUT" && mkdir -p "$OUT"
# Run from the work directory with a relative name: the packager writes the
# package's name into its loader.
(cd "$WORK" && python3 "$EMSDK/upstream/emscripten/tools/file_packager.py" cataclysm-data.data \
  --preload "$STAGE@/" --js-output="$WORK/cataclysm-data.js" --no-node --lz4 > /dev/null)

# Rogue Archive's link additions (scripts/emcc-link.sh appends them to
# upstream's link command; later -s settings override upstream's).
WRAPPED=(
  _ZN13input_context12handle_inputEv
  _ZN13input_context12handle_inputEi
  _ZN13input_manager15get_input_eventE13keyboard_mode
  _ZN15cata_cursesport17curses_drawwindowERKN10catacurses6windowE
  _ZN10ImDrawList7AddTextEP6ImFontfRK6ImVec2jPKcS6_fPK6ImVec4
  _ZN10ImDrawList7AddTextERK6ImVec2jPKcS4_
  _ZN5ImGui8NewFrameEv
  _Z13handle_resizeii
  _Z7do_turnv
  _ZN9main_menu14opening_screenEv
)
RSP="$OBJ/rogue-archive-link.rsp"
{
  echo "$PORT_OBJ"
  for symbol in "${WRAPPED[@]}"; do echo "-Wl,--wrap=$symbol"; done
  echo "--pre-js=$WORK/cataclysm-data.js"
  # Link at -O1 (the objects keep upstream's -Os), then optimise below.
  # Upstream links at -Os; with the pinned Emscripten that runs two hours of
  # optimisation inside the Asyncify run, then a pass that was killed above
  # 14 GB of memory. At -O1 the link takes about a minute.
  echo "-O1"
  # The site's Content Security Policy allows no eval: embind (upstream's
  # emscripten_exception.cpp) then builds its invokers without new Function.
  echo "-sDYNAMIC_EXECUTION=0"
  echo "-sMODULARIZE=1"
  echo "-sEXPORT_ES6=1"
  echo "-sEXPORT_NAME=createCataclysm"
  echo "-sEXPORTED_FUNCTIONS=_main,_ra_state,_ra_screen_text,_ra_messages,_ra_message_count,_ra_stop"
  # FS, as upstream's; ENV for the keyboard hint; what the data loader uses.
  echo "-sEXPORTED_RUNTIME_METHODS=FS,ENV,UTF8ToString,FS_createPath,FS_createDataFile,FS_createPreloadedFile,addRunDependency,removeRunDependency"
  echo "-sINCOMING_MODULE_JS_API=canvas,wasmBinary,locateFile,print,printErr,onAbort,onExit,preRun,postRun,setStatus,monitorRunDependencies"
} > "$RSP"
rm -f "$OBJ/cataclysm-tiles.js" "$OBJ/cataclysm-tiles.wasm"
echo "Linking..."
RA_LINK_RSP="$RSP" make -s --no-print-directory -C "$SRC" "${MAKE_VARS[@]}" "$OBJ/cataclysm-tiles.js"

cp "$OBJ/cataclysm-tiles.js" "$OUT/cataclysm-tiles.mjs"
# The optimisation the -O1 link leaves out, as its own wasm-opt run (-O2:
# about 9 minutes on four cores and 5.5 GB of memory; it shrinks the module
# from about 135 MB to 79 MB, 25 MB gzipped). -Os was stopped at 12 GB.
# Names of imports and exports are kept: the glue is unchanged.
echo "Optimising the module (wasm-opt -O2, about 10 minutes)..."
"$EMSDK/upstream/bin/wasm-opt" "$OBJ/cataclysm-tiles.wasm" -O2 -o "$OUT/cataclysm-tiles.wasm"
# The data package is sent compressed (gzip over LZ4: about half the size),
# named .gzip so no server inflates it before the integrity check.
gzip -9 -n -c "$WORK/cataclysm-data.data" > "$OUT/cataclysm-data.data.gzip"

mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE.txt" "$OUT/licenses/Cataclysm-DDA-LICENSE.txt"
cp "$SRC/LICENSE-OFL-Terminus-Font.txt" "$OUT/licenses/LICENSE-OFL-Terminus-Font.txt"
# The Apache License 2.0 text (Roboto, and FlatBuffers, compiled in).
cp "$SRC/LICENSE-Apache-Robot-Font.txt" "$OUT/licenses/Apache-2.0.txt"
# Third-party code compiled in from upstream's tree.
cp "$SRC/src/third-party/imgui/LICENSE.txt" "$OUT/licenses/imgui-LICENSE.txt"
cp "$SRC/src/third-party/zstd/LICENSE" "$OUT/licenses/zstd-LICENSE.txt"
cp "$SRC/src/third-party/pinyin/LICENSE" "$OUT/licenses/pinyin-Unicode-LICENSE.txt"
# The Emscripten ports linked in (sources as scripts/ports.sh supplies them).
PORTS_DIR="$(em-config CACHE)/ports"
cp "$PORTS_DIR"/sdl2/*/LICENSE.txt "$OUT/licenses/SDL2-LICENSE.txt"
cp "$PORTS_DIR"/sdl2_image/*/LICENSE.txt "$OUT/licenses/SDL2_image-LICENSE.txt"
cp "$PORTS_DIR"/sdl2_ttf/*/LICENSE.txt "$OUT/licenses/SDL2_ttf-LICENSE.txt"
cp "$PORTS_DIR"/freetype/*/docs/FTL.TXT "$OUT/licenses/FreeType-FTL.txt"
cp "$PORTS_DIR"/harfbuzz/*/COPYING "$OUT/licenses/HarfBuzz-COPYING.txt"
cp "$PORTS_DIR"/libpng/*/LICENSE "$OUT/licenses/libpng-LICENSE.txt"
cp "$PORTS_DIR"/zlib/*/LICENSE "$OUT/licenses/zlib-LICENSE.txt"

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game cataclysm-dda \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built Cataclysm: DDA $UPSTREAM_TAG into $OUT"

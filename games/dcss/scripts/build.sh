#!/usr/bin/env bash
# Reproducible WebAssembly build of Dungeon Crawl Stone Soup for Rogue Archive.
#
#   games/dcss/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and its contrib submodules, verifies the
#    commit (upstream.env), applies games/dcss/patches/*.patch (currently none).
# 3. Runs upstream's own Makefile in its cross-compiling mode (CROSSHOST), with
#    compiler wrappers that call Emscripten, for the headless WebTiles build.
#    Upstream generates its sources and tile sheets with host tools as usual.
# 4. Relinks the game objects with port/rogue-archive-platform.cc (which
#    replaces the WebTiles socket with the Web Worker) for the browser, and
#    once more for Node (the conformance harness, not deployed).
# 5. Packs the game data (upstream's install-data layout) and the upstream
#    WebTiles client into games/dcss/dist with runtime-manifest.json.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/dcss"
SRC="$WORK/src-$UPSTREAM_COMMIT"
OUT="$GAME_DIR/dist"
JOBS="${ROGUE_ARCHIVE_JOBS:-$(nproc)}"
CROSSHOST=wasm32-emscripten

if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC"
  git clone --quiet --depth 1 --branch "$UPSTREAM_TAG" "$UPSTREAM_REPO" "$SRC"
fi
ACTUAL_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$UPSTREAM_COMMIT" ]; then
  echo "error: $UPSTREAM_TAG resolved to $ACTUAL_COMMIT, expected $UPSTREAM_COMMIT" >&2
  exit 1
fi
# shellcheck disable=SC2086
git -C "$SRC" submodule update --init --depth 1 --quiet $UPSTREAM_SUBMODULES

# Upstream's Makefile builds in the source tree. Reuse the tree between runs
# (a full build takes a while) unless asked for a clean one, but always start
# from pristine sources plus our patches.
if [ -n "${ROGUE_ARCHIVE_CLEAN:-}" ]; then
  git -C "$SRC" clean --quiet -fdx
  git -C "$SRC" submodule foreach --quiet git clean --quiet -fdx
fi
git -C "$SRC" checkout --quiet -- .
shopt -s nullglob
for patch in "$GAME_DIR"/patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git -C "$SRC" apply --whitespace=nowarn "$patch"
done
shopt -u nullglob
CRAWL="$SRC/crawl-ref/source"

# Compiler wrappers for upstream's cross-compiling mode: $(CROSSHOST)-g++ etc.
# C++ exceptions are part of DCSS's control flow, so they must be enabled.
TOOLS="$WORK/toolchain"
rm -rf "$TOOLS" && mkdir -p "$TOOLS/bin"
cat > "$TOOLS/bin/$CROSSHOST-gcc" <<'SH'
#!/bin/sh
exec emcc -fexceptions "$@"
SH
cat > "$TOOLS/bin/$CROSSHOST-g++" <<'SH'
#!/bin/sh
exec em++ -fexceptions "$@"
SH
printf '#!/bin/sh\nexec emar "$@"\n' > "$TOOLS/bin/$CROSSHOST-ar"
printf '#!/bin/sh\nexec emranlib "$@"\n' > "$TOOLS/bin/$CROSSHOST-ranlib"
printf '#!/bin/sh\nexit 0\n' > "$TOOLS/bin/$CROSSHOST-strip"
chmod +x "$TOOLS/bin"/*
export PATH="$TOOLS/bin:$PATH"

# Compatibility shims (port/compat): the terminal library, linked but never
# used in headless mode, and glibc's backtrace API. Upstream's Makefile finds
# them through its curses settings (NC_PREFIX/include/ncursesw, -lncursesw).
COMPAT="$TOOLS/compat"
mkdir -p "$COMPAT/include" "$COMPAT/lib"
cp -r "$GAME_DIR/port/compat/include" "$COMPAT/include/ncursesw"
emcc -O2 -c "$GAME_DIR/port/compat/compat-stubs.c" -I"$COMPAT/include/ncursesw" -o "$COMPAT/stubs.o"
emar rcs "$COMPAT/lib/libncursesw.a" "$COMPAT/stubs.o"

# Paths inside the browser's virtual file system.
MAKE_VARS=(
  CROSSHOST="$CROSSHOST"
  WEBTILES=y
  # Upstream's cross mode turns off pkg-config for the target and builds lua,
  # sqlite and zlib from contrib; PCRE we ask for. (Command-line variables
  # reach sub-makes, so NO_PKGCONFIG must not be set here: rltiles' host tool
  # needs the host's pkg-config for libpng.)
  BUILD_PCRE=y
  # Only rltiles' host tool uses libpng, and it uses the host's.
  BUILD_LIBPNG=
  NC_PREFIX="$COMPAT"
  # Upstream links -pthread for its mutexes; the game is single-threaded and
  # Emscripten's C library provides the mutex functions without threads.
  EXTRA_LIBS=
  prefix=/crawl DATADIR=data SAVEDIR=/saves
  NOWIZARD=y
  # Use upstream's pregenerated level-compiler parser (prebuilt/), whatever
  # flex/bison the host has, so every build compiles the same sources.
  NO_YACC=y
)

upstream_make_var() {
  # Only the last line: make may first report regenerating included files.
  make --no-print-directory -C "$CRAWL" -f Makefile -f - "${MAKE_VARS[@]}" "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}

echo "Building DCSS $UPSTREAM_TAG with upstream's Makefile ($JOBS jobs)…"
# "docs" generates the manual, aptitude tables and FAQ the in-game help opens.
make --no-print-directory -C "$CRAWL" -j"$JOBS" "${MAKE_VARS[@]}" crawl webserver docs

# Relink: upstream's objects and libraries plus our platform layer.
read -r -a GAME_OBJS <<< "$(upstream_make_var GAME_OBJS)"
read -r -a LIBS <<< "$(upstream_make_var LIBS)"
if [ "${#GAME_OBJS[@]}" -lt 200 ]; then
  echo "error: could not read the object list from upstream's Makefile" >&2
  exit 1
fi
OBJECTS=()
for object in "${GAME_OBJS[@]}"; do OBJECTS+=("$CRAWL/$object"); done
LINK_LIBS=()
for lib in "${LIBS[@]}"; do
  case "$lib" in
    -L/*) LINK_LIBS+=("$lib") ;;
    -L*) LINK_LIBS+=("-L$CRAWL/${lib#-L}") ;;
    /*) LINK_LIBS+=("$lib") ;;
    contrib/*) LINK_LIBS+=("$CRAWL/$lib") ;;
    *) LINK_LIBS+=("$lib") ;;
  esac
done
PLATFORM_OBJ="$WORK/rogue-archive-platform.o"
em++ -fexceptions -O2 -std=c++17 -c "$GAME_DIR/port/rogue-archive-platform.cc" -o "$PLATFORM_OBJ"

# Game data, laid out by upstream's install-data rule, packed for the browser.
STAGE="$WORK/stage"
rm -rf "$STAGE"
make --no-print-directory -C "$CRAWL" "${MAKE_VARS[@]}" DESTDIR="$STAGE" install-data > /dev/null

# DCSS checks its level and database caches against the data files'
# modification times. Every data file gets the same fixed time here and in the
# browser (adapter/worker.ts DATA_MTIME), so caches built now are valid there.
DATA_MTIME=1000000000
find "$STAGE/crawl/data" -exec touch -h -d "@$DATA_MTIME" {} +

COMMON_LDFLAGS=(
  -O2
  -fexceptions
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=1048576
  -sSTACK_SIZE=8388608
  -sINITIAL_MEMORY=134217728
  -sALLOW_MEMORY_GROWTH=1
)

# The Node harness: the same objects and platform layer linked for Node, with
# the game data mounted from the staging directory (tests/conformance/
# replay-hooks.js). It generates the caches below, and scripts/test-engine.sh
# uses it to compare against a native build. Not deployed.
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
rm -rf "$HARNESS" && mkdir -p "$HARNESS"
em++ "$PLATFORM_OBJ" "${OBJECTS[@]}" "${LINK_LIBS[@]}" "${COMMON_LDFLAGS[@]}" \
  -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -lnodefs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,NODEFS \
  --pre-js "$GAME_DIR/tests/conformance/replay-hooks.js" \
  -o "$HARNESS/crawl-node.cjs"

# DCSS's level (des) and database (db) caches, built once here with DCSS's own
# -builddb by the same WebAssembly code the browser runs (the format depends
# on the word size, so a native build's caches would not do). Building them
# in the browser took a minute on phones and exhausted iOS Safari's memory.
CACHEGEN="$WORK/cachegen"
rm -rf "$CACHEGEN" && mkdir -p "$CACHEGEN"
RA_DATA_DIR="$STAGE/crawl/data" RA_SAVES_DIR="$CACHEGEN" node "$HARNESS/crawl-node.cjs" -headless -builddb
for dir in des db; do
  if [ ! -d "$CACHEGEN/saves/$dir" ]; then
    echo "error: -builddb did not produce saves/$dir" >&2
    exit 1
  fi
done
find "$CACHEGEN/saves" -name '*.lk' -delete

rm -rf "$OUT" && mkdir -p "$OUT"
python3 "$EMSDK/upstream/emscripten/tools/file_packager.py" "$OUT/crawl-data.data" \
  --preload "$STAGE/crawl/data@/crawl/data" \
  --preload "$CACHEGEN/saves/des@/crawl/cache/des" \
  --preload "$CACHEGEN/saves/db@/crawl/cache/db" \
  --js-output="$WORK/crawl-data.js" --no-node --export-name=Module > /dev/null

em++ "$PLATFORM_OBJ" "${OBJECTS[@]}" "${LINK_LIBS[@]}" "${COMMON_LDFLAGS[@]}" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createCrawl \
  -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain \
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,onExit,wasmBinary,preRun \
  --pre-js "$WORK/crawl-data.js" \
  -o "$OUT/crawl.mjs"

# Upstream's WebTiles game client (version-matched to the game) and its shared
# scripts, served unchanged next to the runtime.
CLIENT="$OUT/client"
mkdir -p "$CLIENT/game" "$CLIENT/scripts/contrib"
cp -r "$CRAWL/webserver/game_data/static/." "$CLIENT/game/"
cp "$CRAWL/webserver/game_data/templates/game.html" "$CLIENT/game.html"
for script in key_conversion.js; do cp "$CRAWL/webserver/static/scripts/$script" "$CLIENT/scripts/"; done
for script in jquery.js jquery.json.js require.js; do
  cp "$CRAWL/webserver/static/scripts/contrib/$script" "$CLIENT/scripts/contrib/"
done
cp "$CRAWL/webserver/static/style.css" "$CLIENT/lobby-style.css"
mkdir -p "$CLIENT/fonts"
cp "$CRAWL/webserver/static/fonts/fonts.css" "$CRAWL/webserver/static/fonts/"*.woff2 "$CLIENT/fonts/"
# Our host page for the client (client-host/: index.html, host.js, host.css).
cp "$GAME_DIR/client-host/"* "$CLIENT/"

mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE" "$OUT/licenses/DCSS-LICENSE.txt"
cp "$SRC/crawl-ref/docs/license/"*.txt "$OUT/licenses/"
# The DejaVu web fonts carry their license inside the font files only.
python3 "$GAME_DIR/scripts/font-license.py" "$CRAWL/contrib/fonts/DejaVuSans.ttf" \
  > "$OUT/licenses/DejaVu-fonts-LICENSE.txt"

# The module and its data are delivered compressed and inflated by the worker
# (which hands both to the runtime as bytes), so download size does not
# depend on how the host compresses responses. ".gzip", not ".gz": some
# servers send .gz files with Content-Encoding: gzip, and the browser would
# then inflate them before the integrity check.
for file in crawl.wasm crawl-data.data; do
  gzip -9 -n "$OUT/$file"
  mv "$OUT/$file.gz" "$OUT/$file.gzip"
done

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game dcss \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built DCSS $UPSTREAM_TAG into $OUT"

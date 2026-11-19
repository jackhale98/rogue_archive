#!/usr/bin/env bash
# Reproducible WebAssembly build of DRL for Rogue Archive.
#
#   games/drl/scripts/build.sh
#
# 1. Installs the pinned Emscripten SDK (tools/toolchain.env) and the pinned
#    FreePascal (games/drl/toolchain.env, with patches/fpc applied).
# 2. Fetches the pinned DRL and FPC Valkyrie tags and verifies their commits
#    (upstream.env), and Lua 5.1.5 by its SHA-256; applies patches/fpcvalkyrie
#    and patches/lua.
# 3. Compiles Lua with Emscripten, and upstream's two programs (makefile.lua's
#    source_files: src/drl.pas, src/drlwad.pas) with FreePascal for
#    wasm32-wasip1 as a Unix build (-dUNIX: Valkyrie's Linux code paths, its
#    curses console among them), with our platform units first on the unit
#    path (port/: curses; port/wasm/: the few Unix units wasip1 lacks, the C
#    heap). FreePascal writes the objects; Emscripten links them with Lua,
#    port/start.c and the JavaScript bridges, with Asyncify for DRL's waits.
# 4. Builds the game data with upstream's own drlwad, run in WebAssembly under
#    Node (the WADs hold Lua bytecode, which records word sizes), from
#    upstream's build.lua without sounds and music (port/wad-manifest.lua):
#    for the console mode also without images (drl-data.data), and with them
#    for the graphical mode (drl-tiles.data).
# 5. Links the same objects twice: the console (text) mode for a Web Worker
#    (drl.mjs), and the graphical (tiles) mode for the page (drl-tiles.mjs),
#    with Emscripten's SDL 3 port, SDL3_image built from source and WebGL 2
#    in place of the libraries Valkyrie loads at run time (port/libraries.c,
#    port/webgl.js).
# 6. Writes games/drl/dist with runtime-manifest.json; links the console
#    objects for Node as the conformance harness (not deployed).
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
export EMSDK_QUIET=1
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"
# shellcheck source=ensure-fpc.sh
source "$GAME_DIR/scripts/ensure-fpc.sh"
# shellcheck source=ports.sh
source "$GAME_DIR/scripts/ports.sh"
ra_drl_seed_ports

WORK="$RA_CACHE/drl"
SRC="$WORK/src-$UPSTREAM_COMMIT"
VSRC="$WORK/fpcvalkyrie-$VALKYRIE_COMMIT"
LUA_SRC="$WORK/lua-$LUA_VERSION"
IMG_SRC="$WORK/sdl3_image-$SDL_IMAGE_COMMIT"
OBJ="$WORK/obj-$UPSTREAM_COMMIT"
OUT="$GAME_DIR/dist"
mkdir -p "$WORK"

ra_checkout "$UPSTREAM_REPO" "$UPSTREAM_TAG" "$UPSTREAM_COMMIT" "$SRC"
ra_checkout "$VALKYRIE_REPO" "$VALKYRIE_TAG" "$VALKYRIE_COMMIT" "$VSRC"
ra_checkout "$SDL_IMAGE_REPO" "$SDL_IMAGE_TAG" "$SDL_IMAGE_COMMIT" "$IMG_SRC"
shopt -s nullglob
for patch in "$GAME_DIR"/patches/drl/*.patch; do
  echo "Applying DRL $(basename "$patch")"
  git -C "$SRC" apply --whitespace=nowarn "$patch"
done
for patch in "$GAME_DIR"/patches/fpcvalkyrie/*.patch; do
  echo "Applying FPC Valkyrie $(basename "$patch")"
  git -C "$VSRC" apply --whitespace=nowarn "$patch"
done
shopt -u nullglob

LUA_TAR="$WORK/lua-$LUA_VERSION.tar.gz"
if [ ! -f "$LUA_TAR" ] || ! echo "$LUA_SHA256  $LUA_TAR" | sha256sum --check --status; then
  curl -sSfL "$LUA_URL" -o "$LUA_TAR"
fi
echo "$LUA_SHA256  $LUA_TAR" | sha256sum --check --status || {
  echo "error: $LUA_TAR does not match LUA_SHA256" >&2
  exit 1
}
rm -rf "$LUA_SRC" && mkdir -p "$LUA_SRC"
tar -xzf "$LUA_TAR" -C "$LUA_SRC" --strip-components=1
for patch in "$GAME_DIR"/patches/lua/*.patch; do
  echo "Applying Lua $(basename "$patch")"
  (cd "$LUA_SRC" && patch --quiet -p1 < "$patch")
done

rm -rf "$OBJ" && mkdir -p "$OBJ/lua" "$OBJ/fpc" "$OBJ/ld" "$OBJ/tiles"

# Lua: the library objects its Makefile lists (CORE_O, LIB_O), for
# WebAssembly; and its interpreter for this machine, to read upstream's
# build.lua (port/wad-manifest.lua).
lua_make_var() {
  make --no-print-directory -C "$LUA_SRC/src" -f Makefile -f - "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
mapfile -t LUA_OBJECTS < <( (lua_make_var CORE_O; lua_make_var LIB_O) | tr ' ' '\n' | grep '\.o$')
if [ "${#LUA_OBJECTS[@]}" -lt 25 ]; then
  echo "error: could not read Lua's object list from its Makefile" >&2
  exit 1
fi
lua_objects=()
for object in "${LUA_OBJECTS[@]}"; do
  emcc -O2 -std=gnu17 -w -c "$LUA_SRC/src/${object%.o}.c" -o "$OBJ/lua/$object" &
  lua_objects+=("$OBJ/lua/$object")
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
wait
emar rcs "$OBJ/lua/liblua5.1.a" "${lua_objects[@]}"
HOST_LUA="$OBJ/lua/lua-host"
cc -O2 -std=gnu17 -w -DLUA_USE_POSIX -o "$HOST_LUA" "$LUA_SRC/src/lua.c" \
  $(for object in "${LUA_OBJECTS[@]}"; do echo "$LUA_SRC/src/${object%.o}.c"; done) -lm

# FreePascal, for wasm32-wasip1. The unit path: our platform units first,
# then the RTL and the packages DRL uses, then Valkyrie (as upstream's
# makefile.lua passes it). -Sgic is FreePascal's default configuration
# (fpc.cfg), which upstream builds with; -n leaves out any local fpc.cfg.
FPC_UNITS="$FPC_DIR/lib/fpc/$FPC_VERSION/units/wasm32-wasip1"
# The compile date and time FreePascal embeds ({$I %DATE%}, which DRL's log
# prints): the upstream commit's, so that a rebuild gives the same bytes.
COMMIT_TIME="$(git -C "$SRC" log -1 --format=%ct)"
FPC_FLAGS=(
  -n -Twasip1 -CTbfexceptions -O2 -Sgic -v0 -dUNIX
  -DD"$(date -u -d "@$COMMIT_TIME" +%Y/%m/%d)" -DT"$(date -u -d "@$COMMIT_TIME" +%H:%M:%S)"
  -Fu"$GAME_DIR/port" -Fu"$GAME_DIR/port/wasm"
)
for package in rtl rtl-objpas rtl-extra rtl-generics fcl-base fcl-xml paszlib hash; do
  FPC_FLAGS+=(-Fu"$FPC_UNITS/$package")
done
FPC_FLAGS+=(-Fu"$VSRC/src" -Fu"$VSRC/libs" -FU"$OBJ/fpc")
# FreePascal calls its linker with the program's objects; this one writes
# them down for Emscripten to link instead.
cat > "$OBJ/ld/wasm-ld" <<'LD'
#!/bin/sh
printf '%s\n' "$@" > "$RA_LINK_ARGS"
LD
chmod +x "$OBJ/ld/wasm-ld"
# -Fa (a unit used before the program's own) needs it compiled first.
"$FPC_WASM" "${FPC_FLAGS[@]}" "$GAME_DIR/port/wasm/ramalloc.pas"
for program in drl drlwad; do
  (cd "$SRC" && RA_LINK_ARGS="$OBJ/$program.link" "$FPC_WASM" "${FPC_FLAGS[@]}" -Faramalloc \
    -Xe -FD"$OBJ/ld" "src/$program.pas")
done
pascal_objects() { grep '\.o$' "$OBJ/$1.link"; }
emcc -O2 -c "$GAME_DIR/port/start.c" -o "$OBJ/start.o"
emcc -O2 -c "$GAME_DIR/port/libraries-none.c" -o "$OBJ/libraries-none.o"

# The graphical mode's libraries. SDL3_image: its sources with PNG only (the
# format DRL's images are in; SDL 3 decodes it), as upstream's CMake build
# compiles them; every other format's file compiles to "not supported".
# Valkyrie's loaders' symbol tables (scripts/libraries.mjs).
SDL_PORT="$(em-config CACHE)/ports/sdl3/SDL-release-3.4.2"
img_objects=()
for source in "$IMG_SRC"/src/IMG*.c; do
  object="$OBJ/tiles/$(basename "${source%.c}").o"
  emcc -O2 -sUSE_SDL=3 -DLOAD_PNG -w -I"$IMG_SRC/include" -c "$source" -o "$object" &
  img_objects+=("$object")
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
wait
node "$GAME_DIR/scripts/libraries.mjs" "$VSRC" "$SDL_PORT" "$IMG_SRC" "$OBJ/tiles/symbols.c"
emcc -O2 -sUSE_SDL=3 -I"$IMG_SRC/include" -c "$OBJ/tiles/symbols.c" -o "$OBJ/tiles/symbols.o"
emcc -O2 -sUSE_SDL=3 -c "$GAME_DIR/port/libraries.c" -o "$OBJ/tiles/libraries.o"

COMMON_LDFLAGS=(
  -sMALLOC=none
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=524288
  -sSTACK_SIZE=4194304
  -sINITIAL_MEMORY=16777216
  -sMAXIMUM_MEMORY=536870912
  -sALLOW_MEMORY_GROWTH=1
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=1
  -sFORCE_FILESYSTEM=1
  -sEXPORTED_FUNCTIONS=_ra_start
  --js-library "$GAME_DIR/port/wasi-emscripten.js"
  --js-library "$GAME_DIR/port/host.js"
)
# DRL_PROFILING=1: function names in the modules (stack traces in a browser's
# profiler or debugger); a debugging aid, never for a deployed build.
if [ "${DRL_PROFILING:-0}" = "1" ]; then COMMON_LDFLAGS+=(--profiling-funcs); fi
NODE_LDFLAGS=(
  -O2 -sENVIRONMENT=node -sMODULARIZE=1 -lnodefs.js
  -sEXPORTED_RUNTIME_METHODS=ccall,FS,NODEFS
  -sINCOMING_MODULE_JS_API=print,printErr,preRun,onExit
)

# The WAD builder, for Node.
TOOLS="$WORK/tools-$UPSTREAM_COMMIT"
rm -rf "$TOOLS" && mkdir -p "$TOOLS"
mapfile -t objects < <(pascal_objects drlwad)
emcc "${objects[@]}" "$OBJ/start.o" "$OBJ/libraries-none.o" "$OBJ/lua/liblua5.1.a" "${COMMON_LDFLAGS[@]}" "${NODE_LDFLAGS[@]}" \
  -o "$TOOLS/drlwad.cjs"

# Game data: upstream's WADs for each mode (stage/console, stage/graphics),
# and its config.lua.
STAGE="$WORK/stage"
rm -rf "$STAGE"
rm -rf "$OUT" && mkdir -p "$OUT"
for mode in console graphics; do
  mkdir -p "$STAGE/$mode/drl"
  "$HOST_LUA" "$GAME_DIR/port/wad-manifest.lua" "$SRC" /upstream /out "$mode" > "$STAGE/$mode/manifest.lua"
  node "$GAME_DIR/scripts/run-node.mjs" "$TOOLS/drlwad.cjs" \
    --mount "$SRC=/upstream" --mount "$STAGE/$mode/drl=/out" --mount "$STAGE/$mode=/stage" -- /stage/manifest.lua
  for wad in core.wad drl.wad; do
    [ -s "$STAGE/$mode/drl/$wad" ] || { echo "error: drlwad did not write $wad ($mode)" >&2; exit 1; }
  done
  cp "$SRC/bin/config.lua" "$STAGE/$mode/drl/config.lua"
done
# Run from the output directory with a relative name: the packager writes the
# package's path into the loader, and an absolute one would differ by checkout.
(cd "$OUT" && python3 "$EMSDK/upstream/emscripten/tools/file_packager.py" drl-data.data \
  --preload "$STAGE/console/drl@/drl" --js-output="$WORK/drl-data.js" \
  --no-node --export-name=Module > /dev/null)
(cd "$OUT" && python3 "$EMSDK/upstream/emscripten/tools/file_packager.py" drl-tiles.data \
  --preload "$STAGE/graphics/drl@/drl" --js-output="$WORK/drl-tiles-data.js" \
  --no-node --export-name=Module > /dev/null)

mapfile -t objects < <(pascal_objects drl)
emcc "${objects[@]}" "$OBJ/start.o" "$OBJ/libraries-none.o" "$OBJ/lua/liblua5.1.a" "${COMMON_LDFLAGS[@]}" \
  -O2 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDrl \
  -sENVIRONMENT=worker -lidbfs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,ccall \
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,onExit,instantiateWasm,preRun \
  --pre-js "$WORK/drl-data.js" \
  -o "$OUT/drl.mjs"

# The graphical mode, for the page's main thread (Emscripten's SDL 3 draws
# into a canvas of the document and reads its events; Asyncify keeps the page
# responsive while DRL waits).
emcc "${objects[@]}" "$OBJ/start.o" "$OBJ/tiles/libraries.o" "$OBJ/tiles/symbols.o" "${img_objects[@]}" \
  "$OBJ/lua/liblua5.1.a" "${COMMON_LDFLAGS[@]}" \
  -O2 \
  -sUSE_SDL=3 -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 \
  --js-library "$GAME_DIR/port/webgl.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDrlTiles \
  -sENVIRONMENT=web -lidbfs.js \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,ccall,ENV \
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,onExit,instantiateWasm,preRun,canvas,preinitializedWebGLContext \
  --pre-js "$WORK/drl-tiles-data.js" \
  -o "$OUT/drl-tiles.mjs"

# Licences (LICENSES.md has the inventory).
mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE" "$OUT/licenses/DRL-LICENSE.txt"
cp "$VSRC/LICENSE" "$OUT/licenses/FPC-Valkyrie-LICENSE.txt"
cp "$LUA_SRC/COPYRIGHT" "$OUT/licenses/Lua-COPYRIGHT.txt"
fpc_src="$RA_CACHE/fpc/src-$FPC_COMMIT"
cp "$fpc_src/rtl/COPYING.FPC" "$OUT/licenses/FreePascal-RTL-COPYING.FPC.txt"
cp "$fpc_src/rtl/COPYING.txt" "$OUT/licenses/FreePascal-RTL-COPYING.txt"
# The tiles mode: DRL's art (CC BY-SA 4.0) and the libraries linked into it.
cp "$SRC/bin/data/drl/graphics/LICENSE" "$OUT/licenses/DRL-graphics-CC-BY-SA-4.0.txt"
cp "$GAME_DIR/licenses/DRL-graphics-ATTRIBUTION.txt" "$OUT/licenses/DRL-graphics-ATTRIBUTION.txt"
cp "$SDL_PORT/LICENSE.txt" "$OUT/licenses/SDL3-LICENSE.txt"
cp "$IMG_SRC/LICENSE.txt" "$OUT/licenses/SDL3_image-LICENSE.txt"

# Conformance harness: the same objects for Node, the data from a directory.
# scripts/test-engine.sh builds the native counterpart. Not deployed.
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
if [ "${ROGUE_ARCHIVE_HARNESS:-1}" != "0" ]; then
  rm -rf "$HARNESS" && mkdir -p "$HARNESS"
  emcc "${objects[@]}" "$OBJ/start.o" "$OBJ/libraries-none.o" "$OBJ/lua/liblua5.1.a" "${COMMON_LDFLAGS[@]}" "${NODE_LDFLAGS[@]}" \
    -o "$HARNESS/drl-node.cjs"
  cp -r "$STAGE/console/drl" "$HARNESS/data"
fi

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game drl \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION, freepascal $FPC_VERSION ($FPC_COMMIT)"

echo "Built DRL $UPSTREAM_TAG into $OUT"

#!/usr/bin/env bash
# Reproducible WebAssembly build of Brogue CE for Rogue Archive.
#
#   games/brogue-ce/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env).
# 3. Applies patches from games/brogue-ce/patches/*.patch (currently none).
# 4. Compiles upstream sources plus port/rogue-archive-platform.c.
# 5. Writes runtime artifacts and runtime-manifest.json to games/brogue-ce/dist.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/brogue-ce"
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

# Start every build from pristine upstream, then apply our patches (if any).
git -C "$SRC" checkout --quiet -- .
git -C "$SRC" clean --quiet -fdx
shopt -s nullglob
for patch in "$GAME_DIR"/patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git -C "$SRC" apply --whitespace=nowarn "$patch"
done
shopt -u nullglob

# Upstream release builds define an empty extra version string.
CPPFLAGS=(
  -DDATADIR=.
  -DBROGUE_EXTRA_VERSION='""'
  # Select our console through upstream main.c's existing BROGUE_WEB branch,
  # renaming the symbol so upstream's socket-based web-platform.c is not used.
  -DBROGUE_WEB
  -DwebConsole=rogueArchiveConsole
)
# Ask upstream's own Makefile which sources and include paths the core game
# needs (no SDL/curses/web platforms), so files upstream adds in a new release
# (e.g. a vendored library) are picked up without editing this script.
upstream_make_var() {
  make --no-print-directory -C "$SRC" -f Makefile -f - GRAPHICS=NO TERMINAL=NO WEBBROGUE=NO RELEASE=YES \
    "print-$1" <<'MAKE'
print-%: ; @echo $($*)
MAKE
}
mapfile -t UPSTREAM_SOURCES < <(upstream_make_var sources | tr ' ' '\n' | grep '\.c$')
INCLUDES=()
for flag in $(upstream_make_var cflags); do
  case "$flag" in -I*) INCLUDES+=("-I$SRC/${flag#-I}") ;; esac
done
if [ "${#UPSTREAM_SOURCES[@]}" -lt 20 ] || [ "${#INCLUDES[@]}" -lt 3 ]; then
  echo "error: could not read the source list from upstream's Makefile" >&2
  exit 1
fi

CFLAGS=(
  "${INCLUDES[@]}"
  -std=c99 -O2
  -Wall -Wno-parentheses -Wno-unused-result -Wno-unused-but-set-variable
  -Werror=implicit -Werror=format-security
)
SOURCES=()
for source in "${UPSTREAM_SOURCES[@]}"; do SOURCES+=("$SRC/$source"); done
SOURCES+=("$GAME_DIR/port/rogue-archive-platform.c")
LDFLAGS=(
  -O2
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=131072
  -sSTACK_SIZE=8388608
  -sINITIAL_MEMORY=67108864
  -sALLOW_MEMORY_GROWTH=1
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createBrogue
  -sENVIRONMENT=worker
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=0
  -sFORCE_FILESYSTEM=1
  -lidbfs.js
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain,UTF8ToString
  # The ra* bridge hooks are read directly from the Module object by EM_JS code.
  -sINCOMING_MODULE_JS_API=print,printErr,locateFile,onAbort,wasmBinary
  -lm
)

rm -rf "$OBJ" && mkdir -p "$OBJ"
objects=()
for src in "${SOURCES[@]}"; do
  # Upstream source basenames are unique across src/brogue, src/variants and src/platform.
  obj="$OBJ/$(basename "${src%.c}").o"
  objects+=("$obj")
  emcc "${CPPFLAGS[@]}" "${CFLAGS[@]}" -c "$src" -o "$obj" &
  # Bound parallelism to the number of CPUs.
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
wait

rm -rf "$OUT" && mkdir -p "$OUT"
emcc "${objects[@]}" "${LDFLAGS[@]}" -o "$OUT/brogue.mjs"

# Conformance test harness: the SAME object files linked for Node with direct
# filesystem access, so upstream's seed catalogs and recordings can be checked
# against exactly the code we ship (see scripts/test-engine.sh). Not deployed.
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
rm -rf "$HARNESS" && mkdir -p "$HARNESS"
emcc "${objects[@]}" -O2 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072 -sSTACK_SIZE=8388608 \
  -sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=node -sNODERAWFS=1 \
  -sEXIT_RUNTIME=1 -lm -o "$HARNESS/brogue-node.cjs"

# Runtime data used by the browser renderer (not by the WASM module).
cp "$SRC/bin/assets/tiles.png" "$OUT/tiles.png"
mkdir -p "$OUT/licenses"
cp "$SRC/LICENSE.txt" "$OUT/licenses/BrogueCE-LICENSE.txt"
cp "$SRC/bin/assets/LICENSE.txt" "$OUT/licenses/tiles-LICENSE.txt"

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game brogue-ce \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built Brogue CE $UPSTREAM_TAG into $OUT"

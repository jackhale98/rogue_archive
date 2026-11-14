#!/usr/bin/env bash
# Reproducible WebAssembly build of NetHack for Rogue Archive.
#
#   games/nethack/scripts/build.sh
#
# 1. Installs/activates the pinned Emscripten SDK (tools/toolchain.env).
# 2. Fetches the pinned upstream tag and verifies its commit (upstream.env);
#    applies games/nethack/patches/*.patch.
# 3. Runs upstream's own web build: `sys/unix/setup.sh hints/linux.500`,
#    `make fetch-lua` (checked against upstream's checksums) and
#    `make CROSS_TO_WASM=1` (Cross-compiling, "Case sample: Web Assembly"),
#    which compiles the game with the "shim" window port, the game data
#    embedded, and Asyncify so the page can answer window calls.
# 4. Writes games/nethack/dist with runtime-manifest.json.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../../tools/ensure-emsdk.sh
source "$ROOT/tools/ensure-emsdk.sh"

WORK="$RA_CACHE/nethack"
SRC="$WORK/src-$UPSTREAM_COMMIT"
BUILD="$WORK/build-$UPSTREAM_COMMIT"
OUT="$GAME_DIR/dist"
mkdir -p "$WORK"

# The pinned commit, fetched once and checked.
if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC" && mkdir -p "$SRC"
  git -C "$SRC" init --quiet
  git -C "$SRC" remote add origin "$UPSTREAM_REPO"
  git -C "$SRC" fetch --quiet --depth 1 origin "$UPSTREAM_COMMIT"
  git -C "$SRC" checkout --quiet FETCH_HEAD
fi
if [ "$(git -C "$SRC" rev-parse HEAD)" != "$UPSTREAM_COMMIT" ]; then
  echo "error: $SRC is not at $UPSTREAM_COMMIT" >&2
  exit 1
fi

# Upstream's web build flags, with two warnings newer compilers add turned
# off (they are errors under upstream's -Werror): a variable set but unused in
# files.c, and compile flags upstream also passes to the link step.
EMCC_CFLAGS="-Wall -Werror -Wno-unused-but-set-global -Wno-unused-command-line-argument -DNO_SIGNAL -O3"
# The game data is embedded at the root of the module's file system.
MAKE_VARS=(CROSS_TO_WASM=1 "EMCC_CFLAGS=$EMCC_CFLAGS" HACKDIR=/)

# A build tree: a copy of the pinned source with the patches applied. Kept
# between runs (make is incremental) unless the patches, flags or toolchain change.
STAMP="$(cat "$GAME_DIR"/patches/*.patch <(printf '%s\n' "${MAKE_VARS[@]}" "$EMSDK_VERSION" "$LUA_VERSION") | sha256sum | cut -c1-16)"
if [ ! -f "$BUILD/.ra-stamp" ] || [ "$(cat "$BUILD/.ra-stamp")" != "$STAMP" ]; then
  rm -rf "$BUILD"
  cp -a "$SRC" "$BUILD"
  git -C "$BUILD" checkout --quiet -- .
  git -C "$BUILD" clean --quiet -fdx
  shopt -s nullglob
  for patch in "$GAME_DIR"/patches/*.patch; do
    echo "Applying $(basename "$patch")"
    git -C "$BUILD" apply --whitespace=nowarn "$patch"
  done
  shopt -u nullglob
  (cd "$BUILD/sys/unix" && sh setup.sh hints/linux.500 >/dev/null)
  # Lua: upstream's own download, checked against its checksum list; kept in
  # the cache so later builds need no network.
  if [ -d "$WORK/lua-$LUA_VERSION" ]; then
    mkdir -p "$BUILD/lib" && cp -a "$WORK/lua-$LUA_VERSION" "$BUILD/lib/"
  else
    make --no-print-directory -s -C "$BUILD" fetch-lua LUA_VERSION="$LUA_VERSION"
    cp -a "$BUILD/lib/lua-$LUA_VERSION" "$WORK/"
  fi
  echo "$STAMP" > "$BUILD/.ra-stamp"
fi

echo "Building NetHack $UPSTREAM_VERSION (upstream's web build; a few minutes the first time)..."
make --no-print-directory -s -C "$BUILD" "${MAKE_VARS[@]}" >"$WORK/make.log" 2>&1 || {
  tail -40 "$WORK/make.log" >&2
  exit 1
}

rm -rf "$OUT" && mkdir -p "$OUT/licenses"
cp "$BUILD/targets/wasm/nethack.js" "$OUT/nethack.mjs"
cp "$BUILD/targets/wasm/nethack.wasm" "$OUT/nethack.wasm"
cp "$BUILD/dat/license" "$OUT/licenses/NetHack-General-Public-License.txt"
# Lua's MIT licence is the notice at the end of lua.h.
sed -n '/^\* Copyright (C)/,/^\*\//p' "$BUILD/lib/lua-$LUA_VERSION/src/lua.h" >"$OUT/licenses/Lua-license.txt"

node "$ROOT/tools/write-runtime-manifest.mjs" \
  --dir "$OUT" \
  --game nethack \
  --upstream-repo "$UPSTREAM_REPO" \
  --upstream-tag "$UPSTREAM_TAG" \
  --upstream-commit "$UPSTREAM_COMMIT" \
  --toolchain "emscripten $EMSDK_VERSION"

echo "Built NetHack $UPSTREAM_VERSION into $OUT"

#!/usr/bin/env bash
# Engine conformance for the DCSS port (run after scripts/build.sh):
#
# 1. Key coverage: every touch/palette command sends a key that upstream's
#    cmd-keys.h binds to the command it claims (tests/conformance/key-coverage.ts).
# 2. Upstream drift: the WebTiles socket interface our platform layer replaces
#    is unchanged (tests/conformance/upstream-drift.ts).
# 3. Native vs WebAssembly: upstream's objects built natively by upstream's
#    Makefile and linked with the replay platform layer, against the WASM
#    harness built by build.sh, replaying seeded games
#    (tests/conformance/scenarios.json); every message must match.
#    The native build uses clang with LLVM's libc++, the C++ library
#    Emscripten uses. (With GCC's libstdc++, games diverge after a few turns:
#    the two libraries order equal elements in std::sort differently, e.g.
#    los.cc's ray table. That is a property of the libraries, not of the
#    WebAssembly build.) Requires clang and libc++ (apt: libc++-dev libc++abi-dev).
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$GAME_DIR/../.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
WORK="$RA_CACHE/dcss"
SRC="$WORK/src-$UPSTREAM_COMMIT"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT/crawl-node.cjs"
DATA="$WORK/stage/crawl/data"
JOBS="${ROGUE_ARCHIVE_JOBS:-$(nproc)}"
export LC_ALL=C.UTF-8

if [ ! -f "$HARNESS" ] || [ ! -d "$DATA" ]; then
  echo "error: run games/dcss/scripts/build.sh first (no harness at $HARNESS)" >&2
  exit 1
fi

echo "== 1. Key coverage and upstream drift"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC/crawl-ref/source"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC/crawl-ref/source"

echo "== 2. Native build (upstream's Makefile)"
NATIVE="$WORK/native-libcxx-$UPSTREAM_COMMIT"
if [ ! -d "$NATIVE/crawl-ref/source" ]; then
  rm -rf "$NATIVE"
  # A separate tree: upstream builds in place, and this one is not cross-compiled.
  git -C "$SRC" worktree prune
  cp -r "$SRC" "$NATIVE"
  git -C "$NATIVE" clean --quiet -fdx
  git -C "$NATIVE" submodule foreach --quiet git clean --quiet -fdx
fi
NATIVE_SAVES="$WORK/native-saves"
NATIVE_VARS=(GXX="clang++ -stdlib=libc++" GCC=clang WEBTILES=y NO_YACC=y NOWIZARD=y BUILD_PCRE=y DATADIR="$DATA" SAVEDIR="$NATIVE_SAVES")
make --no-print-directory -C "$NATIVE/crawl-ref/source" -j"$JOBS" "${NATIVE_VARS[@]}" crawl > "$WORK/native-build.log" 2>&1 \
  || { tail -40 "$WORK/native-build.log"; exit 1; }
native_var() {
  make --no-print-directory -C "$NATIVE/crawl-ref/source" -f Makefile -f - "${NATIVE_VARS[@]}" "print-$1" <<'MAKE' | tail -n 1
print-%: ; @echo $($*)
MAKE
}
read -r -a OBJS <<< "$(native_var GAME_OBJS)"
read -r -a LIBS <<< "$(native_var LIBS)"
OBJECTS=()
for object in "${OBJS[@]}"; do OBJECTS+=("$NATIVE/crawl-ref/source/$object"); done
LINK=()
for lib in "${LIBS[@]}"; do
  case "$lib" in
    -L/*|/*) LINK+=("$lib") ;;
    -L*) LINK+=("-L$NATIVE/crawl-ref/source/${lib#-L}") ;;
    contrib/*) LINK+=("$NATIVE/crawl-ref/source/$lib") ;;
    *) LINK+=("$lib") ;;
  esac
done
clang++ -stdlib=libc++ -O2 -std=c++17 -c "$GAME_DIR/tests/conformance/replay-platform.cc" -o "$WORK/replay-platform.o"
clang++ -stdlib=libc++ "$WORK/replay-platform.o" "${OBJECTS[@]}" "${LINK[@]}" -o "$WORK/crawl-native-replay"

echo "== 3. Seeded games: native vs WebAssembly"
RA_NATIVE_SAVES="$NATIVE_SAVES" node "$GAME_DIR/tests/conformance/replay.mjs" \
  "$WORK/crawl-native-replay" "$HARNESS" "$DATA" "$WORK/replays"
echo "All DCSS engine conformance checks passed."

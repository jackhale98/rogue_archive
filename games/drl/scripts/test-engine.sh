#!/usr/bin/env bash
# Engine conformance for the DRL port. Run after scripts/build.sh.
#
# 1. Key coverage: every command reaches its default binding through the
#    console's input path, read from upstream's sources (key-coverage.ts).
# 2. Upstream drift: the upstream files the port relies on are unchanged
#    (upstream-drift.ts, drift.json).
# 3. A native build (x86_64-linux) of the same sources with the same
#    FreePascal and the same curses (port/ncurses.pas), its host a Pascal
#    unit (tests/conformance/rareplay.pas), and native WADs from upstream's
#    drlwad built natively (their Lua bytecode in the native word size).
# 4. Native vs WebAssembly replays: each scenario's keys, the same rule for
#    when the next key goes in; every screen and the saved game must match.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=ensure-fpc.sh
source "$GAME_DIR/scripts/ensure-fpc.sh" > /dev/null
WORK="$RA_CACHE/drl"
SRC="$WORK/src-$UPSTREAM_COMMIT"
VSRC="$WORK/fpcvalkyrie-$VALKYRIE_COMMIT"
LUA_SRC="$WORK/lua-$LUA_VERSION"
HARNESS="$WORK/harness-$UPSTREAM_COMMIT"
NATIVE="$WORK/native-$UPSTREAM_COMMIT"
CC="${CC:-cc}"

if [ ! -f "$HARNESS/drl-node.cjs" ]; then
  echo "error: run games/drl/scripts/build.sh first (no harness at $HARNESS)" >&2
  exit 1
fi

echo "== 1. Key coverage"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/key-coverage.ts" "$SRC" "$VSRC"

echo "== 2. Upstream drift"
node --experimental-strip-types --no-warnings "$GAME_DIR/tests/conformance/upstream-drift.ts" "$SRC" "$VSRC"

echo "== 3. Native build"
rm -rf "$NATIVE" && mkdir -p "$NATIVE/obj" "$NATIVE/lua" "$NATIVE/data"
mapfile -t LUA_OBJECTS < <(make --no-print-directory -C "$LUA_SRC/src" -f Makefile -f - print-objects <<'MAKE' | tail -n 1 | tr ' ' '\n' | grep '\.o$'
print-objects: ; @echo $(CORE_O) $(LIB_O)
MAKE
)
for object in "${LUA_OBJECTS[@]}"; do
  "$CC" -O2 -std=gnu17 -w -DLUA_USE_POSIX -c "$LUA_SRC/src/${object%.o}.c" -o "$NATIVE/lua/$object" &
  while [ "$(jobs -rp | wc -l)" -ge "$(nproc)" ]; do wait -n; done
done
wait
ar rcs "$NATIVE/lua/lua5.1.a" "${LUA_OBJECTS[@]/#/$NATIVE/lua/}"
FPC_UNITS="$FPC_DIR/lib/fpc/$FPC_VERSION/units/x86_64-linux"
# The packages the WebAssembly build uses, and those Valkyrie's Linux code
# paths need (x11, pthreads, rtl-console); not ncurses: port/ncurses.pas is the curses.
NATIVE_FLAGS=(-n -Sgic -O2 -v0 -Fu"$GAME_DIR/port" -Fu"$GAME_DIR/tests/conformance")
for package in rtl rtl-objpas rtl-extra rtl-generics rtl-console rtl-unicode fcl-base fcl-xml paszlib hash x11 pthreads; do
  NATIVE_FLAGS+=(-Fu"$FPC_UNITS/$package")
done
NATIVE_FLAGS+=(-Fu"$VSRC/src" -Fu"$VSRC/libs" -Fl"$NATIVE/lua" -FU"$NATIVE/obj" -FE"$NATIVE")
"$FPC_NATIVE" "${NATIVE_FLAGS[@]}" "$GAME_DIR/tests/conformance/rareplay.pas"
(cd "$SRC" && "$FPC_NATIVE" "${NATIVE_FLAGS[@]}" -Farareplay src/drl.pas)
(cd "$SRC" && "$FPC_NATIVE" "${NATIVE_FLAGS[@]}" src/drlwad.pas)
cc -O2 -std=gnu17 -w -DLUA_USE_POSIX -o "$NATIVE/lua/lua-host" "$LUA_SRC/src/lua.c" "$NATIVE/lua/lua5.1.a" -lm
"$NATIVE/lua/lua-host" "$GAME_DIR/port/console-manifest.lua" "$SRC" "$SRC" "$NATIVE/data" > "$NATIVE/manifest.lua"
(cd "$NATIVE" && ./drlwad "$NATIVE/manifest.lua")
cp "$SRC/bin/config.lua" "$NATIVE/data/config.lua"

echo "== 4. Native vs WebAssembly replays"
node "$GAME_DIR/tests/conformance/replay.mjs" \
  --native "$NATIVE/drl" --native-data "$NATIVE/data" \
  --wasm "$HARNESS/drl-node.cjs" --wasm-data "$HARNESS/data" \
  --runs "$WORK/runs" \
  --scenarios "$GAME_DIR/tests/conformance/scenarios.json"

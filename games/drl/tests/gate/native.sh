#!/usr/bin/env bash
# The native (Linux) reference for the Tiles display: upstream's graphical
# mode built from the same sources with the same FreePascal, run under Xvfb
# with Mesa's software OpenGL, driven by keys, screenshots taken. A manual
# check, not part of CI. Run scripts/build.sh and scripts/test-engine.sh first
# (it reuses the conformance build's native Lua and drlwad).
#
#   games/drl/tests/gate/native.sh <WxH> <out dir> step...
#
# Steps (tests/gate/xkeys.py): an X key name (Return, Down, Escape, a...),
# name@ms to wait after it, wait:ms, shot:<file.png>.
# Needs: Xvfb, Mesa (EGL), ImageMagick (import), python3, a C compiler.
set -euo pipefail
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../scripts/upstream.sh
source "$GAME_DIR/scripts/upstream.sh"
# shellcheck source=../../scripts/ensure-fpc.sh
source "$GAME_DIR/scripts/ensure-fpc.sh" > /dev/null
size="$1"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
shift 2
WORK="$RA_CACHE/drl"
SRC="$WORK/src-$UPSTREAM_COMMIT"
VSRC="$WORK/fpcvalkyrie-$VALKYRIE_COMMIT"
IMG_SRC="$WORK/sdl3_image-$SDL_IMAGE_COMMIT"
NATIVE="$WORK/native-$UPSTREAM_COMMIT"
G="$WORK/native-graphics"
[ -x "$NATIVE/drlwad" ] || { echo "error: run scripts/test-engine.sh first" >&2; exit 1; }

# DRL, natively, as the conformance build (rareplay provides the curses host
# the console unit links against; the graphical mode does not use it).
rm -rf "$G" && mkdir -p "$G/obj" "$G/data" "$G/lib"
FPC_UNITS="$FPC_DIR/lib/fpc/$FPC_VERSION/units/x86_64-linux"
FLAGS=(-n -Sgic -O2 -v0 -Fu"$GAME_DIR/port" -Fu"$GAME_DIR/tests/conformance")
for package in rtl rtl-objpas rtl-extra rtl-generics rtl-console rtl-unicode fcl-base fcl-xml paszlib hash x11 pthreads; do
  FLAGS+=(-Fu"$FPC_UNITS/$package")
done
FLAGS+=(-Fu"$VSRC/src" -Fu"$VSRC/libs" -Fl"$NATIVE/lua" -FU"$G/obj" -FE"$G")
"$FPC_NATIVE" "${FLAGS[@]}" "$GAME_DIR/tests/conformance/rareplay.pas" > /dev/null
(cd "$SRC" && "$FPC_NATIVE" "${FLAGS[@]}" -Farareplay src/drl.pas > /dev/null)
"$NATIVE/lua/lua-host" "$GAME_DIR/port/wad-manifest.lua" "$SRC" "$SRC" "$G/data" graphics > "$G/manifest.lua"
(cd "$NATIVE" && ./drlwad "$G/manifest.lua")
cp "$SRC/bin/config.lua" "$G/data/config.lua"

# Upstream's libSDL3 (ext/linux), and SDL3_image from the same source and
# configuration as the WebAssembly build (upstream's binary needs libraries
# of an older distribution).
cp "$SRC/ext/linux/libSDL3.so.0.4.2" "$G/lib/"
ln -sf libSDL3.so.0.4.2 "$G/lib/libSDL3.so.0"
SDL_INCLUDE="$(dirname "$(command -v emcc 2> /dev/null || echo /nonexistent)")/cache/ports/sdl3/SDL-release-3.4.2/include"
[ -d "$SDL_INCLUDE" ] || SDL_INCLUDE="$RA_CACHE/emsdk/upstream/emscripten/cache/ports/sdl3/SDL-release-3.4.2/include"
"${CC:-cc}" -shared -fPIC -O2 -w -DLOAD_PNG -I"$IMG_SRC/include" -I"$SDL_INCLUDE" "$IMG_SRC"/src/IMG*.c \
  -L"$G/lib" -l:libSDL3.so.0.4.2 -Wl,-soname,libSDL3_image.so.0 -o "$G/lib/libSDL3_image.so.0.4.0"
ln -sf libSDL3_image.so.0.4.0 "$G/lib/libSDL3_image.so.0"

# Run it: Xvfb has no GLX for Mesa here, so SDL uses EGL.
home="$out/home"
rm -rf "$home" && mkdir -p "$home"
Xvfb :97 -screen 0 "${size}x24" > /dev/null 2>&1 &
xvfb=$!
trap 'kill $xvfb 2> /dev/null || true' EXIT
sleep 1
export DISPLAY=:97
(cd "$out" && SDL_VIDEO_FORCE_EGL=1 LD_LIBRARY_PATH="$G/lib" "$G/drl" --graphics --no-sound --windowed \
  --config="$G/data/config.lua" --data-path="$G/data/" --write-path="$home/" > "$home/stdout.txt" 2>&1) &
drl=$!
(cd "$out" && python3 "$GAME_DIR/tests/gate/xkeys.py" "$@")
kill $drl 2> /dev/null || true

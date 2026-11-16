#!/usr/bin/env bash
# Compiler used for upstream's `make NATIVE=emscripten` (as CXX). Upstream
# builds with Emscripten 3.1.51; the pinned, newer Emscripten
# (tools/toolchain.env) differs in two ways this restores:
#
# - It no longer predefines the legacy EMSCRIPTEN macro (only __EMSCRIPTEN__).
#   Upstream's web code is written as `#if defined(EMSCRIPTEN)` (the IndexedDB
#   mount, the yield in each redraw, the unsaved-game flag...), so without it
#   that code is silently left out. -DEMSCRIPTEN puts it back.
# - It warns about things the older one did not, and upstream compiles with
#   -Werror. Warnings stay on; they just don't stop the build.
#
# build.sh keys the object directory on this file, so changing it rebuilds.
exec emcc "$@" -DEMSCRIPTEN -Wno-error

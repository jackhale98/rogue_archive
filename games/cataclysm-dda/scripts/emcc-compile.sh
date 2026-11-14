#!/usr/bin/env bash
# Compiler used for upstream's `make NATIVE=emscripten` (as CXX). Upstream
# compiles with -Werror and tests with Emscripten 3.1.51; the pinned, newer
# Emscripten (tools/toolchain.env) warns about things the older one did not.
# Warnings stay on; they just don't stop the build.
exec emcc "$@" -Wno-error

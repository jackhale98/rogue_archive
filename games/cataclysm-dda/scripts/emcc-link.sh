#!/usr/bin/env bash
# Linker used for upstream's `make NATIVE=emscripten` (as LD): em++, which the
# pinned Emscripten needs to link C++ (upstream's emcc did with 3.1.51). Upstream's link
# command and flags are kept as they are; build.sh adds Rogue Archive's object
# and flags (the page's module interface, the link-time wrappers, the data
# package loader) in a response file named by RA_LINK_RSP.
exec em++ "$@" "@${RA_LINK_RSP:?build.sh sets RA_LINK_RSP}"

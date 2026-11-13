#!/usr/bin/env bash
# Installs (once) and activates the pinned Emscripten SDK in the local cache.
# Usage: source tools/ensure-emsdk.sh
set -euo pipefail
_ra_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=toolchain.env
source "$_ra_root/tools/toolchain.env"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
mkdir -p "$RA_CACHE"
EMSDK_DIR="$RA_CACHE/emsdk"
if [ ! -d "$EMSDK_DIR/.git" ]; then
  git clone --quiet "$EMSDK_REPO" "$EMSDK_DIR"
fi
if [ ! -f "$EMSDK_DIR/.ra-installed-$EMSDK_VERSION" ]; then
  (cd "$EMSDK_DIR" && git fetch --quiet --tags && git checkout --quiet "$EMSDK_VERSION" \
    && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION")
  touch "$EMSDK_DIR/.ra-installed-$EMSDK_VERSION"
fi
# emsdk_env.sh is not written for `set -u`.
set +u
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" > /dev/null
set -u
emcc --version | head -1

#!/usr/bin/env bash
# Installs (once) the pinned FreePascal compiler: native (x86_64-linux, for
# the conformance build) and the wasm32-wasip1 cross compiler, with
# patches/fpc/*.patch applied, into the local cache.
# Usage: source games/drl/scripts/ensure-fpc.sh   (sets FPC_DIR, FPC_NATIVE, FPC_WASM)
set -euo pipefail
_ra_drl_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../toolchain.env
source "$_ra_drl_dir/toolchain.env"
RA_CACHE="${ROGUE_ARCHIVE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/rogue-archive}"
_ra_fpc_key="$(cat "$_ra_drl_dir/toolchain.env" "$_ra_drl_dir"/patches/fpc/*.patch "${BASH_SOURCE[0]}" | sha256sum | cut -c1-12)"
FPC_DIR="$RA_CACHE/fpc/$FPC_COMMIT-$_ra_fpc_key"
FPC_NATIVE="$FPC_DIR/lib/fpc/$FPC_VERSION/ppcx64"
FPC_WASM="$FPC_DIR/lib/fpc/$FPC_VERSION/ppcrosswasm32"

if [ ! -x "$FPC_WASM" ] || [ ! -f "$FPC_DIR/.ra-installed" ]; then
  if ! command -v fpc > /dev/null; then
    echo "error: building FreePascal $FPC_VERSION needs a released fpc to start from (apt-get install fpc)" >&2
    exit 1
  fi
  bootstrap="$(fpc -iV)"
  case " $FPC_BOOTSTRAP_VERSIONS " in
    *" $bootstrap "*) ;;
    *) echo "error: fpc $bootstrap found; FreePascal $FPC_VERSION is built from one of: $FPC_BOOTSTRAP_VERSIONS" >&2; exit 1 ;;
  esac
  src="$RA_CACHE/fpc/src-$FPC_COMMIT"
  if [ ! -d "$src/.git" ]; then
    rm -rf "$src" && mkdir -p "$src"
    git -C "$src" init --quiet
    git -C "$src" remote add origin "$FPC_REPO"
    git -C "$src" fetch --quiet --depth 1 origin "$FPC_COMMIT"
    git -C "$src" checkout --quiet FETCH_HEAD
  fi
  actual="$(git -C "$src" rev-parse HEAD)"
  if [ "$actual" != "$FPC_COMMIT" ]; then
    echo "error: FreePascal source is at $actual, expected $FPC_COMMIT" >&2
    exit 1
  fi
  git -C "$src" checkout --quiet -- .
  git -C "$src" clean --quiet -fdx
  for patch in "$_ra_drl_dir"/patches/fpc/*.patch; do
    echo "Applying FreePascal $(basename "$patch")"
    git -C "$src" apply "$patch"
  done
  rm -rf "$FPC_DIR"
  jobs="$(nproc)"
  echo "Building FreePascal $FPC_VERSION ($FPC_COMMIT) with fpc $bootstrap..."
  log="$RA_CACHE/fpc/build-$FPC_COMMIT.log"
  (
    cd "$src"
    # Native compiler, RTL and packages; the compiler builds itself in cycles.
    make all FPC="$(command -v fpc)" OPT="-O2" FPMAKEOPT="-T $jobs"
    make install PREFIX="$FPC_DIR" FPC="$src/compiler/ppcx64"
    # The wasm32-wasip1 cross compiler, its RTL and packages, with branchful
    # exceptions (wasm exception handling does not combine with Asyncify).
    make crossall OS_TARGET=wasip1 CPU_TARGET=wasm32 FPC="$FPC_NATIVE" \
      CROSSOPT="-CTbfexceptions -O2" FPMAKEOPT="-T $jobs"
    make crossinstall OS_TARGET=wasip1 CPU_TARGET=wasm32 FPC="$FPC_NATIVE" \
      CROSSOPT="-CTbfexceptions -O2" INSTALL_PREFIX="$FPC_DIR"
  ) > "$log" 2>&1 || {
    tail -n 40 "$log" >&2
    echo "error: building FreePascal failed (log: $log)" >&2
    exit 1
  }
  touch "$FPC_DIR/.ra-installed"
fi
"$FPC_WASM" -iV > /dev/null
echo "FreePascal $("$FPC_WASM" -iV) ($FPC_COMMIT) at $FPC_DIR"

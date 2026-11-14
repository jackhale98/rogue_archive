#!/usr/bin/env bash
# Supplies the sources of the Emscripten ports upstream's web build links
# (-sUSE_SDL=2 -sUSE_SDL_IMAGE=2 -sUSE_SDL_TTF=2: SDL2, SDL2_image, SDL2_ttf
# and their dependencies zlib, libpng, FreeType and HarfBuzz) from git, at the
# tags the pinned Emscripten's own port recipes name. Sourced by build.sh after
# ensure-emsdk.sh.
#
# Emscripten downloads these as GitHub archive files (sha512-checked) the first
# time a build uses them. Some build environments allow git but not archive
# downloads, so this script checks each port out from its git tag into the
# place Emscripten unpacks it to, with the marker Emscripten writes after
# unpacking; Emscripten then builds the port with its own recipe, exactly as
# if it had downloaded it. libpng and HarfBuzz are left to Emscripten (their
# recipes download release files, not git archives). Where the archive
# downloads work, the result is the same source tree either way.
#
# Each entry: port name | git repository | tag | directory inside the port |
# archive URL | the version string tools/ports/<name>.py must still name.
RA_PORTS=(
  "zlib|https://github.com/madler/zlib|v1.3.2|zlib-1.3.2|https://github.com/madler/zlib/archive/refs/tags/v1.3.2.tar.gz|'1.3.2'"
  "freetype|https://github.com/freetype/freetype|VER-2-14-3|freetype-VER-2-14-3|https://github.com/freetype/freetype/archive/VER-2-14-3.zip|'VER-2-14-3'"
  "sdl2|https://github.com/libsdl-org/SDL|release-2.32.10|SDL-release-2.32.10|https://github.com/libsdl-org/SDL/archive/release-2.32.10.zip|'2.32.10'"
  "sdl2_image|https://github.com/libsdl-org/SDL_image|release-2.6.0|SDL_image-release-2.6.0|https://github.com/libsdl-org/SDL_image/archive/refs/tags/release-2.6.0.zip|'release-2.6.0'"
  "sdl2_ttf|https://github.com/libsdl-org/SDL_ttf|release-2.20.2|SDL_ttf-release-2.20.2|https://github.com/libsdl-org/SDL_ttf/archive/release-2.20.2.zip|'release-2.20.2'"
)

ra_seed_ports() {
  local emscripten_dir ports_dir entry name repo tag subdir url version recipe tmp
  emscripten_dir="$(dirname "$(command -v emcc)")"
  ports_dir="$(em-config CACHE)/ports"
  mkdir -p "$ports_dir"
  for entry in "${RA_PORTS[@]}"; do
    IFS='|' read -r name repo tag subdir url version <<< "$entry"
    recipe="$emscripten_dir/tools/ports/$name.py"
    # The recipe must still use this version (a toolchain update changes it).
    if ! grep -q -- "$version" "$recipe"; then
      echo "error: $recipe no longer names $version; update scripts/ports.sh with the pinned Emscripten" >&2
      return 1
    fi
    if [ -f "$ports_dir/$name/.emscripten_url" ] && [ "$(cat "$ports_dir/$name/.emscripten_url")" = "$url" ]; then
      continue
    fi
    echo "Fetching Emscripten port source $name ($tag) from git"
    tmp="$ports_dir/$name.git-tmp"
    rm -rf "$tmp" && mkdir -p "$tmp"
    git -C "$tmp" init --quiet
    git -C "$tmp" fetch --quiet --depth 1 "$repo" "refs/tags/$tag"
    git -C "$tmp" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
    rm -rf "$tmp/.git"
    rm -rf "${ports_dir:?}/$name" && mkdir -p "$ports_dir/$name"
    mv "$tmp" "$ports_dir/$name/$subdir"
    printf '%s\n' "$url" > "$ports_dir/$name/.emscripten_url"
  done
}

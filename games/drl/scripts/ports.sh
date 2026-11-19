#!/usr/bin/env bash
# Supplies the source of the Emscripten port the graphical (tiles) build links
# (-sUSE_SDL=3: SDL 3) from git, at the tag the pinned Emscripten's own port
# recipe names. Sourced by build.sh after ensure-emsdk.sh. The same approach
# as games/cataclysm-dda/scripts/ports.sh.
#
# Emscripten downloads the port as a GitHub archive file (sha512-checked) the
# first time a build uses it. Some build environments allow git but not
# archive downloads, so this checks the port out from its git tag into the
# place Emscripten unpacks it to, with the marker Emscripten writes after
# unpacking; Emscripten then builds the port with its own recipe, exactly as
# if it had downloaded it. Where archive downloads work, the source tree is
# the same either way.
#
# Each entry: port name | git repository | tag | directory inside the port |
# archive URL | the version string tools/ports/<name>.py must still name.
RA_DRL_PORTS=(
  "sdl3|https://github.com/libsdl-org/SDL|release-3.4.2|SDL-release-3.4.2|https://github.com/libsdl-org/SDL/archive/release-3.4.2.zip|VERSION = '3.4.2'"
)

ra_drl_seed_ports() {
  local emscripten_dir ports_dir entry name repo tag subdir url version recipe tmp
  emscripten_dir="$(dirname "$(command -v emcc)")"
  ports_dir="$(em-config CACHE)/ports"
  mkdir -p "$ports_dir"
  for entry in "${RA_DRL_PORTS[@]}"; do
    IFS='|' read -r name repo tag subdir url version <<< "$entry"
    recipe="$emscripten_dir/tools/ports/$name.py"
    # The recipe must still use this version (a toolchain update changes it).
    if ! grep -qF -- "$version" "$recipe"; then
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

# Building the DCSS runtime

```sh
pnpm build:dcss            # = games/dcss/scripts/build.sh
pnpm test:engine:dcss      # native vs WebAssembly conformance (after a build)
pnpm stage:runtimes        # copy into apps/web/public/runtime/dcss/<buildId>/
pnpm dev                   # or: pnpm build && pnpm preview
```

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`.
2. Shallow-clones upstream at the tag in `upstream.env`, **fails if the tag does not resolve to the pinned commit**, and fetches the submodules listed there (Lua, SQLite, zlib, PCRE, fonts) at the commits upstream pins.
3. Resets the checkout to pristine and applies `patches/*.patch` (none today).
4. Runs upstream's Makefile with `CROSSHOST=wasm32-emscripten` and `WEBTILES=y`, with compiler wrappers (`wasm32-emscripten-g++` → `em++ -fexceptions`, …) and the compatibility shims in `port/compat/` as the "curses" library. Upstream builds its contrib libraries, generates its sources and tile sheets with host tools, and compiles the game.
5. Relinks the game objects with `port/rogue-archive-platform.cc` for a worker (Asyncify, JavaScript exceptions, 128 MiB initial memory with growth, IDBFS). It packs the game data from upstream's `install-data` layout and copies upstream's WebTiles client with `client-host/`. Then it compresses the module and data (`.gzip`), copies the license texts and writes `dist/runtime-manifest.json`.
6. Links the same objects once more for Node (the conformance harness, not deployed; skip with `ROGUE_ARCHIVE_HARNESS=0`).

Requirements: `git`, `make`, a host C/C++ compiler, `python3` with PyYAML, `perl`, `pkg-config` and libpng headers (for upstream's tile generator), `node` ≥ 22. CI installs `python3-yaml libpng-dev`. The conformance test also builds DCSS natively, which needs the ncurses headers (`libncurses-dev`).

The first build takes roughly 15–20 minutes on four cores (most of it compiling about 300 C++ files twice: native tile tools and WebAssembly). Later builds reuse upstream's object files in `~/.cache/rogue-archive/dcss/src-<commit>`; upstream's Makefile rebuilds what a changed flag or file affects. Set `ROGUE_ARCHIVE_CLEAN=1` for a clean build. CI caches the tree.

## Reproducibility notes

- The upstream checkout is verified by commit; submodules are at the commits upstream pins.
- `NO_YACC=y` makes every build use upstream's pregenerated parser, whatever flex/bison the host has.
- `gzip -n` keeps the compressed files free of timestamps.

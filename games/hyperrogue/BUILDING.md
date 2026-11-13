# Building HyperRogue for Rogue Archive

```sh
pnpm build:hyperrogue       # games/hyperrogue/scripts/build.sh → games/hyperrogue/dist
pnpm test:engine:hyperrogue # games/hyperrogue/scripts/test-engine.sh
pnpm stage:runtimes         # copy into apps/web/public/runtime/hyperrogue/<buildId>/
```

The first build takes about three minutes: upstream's web version is one translation unit (the whole game), compiled at `-O2`. Later builds reuse the compiled object unless the port file, the flags or the toolchain change (only the link runs, in seconds).

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`.
2. Fetches the pinned upstream commit (`upstream.env`) and **fails if the checkout is not at that commit**; resets it to pristine and applies `patches/*.patch` (none today).
3. Runs upstream's Makefile for the generated sources (`autohdr.h`, `language-data.cpp`), built with upstream's own `makeh` and `langen` (native C++ compiler).
4. Fetches the pinned zlib (`upstream.env` `ZLIB_*`, verified by commit) and builds it with Emscripten. (Emscripten's own zlib port is downloaded as a tarball at build time; building from the pinned git source keeps every input pinned.)
5. Compiles `port/rogue-archive-web.cpp` (which includes upstream's `hyperweb.cpp`) with upstream's web flags plus `-DCAP_SAVE=1 -DCAP_CONFIG=1` (saving and the config file, off in upstream's online demo), `-DMAXMDIM=4` (the full build; the 2D-only variant of `hyperweb.cpp` no longer compiles) and a fixed command line (`-noscr -f1`: no demo menu, fill the page's area).
6. Links with upstream's web link settings (exceptions, 1 MiB stack; not its legacy GL emulation, which the web build doesn't use) as an ES module factory for the page (`hyperrogue.mjs` + `hyperrogue.wasm`), copies the licences and writes `dist/runtime-manifest.json`.
7. Builds the conformance harness (`tests/conformance/harness.cpp` on upstream's web build, for Node; not deployed; skip with `ROGUE_ARCHIVE_HARNESS=0`). `scripts/test-engine.sh` builds the same file natively; that needs SDL 1.2, OpenGL and zlib headers (Debian/Ubuntu: `libsdl1.2-dev libgl-dev zlib1g-dev`).

Requirements: `git`, `make`, a native C++ compiler, `node` ≥ 22.

## Size

| File | Size | Compressed (gzip) |
|---|---|---|
| `hyperrogue.wasm` | about 9.1 MB | 2.6 MB |
| `hyperrogue.mjs` | about 0.15 MB | 0.04 MB |

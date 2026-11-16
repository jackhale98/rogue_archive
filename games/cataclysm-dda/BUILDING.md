# Building Cataclysm: DDA for Rogue Archive

```sh
pnpm build:cataclysm-dda        # games/cataclysm-dda/scripts/build.sh → games/cataclysm-dda/dist
pnpm test:engine:cataclysm-dda  # games/cataclysm-dda/scripts/test-engine.sh
pnpm stage:runtimes             # copy into apps/web/public/runtime/cataclysm-dda/<buildId>/
```

**Time.** The first build compiles about 430 large C++ files with upstream's Makefile: about 45 minutes on four cores. The link then runs Emscripten's Asyncify pass over the whole module (upstream's web build needs it), about 35 minutes on one core. Later builds recompile only what changed (upstream's Makefile tracks dependencies; the objects live in `~/.cache/rogue-archive/cataclysm-dda/obj-<commit>`, outside the source tree), but every build relinks. Use `ROGUE_ARCHIVE_JOBS` to set the number of parallel compile jobs (default: all cores). Peak memory is about 3 GB (the Asyncify pass); each compile job takes up to about 1.5 GB.

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`, and supplies the Emscripten ports upstream's build uses (`scripts/ports.sh`: SDL2, SDL2_image, SDL2_ttf, FreeType and zlib from git at the tags the pinned Emscripten's recipes name; libpng and HarfBuzz downloaded by Emscripten itself, sha512-checked).
2. Fetches the pinned upstream commit (`upstream.env`) as a sparse, blob-less checkout (without `lang/`, `doc/`, `data/screenshots/`) and **fails if it is not at that commit**; fetches the release tag (upstream's Makefile names the build after it); resets tracked files and applies `patches/*.patch` (none).
3. Runs upstream's Makefile as upstream's `build-scripts/build-emscripten.sh` does (`make NATIVE=emscripten BACKTRACE=0 TILES=1 TESTS=0 RUNTESTS=0 RELEASE=1 LINTJSON=0`), with objects outside the tree, `scripts/emcc-compile.sh` as the compiler (`-Wno-error`) and `scripts/emcc-link.sh` as the linker (`em++` plus the port's additions).
4. Compiles `port/rogue-archive-web.cpp` with the flags upstream's Makefile prints (`scripts/print.mk`).
5. Assembles the game data as upstream's `build-scripts/prepare-web.sh` does (same directories; obsolete mods and `MA` dropped by `scripts/drop-obsolete-mods.mjs`, which reads each `modinfo.json` as upstream's `jq` filter does) with the two shipped tilesets, and packs it with Emscripten's file packager (`--lz4`).
6. Links (upstream's link command and flags, then the port's: its object, link-time wrappers, the data loader as `--pre-js`, an ES module factory, the exports), gzips the data package, copies the licences and writes `dist/runtime-manifest.json`.

Requirements: `git`, `make`, `python3`, `node` ≥ 22, `gzip`. No native compiler is needed.

## Runtime files

| File | Size | Sent compressed |
|---|---|---|
| `cataclysm-tiles.wasm` | SIZE_WASM | SIZE_WASM_GZ (gzip, if the server compresses it) |
| `cataclysm-tiles.mjs` (glue + data loader, with the package's file list) | SIZE_MJS | SIZE_MJS_GZ |
| `cataclysm-data.data.gzip` (the LZ4 data package, gzipped) | SIZE_DATA_GZ (SIZE_DATA LZ4, about 97 MB of files) | as is |
| `licenses/` | < 0.1 MB | |

MEASUREMENTS

## Reproducibility

The `buildId` is a hash of every output file. Inputs are pinned: upstream commit, Emscripten version, the ports' tags (checked against the Emscripten recipes) and archives (sha512). The file packager sorts files by path. REPRO

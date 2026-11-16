# Building Cataclysm: DDA for Rogue Archive

```sh
pnpm build:cataclysm-dda        # games/cataclysm-dda/scripts/build.sh → games/cataclysm-dda/dist
pnpm test:engine:cataclysm-dda  # games/cataclysm-dda/scripts/test-engine.sh
pnpm stage:runtimes             # copy into apps/web/public/runtime/cataclysm-dda/<buildId>/
```

**Time.** The first build compiles about 430 large C++ files with upstream's Makefile: about 45 minutes on four cores (each job takes up to about 1.5 GB). The link, with Emscripten's Asyncify pass (upstream's web build needs it), takes about a minute at `-O1`; the separate `wasm-opt -O2` step then takes about 9 minutes on four cores and **5.3 GB of memory** at its peak. Later builds recompile only what changed (upstream's Makefile tracks dependencies; the objects live in `~/.cache/rogue-archive/cataclysm-dda/obj-<commit>-<compiler>`, outside the source tree, keyed on the compiler wrapper because make does not track flags), then relink and optimise (about 10 minutes). `ROGUE_ARCHIVE_JOBS` sets the number of parallel compile jobs (default: all cores).

**Why not upstream's `-Os` link.** With the pinned Emscripten, the `-Os` link spent about 110 minutes in one `wasm-opt` run (Asyncify plus `-Os`), then its final pass was killed by the kernel at 13.8 GB of memory (this machine: four cores, 15 GB). `wasm-opt -Os` run separately on the `-O1` output was stopped at a 12 GB limit after 19 minutes (8.5 GB resident). `-O2` fits: 135 MB → 79 MB.

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`, and supplies the Emscripten ports upstream's build uses (`scripts/ports.sh`: SDL2, SDL2_image, SDL2_ttf, FreeType and zlib from git at the tags the pinned Emscripten's recipes name; libpng and HarfBuzz downloaded by Emscripten itself, sha512-checked).
2. Fetches the pinned upstream commit (`upstream.env`) as a sparse, blob-less checkout (without `lang/`, `doc/`, `data/screenshots/`: about 320 MB instead of 1.3 GB) and **fails if it is not at that commit**; fetches the release tag (upstream's Makefile names the build after it); resets tracked files and applies `patches/*.patch` (none).
3. Runs upstream's Makefile as upstream's `build-scripts/build-emscripten.sh` does (`make NATIVE=emscripten BACKTRACE=0 TILES=1 TESTS=0 RUNTESTS=0 RELEASE=1 LINTJSON=0`), with objects outside the tree, `scripts/emcc-compile.sh` as the compiler (`-DEMSCRIPTEN -Wno-error`, see `PORTING.md`) and `scripts/emcc-link.sh` as the linker (`em++` plus the port's additions).
4. Compiles `port/rogue-archive-web.cpp` with the flags upstream's Makefile prints (`scripts/print.mk`).
5. Assembles the game data as upstream's `build-scripts/prepare-web.sh` does (same directories; obsolete mods and `MA` dropped by `scripts/drop-obsolete-mods.mjs`, which reads each `modinfo.json` as upstream's `jq` filter does), with the two shipped tilesets and the files at the top of `gfx/`, and packs it with Emscripten's file packager (`--lz4`).
6. Links (upstream's link command and flags, then the port's: its object, the link-time wrappers, the data loader as `--pre-js`, an ES module factory, the exports, `-O1`, `-sDYNAMIC_EXECUTION=0`), optimises the module with `wasm-opt -O2`, gzips the data package, copies the licences and writes `dist/runtime-manifest.json`.

Requirements: `git`, `make`, `python3`, `node` ≥ 22, `gzip`; about 6 GB of free memory for the optimisation step. No native compiler is needed.

## Runtime files

| File | Size | Compressed |
|---|---|---|
| `cataclysm-tiles.wasm` | 78.6 MB | 25.9 MB gzip -9; 13.0 MB brotli 11 (whichever the server applies; GitHub Pages sends gzip) |
| `cataclysm-tiles.mjs` (glue and data loader, with the package's file list) | 2.0 MB | 0.43 MB gzip; 0.30 MB brotli |
| `cataclysm-data.data.gzip` (the LZ4 data package, gzipped) | 26.9 MB (42.4 MB LZ4 package of 85 MB of files: 5,728 files) | sent as is |
| `licenses/` | < 0.1 MB | |

A first visit downloads about 53 MB with gzip (about 40 MB where brotli is used); later visits use the browser cache (runtime files are content-addressed). For comparison, the `-O1` module before the `wasm-opt -O2` step is 135 MB (51 MB gzip, 27 MB brotli).

## Load time and memory (measured)

Headless Chromium (Playwright, software rendering) on a four-core Linux container, served locally by `vite preview` (download time not included), this build:

| Step | Time |
|---|---|
| Page open → main menu waiting for input (verify, inflate the data, compile the module, load every JSON file) | **5–7 s** (about 16 s with the unoptimised `-O1` module) |
| Main menu → Play Now! → the map (world and character generation, map loading) | **about 80–90 s** |

Memory: the peak resident set (`VmHWM`) of Chromium's renderer process, read from `/proc` after reaching the map and opening the inventory, is **about 3.4 GB**; **1.6–1.7 GB** stays resident while playing. The module starts with upstream's 512 MB of WebAssembly memory (`INITIAL_MEMORY`) and may grow to 4 GB; the JS heap (`performance.memory`) reaches about 350 MB at start-up (the inflated data package) and is about 170 MB in play. This is far above what iOS Safari allows a tab: the game is not expected to run on iPhones as built, and no phone was tested.

## Reproducibility

The `buildId` is a hash of every output file. Inputs are pinned: upstream commit, Emscripten version, the ports' tags (checked against the Emscripten recipes) and archives (sha512). The file packager sorts files by path. Checked here: a second run of the build (relinking the same objects, repacking the data, optimising again) gave the same `buildId` (`3b94f7d90fe1e967`); a build from scratch on another machine (CI) has not been compared yet.

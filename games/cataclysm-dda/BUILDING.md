# Building Cataclysm: DDA for Rogue Archive

```sh
pnpm build:cataclysm-dda        # games/cataclysm-dda/scripts/build.sh → games/cataclysm-dda/dist
pnpm test:engine:cataclysm-dda  # games/cataclysm-dda/scripts/test-engine.sh
pnpm stage:runtimes             # copy into apps/web/public/runtime/cataclysm-dda/<buildId>/
```

**Time.** The first build compiles about 430 large C++ files with upstream's Makefile: about 45 minutes on four cores (each job takes up to about 1.5 GB). The link, with Emscripten's Asyncify pass (upstream's web build needs it), takes about a minute at `-O1`; the separate `wasm-opt -O2` step then takes about 5 minutes on four cores (9 minutes before the static constructors were kept out of line, see "Memory") and about **5.3 GB of memory** at its peak. Later builds recompile only what changed (upstream's Makefile tracks dependencies; the objects live in `~/.cache/rogue-archive/cataclysm-dda/obj-<commit>-<compiler>`, outside the source tree, keyed on the compiler wrapper because make does not track flags), then relink and optimise. The optimised module is kept next to the objects, keyed on the linked module and the `wasm-opt` flags: a change that leaves the module alone (the glue, the data) skips the optimisation. `ROGUE_ARCHIVE_JOBS` sets the number of parallel compile jobs (default: all cores).

**Why not upstream's `-Os` link.** With the pinned Emscripten, the `-Os` link spent about 110 minutes in one `wasm-opt` run (Asyncify plus `-Os`), then its final pass was killed by the kernel at 13.8 GB of memory (this machine: four cores, 15 GB). `wasm-opt -Os` run separately on the `-O1` output was stopped at a 12 GB limit after 19 minutes (8.5 GB resident). `-O2` fits: 135 MB → 79 MB. With the static constructors kept out of line ("Memory", below: inlined, they made one 6.6 MB function), `wasm-opt -Os` on the `-O1` output fits (5.6 minutes, 4.6 GB) but gives 77.1 MB instead of 78.2 MB (25.8 MB gzip instead of 26.0): not worth giving up `-O2`'s speed for.

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`, and supplies the Emscripten ports upstream's build uses (`scripts/ports.sh`: SDL2, SDL2_image, SDL2_ttf, FreeType and zlib from git at the tags the pinned Emscripten's recipes name; libpng and HarfBuzz downloaded by Emscripten itself, sha512-checked).
2. Fetches the pinned upstream commit (`upstream.env`) as a sparse, blob-less checkout (without `lang/`, `doc/`, `data/screenshots/`: about 320 MB instead of 1.3 GB) and **fails if it is not at that commit**; fetches the release tag (upstream's Makefile names the build after it); resets tracked files and applies `patches/*.patch` (none).
3. Runs upstream's Makefile as upstream's `build-scripts/build-emscripten.sh` does (`make NATIVE=emscripten BACKTRACE=0 TILES=1 TESTS=0 RUNTESTS=0 RELEASE=1 LINTJSON=0`), with objects outside the tree, `scripts/emcc-compile.sh` as the compiler (`-DEMSCRIPTEN -Wno-error`, see `PORTING.md`) and `scripts/emcc-link.sh` as the linker (`em++` plus the port's additions).
4. Compiles `port/rogue-archive-web.cpp` with the flags upstream's Makefile prints (`scripts/print.mk`).
5. Assembles the game data as upstream's `build-scripts/prepare-web.sh` does (same directories; obsolete mods and `MA` dropped by `scripts/drop-obsolete-mods.mjs`, which reads each `modinfo.json` as upstream's `jq` filter does), with the two shipped tilesets and the files at the top of `gfx/`, and packs it with Emscripten's file packager (`--lz4`).
6. Links (upstream's link command and flags, then the port's: its object, the link-time wrappers, the data loader as `--pre-js`, an ES module factory, the exports, `-O1` with function names, `-sDYNAMIC_EXECUTION=0`, the memory settings in "Memory"), optimises the module with `wasm-opt -O2` (static constructors not inlined; names dropped), gzips the data package, copies the licences and writes `dist/runtime-manifest.json`.

Requirements: `git`, `make`, `python3`, `node` ≥ 22, `gzip`; about 6 GB of free memory for the optimisation step. No native compiler is needed.

## Runtime files

| File | Size | Compressed |
|---|---|---|
| `cataclysm-tiles.wasm` | 78.2 MB | 26.0 MB gzip -9; 13.6 MB brotli 11 (Node's) (whichever the server applies; GitHub Pages sends gzip) |
| `cataclysm-tiles.mjs` (glue and data loader, with the package's file list) | 1.8 MB | 0.42 MB gzip; 0.30 MB brotli |
| `cataclysm-data.data.gzip` (the LZ4 data package, gzipped) | 26.9 MB (42.4 MB LZ4 package of 85 MB of files: 5,728 files) | sent as is |
| `licenses/` | < 0.1 MB | |

A first visit downloads about 53 MB with gzip (about 41 MB where brotli is used); later visits use the browser cache (runtime files are content-addressed). For comparison, the `-O1` module before the `wasm-opt -O2` step is 135 MB without its function names (51 MB gzip, 27 MB brotli).

## Load time (measured)

Headless Chromium (Playwright, software rendering) on a four-core Linux container, served locally by `vite preview` (download time not included), this build:

| Step | Time |
|---|---|
| Page open → main menu waiting for input (verify, inflate the data, compile the module, load the core files) | **4–6 s** (5–7 s before the memory work below; about 16 s with the unoptimised `-O1` module) |
| Main menu → Play Now! → the map (load the game data, world and character generation, map loading) | **about 50–60 s** (60–90 s before) |

## Memory

Measured with `tests/memory-profile.mjs` (headless Chromium on the production build, `vite preview`; it opens the game, plays Play Now! to the map, walks a few turns and opens the inventory, and samples twice a second). From Linux's `/proc` for the page's renderer process: the resident set and its peak (`VmHWM`), how much of it is the WebAssembly linear memory (its mapping) and compiled code (anonymous executable mappings); the GPU process's resident set (where WebGL textures live); from the page: the linear memory's size (it never shrinks, so it is its high-water mark), the JS heap (`performance.memory`) and V8's ArrayBuffer backing stores. Each figure is the phase's maximum, in MB.

**Before** (build `3b94f7d90fe1e967`):

| Phase | Renderer RSS | Peak so far | Linear memory: size / resident | Code | JS heap | ArrayBuffers | GPU process |
|---|---|---|---|---|---|---|---|
| Download, inflate, compile, start | 3,021 | **3,302** | 512 / 6 | 23 | 232 | 220 | 66 |
| Data load, main menu | 619 | 3,302 | 512 / 47 | 37 | 239 | 226 | 83 |
| Play Now! (game data, world, character) | 1,606 | 3,302 | **1,089** / 1,008 | 93 | 269 | 255 | 74 |
| First map | 1,655 | 3,302 | 1,089 / 1,008 | 94 | 167 | 152 | 74 |
| A few turns, inventory | 1,779 | 3,302 | 1,089 / 1,008 | 100 | 168 | 152 | 74 |

**After** (this build):

| Phase | Renderer RSS | Peak so far | Linear memory: size / resident | Code | JS heap | ArrayBuffers | GPU process |
|---|---|---|---|---|---|---|---|
| Download, inflate, compile, start | 517 | **557** | 128 / 38 | 35 | 188 | 185 | 116 |
| Data load, main menu | 380 | 557 | 128 / 38 | 35 | 131 | 120 | 125 |
| Play Now! (game data, world, character) | 1,705 | **1,777** | **576** / 512 | 92 | 131 | 120 | 599 |
| First map | 979 | 1,777 | 576 / 512 | 93 | 88 | 73 | 599 |
| A few turns, inventory | 1,214 | 1,777 | 576 / 512 | 99 | 89 | 73 | 642 |

**Safari's engine (WebKit, JavaScriptCore)**, the same script with `RA_BROWSER=webkit`: Playwright's WebKit for Linux (WPE). Not iOS: the libraries are Linux's, and WebGL draws in software inside the web process, so the tile textures count there (on iOS, WebGL runs in a separate GPU process). The web process's resident set (of which anonymous), MB:

| Phase | Before | After | After, `Use tiles` off |
|---|---|---|---|
| Download, inflate, compile, start | 979 (798) | 957 (768) | 1,005 |
| Data load, main menu (peak) | 1,247 (1,044) | 989 (657) | 1,041 |
| Play Now! to the first map (peak) | **2,527 (2,333)** | **2,130 (1,891)** | **1,764** |
| A few turns, inventory | 2,219 (2,028) | 1,988 (1,793) | 1,568 |
| Linear memory: size / resident | 1,089 / 1,000 | 576 / 515 | 576 / 528 |

JavaScriptCore has no counterpart to Chromium's start-up spike, but its web process sits higher than Chromium's renderer from the start (about 0.8–1.0 GB at the main menu). In a bare page, fetching the 78 MB module took the process up by about 280 MB and compiling it by about 100 MB more (240 MB at the peak), and that memory was not handed back within 10 seconds. With tiles, the textures (about 370–420 MB here) offset most of the heap's saving; with `Use tiles` off the peak is 0.76 GB below the original's.

Where it went, and what changed (each step measured on its own; `PORTING.md`, "Memory", has the reasons):

1. **The 3.3 GB start-up peak was the compiler, not the game.** `wasm-opt -O2` inlined every static constructor (each called once) into `__wasm_call_ctors`: one 6.6 MB function, run once at start-up, which Chromium's baseline compiler (Liftoff) took about 3 GB of memory to compile (`--js-flags=--no-liftoff` made it go away; compiling or instantiating the module alone stays at about 300 MB, since V8 compiles lazily). The constructors are now kept out of line (`--no-inline` on `_GLOBAL__sub_I_*` and `__cxx_global_var_init*`, by name: the link keeps function names for this step and the step drops them): the largest function is now 440 KB, the start-up peak 557 MB instead of 3,302, and the `wasm-opt` step is faster.
2. **Copies of the downloads.** Before, the renderer kept three 75 MB copies of the module's bytes (the glue keeps `Module.wasmBinary`), the gzipped data (27 MB, in the suspended start-up function) and the inflated package (40 MB, which the LZ4 file system needs). The page now compiles the module itself (`instantiateWasm`) and lets the bytes go, inflates the data straight into one buffer of its final size (the gzip trailer's length) without Blob/Response copies, and drops the gzip and the glue's text: ArrayBuffers at the main menu 226 → 120 MB, JS heap 239 → 131 MB; in play 152 → 73 MB. The engine keeps its own copy of the module's bytes (about 75 MB); the LZ4 package (40 MB) stays: files are read from it on demand.
3. **The game's heap (linear memory) was half tiles.** Upstream's default renderer on every platform but Windows is SDL's software renderer, which holds each tileset sprite as its own texture in the WebAssembly heap, in five colour variants (normal, shadow, night vision, overexposed, memory): about 86 MB of RGBA pixels per variant for the default tileset. With the game's other renderer, `opengles2` (WebGL), they are GPU textures. The port makes it the default on a first start (upstream's option, `PORTING.md`): linear memory's high-water mark 1,089 → 576 MB (resident 1,008 → 512). The textures (about 525 MB) are now in the GPU process instead; the total across processes in play is about the same (1.8–1.9 GB in both builds in this software-rendered Chromium), but the WebAssembly heap is half the size.
4. **Memory settings.** Upstream reserves 512 MB up front, grows by 20% steps (capped at 96 MB) and allows 4 GB. The heap's real high-water mark is about 520–580 MB (above), so the port starts at 128 MB, grows in 64 MB steps and stops at 2 GB (`INITIAL_MEMORY=128MB`, `MEMORY_GROWTH_LINEAR_STEP=64MB`, `MAXIMUM_MEMORY=2GB`): a smaller reservation, no 512 MB block at start-up, and pointers below 2 GB (the glue drops its unsigned fix-ups: 2.0 → 1.8 MB).

What is left:

- **The game's heap: about 512 MB resident in play, almost all of it the game's data.** At the main menu it is 38 MB; loading the game's JSON for the world (Play Now! starts with it) takes it to about 480 MB (the "Finalizing Mapgen parameters" step alone adds about 160 MB), and world and character generation and the first map add about 50 MB. The default mods (`dda`, `no_npc_food`, `personal_portal_storms`) are small, and none of upstream's world options changes the data loaded. Lowering this needs upstream-level changes (how the data is held once loaded).
- **The Play Now! peak (1.7 GB) is Chromium's baseline compiler again.** While the game data loads, Liftoff compiles the large Asyncify-instrumented loader functions; one 170 KB function took 255 MB of compiler memory (`--trace-wasm-compilation-times`), 3.2 GB in all over about 11,700 functions, and Chromium does not return all of it at once (the renderer grows by about 1.3 GB, mostly in 1–2 MB allocator pages, then falls back). With `--no-liftoff` the peak stays at about 1.17 GB. Liftoff's memory grows with a function's size times its locals, which Asyncify inflates. Safari's engine works differently (it interprets first), so this is a V8 (Chrome, Android) cost; lowering it would mean less Asyncify instrumentation (JSPI where supported, or an exact list of the functions that can sleep), an upstream-level change to the web build.
- **Code:** about 60–100 MB of compiled code in the renderer, plus the engine's copy of the module's bytes (75 MB).
- **Tiles:** about 450–500 MB of textures in the GPU process (GPU process 599–642 MB with tiles, 145 MB with `Use tiles` off). Turning `Use tiles` off (ASCII, upstream's Graphics option, measured the same way) removes them and changes nothing else (linear memory 576 MB either way); the port leaves that default alone.

The headless numbers are not a phone's. No iPhone was measured here.

## Reproducibility

The `buildId` is a hash of every output file. Inputs are pinned: upstream commit, Emscripten version, the ports' tags (checked against the Emscripten recipes) and archives (sha512). The file packager sorts files by path. Checked here: a second run of the build (relinking the same objects, repacking the data, optimising again) gave the same `buildId` (`3b94f7d90fe1e967`, the build before the memory work). For this build (`4420a1d6ffaa0e23`) a second run relinked to the same module, so it reused the optimised module from the cache, and gave the same `buildId`; the optimisation with the new flags has not been run twice on the same input. A build from scratch on another machine (CI) has not been compared yet.

# Building DRL for Rogue Archive

```sh
sudo apt-get install fpc clang libx11-dev   # a released FreePascal (3.2.x) to build the pinned one from; a C compiler; X11 for the native reference build (test:engine:drl)
pnpm build:drl                     # games/drl/dist: drl.mjs, drl.wasm, drl-data.data (Text); drl-tiles.mjs, drl-tiles.wasm, drl-tiles.data (Tiles); licenses/, runtime-manifest.json
pnpm test:engine:drl               # conformance: upstream drift, key coverage, native vs WebAssembly replay
pnpm stage:runtimes                # copies it into the site
ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:drl   # try a newer upstream (never deployed)
```

The first build installs the pinned Emscripten SDK (`tools/toolchain.env`) and builds the pinned FreePascal (`games/drl/toolchain.env`) into `~/.cache/rogue-archive`: about 5 minutes for FreePascal (native compiler, run-time library and packages, then the wasm32-wasip1 cross compiler and its units), and about 30 seconds for Emscripten's SDL 3 port. Later builds take about a minute (both displays).

## What the build does

1. **Toolchains.** Emscripten 6.0.13. FreePascal 3.3.1 at an exact commit of its development branch (its WebAssembly targets are not in a release), fetched by commit, patched (`patches/fpc`, C varargs) and built with the distribution's FreePascal 3.2.2 (`scripts/ensure-fpc.sh`). The compiler rebuilds itself in its make cycle, so the result does not depend on the bootstrap. The run-time library is built with branchful exceptions (`-CTbfexceptions`): WebAssembly's own exceptions do not combine with Asyncify.
2. **Sources.** DRL `0_10_12c` and FPC Valkyrie `0_10_12` (shallow clones, commits verified; `scripts/upstream.sh`), Lua 5.1.5 (verified by SHA-256), SDL3_image `release-3.4.0` (commit verified; `upstream.env`), and Emscripten's SDL 3 port at the tag its recipe names (3.4.2), checked out from git where archive downloads are blocked (`scripts/ports.sh`, as Cataclysm's). Patches: `patches/fpcvalkyrie`, `patches/lua` (`patches/README.md`).
3. **Lua** with Emscripten: the objects its own Makefile lists (`CORE_O`, `LIB_O`); and its interpreter for this machine, to read upstream's `build.lua`.
4. **DRL** with FreePascal for wasm32-wasip1: upstream's two programs (`src/drl.pas`, `src/drlwad.pas`, `makefile.lua`'s `source_files`), with upstream's unit paths (Valkyrie's `src` and `libs`), FreePascal's default syntax options (`-Sgic`), `-O2`, as a Unix build (`-dUNIX`), with `port/` and `port/wasm/` first on the unit path. FreePascal writes the objects with its own assembler; its linker call is caught (a stand-in `wasm-ld` writes down the object list) and Emscripten links them instead, with Lua, `port/start.c` and the JavaScript bridges (`port/wasi-emscripten.js`, `port/host.js`).
5. **Data.** Upstream's `drlwad`, linked for Node, runs `port/wad-manifest.lua`'s manifest (upstream's `build.lua` without sounds and music) twice and writes `core.wad` and `drl.wad`: for the Text display without the images (`drl-data.data`), for Tiles with them (`drl-tiles.data`); each with upstream's `config.lua`, packed by Emscripten's file packager, preloaded at `/drl`.
6. **The Tiles display's libraries.** SDL3_image's sources compiled with PNG only (`-DLOAD_PNG`; SDL 3 decodes PNG); the symbol tables of Valkyrie's loaders written from its own sources (`scripts/libraries.mjs`); `port/libraries.c`.
7. **Runtime.** `drl.mjs` + `drl.wasm` for a Web Worker (Text: `-O2`, Asyncify, `-sMALLOC=none`), and the same objects linked again for the page with SDL 3 and WebGL 2 (Tiles: `drl-tiles.mjs` + `drl-tiles.wasm`); `runtime-manifest.json` with each file's SHA-256 and a content-hash `buildId`. A Node build of the console objects (the conformance harness, with the data) goes to the cache. `DRL_PROFILING=1` keeps function names in the modules (for a browser's debugger; never deployed).

## Link settings

| Setting | Value | Why |
|---|---|---|
| `-sMALLOC=none` | | One allocator: the Pascal heap (`port/wasm/ramalloc.pas` implements `malloc` on it). |
| `-sASYNCIFY=1` | `ASYNCIFY_STACK_SIZE=524288` | DRL's sleeps and key waits suspend the module. |
| `-sSTACK_SIZE` | 4 MB | FreePascal's own default for WASI is 8 MB; 4 MB is ample for DRL (strings and records on the stack, Lua's C stack). |
| `-sINITIAL_MEMORY` / `MAXIMUM_MEMORY` | 16 MB / 512 MB | DRL fits in 16 MB (measured: it never grows); it can grow as the Pascal heap needs, capped well under a phone's limit. |
| `-O2` | | `-Os` would be 0.2 MB smaller, but with it Emscripten 6.0.13's import minification left the WASI imports from FreePascal's objects without functions ("function import requires a callable" at instantiation). |
| Tiles: `-sUSE_SDL=3`, `-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2`, `--js-library port/webgl.js` | `-sENVIRONMENT=web` | SDL 3 and WebGL 2 on the page's main thread (PORTING.md, "The graphical mode"); `preinitializedWebGLContext` among the incoming module options: the page makes the opaque context SDL uses. |

## Sizes and memory

Each display downloads only its own files:

| Display | File | Size | gzip -9 |
|---|---|---|---|
| Text | `drl.wasm` | 4.72 MB | 1.15 MB |
| Text | `drl-data.data` | 0.38 MB | 0.37 MB |
| Text | `drl.mjs` | 82 KB | 23 KB |
| Tiles | `drl-tiles.wasm` | 6.21 MB | 1.55 MB |
| Tiles | `drl-tiles.data` (with the art) | 2.68 MB | 2.46 MB |
| Tiles | `drl-tiles.mjs` | 216 KB | 53 KB |

About 1.5 MB to download compressed for Text (unchanged by the Tiles display) and 4.1 MB for Tiles. From navigation to DRL's first screen, cold, on a local server (`vite preview`, no network latency): Text 0.59–0.61 s in Chromium, 0.63–0.70 s in WebKit (three runs each, as first measured); Tiles 1.30–1.36 s in Chromium and 1.21–1.23 s in WebKit, against 0.69–0.74 s and 0.74–0.82 s for Text in the same session (three runs each; Tiles compiles a larger module on the page and loads DRL's art before its first screen).

**Memory**, measured with `tests/memory-profile.mjs` (the method of `games/cataclysm-dda/tests/memory-profile.mjs`: headless, production build, twice a second from Linux's `/proc` for the page's process, which runs the game's worker too; the module's memory from the worker). It opens DRL, goes through its main menu to a new game, walks and waits, opens the inventory and the help, then Save & Quit. Each figure is the phase's maximum, MB:

| Phase | Chromium: renderer (peak) | WebKit (WPE): web process (peak), anonymous | Module memory |
|---|---|---|---|
| The library page alone, no game (for comparison) | 141 (147) | 352 (368) | — |
| Download, compile, start, DRL's main menu | 242 (245) | 445 (457), 262 | 16 |
| New game (menus, intro) to the map | 198 | 440, 256 | 16 |
| Playing, inventory, help | 198 | 437, 254 | 16 |
| Save & Quit, back to the main menu | 199 | 445, 261 | 16 |

**The Tiles display** (the same profile with `RA_DISPLAY=tiles`, the setting chosen on a page of its own that is closed before measuring; build `68b2ca55a150035e`):

| Phase | Chromium renderer, 1280×800 (peak) | Chromium, 390×844 (peak) | WebKit, 1280×800 (peak), anonymous | WebKit, 390×844 (peak), anonymous | Module memory |
|---|---|---|---|---|---|
| Download, compile, start, DRL's main menu | 296 (296) | 259 (261) | 623 (630), 436 | 623 (642), 441 | 65 |
| New game (menus, intro) to the map | 264 (307) | 305 (310) | 637 (652), 450 | 572 (642), 390 | 65 |
| Playing, inventory, help | 266 | 265 | 542, 355 | 528, 346 | 65 |
| Save & Quit, back to the main menu | 259 | 263 | 545, 358 | 532, 350 | 65 |

The same session measured Text at 201–242 MB (peak 246) in Chromium and 410–425 MB (peak 435) in WebKit. So Tiles adds about 60 MB to Chromium's renderer (its GPU process, which holds the WebGL textures, is not counted) and about 120 MB to WebKit's process while playing, about 200 MB at its peak (650 MB, while DRL loads its art and draws its first level). DRL's module memory is 65 MB instead of 16 (the art, decoded: Valkyrie keeps each image after uploading it). On Linux, WebKit draws WebGL in the page's process with Mesa's software rasterizer, which is counted here; on an iPhone, Safari draws WebGL in its GPU process. Without llvmpipe's rasterizer threads (`RA_LP_THREADS=0`) the 390×844 figures were the same (peak 640, playing 545): the threads are not the cost. Not yet measured on a physical iPhone; for scale, Cataclysm: DDA's WebKit process reached 1.6–2.5 GB.

The Text display adds about 60 MB to Chromium's renderer and about 90 MB to WebKit's process; DRL's own memory (the module's linear memory: the Pascal heap with Lua's, the stack, the data) stays at its initial 16 MB (`-sINITIAL_MEMORY=16777216`) through a game: it never grows. For scale, Cataclysm: DDA's WebKit process reached 1.6–2.5 GB. WebKit for Linux (WPE) is Safari's engine but not iOS; the port has not been measured on a physical iPhone yet.

## Reproducibility

Every input is pinned: the toolchains, the upstream commits, Lua's hash, the patches, the scripts. FreePascal embeds the compile date and time (DRL's log prints them); the build sets them to the upstream commit's (`-DD`, `-DT`). Two consecutive builds gave the same `buildId` (`4521d1e207ffcd34` before the Tiles display; `68b2ca55a150035e` with it).

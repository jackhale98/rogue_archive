# Building DRL for Rogue Archive

```sh
sudo apt-get install fpc clang     # a released FreePascal (3.2.x) to build the pinned one from; a C compiler
pnpm build:drl                     # games/drl/dist: drl.mjs, drl.wasm, drl-data.data, licenses/, runtime-manifest.json
pnpm test:engine:drl               # conformance: upstream drift, key coverage, native vs WebAssembly replay
pnpm stage:runtimes                # copies it into the site
ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:drl   # try a newer upstream (never deployed)
```

The first build installs the pinned Emscripten SDK (`tools/toolchain.env`) and builds the pinned FreePascal (`games/drl/toolchain.env`) into `~/.cache/rogue-archive`: about 5 minutes for FreePascal (native compiler, run-time library and packages, then the wasm32-wasip1 cross compiler and its units). Later builds take about 35 seconds.

## What the build does

1. **Toolchains.** Emscripten 6.0.13. FreePascal 3.3.1 at an exact commit of its development branch (its WebAssembly targets are not in a release), fetched by commit, patched (`patches/fpc`, C varargs) and built with the distribution's FreePascal 3.2.2 (`scripts/ensure-fpc.sh`). The compiler rebuilds itself in its make cycle, so the result does not depend on the bootstrap. The run-time library is built with branchful exceptions (`-CTbfexceptions`): WebAssembly's own exceptions do not combine with Asyncify.
2. **Sources.** DRL `0_10_12c` and FPC Valkyrie `0_10_12` (shallow clones, commits verified; `scripts/upstream.sh`), Lua 5.1.5 (verified by SHA-256). Patches: `patches/fpcvalkyrie`, `patches/lua` (`patches/README.md`).
3. **Lua** with Emscripten: the objects its own Makefile lists (`CORE_O`, `LIB_O`); and its interpreter for this machine, to read upstream's `build.lua`.
4. **DRL** with FreePascal for wasm32-wasip1: upstream's two programs (`src/drl.pas`, `src/drlwad.pas`, `makefile.lua`'s `source_files`), with upstream's unit paths (Valkyrie's `src` and `libs`), FreePascal's default syntax options (`-Sgic`), `-O2`, as a Unix build (`-dUNIX`), with `port/` and `port/wasm/` first on the unit path. FreePascal writes the objects with its own assembler; its linker call is caught (a stand-in `wasm-ld` writes down the object list) and Emscripten links them instead, with Lua, `port/start.c` and the JavaScript bridges (`port/wasi-emscripten.js`, `port/host.js`).
5. **Data.** Upstream's `drlwad`, linked for Node, runs `port/console-manifest.lua`'s manifest (upstream's `build.lua` without images, sounds and music) and writes `core.wad` and `drl.wad`; with upstream's `config.lua` they are packed into `drl-data.data` (Emscripten's file packager, preloaded at `/drl`).
6. **Runtime.** `drl.mjs` + `drl.wasm` for a Web Worker (`-O2`, Asyncify, `-sMALLOC=none`), `runtime-manifest.json` with each file's SHA-256 and a content-hash `buildId`. A Node build of the same objects (the conformance harness, with the data) goes to the cache.

## Link settings

| Setting | Value | Why |
|---|---|---|
| `-sMALLOC=none` | | One allocator: the Pascal heap (`port/wasm/ramalloc.pas` implements `malloc` on it). |
| `-sASYNCIFY=1` | `ASYNCIFY_STACK_SIZE=524288` | DRL's sleeps and key waits suspend the module. |
| `-sSTACK_SIZE` | 4 MB | FreePascal's own default for WASI is 8 MB; 4 MB is ample for DRL (strings and records on the stack, Lua's C stack). |
| `-sINITIAL_MEMORY` / `MAXIMUM_MEMORY` | 16 MB / 512 MB | DRL fits in 16 MB (measured: it never grows); it can grow as the Pascal heap needs, capped well under a phone's limit. |
| `-O2` | | `-Os` would be 0.2 MB smaller, but with it Emscripten 6.0.13's import minification left the WASI imports from FreePascal's objects without functions ("function import requires a callable" at instantiation). |

## Sizes and memory

Measured on build `2456ef53f9294108` (the same settings as the current one; sizes within a few KB):

| File | Size | gzip -9 |
|---|---|---|
| `drl.wasm` | 4.72 MB | 1.15 MB |
| `drl-data.data` | 0.38 MB | 0.37 MB |
| `drl.mjs` | 81 KB | 22 KB |

About 1.5 MB to download compressed. From navigation to DRL's first screen, cold, on a local server (`vite preview`, no network latency): 0.59–0.61 s in Chromium, 0.63–0.70 s in WebKit (three runs each).

**Memory**, measured with `tests/memory-profile.mjs` (the method of `games/cataclysm-dda/tests/memory-profile.mjs`: headless, production build, twice a second from Linux's `/proc` for the page's process, which runs the game's worker too; the module's memory from the worker). It opens DRL, goes through its main menu to a new game, walks and waits, opens the inventory and the help, then Save & Quit. Each figure is the phase's maximum, MB:

| Phase | Chromium: renderer (peak) | WebKit (WPE): web process (peak), anonymous | Module memory |
|---|---|---|---|
| The library page alone, no game (for comparison) | 141 (147) | 352 (368) | — |
| Download, compile, start, DRL's main menu | 242 (245) | 445 (457), 262 | 16 |
| New game (menus, intro) to the map | 198 | 440, 256 | 16 |
| Playing, inventory, help | 198 | 437, 254 | 16 |
| Save & Quit, back to the main menu | 199 | 445, 261 | 16 |

The game adds about 60 MB to Chromium's renderer and about 90 MB to WebKit's process; DRL's own memory (the module's linear memory: the Pascal heap with Lua's, the stack, the data) stays at its initial 16 MB (`-sINITIAL_MEMORY=16777216`) through a game: it never grows. For scale, Cataclysm: DDA's WebKit process reached 1.6–2.5 GB. WebKit for Linux (WPE) is Safari's engine but not iOS; the port has not been measured on a physical iPhone yet.

## Reproducibility

Every input is pinned: the toolchains, the upstream commits, Lua's hash, the patches, the scripts. FreePascal embeds the compile date and time (DRL's log prints them); the build sets them to the upstream commit's (`-DD`, `-DT`). Two consecutive builds gave the same `buildId` (`4521d1e207ffcd34`).

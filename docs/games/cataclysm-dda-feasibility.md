# Cataclysm: DDA — feasibility

**Verdict: feasible as upstream's own web build; size, memory and the phone interface are the risks.** Phase 1 (build, run, persistence, tests, the UI inventory) is done; the phone design is the next phase.

## Upstream's browser build

Upstream maintains an Emscripten build of the tiles version:

- `Makefile`, `NATIVE=emscripten`: `emcc` with Emscripten's SDL2, SDL2_image (PNG) and SDL2_ttf ports, C++ exceptions, Asyncify (the game's blocking input loop yields to the browser), IDBFS, 512 MB initial memory (up to 4 GB), LZ4-compressed data.
- `build-scripts/build-emscripten.sh`: the make command (`TILES=1 RELEASE=1 BACKTRACE=0 TESTS=0 LINTJSON=0`), with Emscripten 3.1.51.
- `build-scripts/prepare-web.sh`: the data package (`data/{core,font,fontdata.json,json,mods,names,raw,motd,credits,title}` and `gfx/`, without obsolete mods, the MA mod and the Ultica_iso tileset), packed by Emscripten's file packager with `--lz4`.
- `.github/workflows/emscripten.yml`: CI runs both on pull requests; `build-data/web/index.html` is its page.
- In the source: `#if defined(EMSCRIPTEN)` blocks mount the user directory on IndexedDB (`main.cpp mount_idbfs`) and sync it after writes, yield once per redraw (`ui_manager.cpp`), skip JSON verification at load (`SKIP_VERIFICATION`), drop "Quit" from the main menu and fullscreen toggling.

The port runs that build unmodified (no patches) with the pinned Emscripten 6.0.13 instead of 3.1.51. Four adjustments were needed, all in the build scripts: `-DEMSCRIPTEN` (Emscripten 6 no longer defines the legacy macro upstream's web code tests), `-Wno-error`, `em++` as the linker, and the optimisation level (upstream's `-Os` link ran out of memory after two hours; the port links at `-O1` and runs `wasm-opt -O2` separately), plus `-sDYNAMIC_EXECUTION=0` for the site's content security policy.

## Findings

| Question | Answer |
|---|---|
| Newest stable release | `0.I-1` (point release of 0.I; `0.I` and `0.H` were earlier; development builds are `cdda-experimental-*`) |
| Build time | About 45 minutes on four cores for the ~430 translation units; link about a minute; `wasm-opt -O2` about 9 minutes (5.3 GB) |
| Threads / SharedArrayBuffer | Not used (single-threaded, Asyncify) |
| Runs on the page or in a worker | On the page: SDL2 draws with WebGL into the page's canvas; upstream's code calls `window.*` |
| Saves | Upstream's own IDBFS mount (config, worlds, saves) |
| Licence | CC BY-SA 3.0 (code and content); fonts OFL/Apache; third-party code permissive; tilesets CC BY-SA 3.0 (`LICENSES.md`) |
| Mobile | Upstream's Android port has a quick-shortcuts bar, virtual joystick and gestures, compiled only for Android (`UI-INVENTORY.md`); the web build has none of it |

Sizes, load time and memory: `games/cataclysm-dda/BUILDING.md`.

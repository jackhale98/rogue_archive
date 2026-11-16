# How the Cataclysm: DDA port works

Cataclysm: DDA already has a web version: upstream's Makefile builds the tiles game with Emscripten (`make NATIVE=emscripten`), and `build-scripts/prepare-web.sh` packs its data. The port builds exactly that from the pinned release, without patches, and adds what Rogue Archive needs around it: verified downloads, a canvas in the shell's area, keys from the shell, a read-only view of the game for the shell and tests, and saving on leave.

**Status: phase 1.** The game builds, runs, saves and continues on desktop with a keyboard and mouse. The phone controls are a placeholder (a pad, a few actions, More and the keyboard); their design is the next phase, from [UI-INVENTORY.md](UI-INVENTORY.md). The catalog entry stays `planned`; the game opens only by its address (`#/play/cataclysm-dda`).

```
 page (Rogue Archive shell)
┌───────────────────────────────────────────────────────────────────┐
│ adapter/index.ts                                                  │
│  · downloads and verifies cataclysm-tiles.mjs / .wasm and         │
│    cataclysm-data.data.gzip; inflates the data package            │
│  · canvas#canvas in the shell's free area (at least 640×384)      │
│  · keys → synthetic keydown/keypress/keyup on #ra-cdda-keys       │
│  · polls ra_state / ra_messages → contexts, dock, message log     │
│  · persist → FS.syncfs; leave → ra_stop (abort the runtime)       │
│                                                                   │
│ cataclysm-tiles.wasm: upstream's web build + rogue-archive-web.o  │
│  · Asyncify: the game's input loop yields to the browser          │
│  · /home/web_user/.cataclysm-dda (IDBFS, mounted by upstream)     │
│  · data package (LZ4, read on demand) at /data and /gfx           │
└───────────────────────────────────────────────────────────────────┘
```

## The build: upstream's own

- `scripts/build.sh` runs upstream's Makefile with the variables of upstream's `build-scripts/build-emscripten.sh` (`NATIVE=emscripten BACKTRACE=0 TILES=1 TESTS=0 RUNTESTS=0 RELEASE=1 LINTJSON=0`), objects outside the source tree (`BUILD_PREFIX`), and two wrappers:
  - `scripts/emcc-compile.sh` (CXX): `emcc … -DEMSCRIPTEN -Wno-error`. Upstream builds with Emscripten 3.1.51, which predefined the legacy `EMSCRIPTEN` macro; the pinned Emscripten (6.0.13) defines only `__EMSCRIPTEN__`, and upstream writes its web code as `#if defined(EMSCRIPTEN)`. Without the macro that code is silently left out (found in the first browser run: no IndexedDB mount, so nothing persisted; a Quit entry in the main menu; no yield per redraw). Upstream also compiles with `-Werror`, and the newer compiler warns about more; warnings stay on. The object directory is keyed on this file, so changing it rebuilds everything (make tracks sources, not flags).
  - `scripts/emcc-link.sh` (LD): `em++` instead of upstream's `emcc` (Emscripten 6 links C++ only through `em++`), plus a response file with the port's additions: its object, the link-time wrappers (below), the data package loader (`--pre-js`), an ES-module factory (`MODULARIZE`, `EXPORT_ES6`), the exported functions and runtime methods, and the module options the page passes (`INCOMING_MODULE_JS_API`; `instantiateWasm`, not `wasmBinary`: "Memory" below). Upstream's flags are kept (Asyncify, JS exceptions, IDBFS, LZ4) with three exceptions: `-sDYNAMIC_EXECUTION=0` (the site's Content Security Policy allows no `eval`; embind, used by upstream's `emscripten_exception.cpp`, then builds its call wrappers without `new Function`), the memory settings ("Memory" below), and the optimisation level: see below.
  - **Optimisation.** Upstream links at `-Os`. With the pinned Emscripten that runs the Asyncify pass and two hours of `-Os` optimisation in one `wasm-opt` run, then a final pass that was killed at 14 GB of memory (measured here, four cores, 15 GB). The port links at `-O1` (Asyncify alone: about a minute, 135 MB module, with function names: `--profiling-funcs`) and then runs `wasm-opt -O2` on the result as a separate step (about 5 minutes, 5.3 GB peak; 78 MB, 26 MB gzipped), with the static constructors marked not to be inlined (`--no-inline=_GLOBAL__sub_I_*`, `--no-inline=__cxx_global_var_init*`; "Memory" below); the names are not kept in the output. `-Os` now fits as well but saves only 1 MB (`BUILDING.md`). Import and export names are not minified, so the glue is unchanged.
- The port's file `port/rogue-archive-web.cpp` is compiled with the flags upstream's Makefile prints (`scripts/print.mk`).
- **Emscripten ports** (SDL2, SDL2_image, SDL2_ttf, FreeType, HarfBuzz, libpng, zlib): Emscripten downloads them as GitHub archives the first time. Some build environments allow git but not those downloads, so `scripts/ports.sh` checks out the same tags with git where Emscripten unpacks them (with Emscripten's own marker), and checks the pinned Emscripten's recipes still name those versions. Emscripten then builds each port with its own recipe.
- **Data:** as `prepare-web.sh`: `data/{core,font,fontdata.json,json,mods,names,raw,motd,credits,title}` without obsolete mods and `MA`, then `gfx/` — but only the two default tilesets (UltimateCataclysm, Larwick Overmap; `LICENSES.md`). Emscripten's file packager packs it with `--lz4` (files stay compressed in memory and are decompressed in chunks when read); the package is sent gzipped (`.gzip`, not `.gz`: no server inflates it before the integrity check) and the page inflates it before the module starts.
- **Source:** a sparse, blob-less checkout of the pinned commit without `lang/` (translations, about 690 MB, not in the web bundle), `doc/` and `data/screenshots/`.

## The game on the page

- **Why not a worker.** The other terminal games run in a Web Worker. Cataclysm's web build draws with SDL2 and WebGL into the page's canvas, and upstream's code calls `window.*` (`setFsNeedsSync`, `game_unsaved`, the `menuready` event), so it runs on the page. Its blocking input loop is made asynchronous by Asyncify (upstream's choice): the game yields once per redraw (`ui_manager::redraw`, `emscripten_sleep(1)`) and while waiting for events.
- **Keys.** SDL2 listens for keys only on a private element (`SDL_EMSCRIPTEN_KEYBOARD_ELEMENT=#ra-cdda-keys`, set in the environment before start-up; SDL reads hints from the environment), so the shell decides what reaches the game. The adapter sends each key as a browser would (`keydown` with the legacy `keyCode`, `keypress` with the character, `keyup`; Shift and Ctrl as their own key events), which Emscripten's SDL2 turns into key and text events (`adapter/input.ts`).
- **Mouse.** SDL2 takes the canvas's mouse events directly: clicks, the wheel and hover work as in the desktop game (route preview and walk on the map, menus, look and targeting cursors).
- **Size.** The canvas fills the shell's area but never below 640×384 CSS px (80×24 cells of the default 8×16 font: the game's smallest terminal); SDL sizes the window from the canvas's CSS size when the page sends a resize event, and the game resizes its terminal. The adapter sends that event only when the canvas's size really changed: SDL also sets the canvas's size on it, which clears the canvas even when the size is the same, and the game redraws only when its window size changes (found in the browser run: a black screen at rest). On an upright phone only the left part of the screen shows (the phone design will deal with it). Upstream turns high-DPI off on the web (`sdltiles.cpp`), so the canvas has one pixel per CSS pixel.
- **Environment.** `LANG=en_US.UTF-8` (no translations are shipped, so the game does not ask for a language).

## What the port observes (read-only)

Nothing here changes the game. A few upstream functions are wrapped at link time (`wasm-ld --wrap`; `scripts/build.sh` `WRAPPED`): the wrapper records what it sees and calls the real function. (One more wrapper, `options_manager::load`, sets an option's default once: "Memory" below.)

| Wrapped | Gives |
|---|---|
| `input_context::handle_input()` and `handle_input(int)` | the keybinding context the game waits in (its private `category`, read through an explicit template instantiation, which C++ allows for private members) and the stack of waiting contexts; which of a few telling actions the context registers (the map and direction prompts share `DEFAULTMODE`; only the map registers `inventory`) |
| `input_manager::get_input_event` | raw waits outside any context ("press any key") |
| `cata_cursesport::curses_drawwindow` | the text of every curses window as it is drawn, into a screen-sized grid |
| `ImDrawList::AddText` (both), `ImGui::NewFrame` | the text the game's ImGui windows draw (menus, popups), placed in the same grid by position |
| `do_turn`, `main_menu::opening_screen` | in a game, or at the main menu |
| `handle_resize` (sdltiles.cpp) | after the game resizes its window, an immediate redraw of the screen (`ui_manager::invalidate` + `redraw_invalidated`, what upstream itself does after its render target is reset). Upstream otherwise redraws at the next key: on the web, where the page resizes the game after the main menu is drawn, the screen stayed black until a key was pressed. Display only. |

Exports (`ra_*`): `ra_state` (JSON: context, contexts, registered probes, waiting, raw wait, in game, main menu, terminal and cell size, the player's position (local and absolute), name and death, the turn, `game::uquit`, the open ImGui windows' titles), `ra_screen_text`, `ra_messages`/`ra_message_count` (the game's message log, `Messages::recent_messages`), `ra_stop`.

## Contexts and controls (placeholder)

`adapter/state.ts detectContext`: `loading` (not waiting, not in a game), `title` (`MAIN_MENU`), `map` (`DEFAULTMODE` with the inventory registered), `direction` (`DEFAULTMODE` without it: "Examine where?"), `text` (`STRING_INPUT`, `STRING_EDITOR`), `menu` (any other context), `busy` (in a game, not waiting). The dock (`controlsFor`): map — pad, Inventory, Look, Actions (the game's own action menu, Enter), More, Keyboard; direction — pad, Back, More, Keyboard; menus — OK, Back, More, Keyboard. More lists every command of normal play with its original key (`CDDA_COMMANDS`, from `keybindings.json`).

## Saving, as Cataclysm does it

Upstream mounts `/home/web_user/.cataclysm-dda` (config, worlds with their saves, templates, memorials) on IndexedDB before `main` runs and syncs it after the game writes files (`window.setFsNeedsSync`). A game continues from its last save: **Save and quit** (`S`, then a capital `Y`: the game's `FORCE_CAPITAL_YN` is on by default) writes it and returns to the main menu; **Load** continues it. The adapter syncs again when the page is hidden and before it stops the game, and its leave dialog offers **Save and leave** (the game's own Save and quit) while the game has unsaved turns (`window.game_unsaved`, which upstream sets after each turn and clears when it saves). Export gives every file of the user directory with its path (`save/<world>/…`, `config/…`), the desktop game's own files; import puts them back.

## Leaving

The game's loop never returns, so the adapter syncs the files, calls `ra_stop` (`abort()`: Emscripten then ignores the pending wake-up), removes the listeners SDL added to `window` and `document` (recorded during start-up), releases the WebGL context and removes its elements.

## Verification

- Unit tests (`tests/adapter.test.ts`): key strokes (including keybindings.json's key names), commands, contexts, docks, message tags.
- `scripts/test-engine.sh`:
  1. **Key coverage** (`tests/conformance/key-coverage.ts`) against `data/raw/keybindings.json`: each command is an upstream action of normal play and sends one of its default keys; every keyed `DEFAULTMODE` action is offered; every default keyboard binding of every context (1073) can be sent.
  2. **Upstream drift** (`tests/conformance/upstream-drift.ts`): the Makefile's emscripten block, upstream's web build scripts, `mount_idbfs`, `game_unsaved`, the wrapped functions' declarations and `input_context::category`, `options_manager::load` and the renderers the `RENDERER` option offers, Dear ImGui's `AddText`/`NewFrame`, `keybindings.json`.
  3. **Runtime** (`tests/conformance/runtime-check.mjs`): the module exports the page's interface; the data package holds what upstream's web bundle holds (and not the excluded mods, other tilesets or translations).
- **Native vs WebAssembly replay: not done in phase 1.** Cataclysm has no headless replay or demo mode, and nothing in a normal game is seeded from outside: world and character generation draw from an engine seeded at start-up, and the game loop needs a terminal or SDL window. The upstream equivalent is its Catch2 test suite (`tests/`, about 300 more files, `cata_test`), which seeds its RNG and loads the data headlessly. Doing it needs: the test suite compiled twice more (natively, and for Node with `NODERAWFS`, since the shipped module is web-only), about an hour of compilation each on four cores plus the Asyncify link, then running the same test selection (for example the map generation, crafting and item tests) in both and comparing results. A cheaper intermediate step is a Node build of the game itself started with `--check-mods` (load and check every mod) natively and in WebAssembly.
- Memory (`tests/memory-profile.mjs`, not a test: a measurement): phase by phase, as in `BUILDING.md`.
- End-to-end (`e2e/cataclysm-dda.spec.ts`, `e2e/cataclysm-dda.mobile.spec.ts`): desktop — the main menu is drawn (pixels of a screenshot of the canvas, not only the game's state: a WebGL canvas reads back blank), Play Now!, walk, inventory, message log, Save and quit, reload, Load and continue at the same place; phone — the game loads, the placeholder dock and the pad appear, More lists the commands.

## Memory

The page's first run on an iPhone (Safari) was reset during Play Now!'s world generation: out of memory. The measurements and the before/after tables are in `BUILDING.md` ("Memory", `tests/memory-profile.mjs`). What the port changes, and why; none of it changes the game's content or rules:

- **The static constructors stay out of line** (`scripts/build.sh`, `wasm-opt --no-inline=…`). `wasm-opt -O2` had inlined each source file's static constructor (each has one caller) into `__wasm_call_ctors`, making a single 6.6 MB function that runs once at start-up; Chromium's baseline compiler needed about 3 GB of memory for it, the peak of the whole run (3.3 GB). Out of line, the start-up peak is 557 MB. Close to V8's limit for one function (7.65 MB) too, so an upstream update could have broken the module outright.
- **The page keeps no copies of what it downloaded** (`adapter/index.ts`). It compiles the module itself through Emscripten's `instantiateWasm` hook (the glue would otherwise keep `Module.wasmBinary`, 78 MB, for the page's lifetime), inflates the data package straight into a buffer of its final size (the gzip trailer gives it) instead of through Blob and Response copies, and lets the gzipped package and the glue's text go once used (they were kept by the suspended start-up function). Kept: the inflated LZ4 package (40 MB; the file system reads files from it on demand). The debug hook reports the linear memory's size (`memoryBytes()`).
- **The WebGL renderer by default** (`port/rogue-archive-web.cpp`, a wrapper of `options_manager::load`). Upstream's `RENDERER` option (Settings → Graphics → Renderer, "Requires restart") defaults to SDL's `software` renderer on every platform but Windows (`cata_tiles::build_renderer_list` puts it first). The software renderer keeps every tile as its own texture in the WebAssembly heap, five times over (the colour variants for shadow, night vision, overexposure and map memory): about half of the 1.09 GB the heap reached during Play Now!. The port sets the option to `opengles2` (the game's other renderer on the web: SDL's GLES2 renderer over WebGL) once per browser, the first time the game starts, and records that it did in `config/rogue-archive-defaults.json`; from then on the game's own options file decides, so the player's choice stands and is changed where upstream offers it. (A marker rather than "no options file yet": the game writes its options file when a game starts, so browsers that ran the earlier build already have one with `software` in it.) If WebGL is not available, the game falls back to the software renderer itself. Result: linear memory's high-water mark 1,089 → 576 MB. The textures (about 450–500 MB) live in the GPU process instead, so this halves the WebAssembly heap rather than the total. Drawing is unchanged (compared on screenshots) and world generation was not slower.
- **Memory settings** (`scripts/build.sh`). Upstream's `INITIAL_MEMORY=512MB`, `MAXIMUM_MEMORY=4GB` and Emscripten's default growth (+20%, at most 96 MB a step) become `INITIAL_MEMORY=128MB`, `MAXIMUM_MEMORY=2GB` and `MEMORY_GROWTH_LINEAR_STEP=64MB`: the heap's high-water mark is about 520–580 MB with the WebGL renderer, so 128 MB covers start-up to the main menu (38 MB used), 64 MB steps reach it in seven growths with at most 64 MB unused, and 2 GB leaves room for long games while keeping pointers below 2 GB (and the reservation half of upstream's). Large reservations and growth of WebAssembly memory are where iOS Safari fails most often.
- **Tried, not kept:** `wasm-opt -Os` (1 MB smaller). **Not changed:** the default mods (`dda`, `no_npc_food`, `personal_portal_storms`: small), the world options (city size, spawn densities: they change the game, and the data, not the world, is what fills the heap), `Use tiles` (turning it off saves the 450–500 MB of textures, measured; the player can choose it in Settings → Graphics).

What is left is upstream-level: the game data once loaded (about 450 MB of the heap's 512 MB in play), and in Chromium the baseline compiler's memory for the large Asyncify-instrumented functions while the data loads (a transient of about 1.3 GB; `BUILDING.md`).

## Known limitations (phase 1)

- Phone controls are a placeholder; an upright phone shows only part of the 80-column screen.
- No sound (upstream's web build has none).
- Tutorial Game does not work (its mod is left out, as in upstream's web bundle).
- Only two tilesets are offered.
- Large and memory-hungry: about 53 MB to download (gzip); in desktop Chromium, a peak of about 1.8 GB resident in the page's process during Play Now! (3.3 GB before the work in "Memory"), about 1.0–1.2 GB while playing, plus about 0.6 GB in the GPU process (the tiles), and a WebAssembly heap of 576 MB (1.09 GB before). Not yet measured on an iPhone after these changes.

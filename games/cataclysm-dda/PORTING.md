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
  - `scripts/emcc-compile.sh` (CXX): `emcc … -Wno-error`. Upstream compiles with `-Werror` and tests with Emscripten 3.1.51; the pinned Emscripten (6.0.13) warns about more. Warnings stay on.
  - `scripts/emcc-link.sh` (LD): `em++` instead of upstream's `emcc` (Emscripten 6 links C++ only through `em++`), plus a response file with the port's additions: its object, the link-time wrappers (below), the data package loader (`--pre-js`), an ES-module factory (`MODULARIZE`, `EXPORT_ES6`), the exported functions and runtime methods, and the module options the page passes (`INCOMING_MODULE_JS_API`). Upstream's flags are kept: Asyncify, JS exceptions, 512 MB initial memory growing to 4 GB, IDBFS, LZ4, `-Os`.
- The port's file `port/rogue-archive-web.cpp` is compiled with the flags upstream's Makefile prints (`scripts/print.mk`).
- **Emscripten ports** (SDL2, SDL2_image, SDL2_ttf, FreeType, HarfBuzz, libpng, zlib): Emscripten downloads them as GitHub archives the first time. Some build environments allow git but not those downloads, so `scripts/ports.sh` checks out the same tags with git where Emscripten unpacks them (with Emscripten's own marker), and checks the pinned Emscripten's recipes still name those versions. Emscripten then builds each port with its own recipe.
- **Data:** as `prepare-web.sh`: `data/{core,font,fontdata.json,json,mods,names,raw,motd,credits,title}` without obsolete mods and `MA`, then `gfx/` — but only the two default tilesets (UltimateCataclysm, Larwick Overmap; `LICENSES.md`). Emscripten's file packager packs it with `--lz4` (files stay compressed in memory and are decompressed in chunks when read); the package is sent gzipped (`.gzip`, not `.gz`: no server inflates it before the integrity check) and the page inflates it before the module starts.
- **Source:** a sparse, blob-less checkout of the pinned commit without `lang/` (translations, about 690 MB, not in the web bundle), `doc/` and `data/screenshots/`.

## The game on the page

- **Why not a worker.** The other terminal games run in a Web Worker. Cataclysm's web build draws with SDL2 and WebGL into the page's canvas, and upstream's code calls `window.*` (`setFsNeedsSync`, `game_unsaved`, the `menuready` event), so it runs on the page. Its blocking input loop is made asynchronous by Asyncify (upstream's choice): the game yields once per redraw (`ui_manager::redraw`, `emscripten_sleep(1)`) and while waiting for events.
- **Keys.** SDL2 listens for keys only on a private element (`SDL_EMSCRIPTEN_KEYBOARD_ELEMENT=#ra-cdda-keys`, set in the environment before start-up; SDL reads hints from the environment), so the shell decides what reaches the game. The adapter sends each key as a browser would (`keydown` with the legacy `keyCode`, `keypress` with the character, `keyup`; Shift and Ctrl as their own key events), which Emscripten's SDL2 turns into key and text events (`adapter/input.ts`).
- **Mouse.** SDL2 takes the canvas's mouse events directly: clicks, the wheel and hover work as in the desktop game (route preview and walk on the map, menus, look and targeting cursors).
- **Size.** The canvas fills the shell's area but never below 640×384 CSS px (80×24 cells of the default 8×16 font: the game's smallest terminal); SDL sizes the window from the canvas's CSS size when the page sends a resize event, and the game resizes its terminal. On an upright phone only the left part of the screen shows (the phone design will deal with it). Upstream turns high-DPI off on the web (`sdltiles.cpp`), so the canvas has one pixel per CSS pixel.
- **Environment.** `LANG=en_US.UTF-8` (no translations are shipped, so the game does not ask for a language).

## What the port observes (read-only)

Nothing changes the game. A few upstream functions are wrapped at link time (`wasm-ld --wrap`; `scripts/build.sh` `WRAPPED`): the wrapper records what it sees and calls the real function.

| Wrapped | Gives |
|---|---|
| `input_context::handle_input()` and `handle_input(int)` | the keybinding context the game waits in (its private `category`, read through an explicit template instantiation, which C++ allows for private members) and the stack of waiting contexts; which of a few telling actions the context registers (the map and direction prompts share `DEFAULTMODE`; only the map registers `inventory`) |
| `input_manager::get_input_event` | raw waits outside any context ("press any key") |
| `cata_cursesport::curses_drawwindow` | the text of every curses window as it is drawn, into a screen-sized grid |
| `ImDrawList::AddText` (both), `ImGui::NewFrame` | the text the game's ImGui windows draw (menus, popups), placed in the same grid by position |
| `do_turn`, `main_menu::opening_screen` | in a game, or at the main menu |

Exports (`ra_*`): `ra_state` (JSON: context, contexts, registered probes, waiting, raw wait, in game, main menu, terminal and cell size, the player's position (local and absolute), name and death, the turn, `game::uquit`, the open ImGui windows' titles), `ra_screen_text`, `ra_messages`/`ra_message_count` (the game's message log, `Messages::recent_messages`), `ra_stop`.

## Contexts and controls (placeholder)

`adapter/state.ts detectContext`: `loading` (not waiting, not in a game), `title` (`MAIN_MENU`), `map` (`DEFAULTMODE` with the inventory registered), `direction` (`DEFAULTMODE` without it: "Examine where?"), `text` (`STRING_INPUT`, `STRING_EDITOR`), `menu` (any other context), `busy` (in a game, not waiting). The dock (`controlsFor`): map — pad, Inventory, Look, Actions (the game's own action menu, Enter), More, Keyboard; direction — pad, Back, More, Keyboard; menus — OK, Back, More, Keyboard. More lists every command of normal play with its original key (`CDDA_COMMANDS`, from `keybindings.json`).

## Saving, as Cataclysm does it

Upstream mounts `/home/web_user/.cataclysm-dda` (config, worlds with their saves, templates, memorials) on IndexedDB before `main` runs and syncs it after the game writes files (`window.setFsNeedsSync`). A game continues from its last save: **Save and quit** (`S`, yes) writes it and returns to the main menu; **Load** continues it. The adapter syncs again when the page is hidden and before it stops the game, and its leave dialog offers **Save and leave** (the game's own Save and quit) while the game has unsaved turns (`window.game_unsaved`, which upstream sets after each turn and clears when it saves). Export gives every file of the user directory with its path (`save/<world>/…`, `config/…`), the desktop game's own files; import puts them back.

## Leaving

The game's loop never returns, so the adapter syncs the files, calls `ra_stop` (`abort()`: Emscripten then ignores the pending wake-up), removes the listeners SDL added to `window` and `document` (recorded during start-up), releases the WebGL context and removes its elements.

## Verification

- Unit tests (`tests/adapter.test.ts`): key strokes (including keybindings.json's key names), commands, contexts, docks, message tags.
- `scripts/test-engine.sh`:
  1. **Key coverage** (`tests/conformance/key-coverage.ts`) against `data/raw/keybindings.json`: each command is an upstream action of normal play and sends one of its default keys; every keyed `DEFAULTMODE` action is offered; every default keyboard binding of every context (1073) can be sent.
  2. **Upstream drift** (`tests/conformance/upstream-drift.ts`): the Makefile's emscripten block, upstream's web build scripts, `mount_idbfs`, `game_unsaved`, the wrapped functions' declarations and `input_context::category`, Dear ImGui's `AddText`/`NewFrame`, `keybindings.json`.
  3. **Runtime** (`tests/conformance/runtime-check.mjs`): the module exports the page's interface; the data package holds what upstream's web bundle holds (and not the excluded mods, other tilesets or translations).
- **Native vs WebAssembly replay: not done in phase 1.** Cataclysm has no headless replay or demo mode, and nothing in a normal game is seeded from outside: world and character generation draw from an engine seeded at start-up, and the game loop needs a terminal or SDL window. The upstream equivalent is its Catch2 test suite (`tests/`, about 300 more files, `cata_test`), which seeds its RNG and loads the data headlessly. Doing it needs: the test suite compiled twice more (natively, and for Node with `NODERAWFS`, since the shipped module is web-only), about an hour of compilation each on four cores plus the Asyncify link, then running the same test selection (for example the map generation, crafting and item tests) in both and comparing results. A cheaper intermediate step is a Node build of the game itself started with `--check-mods` (load and check every mod) natively and in WebAssembly.
- End-to-end (`e2e/cataclysm-dda.spec.ts`, `e2e/cataclysm-dda.mobile.spec.ts`): desktop — Play Now!, walk, inventory, message log, Save and quit, reload, Load and continue at the same place; phone — the game loads, the placeholder dock and the pad appear, More lists the commands.

## Known limitations (phase 1)

- Phone controls are a placeholder; an upright phone shows only part of the 80-column screen.
- No sound (upstream's web build has none).
- Tutorial Game does not work (its mod is left out, as in upstream's web bundle).
- Only two tilesets are offered.
- Large: see `BUILDING.md` for sizes, load time and memory; untested on iOS Safari, whose per-tab memory limit is the main risk (the module starts with 512 MB).

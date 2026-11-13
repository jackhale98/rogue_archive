# How the HyperRogue port works

HyperRogue already has a web version: upstream's `hyperweb.cpp` builds the whole game (one translation unit) with Emscripten, draws with WebGL through Emscripten's SDL 1, and runs from the browser's animation frames. The port builds that, unchanged, from the pinned source, and adds what Rogue Archive needs around it: saving, a canvas that fills the shell's area, touch play modelled on HyperRogue's mobile version, and the shell's log, dock and pad.

```
 page (Rogue Archive shell)
┌──────────────────────────────────────────────────────────────┐
│ adapter/index.ts                                             │
│  · downloads and verifies hyperrogue.mjs / .wasm             │
│  · canvas + #this_wide sizer in the shell's free area        │
│  · keys → synthetic keydown/keypress/keyup (SDL 1)           │
│  · touch → mouse (tap = click, long-press = right-click)     │
│  · polls ra_state / ra_log_* → dock, message log             │
│  · persist → ra_save (emergency save) + IDBFS sync           │
│                                                              │
│ hyperrogue.wasm: hyperweb.cpp + port/rogue-archive-web.cpp   │
│  · /hyperrogue (IDBFS): hyperrogue.log, hyperrogue.ini       │
└──────────────────────────────────────────────────────────────┘
```

## The game: upstream's web build, on the page

- **Why not a worker.** The other games run in a Web Worker with Asyncify, because their engines block waiting for keys. HyperRogue's web build doesn't block: it draws a frame and returns, called by the browser's animation frames (`emscripten_set_main_loop`). It draws with WebGL into a canvas and reads the page's DOM, so it runs on the page itself.
- **Build.** `scripts/build.sh` compiles `port/rogue-archive-web.cpp`, which `#include`s upstream's `hyperweb.cpp` (which includes `hyper.cpp` and the whole game), with upstream's web flags (C++17, exceptions, a 1 MiB stack) and upstream's own switches:
  - `-DCAP_SAVE=1 -DCAP_CONFIG=1`: the score file (which also holds a game saved with an Orb of Safety or in casual mode) and the config file, both off in upstream's online demo;
  - `-DMAXMDIM=4`: the full build (`hyperweb.cpp`'s 2D-only variant no longer compiles at this version);
  - `-DEMSCRIPTEN_FIXED_ARG="?a=-noscr+-f1"`: the command line is fixed, so the page's own URL (`?debug=1`) is never read as game arguments; `-noscr` skips the "online demo" menu, `-f1` makes the game fill its container.
  - Upstream's `LEGACY_GL_EMULATION` link flag is left out: the web build only uses OpenGL ES 2 calls (the link would fail otherwise), and the game renders the same without the emulation layer.
- **Files.** Before the game starts, the page mounts `/hyperrogue` on IndexedDB (IDBFS, `autoPersist`) and makes it the working directory, so upstream's default file names (`hyperrogue.log`, `hyperrogue.ini`) land there. (The `-c` option can't be used: upstream's web start-up reads arguments only from phase 2.)
- **Size.** Upstream's `get_canvas_size()` reads the size of the element with id `this_wide` in fullscreen mode, but its window-resize handler ignores resizes in that mode. The adapter keeps a hidden sizer element with that id at the free area's size times the device pixel ratio (capped at 2), and calls `ra_resize()` (upstream's `get_canvas_size()` + `setvideomode()`) when the area changes. Emscripten's SDL sets the canvas's CSS size to its pixel size on every resize; a stylesheet rule with `!important` keeps the canvas at the area's CSS size.
- **Added functions** (`port/rogue-archive-web.cpp`; none changes the game's rules):
  - `ra_save()`: `if(!casual) saveStats(true);`, exactly what the Android app (`hyperroid`) does when it goes to the background;
  - `ra_state()`: a read-only snapshot (map or dialog, treasure, kills, turns, whether the player can move, land, orbs; for the dock: a ranged orb held, the orb a click under the pointer would use (`orbToTarget`), strong wind, crossbow mode, fire mode and reload, Dead Orbs, Orb Strategy, the Minefield nearby, the Orb of Safety's charge and the touch mode);
  - `ra_set_touch_mode()`: what a click on the map does, among upstream's own touch modes (move, info, ranged): interface state that upstream's `touch_interface` button cycles, not game state;
  - `ra_item_name()`: an item's name (for the hint naming the orb a tap would use);
  - `ra_log_*`: the game's own message log (`gamelog`);
  - `ra_hover_text()`: what the game says about the cell under the pointer;
  - `ra_land_name()`, `ra_resize()`.

## Saving, as HyperRogue does it

HyperRogue records every game in its score file when the game ends or you quit. A game in progress can be continued later only if you quit while an **Orb of Safety** is powered (its description: "Your game will be saved if you quit the game while the Orb of Safety is still powered") or in **casual mode** (special modes menu). The port keeps that: when the page is hidden or left, `persist()` makes the Android app's emergency save, which records the game's score (and is replaced by the next save in the same session, as on Android). Files can be exported and imported (Menu → Save files for desktop); `hyperrogue.log` and `hyperrogue.ini` are the desktop game's own files.

## Input

- **Keys.** The shell's keys reach the game as synthetic `keydown`, `keypress` and `keyup` events on a private element (`keyboardListeningElement`), with the legacy `keyCode` and `charCode` Emscripten's SDL 1 reads (`adapter/input.ts`, `strokeFor`). The commands (`HYPER_COMMANDS`) are upstream's keys of normal play (`control.cpp`): vi keys to move, `.`/`s` to wait, Space to centre the view, Page Up/Down to rotate it, `t` `g` `f` `o` `i` `m`, Esc (quest screen), `v` (menu), F1 (help), F5 (new game).
- **Touch**, as upstream's mobile version (`mobile.cpp`): the finger shows what is under it (the game's hover), lifting it clicks there (move towards the cell, attack, use a ranged orb on it, choose a menu line), and holding still for half a second right-clicks (help about it). Touches are handled before they reach SDL, which would otherwise turn every touch into a left click.
- **Dock and pad** (`controlsFor`): map: what applies first (Aim with a ranged orb, crossbow Fire, Wind jump `t` with strong wind, Drop with Dead Orbs, Orbs `i` in Orb Strategy, Mark in the Minefield), then centre (long-press: rotate), overview `o` (long-press: Inspect), quest (long-press: help, new game, menu; "Cancel fire" in fire mode, as Esc cancels it first), more; dialogs: back, OK; game over: options, new game, menu. The thumb pad sends the vi keys, with wait in the centre.
- **Tap modes**: Aim and Inspect set upstream's `touchmode` (ranged: a click always targets a ranged orb, as Shift+click; info: a click shows help, as right-click) through `ra_set_touch_mode`; Aim ends once a turn passes. Mark is the adapter's: a tap points at the cell and then presses `m` a frame later (the game works out the cell under the pointer when it draws). A hint over the game names the mode, the orb a release would use while a finger is down, and the Orb of Safety's charge.

## Leaving

The adapter cancels the main loop, removes the listeners the game added to `window` and `document` while it started (recorded during start-up), releases the WebGL context and removes its elements, so a closed game can be collected.

## Verification

- Unit tests (`tests/input.test.ts`): key strokes, commands, docks, state.
- `scripts/test-engine.sh`: key coverage against `control.cpp`; upstream drift (the `hyperweb.cpp` functions and the Android save the port relies on); and native vs WebAssembly: `tests/conformance/harness.cpp` built natively (upstream's desktop configuration, `-nogui`) and as upstream's web build under Node plays seeded games (`-fixx`) with a fixed move sequence and prints a digest of the player's surroundings, treasure and kills after every turn. Seeds 1, 42 and 2026 match for 400 turns each. Seed 7 matches for 324 turns, then one monster four cells away steps to a different one of two equally good cells; the cause (most likely ties broken by iteration order or the maths library) is not yet identified, so that seed is not in the test.
- End-to-end (`e2e/hyperrogue.spec.ts`, `e2e/hyperrogue.mobile.spec.ts`): start, moves, quest screen, message log, importing a desktop score file and keeping it across reloads; on a phone, the dock, tap to move, long-press help, Inspect mode and the pad. Aim, Fire, Drop, Orbs and Mark need orbs, modes or lands a test cannot reach from a fresh game; their docks are unit-tested and their bindings checked by the key coverage.

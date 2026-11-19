# How the DRL port works

DRL is FreePascal on ChaosForge's FPC Valkyrie library, with its rules and data in Lua 5.1. The port compiles both with FreePascal's WebAssembly target and plays either of DRL's displays (the Display setting): its console mode (Text, the default) in a Web Worker, drawn by the site's terminal renderer, or its graphical mode (Tiles: SDL 3 and OpenGL, here WebGL 2) on the page. DRL's own code is unchanged. Building: [BUILDING.md](BUILDING.md); licences: [LICENSES.md](LICENSES.md); why this route: [the feasibility report](../../docs/games/drl-feasibility.md).

## The module

```
FreePascal (wasm32-wasip1, branchful exceptions)     Emscripten
  DRL + FPC Valkyrie + FreePascal's RTL  ──objects──▶  emcc link ◀── Lua 5.1 (C), port/start.c
  port/ncurses.pas, port/wasm/*.pas                     │           port/wasi-emscripten.js, port/host.js
                                                        ▼
                                          drl.mjs + drl.wasm (Asyncify)            console, worker
                                          drl-tiles.mjs + drl-tiles.wasm           graphical, page
                                            (+ SDL 3, SDL3_image, port/libraries.c, port/webgl.js)
```

- **Entry.** `port/start.c`'s `ra_start` calls FreePascal's `_start` (the RTL's entry, with its unhandled-exception handler). The worker calls it with an empty stack, so FreePascal's heap starts at `__heap_base`, where Emscripten's layout puts the heap.
- **One heap.** `port/wasm/ramalloc.pas` (added before the program's own units with `-Faramalloc`) implements C's `malloc` family on the Pascal heap; `-sMALLOC=none` leaves Emscripten's out. When the Pascal heap grows the memory, FreePascal's `WasmGrowMemoryCallback` calls `ra_memory_grown`, which refreshes Emscripten's views of it. The C library's allocations before the program starts (its environment) come from a 64 KB arena in `start.c`.
- **WASI.** The RTL makes WASI calls; `port/wasi-emscripten.js` implements those Emscripten lacks outside its standalone mode (opening paths, directory listings, file status, preopened directories, arguments, sleeping) on Emscripten's file system. Emscripten's errno values are WASI's.
- **A Unix build.** Valkyrie's code assumes every target is Windows or Unix; with `-dUNIX` it takes its Linux paths: the curses console (`vcursesio`, `vcursesconsole`), `dlopen` for optional libraries. wasip1 has no Unix units, so `port/wasm/` provides the names those paths use: `unix` and `baseunix` (C types, `FpFsync` on `fd_sync`, a `fpSystem` that finds no shell), `dl` and `dynlibs` (the libraries the module was linked with, found by name: none in the console build, `port/libraries-none.c`; SDL 3, SDL3_image and GL in the graphical one, below; never FMOD or Steam, as on a desktop without them), `video` (declarations only) and empty `pthreads`, `x`, `xlib`.

## The console: our curses

`port/ncurses.pas` is the part of FreePascal's `ncurses` unit that Valkyrie's curses driver calls (`initscr`, `init_pair`, `mvaddch`, `refresh`, `wgetch`, `curs_set`...), with the same names and values. The screen is an 80×25 window in memory; `refresh` hands it to the host (`ra_present`: two bytes per cell, the character, or the ACS letter for line drawing, and the foreground and background colours with the bold bit); `wgetch` takes the host's next key (`ra_key_take`). The same unit serves the browser (host: `port/host.js` → the worker) and the native conformance build (host: C).

Valkyrie's driver polls: `nodelay` on, a 1 ms sleep before each `wgetch`, and DRL's immediate-mode UI redraws every 10 ms. Sleeps are WASI `poll_oneoff` calls, an Asyncify suspension each; the worker keeps their length while the screen changes, and while it has been still for a second waits for the next key (at most 250 ms), so an idle game costs almost nothing.

**Keys** are what a terminal sends (`adapter/input.ts`): characters, control codes, and curses `KEY_` codes for the arrows, Home/End/PgUp/PgDn, Insert/Delete, Backspace and F-keys. Valkyrie's `CursesToKeyCode` turns them into DRL's key codes, as on Linux. That driver reads no modifiers, so Shift+arrow (run) and Ctrl+arrow (move the target) do nothing, as in upstream's Linux console; capital letters (Shift+letter bindings) work.

## The graphical mode (Tiles)

The same objects linked a second time (`drl-tiles.mjs`), with what DRL's graphical mode loads at run time on a desktop:

- **Libraries by name.** Valkyrie's loaders (`libs/vsdl3library.pas`, `vsdl3imagelibrary.pas`, `vgl3library.pas`) `dlopen` `libSDL3.so…`, `libSDL3_image.so…` and `libGL.so`, then look up every function by name. `port/libraries.c` answers with Emscripten's SDL 3 port (3.4.2, the version upstream ships in `ext/linux`), SDL3_image 3.4.0 built from source with PNG only (decoded by SDL 3), and for GL with `glXGetProcAddress`: the port's function of that name (below), else WebGL 2's, else a stand-in that reports the name once and does nothing (desktop GL WebGL lacks: `glPolygonMode`, `glTexImage1D`…). The tables are written at build time from Valkyrie's own loaders (`scripts/libraries.mjs`): SDL names it does not find in SDL's export lists stop the build, and each stand-in has the WebAssembly signature of Valkyrie's declaration (a call through a pointer of another signature would trap).
- **OpenGL 3.3 core on WebGL 2** (`port/webgl.js`), only where DRL meets a difference, so neither DRL nor Valkyrie is patched: GLSL 3.30 shaders are rewritten as they are compiled (`#version 300 es` and precisions; the GL console's texture buffer read as a 2D integer texture; the sprite transitions' vertex-input arrays as single inputs; four implicit int-to-float conversions, by exact text); texture buffers (`glTexBuffer`, not in WebGL) are emulated with an RGBA32UI texture; per-draw-buffer blending through `OES_draw_buffers_indexed`; `glClearDepth`/`glDepthRange` take doubles; unsized depth renderbuffers get 24 bits; `glEnable(GL_TEXTURE_2D)` (an error in core GL too) is skipped; and vertex attributes stay enabled in their vertex array object, as ANGLE's Vulkan back end (Chromium with SwiftShader) otherwise drew later frames from stale vertices.
- **A pixel is a pixel.** Valkyrie sizes its viewport and framebuffers by the window size it asked SDL for, in SDL's window coordinates; on a high-density screen those are fewer than the canvas's pixels. SDL is told the pixel ratio is 1 (`emscripten_get_device_pixel_ratio`), and the page chooses the canvas's resolution and CSS size.
- **On the page, not in a worker.** Emscripten's SDL 3 needs the document: it finds its canvas by selector, sizes it, and reads keyboard, mouse and touch events from DOM elements, none of which a worker has (Emscripten's OffscreenCanvas support is for pthreads, which the site cannot use). Asyncify keeps the page responsive: DRL yields at each of its sleeps and buffer swaps, and the host makes each sleep wait for the next animation frame (at most one frame a display frame; none while the tab is hidden).
- **Window size.** DRL sizes its window once, when it starts, from `settings.lua` (`screen_width`, `screen_height`, `fullscreen`): the host writes them each launch from the game's area (`adapter/tiles-state.ts` `windowFor`: one pixel a CSS pixel where DRL's 80×25 interface of 10×19 glyphs fits, more where it does not) and keeps the player's other settings. Valkyrie reads `settings.lua` with Lua's `fopen`, relative to Emscripten's working directory, which the host sets to `/home` (before, DRL's settings were never read back in the browser).
- **Input.** SDL listens on a private element (`SDL_EMSCRIPTEN_KEYBOARD_ELEMENT`); the adapter sends keys there as keyboard events, each held for two of DRL's frames, counted by its GL console's uploads (DRL reads key states once a frame, and its event loop draws only when 16 ms have passed: a press and release between two of its frames is lost; holding for display frames lost about one key in four in headless Chromium). Taps are mouse clicks on the canvas: a tap is the left button (DRL walks, travels, uses or picks up; menus choose), a long press the right (fire at the cell); SDL's own touch handling is kept out.
- **Its text, read back.** DRL draws its text (messages, HUD, menus) with Valkyrie's GL console: an 80×25 grid of cells uploaded to a texture buffer each frame. `port/webgl.js` hands the cells to the host (`raConsole`), which turns them into the console's screen format (`adapter/tiles-state.ts`: code page 437 line characters as the curses alternate set, colours as curses colours), so `adapter/state.ts` reads contexts, the HUD and prompts in both displays: the dock, the status band, the message log, Save & Quit and the tests.
- **Each run** (DRL's Exit starts it again) gets a fresh canvas and opaque WebGL 2 context (SDL would ask for an alpha channel, which the page would show through); the listeners SDL added to the page are removed.

## Files

| Path | What | Where |
|---|---|---|
| `/drl` | `core.wad`, `drl.wad`, `config.lua` | Preloaded from `drl-data.data` (Text) or `drl-tiles.data` (Tiles, its `drl.wad` with the images) (read-only) |
| `/home/user` | `drl/`: the save, `player.wad`, `score.wad`, `mortem.txt`, `mortem/`, `backup/` | IDBFS with autoPersist |
| `/home/settings.lua`, `/home/drl.prc` | DRL's settings and its first-run marker | Memory, copied into `/home/user/.home/` as soon as they change and back at start |
| `/home/runtime.log` | DRL's log | Memory only: never in IndexedDB |

DRL is started as `drl --console --no-sound --config=/drl/config.lua --data-path=/drl/ --write-path=/home/` (Tiles: `--graphics --windowed` instead of `--console`). Both displays share the DRL folder. `/home` is the first preopened directory, so it is DRL's working directory, where Valkyrie puts `settings.lua`.

**Saves** are DRL's own: Save & Quit in the game menu (Escape on the map) writes `user/drl/save` and returns to the main menu, whose Continue game loads it (and DRL removes it, as on the desktop). Leaving the site's game uses Save & Quit (the shell's exit prompt). The whole DRL folder can be exported and imported ("Save files for desktop"), as a backup; a lone file goes to `user/drl/`, where DRL keeps it. The saves themselves do not move to or from desktop DRL: Valkyrie writes Lua userdata into them as raw bytes with their size, so a 64-bit desktop's save and this port's (wasm32) differ; scores and settings are text or word-size independent but have not been checked against a desktop build.

**Exit** in DRL's main menu ends the program; the worker starts a fresh module instance, at the main menu again.

## The adapter

- `adapter/host.ts` (in the worker for Text, `adapter/worker.ts`; on the page for Tiles): downloads and verifies the files, compiles the module once and instantiates it per run (`instantiateWasm`; its bytes are not kept), mounts IDBFS, feeds keys, posts frames, flush, export, import.
- `adapter/tiles.ts`, `adapter/tiles-state.ts`: the Tiles display's canvas, keys and taps, its window and its text read back.
- `adapter/state.ts`: what the screen shows, read from DRL's own layout: messages (rows 0-1), the map (rows 2-21, prompts on row 2), the HUD (rows 22-24: name and armour; health, experience and weapon; the level), boxes drawn with line characters (menus, the inventory), prompts (`[more]`, `choose direction`, `= LOOK MODE =`, typing a name), and the terminal cursor (targeting).
- `adapter/input.ts`: keys, commands (each with its default key from `drlkeybindings.pas`), the dock for each context.
- `adapter/index.ts`: the renderer, the phone layout, the status band, the message log, saves.

## Phones

See [docs/design/mobile-play.md](../../docs/design/mobile-play.md#drl). In short: the map follows the player at a readable size (pinch to zoom, drag to look), the HUD and the latest messages are a band at the top (tap it for the log), a box DRL draws over the map (its game menu) becomes a sheet, full screens (the main menu, the inventory, the help) fit the screen, and the dock follows what DRL shows. Tiles: DRL's own picture fills the screen, taps are its mouse (tap: walk or choose, long press: fire at a spot), the band and dock are the same.

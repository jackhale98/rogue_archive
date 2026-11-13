# Brogue: Community Edition — feasibility report

Status: **complete; port implemented** (catalog status `experimental`). Licensing is reported separately in [`games/brogue-ce/LICENSES.md`](../../games/brogue-ce/LICENSES.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | Upstream compiles unmodified to WebAssembly with one added platform file; new game, play, save, reload and load pass automated end-to-end tests in Chromium. |
| Can Rogue Archive legally redistribute everything it ships? | **Yes**, under AGPL-3.0-or-later (code) and CC BY-SA 4.0 (tile sheet), with source availability. | See the license report. |
| Can it deliver a polished experience? | **On desktop, yes. On phones, plausible but unverified on real devices.** | Touch controls pass in emulation only; the 100×34 screen is small on phones. Hence `experimental`, not `playable`. |

## Upstream

| Item | Value |
|---|---|
| Repository | https://github.com/tmewett/BrogueCE |
| Pinned release | `v1.15.1`, commit `1ba4240b7a928ddf0ffb772717bf1d433cd63804` |
| Language / build | C99, GNU Make (`Makefile`, `config.mk`) |
| Native dependencies | SDL2 + SDL2_image (graphical), or ncurses (terminal); neither is needed for our build |
| Existing browser ports | Upstream's `web-platform.c` is a **server-side** bridge for the multi-user "Brogue Web" service: it talks over POSIX datagram sockets to a server process. It does not run in a browser and is not used. No maintained client-side WASM port was found to build on. |

## Platform boundary

Brogue CE already separates the game from the platform with `struct brogueConsole` (`src/platform/platform.h`): `gameLoop`, `pauseForMilliseconds`, `nextKeyOrMouseEvent`, `plotChar`, `remap`, `modifierHeld`, `notifyEvent`, `takeScreenshot`, `setGraphicsMode`. Every native platform (SDL2, curses, the web server bridge, a null platform) implements this struct. That is the integration point:

- **Rendering:** `plotChar(glyph, x, y, fg, bg)` for a fixed 100×34 cell grid (`COLS`×`ROWS`). Colors are 0–100 per channel.
- **Input:** `nextKeyOrMouseEvent` **blocks** until a key or mouse event; `pauseForMilliseconds` sleeps during animations and reports whether input is waiting. Keys use Brogue's own codes (ASCII plus arrow/numpad constants in `Rogue.h`).
- **Files:** saves (`*.broguesave`), recordings (`*.broguerec`), high scores and run history are ordinary files in the current directory, via stdio.
- **Threads, sockets, timers:** none needed outside the server bridge.

`src/platform/main.c` selects the console with `#ifdef BROGUE_SDL / BROGUE_WEB / BROGUE_CURSES`. Compiling with `-DBROGUE_WEB -DwebConsole=rogueArchiveConsole` selects our console through the existing `BROGUE_WEB` branch without touching upstream files; `BROGUE_WEB` affects nothing else except a `--server-mode` flag we never pass.

## Chosen approach

1. **Compile upstream unchanged** with Emscripten (pinned in `tools/toolchain.env`), adding `games/brogue-ce/port/rogue-archive-platform.c`. **No patches.**
2. **Asyncify** turns the blocking input and sleep calls into yields to the browser event loop. Brogue's main loop is untouched.
3. **Run in a Web Worker.** The UI thread only draws and forwards input. No threads, so no COOP/COEP headers are needed (GitHub Pages cannot set them).
4. **Render in the browser** with WebGL2 from Brogue's own grayscale tile sheet (`bin/assets/tiles.png`), downscaled in linear light like upstream `tiles.c`, and tinted per cell. Text, tiles and hybrid modes come from the same sheet, matching the desktop build.
5. **Persist** the game's working directory with Emscripten IDBFS (`autoPersist`). Brogue already records the game in progress to `LastGame.broguesave` as you play, which gives native crash/tab-kill recovery.

Rejected alternatives:

- *Emscripten's SDL2 port with upstream `sdl2-platform.c`/`tiles.c`:* most authentic pixels, but it pins rendering and input to the main thread and SDL's browser event emulation, makes responsive layout and touch control harder, and still needs Asyncify. Our renderer reuses upstream's sprite-fit rules instead.
- *Upstream `web-platform.c`:* requires a server process and sockets; contradicts the static, local-first design.
- *JSPI instead of Asyncify:* smaller and faster, but not yet available in every target browser.

## Measurements (build `c637e74a1f908388`, Emscripten 6.0.13, -O2)

| Artifact | Size | gzip |
|---|---:|---:|
| `brogue.wasm` | 908 KB | 338 KB |
| `brogue.mjs` (glue) | 75 KB | 20 KB |
| `tiles.png` | 406 KB | (PNG) |
| Adapter + worker JS | ~27 KB | ~10 KB |
| **Total first launch** | **≈1.4 MB** | **≈0.8 MB over the wire** (GitHub Pages compresses JS/WASM) |

- WASM memory: 64 MiB initial, growth allowed. Peak use has **not** been measured yet.
- Main thread: the tile sheet is decoded once (transient ~45 MB RGBA during decode, then ~11 MB of luminance kept for re-layouts) plus a small per-size atlas.
- Startup (desktop Chromium, warm cache, local server): title screen in about one second. Not yet measured on phones.

## Risks and how they are handled

| Risk | Handling |
|---|---|
| Phone screens are small for 100×34 cells | Landscape-first layout with side rails; zoom that follows the player; portrait defaults to zoom. Documented as a known limitation. |
| Tab killed on mobile without warning | `LastGame.broguesave` plus IDBFS autoPersist; the host also flushes Brogue's in-memory recording buffer on page hide and before exit. |
| Asyncify overhead | Measured acceptable on desktop; Brogue is turn-based. |
| Rendering differs slightly from desktop | Simplified downscaler (no sub-pixel sharpening, baseline snapping or wall-top waves). Documented. |
| Upstream updates | Pinned tag + commit; one platform file to re-check against `platform.h`. |

## Recommendation

**Go.** Shipped as `experimental` until it is tested on physical iOS Safari and Android Chrome devices; see [`ROADMAP.md`](../../ROADMAP.md).

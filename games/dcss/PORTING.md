# How the DCSS port works

Dungeon Crawl Stone Soup already has a browser front end: **WebTiles**, the client the official online servers use. In a WebTiles build the game sends JSON describing the map, menus, popups, messages and player state to upstream's JavaScript client, and reads the client's keys and UI events back. This port keeps both halves exactly as upstream ships them and removes only the server in between.

```
 page (Rogue Archive shell)                       Web Worker
┌───────────────────────────────────────┐        ┌──────────────────────────────┐
│ adapter/index.ts                      │        │ adapter/worker.ts            │
│  · start screen (launcher.ts)         │ post   │  · verifies + inflates files │
│  · status band (hud.ts)               │ Message│  · IDBFS saves (/saves)      │
│  · follows messages (state.ts)  ◄─────┼────────┤  · joins/splits messages    │
│  · touch commands (input.ts)          │        │                              │
│  ┌─────────────── iframe ───────────┐ │        │ crawl.wasm (DCSS 0.34.1,     │
│  │ client/index.html + host.js      │ │ ─────► │   headless WebTiles)         │
│  │ upstream game client (game/*.js) │ │ keys,  │  port/rogue-archive-         │
│  │ jQuery, RequireJS, tile sheets   │ │ UI     │   platform.cc: the socket    │
│  └──────────────────────────────────┘ │        │   is this worker             │
└───────────────────────────────────────┘        └──────────────────────────────┘
```

## The game: headless WebTiles in a worker

- **Build.** `scripts/build.sh` runs upstream's own Makefile in its cross-compiling mode (`CROSSHOST=wasm32-emscripten`) with tiny compiler wrappers that call Emscripten. Upstream generates its sources, tile sheets and client tables with host tools as usual (`rltiles`, Python, Perl). Sources and flags come from the Makefile, so files a new release adds are picked up without editing the script.
- **No patches.** Three things make the unmodified source work:
  - `port/rogue-archive-platform.cc` defines `socket`, `bind`, `setsockopt`, `sendto`, `recvfrom`, `select`, `pselect` and `usleep`. These take precedence over the C library's when linking. The game's WebTiles socket becomes the worker: `sendto` hands fragments to JavaScript, `recvfrom` and blocking `select` wait (Asyncify) for the next message from the page, and `usleep` returns at once because the client paces animations itself from the game's `delay` messages.
  - `port/compat/` holds inert curses functions, so `libunix.cc` links (with `-headless` none of them run), and an empty `execinfo.h` backtrace API, which `crash.cc` enables on every Unix-like target.
  - Make variables: `EXTRA_LIBS=` drops `-pthread` (upstream only uses mutexes; the game is single-threaded), `NO_YACC=y` uses upstream's pregenerated level-compiler parser, and `prefix=/crawl DATADIR=data SAVEDIR=/saves` set the paths inside the browser's file system.
- **Run.** The worker starts the game as a WebTiles server would: `-headless -webtiles-socket … -await-connection -name <player>`, then sends the client's `attach`. C++ exceptions (part of DCSS's control flow) use Emscripten's JavaScript exception handling, which Asyncify supports.
- **Messages.** The game ends each message with a newline and splits long ones into 2 KB fragments; the worker joins them and posts each burst to the page. Messages starting with `*` are for the server: `flush_messages` ends a burst, `exit_reason` is kept for the start screen, and the rest (`client_path`, `milestone`, `dump`) only matter to a multi-user server.
- **Saves.** `/saves` (DCSS's `SAVEDIR`; characters are `saves/<name>.cs`, with `morgue/` beside it) is an IDBFS mount with `autoPersist`, so every file the game closes is written to IndexedDB at once. DCSS saves when you change level and when you press `S`. DCSS keeps its level and database caches beside the saves (`saves/des`, `saves/db`). The build generates them once with DCSS's own `-builddb`, run by the same WebAssembly in Node, and ships them in the read-only data package (`/crawl/cache`); the worker makes `saves/des` and `saves/db` links to them. DCSS accepts a cache when its recorded modification time of each data file matches, so the build and the worker give every data file the same fixed time (`DATA_MTIME`). Building the caches in the browser took about 12 s on a desktop and a minute or more on a phone, and on iOS the work (plus 13 MB written to IndexedDB) exhausted Safari's memory and the tab crashed. Older installs' cached copies in IndexedDB are removed on start.
- **Game over.** When a game ends (death, save, quit) the process exits like a real DCSS process. The worker prepares a fresh instance, and the start screen comes back, as a WebTiles server returns to its lobby.
- **Download.** `crawl.wasm` and the data package ship as `.gzip` files (6 MB and 3 MB) and are inflated in the worker after their SHA-256 check. (`.gz` would invite servers to add `Content-Encoding: gzip`, so the browser would inflate them before the check.)

## The client: upstream's WebTiles client in a frame

- `client/` holds upstream's game client (`game/`, version-matched to the game), the lobby scripts it needs (`key_conversion.js`, jQuery, RequireJS), the lobby stylesheet and web fonts, and our host page. The frame keeps the client's globals, AMD loader and styles out of the shell, and it has its own Content-Security-Policy.
- `client-host/host.js` provides what a WebTiles lobby page provides around the game client:
  - the `comm` module (messages go to the adapter's bridge, not a WebSocket);
  - the `client` module: message queue, inhibit/uninhibit, `delay`, layers, keyboard handling (following `webserver/static/scripts/client.js`);
  - the globals `assert`, `log`, `abs` and `set_layer`;
  - `game.html`, with the server's `/gamedata/{{ version }}/` paths pointed at our copy, waiting for the tile sheets like the lobby's `waitForImages`.
- Text the client would send as `input` (typed to the game's terminal on a server) becomes `key` messages, because a headless game has no terminal.
- Keys from the shell (dock, keyboard, palette) are dispatched as real keyboard events into the frame. Upstream's menu and popup key handlers therefore see them exactly as typed keys.
- Two presentation-only adjustments in `host.js`, both for phones: the minimap beside the hidden stats column keeps at least one pixel per cell, because upstream would otherwise draw a zero-size canvas and abort the map update; and the client's message pane shows 4 lines instead of 7 (only the client's view changes, not the game's).

## The shell around it

- **Start screen** (`launcher.ts`): lists saved characters (`saves/*.cs`) to continue, and starts new ones by name. Upstream WebTiles always starts the game with a name; without one, headless DCSS has no way to ask for it.
- **Context** (`state.ts`): follows `input_mode`, `ui-push`/`ui-pop`, `menu`/`close_menu`, `init_input`, `ui_state`, `layer` and the `--more--` flag. From these it decides whether the game is on the map, in a menu, a popup, a `--more--`, a yes/no question, an item prompt, a text field, targeting or the level map. Brief busy moments are debounced so the dock doesn't flicker during travel.
- **Touch commands** (`input.ts`) are named shortcuts for DCSS's default keys. `tests/conformance/key-coverage.ts` checks each against `cmd-keys.h`. The action structure is described in [docs/design/mobile-play.md](../../docs/design/mobile-play.md#dcss).
- **Message log** (`messages.ts`): `msgs` messages with DCSS's colour tags become coloured log entries; `rollback` (DCSS rewriting its last messages) is applied.
- **Phones** (`hud.ts`, `client-host/host.css`): a status band (health, magic, place, status lights) replaces the stats column, which opens as a drawer when the band is tapped. Popups and menus use the whole frame and scroll. The frame is placed in the space the shell's controls leave.

## Verification

`scripts/test-engine.sh` checks key coverage, upstream drift (the socket interface, the client's module and `client.*` needs, the followed messages), and native against WebAssembly. For the last, upstream's objects built natively by upstream's Makefile (with clang and LLVM's libc++, the C++ library Emscripten uses) and linked with `tests/conformance/replay-platform.cc` replay seeded games from `tests/conformance/scenarios.json`. The WebAssembly harness, the same objects as the site plus `replay-hooks.js`, replays the same games, and every message the game sends must match. Two things DCSS deliberately leaves unseeded are ignored: tile variants (`rng::UI`) and the placeholder player shown before a character exists. With GCC's libstdc++ instead of libc++, seeded games diverge after a few turns, because the two libraries order equal elements differently in `std::sort` (for example, `los.cc`'s ray table). Each build is still deterministic: that is a property of the C++ libraries, not of the WebAssembly build. End-to-end tests (`e2e/dcss*.spec.ts`) drive the real site on desktop and in phone emulation.

## Updating

See [docs/contributing/updating-a-game.md](../../docs/contributing/updating-a-game.md). For DCSS specifically:

- Saves carry DCSS's own compatibility tags (`crawl-ref/docs/develop/save_compatibility.txt`). Releases sharing a major tag load each other's saves, and newer versions upgrade older saves in place.
- Run `ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:dcss` (or `master`) first.
- If the drift check fails, re-review what it names. That is usually something `host.js` provides for the client.

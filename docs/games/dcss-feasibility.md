# Dungeon Crawl Stone Soup — feasibility report

Status: **port implemented** (catalog status `experimental`). Licensing is reported separately in [`games/dcss/LICENSES.md`](../../games/dcss/LICENSES.md); how the port works is in [`games/dcss/PORTING.md`](../../games/dcss/PORTING.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | Upstream 0.34.1 builds unmodified to WebAssembly with upstream's own Makefile; new character, auto-explore, menus, save, reload and continue pass automated end-to-end tests in Chromium; native and WebAssembly builds produce identical message streams for seeded games. |
| Can Rogue Archive legally redistribute everything it ships? | **Yes**, under GPL-2.0-or-later with GPL-compatible bundled components (MIT, BSD, zlib, public domain/CC0, Bitstream Vera font license), with source availability. | See the license report. |
| Can it deliver a polished experience? | **On desktop, yes: it is the official WebTiles interface. On phones, plausible but unverified on real devices.** | The phone layout passes in emulation only. Upstream's client was designed for keyboard and mouse; character creation, menus and descriptions are tappable, and the dock covers every command. Hence `experimental`, not `playable`. |

## Upstream

| Item | Value |
|---|---|
| Repository | https://github.com/crawl/crawl |
| Pinned release | `0.34.1`, commit `1eebc1a2892e1c89776a0d7a10691f8dac8d9796` (latest release when the port was made; 0.34.0 and 0.33.1 before it) |
| Language / build | C++ (about 410,000 lines), GNU Make; Python 3 + PyYAML and Perl generate sources; a host tool (`rltiles`) generates tile sheets |
| Dependencies | Lua 5.1, SQLite, zlib, PCRE (all vendored as submodules at pinned commits); ncurses for console builds; SDL2/FreeType/GL for local tiles (not needed) |
| Front ends | Console (curses), local tiles (SDL), and **WebTiles**: a server (Python, Tornado) runs one game process per player and relays JSON between it and upstream's JavaScript client |
| Prior browser work | `apollovy/dcss-wasm` (2024, unmaintained): an SDL local-tiles build with Asyncify; 24 MB of WebAssembly plus 27 MB of data, no saves or touch support. It confirmed that Asyncify with JavaScript C++ exceptions works for DCSS. Not used. |

## Platform boundary

DCSS's WebTiles mode is the cleanest boundary in the codebase. `tileweb.cc` (`TilesFramework`) writes every screen update as JSON to a Unix datagram socket and reads control messages from it. With `-headless`, the game never touches the terminal. Everything else is ordinary files (saves, caches, morgue) through stdio.

- **Output:** map cells with tile indices (`map`), player state (`player`), messages (`msgs`), menus (`menu`, `update_menu`), structured popups (`ui-push`: character creation, descriptions, the character sheet), input state (`input_mode`), text prompts (`init_input`).
- **Input:** `key` messages (key codes), `text_input`, clicks on cells, and UI state sync from the client.
- **Blocking:** the game blocks in `recvfrom`/`pselect` while waiting for input; it polls with zero-timeout `select` (e.g. to interrupt auto-explore).

The port replaces exactly those socket calls (`port/rogue-archive-platform.cc`) and serves upstream's client in a frame; see PORTING.md.

## Findings

- **Build:** upstream's cross-compiling mode (`CROSSHOST`) works with Emscripten through four one-line compiler wrappers. Only two shims are needed: inert curses functions and an empty `execinfo.h`. `-pthread` is dropped through a make variable (`EXTRA_LIBS=`). No patches.
- **Size:** 22.6 MB of WebAssembly with Asyncify at `-O2` (6.2 MB gzipped); 11.3 MB of game data (3.3 MB gzipped); about 9.5 MB of tile sheets and client files. That is about 19 MB per first visit, then cached by the service worker.
- **Startup:** the first launch builds DCSS's level and description caches (about 10–15 s in the browser), which persist in the save directory; later launches skip that.
- **Saves:** `*.cs` packages in the save directory, the same format as desktop DCSS of the same version. DCSS's save compatibility tags let newer versions load older saves (`crawl-ref/docs/develop/save_compatibility.txt`).
- **Names:** WebTiles always starts the game with a player name; headless DCSS without one stops at an empty menu. The port adds a start screen (continue a saved character or name a new one), like a WebTiles lobby.
- **Tests:** upstream's Lua test suite (`crawl -test`) needs a debug build. The port instead compares native and WebAssembly builds of the same objects on seeded scripted games, message for message. A native GCC/libstdc++ build diverges from the WebAssembly build after a few turns of play, as would any two builds using different C++ standard libraries (`std::sort` orders ties differently). Built with clang and libc++, the library Emscripten uses, native and WebAssembly agree exactly.
- **Phones:** upstream's client lays out a 42-column stats panel beside the map. On phones the panel becomes a drawer, popups use the whole frame, and the message pane is shorter. Upstream's action panel (quick-use consumables) is already touch-friendly.

## Risks

| Risk | Mitigation |
|---|---|
| The WebTiles protocol or client modules change between versions | The client is version-matched by construction; `upstream-drift.ts` fails on new socket calls, new client dependencies or changed message handlers; weekly canary. |
| Asyncify overhead in a 400k-line C++ program | Measured acceptable (auto-explore and menus respond immediately in Chromium); JSPI could replace Asyncify later. |
| jQuery 1.8.2 in upstream's client | The client only renders the local player's own game in a frame with a strict CSP; no remote input reaches it. |
| Large download | Compressed delivery, content-addressed caching; the library never loads it unless DCSS is opened. |

# Rogue 5.4.4 — feasibility report

Status: **port implemented** (catalog status `experimental`). Licensing is reported separately in [`games/rogue/LICENSES.md`](../../games/rogue/LICENSES.md); how the port works is in [`games/rogue/PORTING.md`](../../games/rogue/PORTING.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | The 5.4.4 source release compiles unmodified to WebAssembly on a small curses written for the port; new character, inventory, item prompts, message log, save, reload and continue pass end-to-end tests in Chromium; native and WebAssembly builds produce identical screens, scoreboards and savefiles for seeded games. |
| Can Rogue Archive legally redistribute everything it ships? | **Yes**, under BSD-3-Clause with the notices retained. | See the license report. |
| Can it deliver a polished experience? | **On desktop, yes: it is Rogue's own 80×24 screen. On phones, plausible but unverified on real devices.** | The phone layout passes in emulation only. Hence `experimental`, not `playable`. |

## Upstream

| Item | Value |
|---|---|
| Repository | https://github.com/Davidslv/rogue (mirror of the Roguelike Restoration Project's Rogue 5.4.4 source release) |
| Pinned release | `5.4.4`, commit `cf9bd26d564a72fac4cf56b55c96c2435270d29a` (the release's only commit) |
| Language / build | K&R-style C (about 16,000 lines); autoconf, or `Makefile.std` |
| Dependencies | curses; on Unix also termios, `getpwuid`, signals |
| Prior browser work | Many "Rogue in the browser" projects exist, mostly reimplementations or emulated DOS binaries; none was used. |

## Platform boundary

curses (screen and keys), `mdport.c` (keys, users, home directory, signals, process control) and stdio files (savefile, scoreboard). The port supplies curses and the user; `mdport.c` is used unchanged with a configuration that disables what a browser lacks.

## Findings

- **Curses as data:** Rogue keeps the monster map in a curses window and reads it back with `mvwinch`, and saves windows into the savefile; a display-only curses would break the game. The port's curses keeps real windows.
- **K&R function pointers:** daemons are called with an argument they don't declare; WebAssembly traps on that. Emscripten's emulated function pointer casts fix it without a patch.
- **Environment:** Emscripten's C library reads the environment once at start-up, so `ROGUEOPTS` (name, savefile) must be set before the module starts; each game is a fresh module instance.
- **Savefiles:** the same format as desktop Rogue 5.4.4 (32/64-bit independent; byte-identical between the native and WebAssembly builds apart from an uninitialised stretch upstream writes).
- **Size:** about 0.33 MB, plus 43 optional tiles (about 30 KB, loaded only when Display: Tiles is chosen).
- **Tiles:** Rogue's screen holds only symbols, so tiles are a presentation of the map rows (CC0 tiles from Dungeon Crawl Stone Soup's export, based on RLTiles); each item class has one picture.

## Risks

| Risk | Mitigation |
|---|---|
| Classic save semantics surprise players (the save is removed when restored) | Stated on the start screen and in the game's notes; it is how Rogue plays. |
| The curses subset misses something rarely used | Conformance replays cover the main screens and prompts; any unimplemented function fails to link. |

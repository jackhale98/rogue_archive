# Angband — feasibility report

Status: **port implemented** (catalog status `experimental`). Licensing is reported separately in [`games/angband/LICENSES.md`](../../games/angband/LICENSES.md); how the port works is in [`games/angband/PORTING.md`](../../games/angband/PORTING.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | Upstream 4.2.6 compiles unmodified to WebAssembly with a browser display module (about 600 lines). Character creation, the town, stores, the dungeon, tiles, save, reload and continue pass end-to-end tests in Chromium; native and WebAssembly builds produce identical screens, tiles, messages, random-number state and savefiles for seeded games. |
| Can Rogue Archive legally redistribute everything it ships? | **Yes**, under GPL-2.0-only (one of the two licences upstream offers), with source availability. Of the tilesets, only Adam Bolt's, whose terms allow any use, are shipped. | See the license report: Shockbolt's tiles exclude other projects, Nomad's and the original 8x8 tiles have no stated terms, and David Gervais' (CC BY 3.0 per upstream) mix in tiles from other artists whose terms upstream does not state; none of these are shipped. |
| Can it deliver a polished experience? | **On desktop, yes: it is Angband's own 80×24 interface, with mouse support (click to travel, right-click context menus). On phones, plausible but unverified on real devices.** | Angband 4.2 has mouse support in its menus and on the map, so a tap is a click; the dock follows what the game waits for. The phone layout passes in emulation only, hence `experimental`. |

## Upstream

| Item | Value |
|---|---|
| Repository | https://github.com/angband/angband |
| Pinned release | `4.2.6`, commit `f3082213b73f3e463e3d0d60bff4b00462beae6e` (latest stable release tag; later tags such as `4.2.6-270-g42cd156ac` are development snapshots) |
| Language / build | C (about 200,000 lines including all front ends, plus 70,000 for the Borg), autotools, CMake and plain makefiles (`src/Makefile.inc` lists the objects every front end builds) |
| Dependencies | None beyond the C library; front ends use curses, X11, SDL/SDL2, Win32 or Cocoa |
| Front ends | `main-gcu.c` (curses), `main-x11.c`, `main-sdl.c`, `main-sdl2.c`, `main-win.c`, `main-cocoa.m`, `main-nds.c`, selected at startup through `main.c`'s module table |
| Prior browser work | Upstream has no browser front end. Browser play has been offered through servers that run the game remotely (e.g. angband.live), which does not fit a static, local-first site. A term front end compiled to WebAssembly is the natural approach here, as for Sil-Q. |

## Platform boundary

Angband's term interface (`ui-term.h`) is the boundary: the game draws text through `text_hook` and tiles through `pict_hook`, and reads keys and mouse clicks from the term's event queue, filled by the front end (`Term_keypress`, `Term_mousepress`). Files (data, saves, scores, dumps, pref files) go through stdio under `lib/` and the user directory. Graphics modes are data (`lib/tiles/list.txt` and each mode's pref files), loaded by upstream's own `grafmode.c` and `ui-prefs.c`; a front end only has to draw the tiles it is given.

## Findings

- **Build:** the source list comes from upstream's `src/Makefile.inc` (`BASEOBJS`) plus `main.c`; our module is selected as `main.c`'s "gcu" entry by build flags. No patches. Builds in under 30 seconds.
- **Paths:** the build points the data at `/angband/lib` and the user directory (saves, scores, pref files, character dumps) at `/angband/user/Angband`, kept in IndexedDB.
- **Savefile names:** on Unix, `main.c` names the default savefile after the login; the browser has none. The module clears that default, so Angband's own savefile menu (`-c`) names each new character's savefile after the character, as upstream does when no default is given.
- **Size:** 2.1 MB of WebAssembly, 1.3 MB of game data, 0.5 MB for the tile sheet (downloaded only when tiles are chosen). The fonts, sounds and other tilesets are left out.
- **Seeding:** Angband seeds its generator from the clock and the process id. The conformance harness fixes both; the deployed game keeps them.
- **Evaluation order:** Angband draws random numbers inside function arguments (`z-type.c` `rand_loc`), whose evaluation order C leaves unspecified; a GCC build and a Clang build make different towns from the same seed. Emscripten is Clang, so the native reference build is too.
- **Null reads:** WebAssembly reads address 0 without trapping; the native build caught the module reading the message log before it exists. Native runs of the same code catch such bugs.
- **Mouse:** `textui_process_click` walks or pathfinds to a clicked map cell (the `mouse_movement` option, on by default), Alt+click looks at it, the second button opens context menus; menus select clicked rows. The touch controls use these.
- **Phones:** the 80×24 screen is too small to read whole on a phone. The map is shown at a readable size around the player, the sidebar and status line become a band, and lists drawn over the map open as sheets.

## Risks

| Risk | Mitigation |
|---|---|
| Upstream moves key bindings, prompts or screen layout | `key-coverage.ts` reads the command tables in `src/ui-game.c` and the keymaps in `lib/customize/pref.prf`; the context detection reads Angband's prompts and is covered by unit tests; weekly canary against the latest release and `master`. |
| Saves across versions | 4.2.x savefiles load in later 4.2 releases; check `load.c` before moving the pin. |
| Phone readability of stores and full-screen pages | Their choices are dock buttons; the screens themselves are shown whole (small). A reflowed view is a candidate for later work. |
| Prompt detection relies on text | Prompts come from a small set of functions (`get_check`, `textui_get_aim_dir`, `textui_get_item`, `target_set_interactive`, `msg_flush`); unit tests pin each form. |

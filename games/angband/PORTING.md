# How the Angband port works

Angband keeps the game apart from its display through the **term** interface (`ui-term.h`): a front end supplies hooks to draw text (`text_hook`) and tiles (`pict_hook`), wipe cells, move the cursor and answer "extra" requests (wait for an event, flush input, refresh, delay), and puts keys and mouse clicks into the term's queue. Upstream ships several such front ends (`main-gcu.c` for curses, `main-x11.c`, `main-sdl2.c`, `main-win.c`, `main-cocoa.m`). This port adds one more, for the browser, and compiles everything else unchanged.

```
 page (Rogue Archive shell)                     Web Worker
┌─────────────────────────────────────┐        ┌───────────────────────────────┐
│ adapter/index.ts                    │        │ adapter/worker.ts             │
│  · draws the screen (term-view),    │ frames │  · verifies the files         │
│    tiles from the tile sheet        │◄───────┤  · IDBFS: /angband/user       │
│  · status band, sheets, map view    │        │  · restarts after save & quit │
│  · context → dock (state, input)    │ events │ angband.wasm (Angband 4.2.6)  │
│  · message log                      ├───────►│  port/main-web.c: the term    │
└─────────────────────────────────────┘        └───────────────────────────────┘
```

## The game: a term front end in a worker

- **Build.** `scripts/build.sh` compiles the objects upstream's `src/Makefile.inc` lists for every front end (`BASEOBJS`) and `main.c`, with Emscripten, plus `port/main-web.c`. Upstream's `main.c` chooses a display module from a table of the ones compiled in; the build defines `USE_GCU` and renames `init_gcu`/`help_gcu` to `init_web`/`help_web`, so the table's "gcu" entry starts ours (`main-gcu.c` itself is not compiled). The game is started with `-c -mgcu -- -n -g<mode>`: `-c` opens Angband's own savefile menu (new game, or one of the savefiles); after `--` come the module's own options.
- **No patches.** `port/main-web.c` is the front end: an 80×24 term whose hooks keep a copy of the screen (character and colour per cell, and for tile cells the foreground and terrain tile) and hand it to the worker on every refresh, with a snapshot of read-only state for the shell: health, mana, depth, position, the map panel's offset and where the map starts on screen; the keyset (`rogue_like_commands`) and `mouse_movement` options; level, gold, the graphics mode; what is underfoot (stairs, a shop entrance, objects the player knows of); visible monsters in view and adjacent, with the direction to an adjacent one; whether the player can fire (a launcher and ammunition) and cast; closed doors next to the player; whether the player is resting or running. It only reads game data (with upstream's own predicates: `square_isdownstairs`, `monster_is_in_view`, `player_can_fire`…), never writes it, and the conformance replays print the whole snapshot at every frame. When Angband waits for input (`TERM_XTRA_EVENT`), the module blocks with Asyncify until the page sends an event; `TERM_XTRA_DELAY` sleeps the same way, so animations play.
- **Characters.** Angband's text is UTF-8; its screen stays within Latin-1 (`font-gcu.prf` draws floors as `·`), which the module passes on as single bytes.
- **Input.** Keys arrive as Angband's own keycodes with modifiers (`KC_ENTER`, `ESCAPE`, the arrows, `KC_MOD_KEYPAD` for keypad digits, as upstream's SDL2 front end sends them); clicks as `Term_mousepress` on a screen cell. Angband's menus take clicks, and on the map a click walks to an adjacent cell or travels to a far one (`ui-context.c` `textui_process_click`: `CMD_PATHFIND`); Alt+click looks at a cell; the second button opens Angband's context menus.
- **Tiles.** At start-up the module loads Angband's graphics modes (`init_graphics_modes`, reading `lib/tiles/list.txt`) and selects the one asked for; the game then loads that mode's pref files and draws the map with tile coordinates through `pict_hook`. When the page's Display setting changes, the module switches mode at the next wait for input, as `main-sdl2.c` does from its menu (`reset_visuals` and a redraw without flushing input).
- **Messages.** After each refresh the module sends the messages Angband added to its log since the last one. Angband counts a repeated message instead of adding it; the new count ("… <2x>", as its message log shows it) is sent as a new text for the newest entry, not a new entry.
- **Saves.** The player's directory (`/angband/user`, holding `Angband/save`, `scores`, `panic`, `archive`, character dumps and pref files) is an IDBFS mount with `autoPersist`, so each file Angband closes is in IndexedDB at once. Angband saves when you take the stairs and with `Ctrl+S`; `Ctrl+X` saves and quits, after which the worker starts Angband again in a fresh module instance at its savefile menu. `main.c` names the default savefile after the login (the browser has none); the module's `-n` option clears that default, so each new character's savefile is named after the character, as upstream does without a default. The rest of `lib/` is the game data, preloaded read-only.

## The shell around it

- **Drawing** uses the shared terminal renderer (`packages/term-view`, MIT): a Canvas2D character grid with views (the whole screen, or parts of it), hit-testing and touch gestures. Tile cells are drawn from the tile sheet, the terrain first and then what stands on it, as upstream's SDL2 front end does.
- **Desktop:** the whole 80×24 screen, fitted. With tiles, the message line, sidebar and status line stay text and the map is drawn in square cells at the size that fits the whole map panel; when Angband draws a list over the map, the whole screen is shown as text until it closes.
- **Context** (`state.ts`): from the snapshot and the prompt line, what the game is waiting for: the savefile menu, character creation, a `-more-` or "press any key", a yes/no question, a direction, an aim (closest target, choose one), look/target mode, an item prompt (`Drop which item? (Inven: a-d, / for Equip, ESC)`), a text field, a store, a menu or list over the map, or the map itself.
- **Touch commands** (`input.ts`) are named shortcuts for Angband's own bindings in the original keyset, and in the roguelike keyset when that option is on. Movement uses the arrow and Home/PageUp/End/PageDown keys, which `pref.prf` maps to walking in both keysets (Shift to run). `tests/conformance/key-coverage.ts` checks each against `src/ui-game.c`'s command tables and `lib/customize/pref.prf`'s keymaps. Lettered choices on screen (creation, item prompts, stores, lists) become dock buttons; the savefile menu's rows become "New character" and "Continue <name>". The action structure is described in [docs/design/mobile-play.md](../../docs/design/mobile-play.md#angband).
- **Phones:** a status band (health, mana, level, depth, Angband's status line and the message line) replaces the sidebar; the map is drawn at a readable size following the player (pinch to zoom, drag to look around); lists drawn over the map open as a sheet whose rows can be tapped. A tap on the map travels there (Angband's pathfinding); long-press looks at that cell. The dock follows the situation: what is underfoot leads (stairs, a shop to enter, objects to pick up), one tap fires at the nearest monster (or throws), one tap attacks an adjacent one, low health leads with potions and scrolls.

## Verification

`scripts/test-engine.sh` checks key coverage, then compares native and WebAssembly builds. The same game objects and display module are linked with a host written in C (`tests/conformance/replay-platform.c`) instead of JavaScript: natively with the host Clang, and for Node from the objects the site uses. Both replay the event scripts in `tests/conformance/scenarios.json` (new characters, the town and a store, the dungeon, fighting, travel by mouse, tiles, saving and continuing). The clock and process id are fixed, which fixes Angband's random seed, and every screen at every wait (text, colours, tiles, state), the random-number generator's state, every message, and every file written must be identical.

The native build must be Clang: C leaves the order in which a call's arguments are evaluated unspecified, and Angband draws random numbers inside arguments (`z-type.c` `rand_loc`: `loc(rand_spread(…), rand_spread(…))`), so a GCC build makes a different town from the same seed than a Clang build. Both are correct Angband; Emscripten is Clang.

End-to-end tests (`e2e/angband*.spec.ts`) drive the real site on desktop and in phone emulation.

## Updating

See [docs/contributing/updating-a-game.md](../../docs/contributing/updating-a-game.md). For Angband specifically:

- Savefiles carry Angband's version; 4.2 releases load earlier 4.2 savefiles. Check `load.c` before moving a pin.
- Run `ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:angband` (or `master`) first.
- If the key-coverage check fails, a binding moved in `ui-game.c` or `pref.prf`: update `adapter/input.ts`.
- If a new tileset appears in `lib/tiles/list.txt`, check its terms in `docs/copying.rst` before adding it to `TILESETS` in `scripts/build.sh`.

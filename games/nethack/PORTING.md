# How the NetHack port works

NetHack separates the game from its interface: every screen it shows goes through a window interface (`doc/window.txt`) that each port implements (tty, curses, X11, Qt, Windows). Upstream also maintains a WebAssembly build whose "shim" window port forwards every one of those calls to JavaScript and waits for the answer. The port builds that, and answers the calls in the browser the way NetHack's own tty port draws: an 80×24 screen with the message line on top, the map, and two status lines.

```
 page (Rogue Archive shell)                 Web Worker
┌───────────────────────────────┐   ┌──────────────────────────────────────┐
│ adapter/index.ts              │   │ adapter/worker.ts                    │
│  · start screen (name)        │   │  · verified download, instantiate    │
│  · term-view: text or tiles   │◀──│  · /save, /scores on IndexedDB       │
│  · phones: band, map follows, │   │ adapter/windowport.ts                │
│    menus as sheets, dock, pad │──▶│  · answers the shim's window calls   │
│  · keys, taps, clicks         │   │    (as tty), composes the screen     │
└───────────────────────────────┘   │ nethack.wasm: upstream's web build   │
                                    │  + tile.c + port/rogue-archive-glue.c │
                                    └──────────────────────────────────────┘
```

## The game: upstream's web build

- **Build** (`scripts/build.sh`, [BUILDING.md](BUILDING.md)): upstream's Makefile with `CROSS_TO_WASM=1`, the game data embedded, Asyncify for the window calls. One patch brings `sys/libnh/libnhmain.c` (the web build's main) up to date with `sys/unix/unixmain.c` so it links ([patches/README.md](patches/README.md)). `TILES_IN_GLYPHMAP` and upstream's generated `src/tile.c` give each glyph its tile number, as in upstream's tile ports.
- **Glue** (`port/rogue-archive-glue.c`): the shim passes pointers to NetHack's structures (`glyph_info`, menu identifiers); small functions read them so the JavaScript side doesn't depend on their memory layout: a glyph's character, colour, tile and flags; menu identifiers kept per window and the `menu_item` array `select_menu` returns; the extended command list; the status conditions as tty names them; help files from the data library; the name typed at `askname`; and a read-only state snapshot (hit points, power, depth, position, turn, hunger).
- **One game per run**, as on a desktop: the worker starts `main` with `-u <name>`. A character with a save file continues that game; saving (`S`) or dying ends the run, and a fresh instance is prepared.

## The window port (`adapter/windowport.ts`)

Each shim call is answered as tty does; the module has no browser dependencies, so tests drive it the same way in Node.

- **Map:** `print_glyph` stores each cell's character, colour and tile; pets and detected monsters are shown in reverse video (tty's `hilite_pet`).
- **Messages:** `putstr` to the message window goes to the shell's message log and the message line (the latest of this turn that fit). `display_nhwindow(WIN_MESSAGE, TRUE)` shows `--More--` and waits, as tty.
- **Status:** `status_update` values with the field formats of `src/botl.c` (the shim never calls `status_enablefield`), in tty's two-line order; conditions named as tty names them.
- **Menus** (`start_menu`/`add_menu`/`end_menu`/`select_menu`): drawn over the map as tty draws them (right-aligned, paged, "a - item" lines, letters assigned per page when the game gives none) with tty's keys: letters, group keys, counts, `.` `,` `-` `\` to select, `>` `<` `^` `|` for pages, Enter/Space to accept, Esc to cancel. Text windows and `display_file` page the same way.
- **Prompts:** `yn_function` with tty's rules (Esc gives `q` or `n` when offered; Enter takes the default); `getlin` and extended commands (`#name`) are typed on the message line; `nh_poskey` returns keys or map clicks.
- **Character creation** is NetHack's own (`genl_player_setup`, its menus).

## The screen and input (`adapter/index.ts`, `adapter/input.ts`)

- **Text or tiles** (setting *Display*): text uses NetHack's 16 colours; tiles draw the map cells with NetHack's own tiles (`tiles.png`, cut per tile once), messages, status and menus staying text.
- **Desktop:** the whole screen, fitted; with tiles, the message and status lines as text above and below a square-celled map.
- **Phones:** a band with the two status lines (hit points as a bar) and the message line; the map zoomed (pinch) and following the hero (drag to look around); a menu or text window lifted into a large sheet with tappable lines, over the map drawn without it; the band shows this turn's messages (up to three lines), and `--More--` continues by itself unless *--More-- prompts* is set to wait.
- **Keys:** NetHack's own (number_pad off): vi keys, arrows and the numpad as directions, Shift to run, Ctrl and Alt (meta) combinations.
- **Map gestures** (the design: [docs/design/nethack-controls.md](../../docs/design/nethack-controls.md)): `~/.nethackrc` (written by the worker; `HOME` and `NETHACKOPTIONS` are set in `preRun`, before the C library reads the environment) binds `mouse1` to NetHack's `mouseaction` and `mouse2` to `#therecmdmenu`. A tap on a cell is a mouse1 click (travel, move, attack, open); a tap on the hero sends `#herecmdmenu`; a long press next to the hero is a mouse2 click (the game's menu for that cell), farther away farlook (`;` and a click on the cell at the position prompt). At a position prompt a tap picks the cell; at a direction prompt it gives the direction towards it.
- **Touch dock** (`controlsFor` in `adapter/input.ts`), from the read-only snapshot `ra_state` (`port/rogue-archive-glue.c`: the feature underfoot, objects here, displayed hostile monsters next to the hero and the nearest lined up, the trouble conditions on the status line, encumbrance, the quiver, known spells, unpaid items, getpos): exploring (a lead for the place or moment, Search, Travel, Pack, Look, More), fighting (Fight or Fire at the monster in one tap, Cast or Zap, Quaff, Elbereth), trouble (Pray, Quaff, Elbereth, Fight or Flee); prompts get their own docks (answers, items, directions, positions, typed lines). An item prompt opens the list of suitable items at once (`?`): on a phone always (once per question, also when the game's own menus or the keyboard asked), on desktop after a touch command; up to three items get a button each. The game screen allows no text selection, so a long press never starts one (iOS). The Elbereth button (setting *Strategy shortcuts*, off by default) sends `E` and answers the game's questions (`-`, no to adding, the text) as a short script that stops at the map. Character creation's question and menus get buttons named for what they do (Pick for me, Let me choose; Random; Yes; start game).

## Saves

`/save` (NetHack's save files, `save/0<name>`) and `/scores` (`record`, `logfile`, `xlogfile`, `livelog`, copied to the root for each game and back) are IndexedDB mounts. NetHack keeps no save while you play: leaving without saving loses the game, so the shell's leave dialog offers *Save and leave* (`S`, `y`). Save files can be exported and imported (a desktop file `save/<uid><name>` is renamed for uid 0).

## Verification

- Unit tests (`tests/`): the window port against a scripted module (menus, prompts, status), keys and docks.
- End-to-end (`e2e/nethack.spec.ts`, `e2e/nethack.mobile.spec.ts`): character creation by keys and by taps, the map, menus, tiles, travel by tap, save and continue after a reload.
- Not yet: a native-versus-WebAssembly comparison of seeded games (as the other ports have), and a key coverage check against `cmd.c`.

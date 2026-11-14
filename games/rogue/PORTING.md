# How the Rogue port works

Rogue draws everything through curses, and its platform code (`mdport.c`) reads keys, looks up the user and handles signals the Unix way. The port keeps every upstream file unchanged and supplies the pieces a browser lacks: a small curses, a build configuration, and a user account.

```
 page (Rogue Archive shell)                     Web Worker
┌─────────────────────────────────────┐        ┌───────────────────────────────┐
│ adapter/index.ts                    │        │ adapter/worker.ts             │
│  · start screen (start-screen)      │ frames │  · verifies the files         │
│  · draws the screen (term-view)  ◄──┼────────┤  · IDBFS: /rogue (saves,      │
│  · status band, sheets, map view    │        │    scoreboard)                │
│  · context → dock (state, input)    │ keys   │ rogue.wasm (Rogue 5.4.4)      │
│  · message log                      ├───────►│  port/curses-web.c            │
└─────────────────────────────────────┘        └───────────────────────────────┘
```

## The game: Rogue on a small curses, in a worker

- **Build.** `scripts/build.sh` compiles the sources upstream's `Makefile.std` lists with Emscripten, with `-DHAVE_CONFIG_H` and `port/` first on the include path. Upstream's `extern.h` includes `config.h` when `HAVE_CONFIG_H` is set, so `port/config.h` describes the browser (no fork, shell, terminal database or load average; the scoreboard in `/rogue`). `port/curses.h` is found before any system curses.
- **Curses** (`port/curses-web.c`). The subset of curses Rogue 5.4.4 uses, over in-memory windows: Rogue also uses a window as a data structure (the monster map), so windows are real cell arrays. `wrefresh` copies a window to the physical screen and hands it to the worker with a small read-only state snapshot (hit points, level, the hero's position, gold, whether an overlay window is in front; whether the hero is on the stairs, carries the Amulet, how hungry he is, the type of an object under him, whether armour is worn, and whether he is hallucinating). `wgetch` presents the screen and waits (Asyncify) for the page's next key. Keys arrive decoded, so after ESC, when Rogue's `md_readchar` switches to `halfdelay` to see whether an escape sequence follows, `wgetch` reports none at once. Standout (reverse video) is passed on as an attribute.
- **The account** (`port/platform.c`). Rogue looks up its user's home directory and shell with `getpwuid()` and dereferences the result; Emscripten has no user database and returns NULL. A link-time definition describes one user whose home is `/rogue`.
- **Function pointer casts.** Rogue is K&R C: daemons and fuses are stored as `void (*)()` and called with an argument the functions don't declare. Native code tolerates that; WebAssembly traps on an indirect call with a different signature, so the build emulates function pointer casts (`-sEMULATE_FUNCTION_POINTER_CASTS`).
- **Names and saves.** Rogue takes the player's name and savefile from its `ROGUEOPTS` options; the worker sets `name=<name>,file=/rogue/<name>.save` before the program starts (the C library reads the environment once, at start-up). Each game is one run of the program, as on a terminal: it ends when you save (`S`), die or quit, and continuing passes the savefile as the argument (`rogue Name.save`). Like the original, Rogue deletes a savefile when it restores it, so a game in progress has no save. `/rogue` is an IDBFS mount with `autoPersist`.

## The shell around it

- **Start screen** (`packages/start-screen`, MIT): continue a saved game or start a new character by name; it returns when a game ends.
- **Drawing** uses the shared terminal renderer (`packages/term-view`, MIT), monochrome, with standout drawn in reverse video.
- **Display: Tiles** (`adapter/tiles.ts`): the map's symbols drawn with tiles from the CC0 export of Dungeon Crawl Stone Soup's tiles (based on RLTiles); `tiles/tiles.json` maps each symbol to a file, `scripts/build.sh` copies them from the pinned export (`upstream.env` `TILES_*`), and the page checks each against the runtime manifest. Rogue's screen holds only symbols, so tiles apply to the map rows and only while no list or text covers the map; monsters and items stand on a floor tile; each item class has one picture (Rogue shows only the class). On desktop the message and status lines stay text above and below a square-celled map.
- **Display: 1-Bit** (same file): the same, with Kenney's CC0 1-Bit Pack. `scripts/build.sh` downloads the pack (`upstream.env` `ONEBIT_*`, verified by SHA-256) and ships only its tile sheet; `tiles/one-bit.json` gives each symbol's place in the sheet and an optional tint, and the page cuts the tiles and recolours them (monsters in red and a few other colours so they stand out from the hero; a darkened floor).
- **Context** (`state.ts`): from the snapshot and Rogue's prompts: `--More--` and "Press space to continue", "[Press return to continue]" (the tombstone and scores), "which direction?", item prompts ("(* for list)"), yes/no questions, typed answers, lists over the map, the map.
- **`--More--` in fights** (`input.ts` `continueFirst`): Rogue waits for Space at `--More--` and ignores other keys (`io.c` `endmsg`), and a fight shows one after almost every blow ("You hit the bat", then "The bat hits you"). At `--More--` a direction (pad or keyboard) or the pad's search sends Space first and then the key, so a blow takes one tap or key press; if another `--More--` follows, Rogue ignores the key as it always would. The game is unchanged.
- **Touch commands** (`input.ts`) are named shortcuts for Rogue's command keys; `tests/conformance/key-coverage.ts` checks each against `command.c` (including the run keys, capitals and control codes, and that Rogue repeats the commands sent with a count, `10s` and `10.`). Arrow and keypad keys become `hjklyubn` (Shift runs); top-row digits stay repeat counts.
- **Map leads** (`state.ts` `mapLeads`, `input.ts` `controlsFor`): the dock reads the monsters next to the hero from the screen (capital letters) and leads with "Fight ↖B" (`f` and the direction in one tap), or "Throw →E" when only a floating eye is there; from the snapshot it leads with Pick up, Eat, Take off (an aquator in sight), Down > or Up <. While hallucinating the screen's letters are random, so the button names only the direction and no letter-based lead applies. Every lead sends the original keys.
- **Message log:** Rogue keeps only its last message (`Ctrl+P`); the shell's log collects each message line as Rogue shows it.
- **Phones:** a status band (Rogue's status line and its message line) replaces the bottom and top lines, the map is drawn at a readable size following the hero (pinch to zoom, drag to look around), lists open as a sheet whose lines can be tapped, and a long press on the map identifies the symbol there (`/`).

## Verification

`scripts/test-engine.sh` checks key coverage, then builds Rogue natively with the host compiler, linked with the same curses and a C replay host (`tests/conformance/replay-platform.c`), and compares it with the Node harness linked from the objects the site uses. Both replay the scripts in `tests/conformance/scenarios.json` (exploring, fighting, the inventory and item prompts, saving, quitting through the scores) from a fixed clock and process id; every screen at every key wait, the scoreboard and the savefile must match. (One stretch of a savefile is skipped: upstream writes its 80-byte screen-size line from an uninitialised stack buffer; restoring reads only the text.) End-to-end tests (`e2e/rogue*.spec.ts`) drive the real site on desktop and in phone emulation.

## Updating

The pinned release is the last of its line; a newer one is unlikely. If the pin moves, run `ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:rogue` first; a failing key-coverage check means a binding moved in `command.c`.

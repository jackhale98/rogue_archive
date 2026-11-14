# How the Sil-Q port works

Sil-Q, like Angband 3.0 from which it descends, keeps the game apart from its display through the **term** interface (`z-term.c`): a front end supplies hooks to draw text, wipe cells, move the cursor and answer "extra" requests (wait for a key, flush input, refresh, delay). Upstream ships several such front ends (`main-gcu.c` for curses, `main-x11.c`, `main-win.c`, `main-cocoa.m`). This port adds one more, for the browser, and compiles everything else unchanged.

```
 page (Rogue Archive shell)                     Web Worker
┌─────────────────────────────────────┐        ┌───────────────────────────────┐
│ adapter/index.ts                    │        │ adapter/worker.ts             │
│  · draws the screen (term-view)     │ frames │  · verifies the files         │
│  · status band, sheets, map view ◄──┼────────┤  · IDBFS: lib/save, apex, user│
│  · context → dock (state, input)    │        │                               │
│  · message log                      │ keys   │ sil.wasm (Sil-Q 1.5.0)        │
│                                     ├───────►│  port/main-web.c: the term    │
└─────────────────────────────────────┘        └───────────────────────────────┘
```

## The game: a term front end in a worker

- **Build.** `scripts/build.sh` compiles the sources upstream's `Makefile.std` lists, except its display modules, with Emscripten, plus `port/main-web.c`. Upstream's `main.c` chooses a display module from a table of the ones compiled in; the build defines `USE_GCU` and renames `init_gcu`/`help_gcu` to `init_web`/`help_web`, so the table's "gcu" entry starts ours (`main-gcu.c` itself is not compiled). The game is started with `-mgcu`.
- **No patches.** Two things make the unmodified source work in a browser:
  - `port/main-web.c` is the front end: an 80×24 term whose hooks keep a copy of the screen (character and colour per cell) and hand it to the worker on every refresh, with a snapshot of read-only state for the shell: health, voice, depth, position, map offset; the keyset in use; stealth mode, songs, hunger, timed conditions, speed, light left; what is underfoot (stairs, forge, object, the Iron Crown); `on_the_run`; unspent experience and the price of the cheapest available ability; visible monsters in view and adjacent; bow and quivers; closed doors next to the player; the first flask of oil in the pack (for the Oil button: "throw at nearest" only takes items made for throwing). It only reads game data (upstream's own `abilities_in_skill`, `prereqs` and `affinity_level` for the ability price), never writes it, and the conformance replays print the whole snapshot at every frame. When Sil waits for a key (`TERM_XTRA_EVENT`), the module blocks with Asyncify until the page sends one; `TERM_XTRA_DELAY` sleeps the same way, so animations play.
  - Sil's Unix startup drops setuid/setgid privileges and quits if that fails, and Emscripten's C library reports these calls as failing. `main-web.c` defines `setregid`, `setegid`, `setgid` and `setreuid` to succeed; definitions in the program take precedence over the C library's when linking.
- **Messages.** After each refresh the module sends the messages Sil added to its log since the last one. Sil merges a repeated message into the previous one ("… <2x>"); that is sent as a new text for the newest entry, not a new entry.
- **Saves.** `lib/save` (savefiles, named `<uid>.<name>`), `lib/apex` (high scores) and `lib/user` (character dumps) are IDBFS mounts with `autoPersist`, so each file Sil closes is in IndexedDB at once. Sil saves when you take the stairs and with `Ctrl+S`; `Ctrl+X` saves and returns to Sil's title menu, which can start or open another character. The rest of `lib/` is the game data, preloaded read-only.

## The shell around it

- **Drawing** uses the shared terminal renderer (`packages/term-view`, MIT): a Canvas2D character grid with views (the whole screen, or parts of it), hit-testing and touch gestures.
- **Context** (`state.ts`): from the snapshot and the prompt line, what the game is waiting for: the title and character creation, a `-more-`, a yes/no question, a direction, look/target mode, an item prompt (`(Inven: a-b, * to see, / for Equip, ESC) Drop which item?`), a text field, a menu or list over the map, or the map itself.
- **Touch commands** (`input.ts`) are named shortcuts for Sil's default (original) keyset. With another keyset (`hjkl_movement`, `angband_keyset`), map commands go after Sil's keymap bypass `\`, so they keep their meaning. `tests/conformance/key-coverage.ts` checks each against `dungeon.c` `process_command` and the direction keymaps in `lib/pref/pref.prf`. Lettered choices on screen (title menu, creation, lists) become dock buttons; at the title menu, saved characters can be continued by name. The action structure is described in [docs/design/mobile-play.md](../../docs/design/mobile-play.md#sil-q).
- **Phones:** a status band (health, voice, depth) replaces Sil's sidebar; the map is drawn at a readable size following the player (pinch to zoom, drag to look around); lists and descriptions drawn over the map open as a sheet, whose lines can be tapped. Long-press on the map looks at that cell (`l`, `p`, then one step per cell). The dock follows the situation (exploring, monsters in view, adjacent, low health) and leads with what is underfoot; song prompts become song buttons, and only aim prompts offer a target.

## Verification

`scripts/test-engine.sh` checks key coverage, then compares native and WebAssembly builds. The same game objects and display module are linked with a host written in C (`tests/conformance/replay-platform.c`) instead of JavaScript: natively with the host C compiler, and for Node from the objects the site uses. Both replay the key scripts in `tests/conformance/scenarios.json` (new characters, the tutorial, fighting, dying, saving and reloading). The clock and process id are fixed, which fixes Sil's random seed, and every screen at every key wait, every message, and every savefile written must be identical. End-to-end tests (`e2e/sil-q*.spec.ts`) drive the real site on desktop and in phone emulation.

## Updating

See [docs/contributing/updating-a-game.md](../../docs/contributing/updating-a-game.md). For Sil-Q specifically:

- Savefiles carry Sil-Q's version and are upgraded by newer releases where upstream supports it; check `load.c` before moving a pin.
- Run `ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:sil` (or `master`) first.
- If the key-coverage check fails, a binding moved in `process_command`: update `adapter/input.ts`.

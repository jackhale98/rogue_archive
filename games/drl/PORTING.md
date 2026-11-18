# How the DRL port works

DRL is FreePascal on ChaosForge's FPC Valkyrie library, with its rules and data in Lua 5.1. The port compiles both with FreePascal's WebAssembly target and plays DRL's console mode in a Web Worker, drawn by the site's terminal renderer. DRL's own code is unchanged. Building: [BUILDING.md](BUILDING.md); licences: [LICENSES.md](LICENSES.md); why this route: [the feasibility report](../../docs/games/drl-feasibility.md).

## The module

```
FreePascal (wasm32-wasip1, branchful exceptions)     Emscripten
  DRL + FPC Valkyrie + FreePascal's RTL  ──objects──▶  emcc link ◀── Lua 5.1 (C), port/start.c
  port/ncurses.pas, port/wasm/*.pas                     │           port/wasi-emscripten.js, port/host.js
                                                        ▼
                                          drl.mjs + drl.wasm (Asyncify)
```

- **Entry.** `port/start.c`'s `ra_start` calls FreePascal's `_start` (the RTL's entry, with its unhandled-exception handler). The worker calls it with an empty stack, so FreePascal's heap starts at `__heap_base`, where Emscripten's layout puts the heap.
- **One heap.** `port/wasm/ramalloc.pas` (added before the program's own units with `-Faramalloc`) implements C's `malloc` family on the Pascal heap; `-sMALLOC=none` leaves Emscripten's out. When the Pascal heap grows the memory, FreePascal's `WasmGrowMemoryCallback` calls `ra_memory_grown`, which refreshes Emscripten's views of it. The C library's allocations before the program starts (its environment) come from a 64 KB arena in `start.c`.
- **WASI.** The RTL makes WASI calls; `port/wasi-emscripten.js` implements those Emscripten lacks outside its standalone mode (opening paths, directory listings, file status, preopened directories, arguments, sleeping) on Emscripten's file system. Emscripten's errno values are WASI's.
- **A Unix build.** Valkyrie's code assumes every target is Windows or Unix; with `-dUNIX` it takes its Linux paths: the curses console (`vcursesio`, `vcursesconsole`), `dlopen` for optional libraries. wasip1 has no Unix units, so `port/wasm/` provides the names those paths use: `unix` and `baseunix` (C types, `FpFsync` on `fd_sync`, a `fpSystem` that finds no shell), `dl` (no libraries load: no SDL, FMOD or Steam, as on a desktop without them), `dynlibs`, `video` (declarations only) and empty `pthreads`, `x`, `xlib`.

## The console: our curses

`port/ncurses.pas` is the part of FreePascal's `ncurses` unit that Valkyrie's curses driver calls (`initscr`, `init_pair`, `mvaddch`, `refresh`, `wgetch`, `curs_set`...), with the same names and values. The screen is an 80×25 window in memory; `refresh` hands it to the host (`ra_present`: two bytes per cell, the character, or the ACS letter for line drawing, and the foreground and background colours with the bold bit); `wgetch` takes the host's next key (`ra_key_take`). The same unit serves the browser (host: `port/host.js` → the worker) and the native conformance build (host: C).

Valkyrie's driver polls: `nodelay` on, a 1 ms sleep before each `wgetch`, and DRL's immediate-mode UI redraws every 10 ms. Sleeps are WASI `poll_oneoff` calls, an Asyncify suspension each; the worker keeps their length while the screen changes, and while it has been still for a second waits for the next key (at most 250 ms), so an idle game costs almost nothing.

**Keys** are what a terminal sends (`adapter/input.ts`): characters, control codes, and curses `KEY_` codes for the arrows, Home/End/PgUp/PgDn, Insert/Delete, Backspace and F-keys. Valkyrie's `CursesToKeyCode` turns them into DRL's key codes, as on Linux. That driver reads no modifiers, so Shift+arrow (run) and Ctrl+arrow (move the target) do nothing, as in upstream's Linux console; capital letters (Shift+letter bindings) work.

## Files

| Path | What | Where |
|---|---|---|
| `/drl` | `core.wad`, `drl.wad`, `config.lua` | Preloaded from `drl-data.data` (read-only) |
| `/home/user` | `drl/`: the save, `player.wad`, `score.wad`, `mortem.txt`, `mortem/`, `backup/` | IDBFS with autoPersist |
| `/home/settings.lua`, `/home/drl.prc` | DRL's settings and its first-run marker | Memory, copied into `/home/user/.home/` as soon as they change and back at start |
| `/home/runtime.log` | DRL's log | Memory only: never in IndexedDB |

DRL is started as `drl --console --no-sound --config=/drl/config.lua --data-path=/drl/ --write-path=/home/`. `/home` is the first preopened directory, so it is DRL's working directory, where Valkyrie puts `settings.lua`.

**Saves** are DRL's own: Save & Quit in the game menu (Escape on the map) writes `user/drl/save` and returns to the main menu, whose Continue game loads it (and DRL removes it, as on the desktop). Leaving the site's game uses Save & Quit (the shell's exit prompt). The whole DRL folder can be exported and imported ("Save files for desktop"), as a backup; a lone file goes to `user/drl/`, where DRL keeps it. The saves themselves do not move to or from desktop DRL: Valkyrie writes Lua userdata into them as raw bytes with their size, so a 64-bit desktop's save and this port's (wasm32) differ; scores and settings are text or word-size independent but have not been checked against a desktop build.

**Exit** in DRL's main menu ends the program; the worker starts a fresh module instance, at the main menu again.

## The adapter

- `adapter/worker.ts`: downloads and verifies the files, compiles the module once and instantiates it per run (`instantiateWasm`; its bytes are not kept), mounts IDBFS, feeds keys, posts frames, flush, export, import.
- `adapter/state.ts`: what the screen shows, read from DRL's own layout: messages (rows 0-1), the map (rows 2-21, prompts on row 2), the HUD (rows 22-24: name and armour; health, experience and weapon; the level), boxes drawn with line characters (menus, the inventory), prompts (`[more]`, `choose direction`, `= LOOK MODE =`, typing a name), and the terminal cursor (targeting).
- `adapter/input.ts`: keys, commands (each with its default key from `drlkeybindings.pas`), the dock for each context.
- `adapter/index.ts`: the renderer, the phone layout, the status band, the message log, saves.

## Phones

See [docs/design/mobile-play.md](../../docs/design/mobile-play.md#drl). In short: the map follows the player at a readable size (pinch to zoom, drag to look), the HUD and the latest messages are a band at the top (tap it for the log), a box DRL draws over the map (its game menu) becomes a sheet, full screens (the main menu, the inventory, the help) fit the screen, and the dock follows what DRL shows.

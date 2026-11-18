# DRL — feasibility report

Status: **port implemented** (catalog status `planned` until the definition of done passes). Licensing is reported separately in [`games/drl/LICENSES.md`](../../games/drl/LICENSES.md); how the port works is in [`games/drl/PORTING.md`](../../games/drl/PORTING.md), and how to build it in [`games/drl/BUILDING.md`](../../games/drl/BUILDING.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | FreePascal's development branch (3.3.1) compiles DRL and FPC Valkyrie for `wasm32-wasip1`; Emscripten links those objects with Lua 5.1.5 (C), with Asyncify for DRL's waits. A proof of concept, then the game itself, ran under Node first: character creation, the intro, the dungeon map and HUD, moving. It needed one compiler fix (C varargs, below), one line in Valkyrie (a name FreePascal 3.3 added) and one in Lua (a 64-bit `lua_Integer`, as on the desktop builds). |
| Can Rogue Archive legally redistribute everything it ships? | **Yes, for the console (ASCII) mode without sound.** | The code is GPL-2.0 (DRL), MIT (FPC Valkyrie, Lua) and FreePascal's run-time library licence (LGPL with a static-linking exception). The game data in the repository (Lua scripts, help, ASCII art) is under the repository's GPL. Upstream's sprites are CC BY-SA 4.0 and redistributable, but the console mode does not use them, so they are left out. Music and sounds are not in the repository at all (upstream distributes them separately, and they derive from the 1993 game): not shipped. |
| Can it deliver a polished experience? | **On desktop, yes: DRL's own 80×25 console, as in a terminal. On phones, plausible but unverified on a real device.** | The console is keyboard-only (no mouse, as in a terminal). The phone layout recomposes the game's cells (map zoomed, status band read from DRL's own HUD rows, menus as sheets) with a dock that follows what the game shows. |

## Upstream

| Item | Value |
|---|---|
| Repositories | https://github.com/chaosforgeorg/drl (the game), https://github.com/chaosforgeorg/fpcvalkyrie (ChaosForge's engine library; upstream's README: keep both on the same release) |
| Pinned release | DRL `0_10_12c`, commit `501db3060829e89610f5880079e0d5791df6999a` (annotated tag, 2026-10-29: the newest release tag); FPC Valkyrie `0_10_12`, commit `effea5628a3c96c21aa7e8b0663dff080e56b116` (its tag for that release; DRL's `a`/`c` hotfix tags have no Valkyrie counterpart). The default branch is `development`. |
| Language / build | FreePascal (DRL about 30,000 lines, Valkyrie about 45,000), game rules and data in Lua 5.1. Upstream builds with FreePascal 3.2.2 through `makefile.lua` (run by `lua5.1`, with Valkyrie's `scripts/lua_make.lua`): it compiles `src/drl.pas` and `src/drlwad.pas`, then `drlwad` builds `core.wad` and `drl.wad` from `build.lua` (Lua compiled to bytecode, some entries encrypted with a key derived in `drlwad`). |
| Dependencies | Lua 5.1 (linked statically on Unix); SDL3, FMOD and the Steam API are loaded at run time when present and optional. |
| Interfaces | Graphical (SDL3 and OpenGL 3, sprites) and console: curses on Unix (`vcursesio`, `vcursesconsole`), FreePascal's `video`/`keyboard` units elsewhere (`vtextio`). `--console` selects it. |
| Prior browser work | None found. Jupiter Hell Classic (the commercial remake) is not a browser game. |

## Route to WebAssembly

**FreePascal for WebAssembly.** Only FreePascal's development branch (3.3.1) has WebAssembly targets (`wasm32-wasip1`, `wasm32-embedded`); no release has them. It is pinned to an exact commit, fetched by commit and built from source with the distribution's FreePascal 3.2.2 (the compiler rebuilds itself in its make cycle, so the result does not depend on the bootstrap), recorded in [`games/drl/toolchain.env`](../../games/drl/toolchain.env). It has an internal assembler and writes standard WebAssembly object files. `wasm32-wasip1` was chosen over `wasm32-embedded` because DRL needs files (the data, saves, scores, the log): the wasip1 run-time library makes WASI calls for them.

**Exceptions.** FreePascal offers native WebAssembly exceptions and "branchful" exceptions (a flag checked after each call). Native exceptions do not combine with Asyncify (Binaryen's transformation that lets DRL's blocking loop wait for the page), and JSPI, which would, is not in Safari; so branchful exceptions, for the RTL and the game.

**Lua and the link.** Lua 5.1 raises errors with `setjmp`/`longjmp`; `wasi-libc` implements them only with WebAssembly exceptions (again incompatible with Asyncify). Emscripten's JavaScript-based `setjmp`/`longjmp` works with Asyncify, and Emscripten also gives the file systems (IDBFS for saves), the worker glue and the toolchain the other ports pin. So Emscripten compiles Lua and links everything: the FreePascal objects (the list FreePascal would pass its linker, captured by a stand-in `wasm-ld`), Lua, a small C entry and two JavaScript bridges. FreePascal's run-time library calls WASI; Emscripten provides about half of those calls outside its standalone mode, and `port/wasi-emscripten.js` provides the rest over Emscripten's file system (Emscripten's errno values are WASI's).

**One allocator.** FreePascal's heap grows the WebAssembly memory itself, and its `_start` takes the stack pointer at entry as the heap's start; Emscripten's default layout (data, stack, then the heap from `__heap_base`) gives exactly that when `_start` is called with an empty stack. Emscripten's own malloc would grow the same memory from the same address, so it is left out (`-sMALLOC=none`) and the C library's `malloc` family is implemented on the Pascal heap (`port/wasm/ramalloc.pas`); after the Pascal heap grows the memory, FreePascal's `WasmGrowMemoryCallback` refreshes Emscripten's views of it. The C library's few allocations before the program starts come from a small arena (`port/start.c`).

**Alternatives considered.** `pas2js` (Pascal to JavaScript) cannot link Lua's C or FreePascal's run-time library. A hand-written WASI host with `wasi-libc` cannot run Lua's `longjmp` with Asyncify. Restructuring DRL's loop to avoid Asyncify would change upstream's code throughout. Running the game on a server does not fit a static site.

**Proof of concept** (run under Node before the port): Pascal calling Lua and Lua calling Pascal; a Pascal callback raising a Lua error (`luaL_error`, varargs) that a Lua `pcall` catches; Pascal `try`/`except`/`finally`; 51 Asyncify suspensions inside Pascal callbacks under Lua's VM, some inside `pcall`; a 64 MB Pascal allocation growing the memory with output still working after it.

## Findings

- **A FreePascal compiler bug blocked the port: C varargs on WebAssembly.** Calling a C function declared `varargs` with arguments (Valkyrie calls `luaL_error` and `lua_pushfstring` so in about 50 places) stopped the compiler with an internal error, and FreePascal's WebAssembly backend passed varargs as extra parameters, which is not clang's ABI (one extra `i32`: the address of a buffer holding the arguments). [`games/drl/patches/fpc/0001-wasm32-c-varargs.patch`](../../games/drl/patches/fpc/0001-wasm32-c-varargs.patch) implements clang's ABI in the compiler (about 150 lines in `compiler/wasm32`); `printf` from Pascal then formats strings, integers, 64-bit integers, doubles and characters correctly. Patching the compiler rather than the call sites keeps the game unchanged and rots only when FreePascal is updated.
- **FreePascal 3.3 against code written for 3.2:** its `SysUtils` added `TAnsiStringArray`, which shadows Valkyrie's own in units that use both ("function header doesn't match"). One patch in Valkyrie makes the two the same type ([`patches/fpcvalkyrie`](../../games/drl/patches/fpcvalkyrie)).
- **Word sizes:** Valkyrie declares `lua_Integer` as 64-bit, which Lua 5.1's `ptrdiff_t` is on the 64-bit desktops DRL ships for but not on wasm32 (the linker reported the signature mismatch). Lua is built with a 64-bit `LUA_INTEGER` instead ([`patches/lua`](../../games/drl/patches/lua)), so the game sees the same integers as on the desktop.
- **The WADs hold Lua bytecode,** whose header records word sizes: WADs from a native `drlwad` fail to load in WebAssembly ("bad header in precompiled chunk"). Upstream's `drlwad` is built for WebAssembly too and run under Node by the build (the DCSS lesson about building data with the game's own tool, in its own word size).
- **Valkyrie assumes every target is Windows or Unix** (its library bindings' `uses` clauses don't parse otherwise). Compiled as a Unix build (`-dUNIX`), it takes its Linux code paths, among them the curses console, with no patch: six small units for what wasip1 lacks (`unix`, `baseunix`, `dl`, `dynlibs`, and empty `pthreads`, `x`, `xlib`), and our own `ncurses` (the dozen calls the curses driver makes). The browser therefore runs upstream's Linux console driver, and a native Linux build can run the same driver with the same units.
- **Console mode is keyboard-only and has no modifiers** (upstream's curses driver ignores them: Shift+direction to run and Ctrl+direction to move the target do nothing in a Linux terminal either). Running and targeting remain available through `,` (repeat move) and the targeting mode.
- **DRL's console redraws every frame** (an immediate-mode UI, about 90 frames per second, with two sleeps per frame); the worker lets the game sleep until a key when the screen has not changed for a while.
- **Data:** upstream's `build.lua` minus images, sounds and music: `drl.wad` 288 KB instead of 2.6 MB.

## Risks

- FreePascal's WebAssembly support is in its development branch: a later commit may fix, break or change it (the compiler patch may then be unnecessary or conflict). Updating the pin is a reviewed change with the conformance tests.
- The compiler patch is ours and is not upstream; it is exercised by every varargs call in the game.
- Branchful exceptions differ from native ones in one case: a Pascal exception raised inside a Pascal function called *from Lua's C code* would not unwind through the C frames. Valkyrie's callbacks report errors to Lua with `luaL_error` (a `longjmp`, which does unwind); Pascal exceptions there would be bugs on the desktop too.
- Trademarks: the game is "DRL" upstream ("D**m the Roguelike" on its own welcome screen) and its data keeps the 1993 game's monster and weapon names, as upstream publishes it under the GPL. The port ships upstream's data unchanged and uses no logos or artwork from that game.

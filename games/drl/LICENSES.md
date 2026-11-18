# DRL port — license and provenance report

What the DRL port ships, where each part comes from and under which terms, and what it leaves out. The feasibility report is [`docs/games/drl-feasibility.md`](../../docs/games/drl-feasibility.md).

**Summary:** the shipped runtime is GPL-2.0 (DRL, the game data in its repository, and this port's game-specific code), combined with permissively licensed parts (FPC Valkyrie and Lua under MIT; FreePascal's run-time library under its LGPL with a static-linking exception; Emscripten's runtime). Only the console (ASCII) mode is shipped: upstream's sprites are not used by it and are left out, and its music and sounds, which are not in its repository, are not shipped.

## Inventory

| Component | Origin | Version | License | Shipped? | Notes |
|---|---|---|---|---|---|
| DRL source code (`src/*.pas`; the programs `drl.pas` and `drlwad.pas`) | https://github.com/chaosforgeorg/drl | `0_10_12c` @ `501db3060829e89610f5880079e0d5791df6999a` | GPL-2.0 (`LICENSE`; README: "All code is (C) 2003-2025 Kornel Kisielewicz. Code is distributed under the GPL 2.0 license") | Yes, compiled into `drl.wasm` / `drl.mjs` | Unmodified (`patches/drl/` is empty). The repository's `LICENSE` is GPL version 2 without "or later"; distributed here under GPL-2.0-only. |
| DRL game data in the repository: Lua scripts (`bin/data/core/*.lua`, `bin/data/drl/**/*.lua`), help (`bin/data/drl/help/*.hlp`), ASCII art (`bin/data/drl/ascii/*.asc`), `bin/data/drl/fonts/default`, `bin/config.lua` | Same | Same | The repository's GPL-2.0: the data is published in the GPL repository with no separate terms (only `bin/data/drl/graphics/` has its own `LICENSE`) | Yes: packed by upstream's `drlwad` into `core.wad` and `drl.wad`, and `config.lua`, in `drl-data.data` | Upstream's `build.lua` manifest, without its image, sound and music entries (`port/console-manifest.lua`). Lua compiled to bytecode and some entries encrypted, as upstream's `drlwad` does (with the key it derives itself, `bin/dkey.inc`). |
| Sprites and graphical-mode images (`bin/data/drl/graphics/*.png`) and the bitmap font (`bin/data/drl/fonts/font10x19.png`) | Same; art by Derek Yu (0.9.9.7), modified and extended by Łukasz Śliwiński (0.9.9.8+) | Same | CC BY-SA 4.0 (`bin/data/drl/graphics/LICENSE`, README) | **No** | Redistributable with attribution and ShareAlike, but DRL's console mode does not use them; left out of the WADs (2.3 MB). A graphical mode would need them, with attribution. |
| Music (`data/drlhq/music`, `data/drllq/music`) | Not in the repository: upstream's `!readme.txt` points to the binary download at drl.chaosforge.org | — | Not stated in the repository; the game's credits name remixes (Sonic Clang) and tracks by Simon Volpert, and the tracks derive from the 1993 game's soundtrack | **No** | Not in the pinned source, not redistributable as far as we can tell, and the port has no audio. |
| Sound effects (`data/drlhq/sound`, `data/drllq/sound`) | Not in the repository (same `!readme.txt`) | — | Not stated in the repository; the credits name Per Kristian Risvik for the HQ effects; the LQ effects derive from the 1993 game | **No** | As for the music. |
| `install/install_license.txt` ("This game is Freeware but with some limitations...") | Same | Same | The licence text of upstream's old binary installer | No | Applies to upstream's binary packages (with their audio); the source and data shipped here are under the repository's GPL. |
| Upstream's bundled libraries (`ext/`: SDL3, FMOD, Steam API, Lua DLL) | Same | Same | Their vendors' terms | **No** | Not used: the console mode needs none of them, and Lua is built from source. |
| FPC Valkyrie (`src/*.pas`, `libs/*.pas`) | https://github.com/chaosforgeorg/fpcvalkyrie | `0_10_12` @ `effea5628a3c96c21aa7e8b0663dff080e56b116` | MIT (`LICENSE`, © 2016 ChaosForge). Some file headers still carry an older "GNU Library General Public License" notice; the repository's licence is MIT. | Yes (compiled in) | One patch (`patches/fpcvalkyrie/0001-*`): a type alias for FreePascal 3.3. Its `LICENSE` is shipped as `licenses/FPC-Valkyrie-LICENSE.txt`. |
| Lua | https://www.lua.org/ftp/lua-5.1.5.tar.gz (SHA-256 `2640fc56...695333`) | 5.1.5 | MIT (`COPYRIGHT`) | Yes (compiled in) | One patch (`patches/lua/0001-*`): a 64-bit `LUA_INTEGER`. `COPYRIGHT` shipped as `licenses/Lua-COPYRIGHT.txt`. |
| FreePascal run-time library and packages (`rtl`, `rtl-objpas`, `fcl-base`, `fcl-xml`, `paszlib`, `hash`... for wasm32-wasip1) | https://gitlab.com/freepascal.org/fpc/source | `128a07af7c265f9303a46257a1b411a04920dba5` (3.3.1) | LGPL-2.0 with FreePascal's static-linking exception (`rtl/COPYING.FPC`: linking it into an executable does not make the executable subject to the LGPL) | Yes (compiled in) | `rtl/COPYING.FPC` and `rtl/COPYING.txt` shipped in `licenses/`. GPL-compatible. |
| FreePascal compiler | Same | Same | GPL-2.0-or-later | No (a build tool) | Built from source with `patches/fpc/0001-wasm32-c-varargs.patch` (ours, GPL-2.0-or-later as the compiler). Its output is not covered by the compiler's licence. |
| Rogue Archive platform layer (`port/ncurses.pas`, `port/wasm/*.pas`, `port/start.c`, `port/wasi-emscripten.js`, `port/host.js`, `port/console-manifest.lua`) | This repository | — | GPL-2.0-only | Yes (compiled in) | Our curses, the few FreePascal units WebAssembly lacks (implementing FreePascal's interfaces), the WASI bridge. |
| Adapter and worker (`adapter/*.ts`) | This repository | — | GPL-2.0-only | Yes (JS chunks) | |
| GPL-2.0 text (`licenses/GPL-2.0.txt`) | Upstream's `LICENSE` | 2, June 1991 | Verbatim copying permitted | Yes, as `licenses/DRL-LICENSE.txt` | |
| Shared terminal renderer (`packages/term-view`) | This repository | — | MIT | Yes (JS chunks) | Platform code; GPL-compatible. |
| Emscripten runtime (JS glue, libc linked in) | https://github.com/emscripten-core/emscripten | 6.0.13 | MIT / University of Illinois NCSA; musl libc (MIT); compiler-rt (Apache-2.0 WITH LLVM-exception) | Yes | Permissive; GPL-compatible. Notices in `licenses/THIRD_PARTY_NOTICES.md`. |
| Build and test scripts (`scripts/`, `tests/`) | This repository | — | GPL-2.0-only | No (source only) | |
| Generated artifacts (`dist/`, `runtime-manifest.json`) | Built in CI from the above | — | As their inputs | Yes | Content-hashed; every file listed with SHA-256. |

## Names and trademarks

DRL was DoomRL; upstream renamed it and publishes it as "DRL" ("D**m the Roguelike" on its own welcome screen). Its data keeps the 1993 game's monster, weapon and place names, as upstream publishes them under the GPL; the port ships upstream's data unchanged. The port uses none of that game's logos, artwork, music or sounds, and Rogue Archive's own text calls the game DRL. Whether the names raise trademark questions for redistribution is a judgement for the maintainers; nothing here changes them.

## Why GPL-2.0-only

DRL's `LICENSE` is the GPL version 2, and its README says "Code is distributed under the GPL 2.0 license" without "or later". The port's own game-specific files are under the same terms; the parts it is combined with (MIT, FreePascal's LGPL with its static-linking exception, Emscripten's permissive licences) are GPL-compatible.

## Obligations and how they are met

- **Source:** the pinned upstream commits, the Lua tarball's hash, the FreePascal commit, every patch and the build script are in this repository; `scripts/build.sh` rebuilds the shipped runtime from them.
- **Licence texts and notices:** `dist/licenses/` holds DRL's `LICENSE` (the GPL-2.0), FPC Valkyrie's and Lua's licences and FreePascal's run-time library licence; the site links this report.
- **Modifications:** marked as patches with their reasons (`patches/README.md`); DRL itself is not modified.

## Contribution policy

No changes are submitted upstream from this project (its changes are AI-assisted; ChaosForge's policy on such contributions is not stated). The compiler fix is worth reporting to FreePascal by a maintainer.

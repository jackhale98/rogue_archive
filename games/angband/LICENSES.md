# Angband port — license and provenance report

This report covers every file the Angband port distributes from the public site. It is an engineering record, not legal advice. Re-check it whenever the pinned upstream version changes.

**Summary:** everything shipped has a documented redistribution basis. Angband is offered by its authors under **either GPL-2.0 or the Angband licence**; Rogue Archive distributes it under **GPL-2.0-only**. Of upstream's five tilesets, only **Adam Bolt's 16x16 tiles** are shipped: upstream states they "may be redistributed and used for any purpose, with or without modification". The other tilesets, the sounds and the fonts are not shipped. The complete corresponding source (upstream at the pinned commit, this directory and the build scripts) is published in this repository.

All statements below are quoted from upstream's own files at the pinned commit: `docs/copying.rst` (the licence statement; upstream has no `copying.txt` in 4.2), `docs/thanks.rst` (credits), `lib/tiles/list.txt` and each tileset's pref files, and the source files' headers.

## Inventory

| Component | Origin | Version | License | Shipped? | Notes |
|---|---|---|---|---|---|
| Game source code (`src/*.c` listed as `BASEOBJS` in `src/Makefile.inc`, and `src/main.c`) | https://github.com/angband/angband | `4.2.6` @ `f3082213b73f3e463e3d0d60bff4b00462beae6e` | GPL-2.0 or the Angband licence (each file's header, `docs/copying.rst`); distributed here under GPL-2.0-only | Yes, compiled into `angband.wasm` / `angband.mjs` | Unmodified; no patches. The Borg sources (`src/borg/`) are in `BASEOBJS` but compile to nothing without `ALLOW_BORG`, which this build does not define. |
| `src/message.c` (© 2007 Elly, Andi Sidwell) and `src/wiz-stats.c` (© 2008 Andi Sidwell) | Same | Same | BSD-2-Clause (their headers) | Yes (compiled in) | GPL-compatible. Their notices are shipped as `licenses/Angband-BSD-notices.txt` (extracted from the sources by `scripts/build.sh`), as the binary-redistribution clause asks. |
| `src/z-util.c` UTF-8 helper | Same | Same | Public domain (its comment: "In the public domain") | Yes (compiled in) | |
| Game data: `lib/gamedata`, `lib/customize`, `lib/help`, `lib/screens`, the empty `lib/user` tree, `lib/tiles/list.txt` | Same | Same | Same as the code (`lib/readme.txt`; `docs/copying.rst`) | Yes, as `angband-data.data` | Unmodified. |
| Adam Bolt's 16x16 tiles (`lib/tiles/adam-bolt/16x16.png`) | Same; by Adam Bolt (`docs/thanks.rst`), lurker/trapper tiles adjusted upstream in commit `e92ed129` (2022) | Same | "Adam Bolt's (16x16) graphics may be redistributed and used for any purpose, with or without modification." (`docs/copying.rst`) | **Yes**, as `tiles/adam-bolt.png` | The only tileset shipped. Byte-identical to upstream's file. |
| Adam Bolt's tile prefs (`lib/tiles/adam-bolt/graf-new.prf`, `flvr-new.prf`, `xtra-new.prf`) | Same; by Robert Ruehlmann (`graf-new.prf` header) | Same | As the game data (GPL-2.0 or the Angband licence) | Yes (in `angband-data.data`) | Angband's own mapping of game objects to tiles; read by the game when the tiles are chosen. |
| David Gervais' 32x32 tiles (`lib/tiles/gervais/`) | Same | Same | "may be redistributed, modified, and used only under the terms of the Creative Commons Attribution 3.0 licence" (`docs/copying.rst`) | **No (not yet)** | Redistributable with attribution as upstream states, but the sheet is "Buzzkill's Universal 32x32 Tileset (UT32) ... a modified version of David Gervais's 32x32 tileset. Additional tiles by provided by Rob Fiala, Jeff Greene, Thapper ... and others ... Additional tiles from Tangaria's tileset" (`graf-dvg.prf` header), updated again in 2019 (commit `b93680e1`, "thanks Bill Peterson"). Upstream's statement covers the file, but the additional artists' own terms are not stated in upstream's files. Left out until that is confirmed; a candidate for a later change. |
| Shockbolt's 64x64 tiles (`lib/tiles/shockbolt/`) | Same; © Raymond Gaustadnes 2012 | Same | Permission only "with in-development and released versions of Angband"; "Permission is not granted to ... use or distribute the tileset with other games or projects" without the author's explicit permission; no modification (`docs/copying.rst`) | **No** | Rogue Archive is another project redistributing Angband; this is outside the stated permission. Would need explicit permission from the author. |
| Nomad's 8x16 tiles (`lib/tiles/nomad/`) | Same; by Nomad (`docs/thanks.rst`: "8x16 tiles") | Same | **None stated.** `docs/copying.rst` lists no terms for this set. | **No** | Rights unclear: not shipped. |
| Original 8x8 tiles (`lib/tiles/old/`) | Same; the pixmap provided by Lars Haugseth (`graf-xxx.prf` header) | Same | **None stated** in `docs/copying.rst`. | **No** | Rights unclear: not shipped. |
| Sounds (`lib/sounds/`) | Same; by Dubtrain | Same | CC BY 4.0 (`docs/copying.rst`) | **No** | Clearly licensed, but the port has no audio. |
| Fonts (`lib/fonts/`) | Same; by Leon Marrick, Sheldon Simms III, Nick McConnell | Same | GPL (`docs/copying.rst`) | **No** | The browser draws text with its own monospace font. |
| Icons, screenshots, the SDL runtime libraries upstream ships for Windows | Same | Same | Various | **No** | Not used. |
| Rogue Archive display module (`port/main-web.c`) | This repository | — | GPL-2.0-only | Yes (compiled in) | A front end for Angband's term interface, modelled on upstream's `main-xxx.c` template and `main-gcu.c`. |
| Adapter and worker (`adapter/*.ts`) | This repository | — | GPL-2.0-only | Yes (JS chunks) | Uses Angband's colour table and graphics mode (sent by the game) and its key bindings. |
| GPL-2.0 text (`licenses/GPL-2.0.txt`) | Free Software Foundation | 2, June 1991 | Verbatim copying permitted | Yes, as `licenses/GPL-2.0.txt` | Upstream refers to the GPL-2.0 but does not include its text. |
| Shared terminal renderer (`packages/term-view`) | This repository | — | MIT | Yes (JS chunks) | Platform code; GPL-compatible. |
| Emscripten runtime (JS glue, libc linked in) | https://github.com/emscripten-core/emscripten | 6.0.13 | MIT / University of Illinois NCSA; musl libc (MIT); compiler-rt (Apache-2.0 WITH LLVM-exception) | Yes | Permissive; GPL-compatible. Notices in `licenses/THIRD_PARTY_NOTICES.md`. |
| Cover (`apps/web/public/covers/angband.webp`) | Generated by Rogue Archive from this port | — | Depicts GPL-2.0 game output (and Adam Bolt's tiles, if shown); distributed under GPL-2.0-only | Yes | An automated Playwright capture of the running game. |
| Build and test scripts (`scripts/`, `tests/`) | This repository | — | GPL-2.0-only | No (source only) | |
| Generated artifacts (`dist/`, `runtime-manifest.json`) | Built in CI from the above | — | As their inputs | Yes | Content-hashed; every file listed with SHA-256. |

## Why GPL-2.0-only

`docs/copying.rst` and every source header offer "the GNU General Public License, version 2 ... or the 'Angband licence'". They name version 2 and no later version, so the GPL option is GPL-2.0-only. The Angband licence restricts distribution to "educational, research, and not for profit purposes"; the GPL option has no such restriction and is the one used here. Upstream asks derivatives to keep the dual statement rather than relicensing Adam Bolt's tiles under the GPL; the tiles are shipped under their own terms, unmodified, with upstream's statement alongside (`licenses/Angband-copying.rst`).

## Obligations and how they are met

- **GPL-2.0 source availability:** the game page and the About page link to this repository, which holds the exact build recipe, the pinned upstream revision (verified by commit hash at build time), the display module and the adapter. The game page shows the pinned version, commit and build ID.
- **License texts:** `licenses/Angband-copying.rst` (upstream's statement, including each tileset's terms), `licenses/GPL-2.0.txt` and `licenses/Angband-BSD-notices.txt` are shipped inside the runtime directory.
- **Attribution for the tiles:** the Display setting names Adam Bolt's tiles; credits are in Angband's own `docs/thanks.rst` and in `licenses/Angband-copying.rst`.
- **Notices:** Angband shows its own version and credits (`V` in game, the splash screen).

## Contribution policy

Angband's `CONTRIBUTING.md` welcomes pull requests and does not address how contributions are authored. This port needs **no** upstream changes, and none have been proposed upstream. Re-read the project's guidance before proposing any.

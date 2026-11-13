# Rogue port — license and provenance report

This report covers every file the Rogue port distributes from the public site. It is an engineering record, not legal advice. Re-check it whenever the pinned upstream version changes.

**Summary:** everything shipped has a documented redistribution basis. Rogue 5.4.4 is the later, redistributable source release of Rogue (not the original 1980 code), under a **BSD-3-Clause** licence; two contributed files carry the same terms from their authors. The port's own files use the same licence. No graphics, sounds or fonts are shipped.

## Inventory

| Component | Origin | Version | License | Shipped? | Notes |
|---|---|---|---|---|---|
| Game source code (the `CFILES` of `Makefile.std`) | https://github.com/Davidslv/rogue (a mirror of the Roguelike Restoration Project's Rogue 5.4.4 source release) | `5.4.4` @ `cf9bd26d564a72fac4cf56b55c96c2435270d29a` | BSD-3-Clause: © 1980–1983, 1985, 1999 Michael Toy, Ken Arnold and Glenn Wichman (`LICENSE.TXT`) | Yes, compiled into `rogue.wasm` / `rogue.mjs` | Unmodified; no patches. |
| `state.c`, `mdport.c` | Same | Same | BSD-3-Clause, © 1999, 2000, 2005 Nicholas J. Kisseberth (`LICENSE.TXT`) | Yes (compiled in) | Unmodified. |
| `xcrypt.c` (FreeSec libcrypt) | Same | Same | BSD-3-Clause, © 1994 David Burren (`LICENSE.TXT`) | Yes (compiled in) | Unmodified. |
| Rogue Archive port files (`port/config.h`, `port/curses.h`, `port/curses-web.c`, `port/platform.c`) | This repository | — | BSD-3-Clause | Yes (compiled in) | A small curses written for this port (not derived from ncurses or PDCurses), the build configuration, and the browser's account. |
| Adapter and worker (`adapter/*.ts`) | This repository | — | BSD-3-Clause | Yes (JS chunks) | |
| Shared packages (`packages/term-view`, `packages/start-screen`) | This repository | — | MIT | Yes (JS chunks) | Platform code. |
| Emscripten runtime (JS glue, libc linked in) | https://github.com/emscripten-core/emscripten | 6.0.13 | MIT / University of Illinois NCSA; musl libc (MIT); compiler-rt (Apache-2.0 WITH LLVM-exception) | Yes | Notices in `licenses/THIRD_PARTY_NOTICES.md`. |
| Build and test scripts (`scripts/`, `tests/`) | This repository | — | BSD-3-Clause | No (source only) | |
| Generated artifacts (`dist/`, `runtime-manifest.json`) | Built in CI from the above | — | As their inputs | Yes | Content-hashed; every file listed with SHA-256. |

## Obligations and how they are met

- **Retain the copyright notices and conditions (source and binary):** `licenses/Rogue-LICENSE.txt` (upstream `LICENSE.TXT`, with all three notices) is shipped inside the runtime directory; the game page links to this repository and credits the authors.
- **No endorsement:** the site does not use the authors' names to promote anything; they are credited as authors only.

## Provenance

Rogue was written by Michael Toy, Glenn Wichman and Ken Arnold (1980–1985). The 5.4.4 source release is the version the Roguelike Restoration Project (rogueforge) made redistributable under BSD terms, with portability work by Nicholas J. Kisseberth (its version string reads `rogue (rogueforge) 09/05/07`). The pinned mirror's single commit, tagged `5.4.4`, contains that release.

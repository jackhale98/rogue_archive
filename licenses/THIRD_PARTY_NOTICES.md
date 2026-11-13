# Third-party notices

## Games

| Game | Code | Assets | Report |
|---|---|---|---|
| Brogue: Community Edition 1.15.1 (`tmewett/BrogueCE` @ `1ba4240b`) | AGPL-3.0-or-later | `tiles.png`: CC BY-SA 4.0, © Brogue: Community Edition maintainers; originally by Antony Boucher, based on Oryx Design Lab's "Brogue Tiles" distributed with Brogue under the AGPL | [games/brogue-ce/LICENSES.md](../games/brogue-ce/LICENSES.md) |
| Dungeon Crawl Stone Soup 0.34.1 (`crawl/crawl` @ `1eebc1a2`) | GPL-2.0-or-later, with GPL-compatible parts (BSD, MIT, public domain); bundled Lua (MIT), SQLite (public domain), PCRE (BSD), zlib; WebTiles client libraries jQuery 1.8.2, jQuery JSON, SimpleBar, focus-trap (MIT), RequireJS (MIT or new BSD) | Tiles: mostly public domain / CC0 (RLTiles and DCSS tile contributors); DejaVu fonts: Bitstream Vera license, DejaVu changes public domain | [games/dcss/LICENSES.md](../games/dcss/LICENSES.md) |
| Sil-Q 1.5.0 (`sil-quirk/sil-q` @ `09a53ab8`) | GPL-2.0-only (upstream offers GPL-2.0 or the Angband licence; distributed here under GPL-2.0) | None shipped (text display; upstream's tiles, sounds and fonts are left out) | [games/sil-q/LICENSES.md](../games/sil-q/LICENSES.md) |
| Rogue 5.4.4 (`Davidslv/rogue` @ `cf9bd26d`) | BSD-3-Clause (Toy, Arnold, Wichman; state.c/mdport.c Nicholas J. Kisseberth; xcrypt.c David Burren) | Optional tiles: CC0 (crawl/tiles export of Dungeon Crawl Stone Soup's tiles, based on RLTiles) | [games/rogue/LICENSES.md](../games/rogue/LICENSES.md) |

The complete corresponding source of each game build is this repository at the deployed commit, together with the upstream revision pinned in `games/<id>/upstream.env`. Each game's license texts are shipped next to its runtime (`runtime/<id>/<buildId>/licenses/`).

## Compiled into game runtimes

- **Emscripten** 6.0.13 runtime and system libraries: MIT / University of Illinois/NCSA Open Source License. Includes musl libc (MIT) and LLVM compiler-rt (Apache-2.0 WITH LLVM-exception).

## Bundled into the web app

| Package | License |
|---|---|
| React, React DOM | MIT |
| idb | ISC |
| Fraunces (via @fontsource-variable/fraunces) | SIL Open Font License 1.1 |
| Inter (via @fontsource-variable/inter) | SIL Open Font License 1.1 |

Build-time tools (Vite, TypeScript, ESLint, Vitest, Playwright, Zod for CI validation) are not distributed.

# Rogue port — license and provenance report

This report covers every file the Rogue port distributes from the public site. It is an engineering record, not legal advice. Re-check it whenever the pinned upstream version changes.

**Summary:** everything shipped has a documented redistribution basis. Rogue 5.4.4 is the later, redistributable source release of Rogue (not the original 1980 code), under a **BSD-3-Clause** licence; two contributed files carry the same terms from their authors. The port's own files use the same licence. The optional tiles are CC0 (Dungeon Crawl Stone Soup's tiles, based on the public-domain RLTiles). No sounds or fonts are shipped.

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
| Tiles for Display: Tiles (`dist/tiles/`, 43 PNG files, 32×32) | https://github.com/crawl/tiles, `releases/Nov-2015` @ `a6ea1655db5c044829d9eea19a232fa6fcac87b0` | Nov 2015 export | CC0 1.0 (Dungeon Crawl Stone Soup's tiles, based on the public-domain RLTiles; the export contains only tiles whose artists released them under CC0 and excludes those of unclear ownership, `TILES_UNDER_UNKNOWN_LICENSE.md`) | Yes, unmodified | Listed below. The export's `README.md` and `ARTISTS.md` are shipped in `licenses/` as a courtesy. |
| Build and test scripts (`scripts/`, `tests/`) | This repository | — | BSD-3-Clause | No (source only) | |
| Generated artifacts (`dist/`, `runtime-manifest.json`) | Built in CI from the above | — | As their inputs | Yes | Content-hashed; every file listed with SHA-256. |

## Tiles

Each symbol's tile (`tiles/tiles.json`; the room-floor tile is also drawn under monsters and items). None is on the export's list of tiles of unknown licence (checked by name). Where Dungeon Crawl has no such creature, the nearest one stands in (an emu as a harpy, a quagga as a yak, the black unicorn as a hippogriff, the xeroc as a shapeshifter).

| Symbol | Rogue | Tile (in `releases/Nov-2015`) |
|---|---|---|
| `@` | the hero | `player/base/human_m.png` |
| `.` | room floor | `dngn/floor/grey_dirt0.png` |
| `#` | passage | `dngn/floor/pebble_brown0.png` |
| `-` | wall | `dngn/wall/stone_gray0.png` |
| `|` | wall | `dngn/wall/stone_gray1.png` |
| `+` | doorway | `dngn/doors/open_door.png` |
| `%` | stairs | `UNUSED/features/rock_stairs_down.png` |
| `^` | trap | `dngn/traps/pressure_plate.png` |
| `:` | food | `item/food/bread_ration.png` |
| `!` | potion | `item/potion/brilliant_blue.png` |
| `?` | scroll | `item/scroll/scroll-grey.png` |
| `/` | wand or staff | `item/wand/gem_glass.png` |
| `=` | ring | `item/ring/ruby.png` |
| `]` | armor | `item/armour/ring_mail1.png` |
| `)` | weapon | `item/weapon/mace1.png` |
| `*` | gold | `item/gold/05.png` |
| `,` | the Amulet of Yendor | `item/amulet/cameo_orange.png` |
| `A` | aquator | `mon/amorphous/azure_jelly.png` |
| `B` | bat | `mon/animals/bat.png` |
| `C` | centaur | `player/base/centaur_brown_m.png` |
| `D` | dragon | `mon/dragons/golden_dragon.png` |
| `E` | emu | `mon/harpy.png` |
| `F` | venus flytrap | `mon/fungi_plants/thorn_hunter.png` |
| `G` | griffin | `mon/griffon.png` |
| `H` | hobgoblin | `mon/hobgoblin.png` |
| `I` | ice monster | `mon/animals/ice_beast.png` |
| `J` | jabberwock | `mon/dragons/wyvern.png` |
| `K` | kestrel | `mon/animals/caustic_shrike.png` |
| `L` | leprechaun | `mon/boggart.png` |
| `M` | medusa | `mon/greater_naga.png` |
| `N` | nymph | `mon/water_nymph.png` |
| `O` | orc | `mon/orc.png` |
| `P` | phantom | `mon/undead/phantom.png` |
| `Q` | quagga | `mon/animals/yak.png` |
| `R` | rattlesnake | `mon/animals/water_moccasin.png` |
| `S` | snake | `mon/animals/adder.png` |
| `T` | troll | `mon/deep_troll.png` |
| `U` | black unicorn | `mon/hippogriff.png` |
| `V` | vampire | `mon/undead/vampire.png` |
| `W` | wraith | `mon/undead/wight.png` |
| `X` | xeroc | `mon/shapeshifter.png` |
| `Y` | yeti | `mon/animals/polar_bear.png` |
| `Z` | zombie | `mon/undead/zombies/zombie_ogre.png` |

## Obligations and how they are met

- **Retain the copyright notices and conditions (source and binary):** `licenses/Rogue-LICENSE.txt` (upstream `LICENSE.TXT`, with all three notices) is shipped inside the runtime directory; the game page links to this repository and credits the authors.
- **No endorsement:** the site does not use the authors' names to promote anything; they are credited as authors only.

## Provenance

Rogue was written by Michael Toy, Glenn Wichman and Ken Arnold (1980–1985). The 5.4.4 source release is the version the Roguelike Restoration Project (rogueforge) made redistributable under BSD terms, with portability work by Nicholas J. Kisseberth (its version string reads `rogue (rogueforge) 09/05/07`). The pinned mirror's single commit, tagged `5.4.4`, contains that release.

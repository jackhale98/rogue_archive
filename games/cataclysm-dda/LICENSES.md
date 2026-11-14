# Cataclysm: DDA port — license and provenance report

This report covers every file the Cataclysm: Dark Days Ahead port distributes from the public site. It is an engineering record, not legal advice. Re-check it whenever the pinned upstream version changes.

**Summary:** everything shipped has a documented redistribution basis. Cataclysm: DDA's code and content are **CC BY-SA 3.0** (upstream's `LICENSE.txt`); the third-party code compiled in from upstream's tree (Dear ImGui, zstd, FlatBuffers, PLF list/colony, Unicode pinyin data) and the libraries linked from Emscripten's ports (SDL2, SDL2_image, SDL2_ttf, FreeType, HarfBuzz, libpng, zlib) are under permissive licences, and their notices ship with the runtime. The fonts are the game's own (Terminus and VecTerminus: SIL OFL 1.1; GNU Unifont: SIL OFL 1.1 / GPL-2.0-or-later with the font embedding exception; Roboto: Apache-2.0). Two tilesets are shipped, the game's defaults (UltimateCataclysm and Larwick Overmap), under CC BY-SA 3.0; the other tilesets in upstream's tree are not shipped (size, not licence). No sounds or music are shipped (upstream's web build has no sound). The port's own files use the game's licence.

## Inventory

| Component | Origin | Version | License | Shipped? | Notes |
|---|---|---|---|---|---|
| Game source code (`src/`) | https://github.com/CleverRaven/Cataclysm-DDA | `0.I-1` @ `7b2efa5cea38e4d4d97dd0e63b28b9148623da59` | CC BY-SA 3.0 (`LICENSE.txt`: "Cataclysm is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported License") | Yes, compiled into `cataclysm-tiles.wasm` / `.mjs` | Unmodified; no patches. Built with upstream's own Makefile (`make NATIVE=emscripten`). `LICENSE.txt` ships as `licenses/Cataclysm-DDA-LICENSE.txt`. |
| Game data (`data/core`, `json`, `mods`, `names`, `raw`, `motd`, `credits`, `title`, `fontdata.json`) | Same repository | Same | CC BY-SA 3.0 (`LICENSE.txt` covers the project's content) | Yes, in `cataclysm-data.data.gzip` | The directories upstream's web bundle packs (`build-scripts/prepare-web.sh`), minus the mods it drops (obsolete mods and `MA`). Unmodified. |
| Translations (`lang/`) | Same repository | Same | CC BY-SA 3.0 | **No** | Upstream's web bundle leaves them out (about 690 MB of `.po` sources; compiled `.mo` files are not in the tree). The game runs in English. |
| UltimateCataclysm tileset (`gfx/UltimateCataclysm`) | Same repository (synced from https://github.com/I-am-Erk/CDDA-Tilesets) | Same | CC BY-SA 3.0. The tileset repository's `readme.md`: "Cataclysm:Dark Days Ahead and the Ultimate Cataclysm tileset is the result of contributions from volunteers under the Creative Commons Attribution ShareAlike 3.0 license"; its `LICENSE.txt` is the same CC BY-SA 3.0 statement as the game's. The tileset's `tileset.txt` credits filler trees "originally sourced from opengameart.org and drawn by Yar, edited by I-am-Erk" The tileset does not state the OpenGameArt licence of those source sprites; the tileset project distributes the edited result under CC BY-SA 3.0. **Residual item:** confirm the OpenGameArt licence of Yar's trees (OpenGameArt's free licences, CC0/CC BY/CC BY-SA/OGA-BY, are all compatible with redistribution under CC BY-SA 3.0, but that has not been checked against the original page). | Yes | The game's default tileset (option `TILES`). Credits: `tileset.txt` inside the package. |
| Larwick Overmap tileset (`gfx/Larwick_Overmap`) | Same repository (CDDA-Tilesets) | Same | CC BY-SA 3.0 (the tileset repository's `LICENSE.txt`, which covers all its tilesets; "initially released as a mod by Larwick") | Yes | The game's default overmap tileset (option `OVERMAP_TILES`). |
| Other tilesets (`gfx/Altica`, `ChibiUltica`, `MshockXotto+`, `RetroDays`, `NeoDays`, `GiantDays`, `BrownLikeBears`, `HollowMoon`, `Cuteclysm`, `PenAndPaper`, `SurveyorsMap`, `ASCII_Overmap`, `ASCIITileset`, `SmashButton_iso`, `Ultica_iso`) | Same repository | Same | CC BY-SA 3.0 per the tileset repository's `LICENSE.txt` (individual credits vary: `MshockXotto+/Credit.txt`) | **No** | Left out to keep the download small (about 40 MB); the game offers only the shipped tilesets. Each would need its credits checked before shipping. |
| Terminus font (`data/font/Terminus.ttf`) | Same repository | Same | SIL OFL 1.1, © Dimitar Toshkov Zhekov, Reserved Font Name "Terminus Font" (`LICENSE-OFL-Terminus-Font.txt`) | Yes (data package) | The game's default font (`fontdata.json`). Licence text ships as `licenses/LICENSE-OFL-Terminus-Font.txt`. |
| VecTerminus font (`data/font/VecTerminus12Medium.otf`) | Same repository | Same | SIL OFL 1.1, © tisimst, Reserved Font Name "Vecterminus" (same licence file) | Yes (data package) | |
| GNU Unifont (`data/font/unifont.ttf`) | Same repository | Same | SIL OFL 1.1 and GPL-2.0-or-later with the GNU font embedding exception (`LICENSE.txt`; http://unifoundry.com/LICENSE.txt) | Yes (data package) | The fallback font for characters Terminus lacks. Used under the OFL. |
| Roboto Medium (`data/font/Roboto-Medium.ttf`) | Same repository | Same | Apache-2.0 (`LICENSE-Apache-Robot-Font.txt`) | Yes (data package) | Licence text ships as `licenses/Apache-2.0.txt`. |
| Map font images (`data/font/map_font_LARWICK*.png`) | Same repository | Same | CC BY-SA 3.0 | Yes (data package) | |
| Dear ImGui (`src/third-party/imgui`) | Same repository (vendored from https://github.com/ocornut/imgui) | as vendored | MIT, © Omar Cornut (`LICENSE.txt`) | Compiled in | Notice ships as `licenses/imgui-LICENSE.txt`. |
| zstd (`src/third-party/zstd`) | Same repository (vendored from https://github.com/facebook/zstd) | as vendored | BSD-3-Clause, © Meta Platforms (`LICENSE`) | Compiled in | Notice ships as `licenses/zstd-LICENSE.txt`. |
| FlatBuffers (`src/third-party/flatbuffers`) | Same repository (vendored from https://github.com/google/flatbuffers) | as vendored | Apache-2.0, © Google (file headers) | Compiled in | `licenses/Apache-2.0.txt`. |
| PLF list and colony (`src/list.h`, `src/colony.h`) | Same repository | Same | zlib licence (`LICENSE.txt`) | Compiled in | |
| Pinyin data (`src/third-party/pinyin`) | Same repository | Same | Unicode License (`LICENSE`) | Compiled in | Used for searching Chinese text; notice ships as `licenses/pinyin-Unicode-LICENSE.txt`. |
| SDL2 | Emscripten port, source https://github.com/libsdl-org/SDL | `release-2.32.10` | zlib licence | Compiled in | Fetched by tag (`scripts/ports.sh`) at the version the pinned Emscripten names; `licenses/SDL2-LICENSE.txt`. |
| SDL2_image (PNG only) | https://github.com/libsdl-org/SDL_image | `release-2.6.0` | zlib licence | Compiled in | `licenses/SDL2_image-LICENSE.txt`. |
| SDL2_ttf | https://github.com/libsdl-org/SDL_ttf | `release-2.20.2` | zlib licence | Compiled in | `licenses/SDL2_ttf-LICENSE.txt`. |
| FreeType | https://github.com/freetype/freetype | `VER-2-14-3` | FreeType License (FTL), chosen of FTL / GPL-2.0 | Compiled in | FTL requires a credit in the documentation: "Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved." `licenses/FreeType-FTL.txt`. |
| HarfBuzz | Emscripten port (release archive `harfbuzz-3.2.0.tar.xz`, sha512-checked by Emscripten) | 3.2.0 | MIT ("Old MIT") | Compiled in | `licenses/HarfBuzz-COPYING.txt`. |
| libpng | Emscripten port (archive from Emscripten's port storage, sha512-checked) | 1.6.59 | libpng licence | Compiled in | `licenses/libpng-LICENSE.txt`. |
| zlib | https://github.com/madler/zlib | `v1.3.2` | zlib licence | Compiled in | `licenses/zlib-LICENSE.txt`. |
| Emscripten runtime (JS glue, file packager loader, LZ4 decoder, libc, libc++) | https://github.com/emscripten-core/emscripten | 6.0.13 | MIT / University of Illinois NCSA; musl libc (MIT); libc++, libc++abi and compiler-rt (Apache-2.0 WITH LLVM-exception); LZ4 (BSD-2-Clause, in the JS decoder) | Yes | Notices in `licenses/THIRD_PARTY_NOTICES.md` (repository root). |
| Rogue Archive port file (`port/rogue-archive-web.cpp`) | This repository | — | CC BY-SA 3.0 | Compiled in | Read-only observation of the game: wraps a few upstream functions at link time (`scripts/build.sh` `WRAPPED`). |
| Adapter (`adapter/*.ts`) | This repository | — | CC BY-SA 3.0 | Yes (JS chunk) | |
| Build and test scripts (`scripts/`, `tests/`) | This repository | — | CC BY-SA 3.0 | No (source only) | |
| Generated artifacts (`dist/`, `runtime-manifest.json`) | Built from the above | — | As their inputs | Yes | Content-hashed; every file listed with SHA-256. |

## Not shipped

| Upstream content | Why not |
|---|---|
| `lang/` (translations) | Not in upstream's web bundle; English only. |
| `data/sound`, sound packs | Upstream's web build has no sound (`SOUND` off). |
| `data/screenshots`, `doc/`, `android/`, `tests/`, `tools/` | Not part of the game. |
| The tilesets listed above as not shipped | Size; not licence. |
| `data/mods/MA` and obsolete mods (`Aftershock`, `Defense_Mode`, `Mythos-Creatures`, `Rummaging`, `TEST_DATA`, `dda_tutorial`, `rural_biome`) | Left out by upstream's web bundle (`prepare-web.sh`). Without `dda_tutorial` the main menu's Tutorial Game does not work, as on upstream's web build. |

## Obligations and how they are met

- **CC BY-SA 3.0 (attribution, share-alike):** the game's credits screen (main menu → Credits) and `data/credits` ship unchanged; the catalog and the game page credit the CleverRaven community and Whales; the port's own code is under the same licence; `licenses/Cataclysm-DDA-LICENSE.txt` ships with the runtime; the source (this repository, pinning the exact upstream commit) is linked from the site.
- **SIL OFL 1.1 (fonts):** the fonts are shipped unmodified with the game data and their licence text; they are not sold on their own.
- **Apache-2.0 (Roboto, FlatBuffers):** the licence text ships with the runtime; no NOTICE files are provided upstream.
- **MIT / BSD / zlib / libpng / Unicode / FTL notices:** shipped in `licenses/` inside the runtime directory; FreeType's credit line is above and in `PORTING.md`.

## Provenance

Cataclysm: Dark Days Ahead is developed by the CleverRaven community since 2013, forked from Cataclysm by Whales. The pinned tag `0.I-1` is upstream's newest stable release (point release of 0.I) at the time of porting; development builds are tagged `cdda-experimental-*` and are not used. AI-generated changes are not submitted upstream (the project restricts LLM-sourced contributions).

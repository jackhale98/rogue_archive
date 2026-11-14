# Building the Angband runtime

```sh
pnpm build:angband          # = games/angband/scripts/build.sh
pnpm test:engine:angband    # key coverage + native vs WebAssembly conformance (after a build)
pnpm stage:runtimes         # copy into apps/web/public/runtime/angband/<buildId>/
pnpm dev                    # or: pnpm build && pnpm preview
```

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk` (shared with the other games).
2. Shallow-clones upstream at the tag in `upstream.env` and **fails if the tag does not resolve to the pinned commit**.
3. Resets the checkout to pristine and applies `patches/*.patch` (none today).
4. Reads the object list from upstream's `src/Makefile.inc` (`BASEOBJS`: the game and its `z-*` library, which every front end links), adds upstream's `main.c`, and compiles them with `port/main-web.c`. The flags select our module through `main.c` (`-DUSE_GCU -Dinit_gcu=init_web -Dhelp_gcu=help_web`), place the game data at `/angband/lib/` and the player's files under `/angband/user/` (`-DDEFAULT_*_PATH`, `-DPRIVATE_USER_PATH`, `-DUSE_PRIVATE_PATHS`). The Borg is not compiled in (no `-DALLOW_BORG`).
5. Packs `lib/` (`customize gamedata help screens user`, `tiles/list.txt` and the pref files of the tilesets shipped; not the fonts, sounds, icons or tile sheets) and links a Web Worker module (Asyncify, 64 MiB initial memory with growth, IDBFS). Copies the shipped tile sheets to `dist/tiles/` (only Adam Bolt's, see `LICENSES.md`), the licence texts to `dist/licenses/`, and writes `dist/runtime-manifest.json`.
6. Links the same game objects once more for Node with the C replay host (the conformance harness, not deployed; skip with `ROGUE_ARCHIVE_HARNESS=0`).

Requirements: `git`, `make`, `python3`, `node` ≥ 22. The conformance test also needs a host Clang (`clang`; see `PORTING.md` for why not GCC).

A build takes about half a minute.

## Output

| File | Size | Contents |
|---|---|---|
| `angband.wasm` | 2.1 MB | The game and the display module |
| `angband.mjs` | 85 KB | Emscripten's glue (an ES module factory) |
| `angband-data.data` | 1.3 MB | `lib/` as the game reads it |
| `tiles/adam-bolt.png` | 0.5 MB | Adam Bolt's 16x16 tile sheet, fetched only when tiles are chosen |
| `licenses/` | | Upstream's `copying.rst`, the GPL-2.0 text, the BSD notices of `message.c` and `wiz-stats.c` |

## Reproducibility notes

- The upstream checkout is verified by commit.
- Every build compiles from a clean object directory; the source list comes from upstream's makefiles, so files a new release adds are picked up without editing the script.
- Two consecutive builds give the same `buildId` (checked locally).

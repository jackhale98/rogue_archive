# Building the Sil-Q runtime

```sh
pnpm build:sil             # = games/sil-q/scripts/build.sh
pnpm test:engine:sil       # key coverage + native vs WebAssembly conformance (after a build)
pnpm stage:runtimes        # copy into apps/web/public/runtime/sil-q/<buildId>/
pnpm dev                   # or: pnpm build && pnpm preview
```

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`.
2. Shallow-clones upstream at the tag in `upstream.env` and **fails if the tag does not resolve to the pinned commit**.
3. Resets the checkout to pristine and applies `patches/*.patch` (none today).
4. Reads the source list from upstream's `src/Makefile.std` (`SRCS`), leaves out its display modules (`main-*.c`, `maid-*.c`) and compiles the rest with `port/main-web.c`. The flags select our module through upstream's `main.c` (`-DUSE_GCU -Dinit_gcu=init_web -Dhelp_gcu=help_web`) and place the game data at `/sil/lib/` (`-DDEFAULT_PATH`).
5. Packs `lib/` (`apex data edit pref save user` and `xtra/tutorial`; not the PDF manuals, sounds, bitmap fonts or tile sheets, which a text display doesn't use) and links a Web Worker module (Asyncify, 64 MiB initial memory with growth, IDBFS). Copies the licence and writes `dist/runtime-manifest.json`.
6. Links the same game objects once more for Node with the C replay host (the conformance harness, not deployed; skip with `ROGUE_ARCHIVE_HARNESS=0`).

Requirements: `git`, `make`, `python3`, `node` ≥ 22. The conformance test also needs a host C compiler (`cc`).

A build takes well under a minute: Sil-Q is about 140,000 lines of C.

## Reproducibility notes

- The upstream checkout is verified by commit.
- Every build compiles from a clean object directory; the source list comes from upstream's makefile, so files a new release adds are picked up without editing the script.

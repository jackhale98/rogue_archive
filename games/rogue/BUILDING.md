# Building the Rogue runtime

```sh
pnpm build:rogue           # = games/rogue/scripts/build.sh
pnpm test:engine:rogue     # key coverage + native vs WebAssembly conformance (after a build)
pnpm stage:runtimes        # copy into apps/web/public/runtime/rogue/<buildId>/
pnpm dev                   # or: pnpm build && pnpm preview
```

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`.
2. Shallow-clones upstream at the tag in `upstream.env` and **fails if the tag does not resolve to the pinned commit**.
3. Resets the checkout to pristine and applies `patches/*.patch` (none today).
4. Reads the source list from upstream's `Makefile.std` (`CFILES`) and compiles it with `-DHAVE_CONFIG_H` and `port/` first on the include path, so `port/config.h` and `port/curses.h` are used; adds `port/curses-web.c` and `port/platform.c`.
5. Links a Web Worker module (Asyncify, emulated function pointer casts, 16 MiB initial memory with growth, IDBFS), copies the licence and writes `dist/runtime-manifest.json`. Rogue has no data files.
6. Links the same objects once more for Node with the C replay host (the conformance harness, not deployed; skip with `ROGUE_ARCHIVE_HARNESS=0`).

Requirements: `git`, `make`, `node` ≥ 22. The conformance test also needs a host C compiler (`cc`).

A build takes well under a minute (Rogue is about 16,000 lines of C). The runtime is about 0.33 MB.

## Reproducibility notes

- The upstream checkout is verified by commit.
- Every build compiles from a clean object directory; the source list comes from upstream's makefile.

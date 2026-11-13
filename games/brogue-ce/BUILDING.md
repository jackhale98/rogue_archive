# Building the Brogue CE runtime

```sh
pnpm build:brogue          # = games/brogue-ce/scripts/build.sh
pnpm stage:runtimes        # copy into apps/web/public/runtime/brogue-ce/<buildId>/
pnpm dev                   # or: pnpm build && pnpm preview
```

## What the script does

1. Sources `tools/ensure-emsdk.sh`, which installs the **pinned** Emscripten SDK (`tools/toolchain.env`, currently 6.0.13) into `~/.cache/rogue-archive/emsdk` (override with `ROGUE_ARCHIVE_CACHE`).
2. Shallow-clones upstream at the tag in `upstream.env` and **fails if the tag does not resolve to the pinned commit**.
3. Resets the checkout to pristine and applies `patches/*.patch` (there are none today).
4. Compiles the core-game sources listed by upstream's Makefile (its `sources` and `cflags` with SDL, curses and the web server bridge disabled) plus `port/rogue-archive-platform.c` with `emcc -O2`, then links with Asyncify, a 8 MiB stack (Brogue keeps large grids on the stack), 64 MiB initial memory with growth, IDBFS, and an ES-module factory for a worker environment.
5. Copies `tiles.png` and the upstream license files, then writes `dist/runtime-manifest.json` listing every file with size and SHA-256 and a content-derived `buildId`.

Requirements: `git`, `python3` (used by emsdk), `node` ≥ 22, a POSIX shell. No SDL, ncurses or system Emscripten.

A full build takes about a minute on four cores. The same command runs in CI (`.github/workflows/ci.yml`), which caches the SDK.

## Reproducibility notes

- The upstream checkout is verified by commit, not just tag.
- The toolchain version is pinned; changing it is a reviewed change to `tools/toolchain.env`.
- Two builds of the same inputs on the same toolchain produce the same `buildId` (checked when this port was set up). If they ever differ, treat it as a bug.

## Updating upstream

See [`docs/contributing/updating-a-game.md`](../../docs/contributing/updating-a-game.md), which covers the weekly upstream canary, the drift check and what happens to saves across versions. The source list and include paths come from upstream's own Makefile, so new upstream files need no changes here.

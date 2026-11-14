# Building NetHack for Rogue Archive

```sh
pnpm build:nethack          # games/nethack/scripts/build.sh → games/nethack/dist
pnpm test:engine:nethack    # games/nethack/scripts/test-engine.sh
pnpm stage:runtimes         # copy into apps/web/public/runtime/nethack/<buildId>/
```

The first build takes about a minute and a half; later builds rebuild only what changed (make is incremental) unless the patches, flags or toolchain change.

## What the script does

1. Installs/activates the **pinned** Emscripten SDK (`tools/toolchain.env`) in `~/.cache/rogue-archive/emsdk`.
2. Fetches the pinned upstream commit (`upstream.env`) and **fails if the checkout is not at that commit**; copies it to a build tree and applies `patches/*.patch`.
3. Runs upstream's own setup (`sys/unix/setup.sh hints/linux.500`) and `make fetch-lua` (Lua 5.4.8, checked against upstream's checksum list; kept in the cache afterwards).
4. Generates `src/tile.c` with upstream's `tilemap` (native), then compiles it and the port's glue (`port/rogue-archive-glue.c`) with upstream's own compile flags for the web build (read from the Makefile with `make -n`).
5. Runs upstream's web build, `make CROSS_TO_WASM=1` ("Case sample: Web Assembly" in `Cross-compiling`), with three settings on the command line:
   - `EMCC_CFLAGS`: upstream's, plus `-Wno-unused-but-set-global -Wno-unused-command-line-argument` (two warnings newer compilers add, errors under upstream's `-Werror`) and `-DTILES_IN_GLYPHMAP` (each glyph carries its tile number, as in upstream's tile ports);
   - `HACKDIR=/` (the game data is embedded at the root; upstream's default would bake the builder's home directory into the binary);
   - `HINTOBJ` (the Makefile's place for objects a hints file adds): `tile.o` and the glue, linked by upstream's own link step.
6. Builds upstream's `tile2bmp` (native) and converts its sheet to `tiles.png` (`scripts/bmp-to-png.mjs`).
7. Copies the licences and writes `dist/runtime-manifest.json`.

Requirements: `git`, `make`, a native C compiler, `node` ≥ 22, network access for the first Lua download.

## Size

| File | Size | Compressed (gzip) |
|---|---|---|
| `nethack.wasm` (game data embedded) | about 6.3 MB | 2.2 MB |
| `nethack.mjs` | about 0.09 MB | 0.02 MB |
| `tiles.png` | about 0.08 MB | — |

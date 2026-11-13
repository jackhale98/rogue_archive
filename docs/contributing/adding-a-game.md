# Adding a game

Read [the plan](../plan/implementation-plan.md) §2.3 (feasibility vs readiness), §11 (porting methodology) and §12 (per-game notes) first. Brogue CE (`games/brogue-ce`) is the reference implementation.

## 0. Before writing code

1. Open an issue naming the game and its upstream. Check the expansion order in `games/catalog.json` (`priority`). Brogue CE and DCSS come first.
2. Write **`docs/games/<id>-feasibility.md`**: upstream repository and website; pinned release or commit; language, build system and compiler; native dependencies; renderer and input abstractions; filesystem and save behavior; audio; threads, sockets and timers; data and asset sizes; **existing browser/WASM ports, reproduced from source, with their licenses**; expected runtime size and memory; approach; risks; go/no-go. Answer the three questions separately: can it run, can we redistribute everything, can we make it good.
3. Write **`games/<id>/LICENSES.md`**: an inventory of source code, game data, tiles/sprites, fonts, audio/music, third-party dependencies, documentation/screenshots, and build scripts/generated artifacts. For each: origin, exact version, license, notices, redistribution basis, obligations, shipped or not. Anything uncertain is `BLOCKED — RIGHTS REVIEW REQUIRED` and is not bundled.
4. Check the upstream project's contribution policy before proposing anything upstream.

## 1. Build

- `games/<id>/upstream.env` (repository, tag, **commit**) and `scripts/build.sh` that verifies the commit, applies `patches/*.patch` in order, builds with the pinned toolchain (`tools/toolchain.env`; add a pin if you need another toolchain), and writes `dist/` plus `runtime-manifest.json` through `tools/write-runtime-manifest.mjs`.
- Reproduce the **native** build first. Then make a minimal WASM proof that starts a real game and accepts a real command. Ugly rendering is fine at this stage; fake gameplay is not.
- Prefer a platform/port file over patches. Document every patch in `patches/README.md`.
- Single-threaded only (no COOP/COEP on Pages). Prefer a Web Worker with Asyncify (see ADR 0004).

## 2. Adapter

- `games/<id>/package.json` (with the game's license) exporting a `GameModule` from `adapter/index.ts`.
- Implement `GameAdapter`: verify runtime files against the manifest, report real progress, map keys exactly as upstream does, publish `commands` and a `touchLayout`, implement `persist`/`exportSaves`/`importSaves`, and clean up completely on `shutdown`.
- Register the lazy import in `apps/web/src/app/adapters.ts`. That is the only shared-code change a game should need. If you need more, propose a contract change first.

## 3. Catalog, docs, tests

- Add or update the entry in `games/catalog.json` (`pnpm validate:catalog` enforces the launchable requirements). Start at `prototype`; `experimental` once it is genuinely playable; `playable` only when §15.4 acceptance passes, **including real mobile devices** if touch is advertised.
- `games/<id>/BUILDING.md`, `PORTING.md`, and a cover image you generated from the running game (with provenance in `LICENSES.md`).
- Unit tests for input mapping and anything else pure. Playwright tests that start a real game, play, save, reload and load, and exercise touch if advertised.
- Record download size, memory, startup time and the compatibility matrix.
- Add to `licenses/THIRD_PARTY_NOTICES.md` and `ROADMAP.md`.

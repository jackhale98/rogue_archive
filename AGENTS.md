# Instructions for coding agents

Read this before changing anything. The full plan is [docs/plan/implementation-plan.md](docs/plan/implementation-plan.md). It is authoritative where this file is brief.

## Product principles

- Preserve each original game: rules, balance, procedural generation, permadeath, look. Improve access (input, layout, saving), never the game.
- Static and local-first: no backend, accounts, analytics or telemetry. The landing page never downloads a game runtime.
- Honest status: a game is `playable` only when its acceptance criteria pass. `experimental` means playable with known limitations or limited device coverage.
- **Prefer a small collection of complete, excellent ports over a long list of games.**

## Sequencing

1. Brogue CE: done as `experimental`; outstanding work is real-device testing.
2. DCSS: next. Do not start a third game until DCSS is complete.
3. Then follow the order in `games/catalog.json` (`priority`). ToME and GearHead are watchlist only.

## Repository map

| Path | Contents |
|---|---|
| `apps/web` | The site: library, game detail, play shell, settings (React + Vite). No game-specific code. |
| `packages/game-api` | The adapter contract, lifecycle machine and key normalization. |
| `packages/game-storage` | IndexedDB settings/recent games and the `.roguearchive` save format. |
| `packages/catalog` | Catalog types and helpers (`index.ts`) and the Zod schema (`schema.ts`, tooling and CI only). |
| `games/catalog.json` | Single source of truth for the library. |
| `games/<id>/` | One game: `upstream.env`, `scripts/build.sh`, `port/`, `patches/`, `adapter/`, `tests/`, `BUILDING.md`, `PORTING.md`, `LICENSES.md`. |
| `tools/` | Toolchain pin, emsdk installer, runtime manifest writer, runtime staging, catalog validation. |
| `e2e/` | Playwright tests. |
| `docs/` | Plan, architecture, ADRs, per-game reports, contributor guides, design system. |

## Commands

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm validate:catalog
pnpm build:brogue && pnpm stage:runtimes
ROGUE_ARCHIVE_BASE=/rogue_archive/ pnpm build && pnpm e2e
```

## Architecture rules

- The shared platform must not branch on game ids. Put differences in the adapter or in catalog data. The only per-game line in `apps/web` is the lazy import in `src/app/adapters.ts`.
- Do not add a universal "roguelike engine" abstraction. The contract covers lifecycle, capabilities, input transport, persistence and status, not game semantics.
- Keep game engines off the UI thread where possible (Web Worker). Do not use pthreads/SharedArrayBuffer: GitHub Pages cannot send COOP/COEP headers.
- Runtime files are content-addressed (`runtime/<id>/<buildId>/`) and verified by SHA-256 before use. Never load unlisted remote code.
- Saves live in the game's own virtual filesystem (IndexedDB). Never rewrite a game's save format. Cache cleanup must never touch IndexedDB.

## Licensing rules

- Treat code, data, tiles, fonts, audio, docs, screenshots and build artifacts as separately licensed until verified. Each game needs a complete inventory in `games/<id>/LICENSES.md` before it can be launchable.
- If rights are unclear, mark the game `blocked` with named blockers and stop. Never substitute or bundle uncertain assets.
- Do not submit AI-generated changes upstream unless that project's current policy allows it. Cataclysm: DDA restricts LLM-sourced contributions.

## Porting a game

Follow [docs/contributing/adding-a-game.md](docs/contributing/adding-a-game.md). In short: separate feasibility and license reports first; investigate existing browser ports before writing one; pin source and toolchain; native build before WASM; isolate patches; a compile is not a playable game; record size, memory and compatibility; test on real mobile browsers.

## Honesty rules

- Never claim a test ran unless it ran. In PRs, separate automated checks, manual browser tests and unverified assumptions.
- No fake functionality: no mock gameplay, invented progress percentages or placeholder "playable" states.
- Update `ROADMAP.md`, the catalog's `compatibility` and `knownLimitations`, and the relevant docs in the same change as the code.
- Keep each change scoped to one purpose.

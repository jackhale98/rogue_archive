# CLAUDE.md

Guidance for Claude Code in this repository. The full agent rules are in [AGENTS.md](AGENTS.md); **porting or changing a game? Follow [docs/contributing/porting-playbook.md](docs/contributing/porting-playbook.md)** (Brogue CE is the reference implementation); the plan is [docs/plan/implementation-plan.md](docs/plan/implementation-plan.md); progress is tracked in [ROADMAP.md](ROADMAP.md). Read AGENTS.md before making changes.

## Essentials

- Static, local-first site (React + Vite) hosting independently adapted roguelikes built from **pinned upstream source** to WebAssembly. No backend, accounts or telemetry.
- Shared code (`apps/web`, `packages/*`) must never branch on a game id; game-specific code lives in `games/<id>/` under that game's license (Brogue CE: AGPL-3.0-or-later). Platform code is MIT.
- Order of work: Brogue CE (experimental; needs real-device testing) → DCSS → the `priority` order in `games/catalog.json`. ToME and GearHead are watchlist only.
- Never mark a game `playable` until its acceptance criteria pass; never claim a test ran unless it ran; no upstream submissions of AI-generated changes unless that project allows it.

## Commands

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm validate:catalog
pnpm build:brogue && pnpm stage:runtimes      # WASM build (installs pinned emsdk to ~/.cache/rogue-archive)
pnpm test:engine                              # Brogue conformance: seed catalogs, native vs WASM replay, key coverage, upstream drift (~2 min)
ROGUE_ARCHIVE_UPSTREAM_REF=master pnpm canary:brogue   # try the port against a newer upstream (never deployed)
pnpm dev                                      # http://localhost:5173 (debug hook always on in dev)
ROGUE_ARCHIVE_BASE=/rogue_archive/ pnpm build && pnpm e2e
```

## Testing tips

- E2E tests read the game screen through `window.__rogueArchive.adapter.debug` (dev builds or `?debug` in the URL): `screenText()`, `rowText(y)`, `cellToClient(x, y)`, `inGame`, `playerX/Y`.
- Brogue's `--MORE--` prompts accept Space/Escape/click, not Enter. Dialogs drawn over the map can leave map glyphs in the "spaces" of `screenText()`; match contiguous substrings.
- Service-worker-served requests bypass `page.route`; use `test.use({ serviceWorkers: 'block' })` when intercepting.
- Wait for Brogue to be waiting for input (`waitInGame` checks `debug.context === 'map'`): keys pressed during the level's fade-in only skip the fade.

## Before committing

Run the checks above, update docs/ROADMAP/catalog compatibility in the same change, and end commit messages with the attribution lines the session provides.

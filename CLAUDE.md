# CLAUDE.md

Guidance for Claude Code in this repository. The full agent rules are in [AGENTS.md](AGENTS.md); **porting or changing a game? Follow [docs/contributing/porting-playbook.md](docs/contributing/porting-playbook.md)** (Brogue CE is the reference implementation); the plan is [docs/plan/implementation-plan.md](docs/plan/implementation-plan.md); progress is tracked in [ROADMAP.md](ROADMAP.md). Read AGENTS.md before making changes.

## Essentials

- Static, local-first site (React + Vite) hosting independently adapted roguelikes built from **pinned upstream source** to WebAssembly. No backend, accounts or telemetry.
- Order of work: Brogue CE, DCSS, Sil-Q, Rogue and HyperRogue are `playable` (played on a physical iPhone; Android not yet tested) → the `priority` order in `games/catalog.json`. ToME and GearHead are watchlist only.
- Shared code (`apps/web`, `packages/*`) must never branch on a game id; game-specific code lives in `games/<id>/` under that game's license (Brogue CE: AGPL-3.0-or-later; DCSS: GPL-2.0-or-later; Sil-Q: GPL-2.0-only; Rogue: BSD-3-Clause). Platform code is MIT.
- Never mark a game `playable` until its acceptance criteria pass; never claim a test ran unless it ran; no upstream submissions of AI-generated changes unless that project allows it.

## Commands

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm validate:catalog
pnpm build:brogue && pnpm stage:runtimes      # WASM build (installs pinned emsdk to ~/.cache/rogue-archive)
pnpm test:engine                              # Brogue conformance: seed catalogs, native vs WASM replay, key coverage, upstream drift (~2 min)
pnpm build:dcss && pnpm test:engine:dcss      # DCSS: WASM build with upstream's Makefile (~15-20 min first time); native vs WASM replay
pnpm build:sil && pnpm test:engine:sil        # Sil-Q: WASM build (<1 min); key coverage, native vs WASM replay
pnpm build:rogue && pnpm test:engine:rogue    # Rogue: WASM build (<1 min); key coverage, native vs WASM replay
pnpm build:nethack && pnpm test:engine:nethack     # NetHack: upstream's WASM build (~1.5 min); drift, a game played under Node
pnpm build:hyperrogue && pnpm test:engine:hyperrogue  # HyperRogue: WASM build (~3 min first time); key coverage, drift, native vs WASM seeded games (needs libsdl1.2-dev libgl-dev zlib1g-dev)
ROGUE_ARCHIVE_UPSTREAM_REF=master pnpm canary:brogue   # try the port against a newer upstream (never deployed)
pnpm dev                                      # http://localhost:5173 (debug hook always on in dev)
ROGUE_ARCHIVE_BASE=/rogue_archive/ pnpm build && pnpm e2e
```

## Testing tips

- E2E tests read the game screen through `window.__rogueArchive.adapter.debug` (dev builds or `?debug` in the URL): `screenText()`, `rowText(y)`, `cellToClient(x, y)`, `inGame`, `playerX/Y`.
- Brogue's `--MORE--` prompts accept Space/Escape/click, not Enter. Dialogs drawn over the map can leave map glyphs in the "spaces" of `screenText()` ("Save this#game?and?exit"); `waitForScreenText` lets each space match any character, and other checks should match contiguous substrings.
- Service-worker-served requests bypass `page.route`; use `test.use({ serviceWorkers: 'block' })` when intercepting.
- DCSS: its debug hook is `window.__rogueArchive.adapter.debug` with `context`, `inGame`, `player`, `popups`, `menus`, `text()`; the client is in `iframe.dcss-client` (same origin). DCSS's caches ship prebuilt (build.sh runs `-builddb`; data files are pinned to `DATA_MTIME`).
- Sil-Q: its debug hook has `context`, `inDungeon`, `state`, `screenText()`, `rowText(y)`; Sil's `-more-` takes Space/Escape. `Ctrl+X` saves and shows the scores ("press any key") before the title menu.
- HyperRogue runs on the page (WebGL canvas `canvas.hr-canvas`, no worker); debug hook `context` (map/dialog/over), `state` (treasure, kills, turns, canMove…), `land`, `hover()`, `messages()`, `files()`. Headless Chromium draws it in software at about one frame per second, so tests wait on `state.turns` rather than the screen; it saves only on leaving (the Android app's background save), and resumes a game only with an Orb of Safety or in casual mode, as upstream.
- NetHack: debug hook `context` (map/menu/text/yn/item/direction/getlin/extcmd/more), `prompt`, `menu` (how, title, items), `state`, `tiled`, `screenText()`, `rowText(y)` (on phones, with a menu open, rows 24–47 hold the screen with the menu, rows 0–23 without it), `cellToClient(x, y)`. New characters meet NetHack's own questions (Shall I pick…, role and race menus), the intro text, the starting inventory and 5.0's tutorial question (`toMap` in `e2e/nethack-helpers.ts` gets past them). `S` then `y` saves and ends the session.
- Rogue: debug hook `context`, `inGame`, `state`, `saves`, `screenText()`; the start screen is `.ra-start`. `S` then `y` saves and ends the game (back to the start screen); a restored save is deleted, as in the original.
- Wait for Brogue to be waiting for input (`waitInGame` checks `debug.context === 'map'`): keys pressed during the level's fade-in only skip the fade.

## Before committing

Run the checks above, update docs/ROADMAP/catalog compatibility in the same change, and end commit messages with the attribution lines the session provides.

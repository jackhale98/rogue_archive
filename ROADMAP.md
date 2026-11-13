# Roadmap

Status as of the first implementation pass. The plan is in [docs/plan/implementation-plan.md](docs/plan/implementation-plan.md); this file tracks progress against it.

## Phase 0 — Repository setup ✅

- [x] pnpm monorepo, TypeScript strict, ESLint, Prettier, Vitest, Playwright
- [x] `AGENTS.md`, `ROADMAP.md`, architecture overview, ADRs, revised plan
- [x] CI workflow (checks, Brogue build, e2e) and GitHub Pages deploy workflow
- [ ] Enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and verify the deployed URL

## Phase 1 — Product shell and design system ✅

- [x] Library: featured game, search, interface/touch filters, recently played, roadmap, watchlist
- [x] Game detail: provenance, controls, preferences, offline download, compatibility, limitations
- [x] Settings: theme, text size, on-screen controls, handedness, motion, clear local data
- [x] PWA manifest, icons, service worker (offline app shell and per-game runtime cache)
- [x] Design tokens (dark/light) and responsive layouts

## Phase 2 — Common runtime and persistence ✅

- [x] Versioned game API (`GAME_API_VERSION = 1`), lifecycle state machine
- [x] Session host: manifest loading, integrity checks, status and errors, input routing, persist on hide/exit
- [x] Touch control primitives (pad with hold-to-repeat, action buttons, command list, on-screen keyboard)
- [x] IndexedDB settings and recent games; `.roguearchive` save export/import format
- [ ] A fake adapter for platform contract tests (the Brogue adapter currently exercises the contract end to end)

## Phase 3 — Brogue CE 🟡 experimental

- [x] Feasibility and license reports
- [x] Pinned, reproducible WASM build with no upstream patches
- [x] WebGL2 renderer from Brogue's tile sheet (text, tiles and hybrid modes)
- [x] Keyboard, mouse and touch input; preview-then-act taps; zoom that follows the player
- [x] Saves with crash recovery; export/import
- [x] Automated e2e coverage in desktop Chromium and mobile emulation
- [x] Engine conformance in CI: upstream seed catalogs (3 variants) reproduced exactly; native-vs-WASM replay of saves; source-driven key coverage
- [x] Saves interchangeable with desktop Brogue CE 1.15.1 (download/import plain `.broguesave`)
- [x] Content-aware zoom (keeps descriptions, menus and dialogs in view) and a pinned message strip
- [x] Phone layout: full-bleed map with pinch zoom and pan, status band (health, hunger, depth, messages), menus as sheets, descriptions as peek cards, sidebar drawer, immersive shell (see docs/design/mobile-play.md)
- [x] Context-aware dock (exploring, targeting, --MORE--, yes/no, menus, busy) with long-press fans; floating thumb pad; optional vibration
- [x] Scrollable message log (Brogue's full history, colors, turns) as a platform feature; map no longer shows lifted text boxes
- [ ] Try it on real phones; tune default map size, dock contents and fan timing from that feedback
- [ ] iPhone: one-time "Add to Home Screen" hint for full screen
- [x] Update safety: build reads upstream's Makefile; drift check; weekly canary against latest release and development branch
- [ ] Before the next minor Brogue release: decide whether to keep the previous build playable for unfinished saves
- [ ] **Test on physical iOS Safari and Android Chrome**, then fill in the compatibility table
- [ ] Test Firefox and desktop Safari
- [ ] Measure peak memory and startup time on a mid-range phone
- [ ] Promote to `playable` once the above pass

## Phase 4 — Dungeon Crawl Stone Soup ⏭ next

- [ ] Feasibility report (existing community WASM work, console vs tiles, prompts and menus)
- [ ] License/provenance report (per-file code licenses, tiles)
- [ ] Native build, then minimal WASM proof
- [ ] Adapter, rendering, controls, saves, tests
- [ ] Confirm Brogue CE needed no DCSS-specific changes

## Phase 5 — First public release

- [ ] Pages deployment verified at the real URL
- [ ] At least one game `playable`
- [ ] Device compatibility matrix filled from real devices

## Phase 6 — Catalog expansion (after DCSS)

Sil-Q → Rogue 5.4.4 → HyperRogue → NetHack 5.0.0 → Angband → DRL → Allure of the Stars → Cataclysm: DDA (reproduce upstream's Emscripten build first) → Shattered Pixel Dungeon → IVAN → Infra Arcana.
Watchlist: ToME (asset licensing), GearHead (noncommercial assets).

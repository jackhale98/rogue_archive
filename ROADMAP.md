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
- [x] Description cards: compact, outlined, placed so they never cover the player or the described cell; tap to dismiss; --MORE-- boxes no longer dim the map
- [x] Porting playbook (docs/contributing/porting-playbook.md) capturing the Brogue patterns as the standard for future games
- [x] Descriptions on phones: full-screen reader with re-flowed, colored text (long-press opens; Brogue-initiated boxes offer a "Read" chip instead of covering the map)
- [x] Latching Shift on touch (item details in menus, running, reverse target cycling); scrollable reader with edge shadows
- [x] Phone item details: the sheet shows only the chosen item's panel; the dock offers its actions (apply/equip/remove/throw/drop, relabel/call) and item stepping
- [x] Phone title screen: large buttons for new game, loading saves (a list with dates), recordings, scores, variant and mode
- [ ] Try it on real phones; tune default map size, dock contents and fan timing from that feedback
- [ ] iPhone: one-time "Add to Home Screen" hint for full screen
- [x] Update safety: build reads upstream's Makefile; drift check; weekly canary against latest release and development branch
- [ ] Before the next minor Brogue release: decide whether to keep the previous build playable for unfinished saves
- [ ] **Test on physical iOS Safari and Android Chrome**, then fill in the compatibility table
- [ ] Test Firefox and desktop Safari
- [ ] Measure peak memory and startup time on a mid-range phone
- [ ] Promote to `playable` once the above pass

## Phase 4 — Dungeon Crawl Stone Soup 🟡 experimental

- [x] Feasibility report (prior WASM work, console vs local tiles vs WebTiles, prompts and menus): docs/games/dcss-feasibility.md
- [x] License/provenance report, including bundled libraries, the WebTiles client and the DejaVu fonts (license extracted from the fonts at build time)
- [x] Native build, then WASM build: 0.34.1 built unmodified by upstream's own Makefile (cross-compiling mode); headless WebTiles with the socket replaced by the worker; no patches
- [x] Upstream's own WebTiles client, version-matched, in a frame (ADR 0012); start screen for saved and new characters
- [x] Saves in IndexedDB (IDBFS autoPersist), export/import; `.cs` saves interchangeable with desktop DCSS 0.34
- [x] Phone layout: status band, stats drawer, minimap popup button, full-frame popups and menus, shorter message pane, long-press to describe a square
- [x] Action structure for DCSS's ~70 commands: six-button dock with long-press fans, thumb pad with Run latch, context docks (menus, --more--, yes/no, item prompts, text, targeting, level map), full palette (docs/design/mobile-play.md#dcss)
- [x] Message log from DCSS's message stream (colours, rollbacks)
- [x] Engine conformance: key coverage against `cmd-keys.h`; upstream drift check; native (clang + libc++) vs WebAssembly replay of seeded games through the same platform interface, message for message
- [x] e2e: desktop (new character, auto-explore, log, menus, save, reload, continue) and phone (tap creation, status drawer, dock, fans)
- [x] CI build (cached), weekly canary for both games
- [x] Confirm Brogue CE needed no DCSS-specific changes (shared code changed only to register the adapter; one e2e file renamed)
- [ ] Pinch zoom of the map on phones (upstream's viewport scale)
- [x] Progress screen while DCSS starts (first launch builds its caches); character creation in one column on phones
- [x] DCSS's level and database caches built at build time and shipped (first launch ~1 s instead of a minute on phones; building them crashed iOS Safari)
- [ ] Test on physical phones, Firefox and Safari; measure memory and startup
- [ ] Promote to `playable` once the above pass

## Phase 6a — Sil-Q 🟡 experimental

- [x] Feasibility report: docs/games/sil-q-feasibility.md
- [x] License/provenance report (GPL-2.0-only of upstream's GPL-2.0-or-Angband-licence offer; graphics, sounds and fonts with other terms not shipped)
- [x] WASM build of v1.5.0 with no patches: a browser display module for Sil's term interface, selected through upstream's unchanged `main.c`
- [x] Shared terminal renderer for text-grid games (`packages/term-view`, MIT): views, follow-the-player map, hit-testing, tap/long-press/pan/pinch
- [x] Saves in IndexedDB (lib/save, apex, user), export/import; savefiles interchangeable with desktop Sil-Q 1.5
- [x] Phone layout: status band, map around the player with pinch zoom, lists as tappable sheets
- [x] Context docks: title and creation choices as buttons, saved characters as Continue buttons, item prompts (letters, then named items), -more-, yes/no, direction, look/target, text, menus
- [x] Message log (Sil's repeated messages merged, not duplicated)
- [x] Engine conformance: key coverage against `process_command` and the keymaps; native vs WebAssembly replay of seeded games (screens, messages and savefiles identical)
- [x] e2e: desktop (new character, item prompt, log, save, reload, continue) and phone (title buttons, tap creation, item dock, palette, continue)
- [x] CI build, deploy, weekly canary
- [ ] Test on physical phones, Firefox and Safari
- [ ] Promote to `playable` once the above pass

## Phase 6b — Rogue 5.4.4 🟡 experimental

- [x] Feasibility report: docs/games/rogue-feasibility.md
- [x] License/provenance report (BSD-3-Clause 5.4.4 source release, three notices retained)
- [x] WASM build with no patches: a small curses written for the port (windows as data, as Rogue needs), a browser `config.h`, the browser's "user" for the home directory, emulated K&R function pointer casts
- [x] Shared start screen for games started by name (`packages/start-screen`, MIT); curses standout as reverse video in `packages/term-view`
- [x] Saves in IndexedDB (/rogue: savefiles, scoreboard), export/import; classic semantics (saved with S, removed on restore)
- [x] Phone layout: status band, map around the hero with pinch zoom, lists as tappable sheets, long-press to identify a symbol
- [x] Context docks: --More--, scores, yes/no, direction, item prompts, lists, text
- [x] Engine conformance: key coverage against `command.c`; native vs WebAssembly replay (screens, scoreboard and savefiles identical)
- [x] e2e: desktop (moves, inventory, item prompt, log, save, reload, continue) and phone (band, pad, dock, sheet, direction prompt)
- [x] CI build, deploy, weekly canary
- [ ] Test on physical phones, Firefox and Safari
- [ ] Promote to `playable` once the above pass

## Phase 5 — First public release

- [ ] Pages deployment verified at the real URL
- [ ] At least one game `playable`
- [ ] Device compatibility matrix filled from real devices

## Phase 6 — Catalog expansion (after DCSS)

~~Sil-Q~~ (experimental, Phase 6a) → ~~Rogue 5.4.4~~ (experimental, Phase 6b) → HyperRogue → NetHack 5.0.0 → Angband → DRL → Allure of the Stars → Cataclysm: DDA (reproduce upstream's Emscripten build first) → Shattered Pixel Dungeon → IVAN → Infra Arcana.
Watchlist: ToME (asset licensing), GearHead (noncommercial assets).

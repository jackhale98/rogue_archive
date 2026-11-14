# Roadmap

Status as of the first implementation pass. The plan is in [docs/plan/implementation-plan.md](docs/plan/implementation-plan.md); this file tracks progress against it.

## Phase 0 — Repository setup ✅

- [x] pnpm monorepo, TypeScript strict, ESLint, Prettier, Vitest, Playwright
- [x] `AGENTS.md`, `ROADMAP.md`, architecture overview, ADRs, revised plan
- [x] CI workflow (checks, Brogue build, e2e) and GitHub Pages deploy workflow
- [ ] Enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and verify the deployed URL

## Phase 1 — Product shell and design system ✅

- [x] Offline from the library: a download button on each game card (download, progress, available offline) and Download all (library and Settings)
- [x] Library: continue playing (last played), game cards with Play and Details (compact rows on phones), the next roadmap games with the full roadmap and watchlist folded; search and interface/touch filters once eight or more games are playable
- [x] Game detail: provenance, controls, preferences, offline download, compatibility, limitations
- [x] Settings: theme, text size, on-screen controls, handedness, motion, clear local data
- [x] PWA manifest, icons, service worker (offline app shell and per-game runtime cache)
- [x] Design tokens (dark/light) and responsive layouts

## Phase 2 — Common runtime and persistence ✅

- [x] Versioned game API (`GAME_API_VERSION = 1`), lifecycle state machine
- [x] Session host: manifest loading, integrity checks, status and errors, input routing, persist on hide/exit
- [x] Touch control primitives (pad with hold-to-repeat, action buttons, command list, on-screen keyboard)
- [x] IndexedDB settings and recent games; `.roguearchive` save export/import format
- [x] Ask for persistent storage once a game runs; Settings → Keeping your saves (status, space used, Safari's 7-day rule and the Home Screen app)
- [ ] Optional cloud sync of saves to the player's own Dropbox or OneDrive (browser-only OAuth with PKCE, app folder; see docs/architecture/storage.md)
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
- [x] Touch controls audit (docs/design/controls-audit.md): palette no longer offers `y`/`n` (they move diagonally); five-turn search (Ctrl+S) and Look (Tab) by touch; "Go ↓/↑" once the stairs route is shown, Stairs after exploring; a danger dock (Fight, Throw again in one tap; never Rest/Search as the lead); Eat leads when Hungry; search progress; Rest until better vs Rest 100 named by what `Z` will do; Throw/Zap/Go on the targeting dock; a recording-playback dock; every touch command checked against upstream's key handlers
- [x] Played on a real iPhone (iOS Safari), November 2026: all five games playable
- [ ] Tune default map size, dock contents and fan timing from real-phone feedback (continuing)
- [ ] iPhone: one-time "Add to Home Screen" hint for full screen
- [x] Update safety: build reads upstream's Makefile; drift check; weekly canary against latest release and development branch
- [ ] Before the next minor Brogue release: decide whether to keep the previous build playable for unfinished saves
- [x] Played on a physical iPhone (iOS Safari); compatibility table updated
- [ ] Test on Android Chrome
- [ ] Test Firefox and desktop Safari
- [ ] Measure peak memory and startup time on a mid-range phone
- [x] Promoted to `playable` (played on a physical iPhone, November 2026)

## Phase 4 — Dungeon Crawl Stone Soup 🟡 experimental

- [x] Feasibility report (prior WASM work, console vs local tiles vs WebTiles, prompts and menus): docs/games/dcss-feasibility.md
- [x] License/provenance report, including bundled libraries, the WebTiles client and the DejaVu fonts (license extracted from the fonts at build time)
- [x] Native build, then WASM build: 0.34.1 built unmodified by upstream's own Makefile (cross-compiling mode); headless WebTiles with the socket replaced by the worker; no patches
- [x] Upstream's own WebTiles client, version-matched, in a frame (ADR 0012); start screen for saved and new characters
- [x] Saves in IndexedDB (IDBFS autoPersist), export/import; `.cs` saves interchangeable with desktop DCSS 0.34
- [x] Phone layout: status band, stats drawer, minimap popup button, full-frame popups and menus, shorter message pane, long-press to describe a square
- [x] Action structure for DCSS's ~70 commands: six-button dock with long-press fans, thumb pad with Run latch, context docks (menus, --more--, yes/no, item prompts, text, targeting, level map), full palette (docs/design/mobile-play.md#dcss)
- [x] Message log from DCSS's message stream (colours, rollbacks)
- [x] Touch controls from the controls audit (docs/design/controls-audit.md): combat dock when hostile monsters are in view (read from the client's own map, as upstream's monster list does; "Fire: *quiver*"; no Explore or Rest), stairs button from what is underfoot (Down/Up/Pray/Shop/Enter/Exit, else Travel), Orb or Zot → stairs first, Ability leads for non-casters, separate aim/look/direction docks, menu docks by tag (travel, pick up and multi-select, spells and abilities, yes/no with Always), Str/Int/Dex buttons at level-up, Attack latch (Ctrl+direction), quiver cycling, add macro, save now
- [x] Engine conformance: key coverage against `cmd-keys.h` (and the keys prompts read themselves); upstream drift check (including what the touch controls read); native (clang + libc++) vs WebAssembly replay of seeded games through the same platform interface, message for message
- [x] e2e: desktop (new character, auto-explore, log, menus, save, reload, continue) and phone (tap creation, status drawer, dock, fans, stairs button, look dock, Attack latch, Ability for a Fighter, travel menu dock, combat dock when a monster comes into view)
- [x] CI build (cached), weekly canary for both games
- [x] Confirm Brogue CE needed no DCSS-specific changes (shared code changed only to register the adapter; one e2e file renamed)
- [ ] Pinch zoom of the map on phones (upstream's viewport scale)
- [x] Progress screen while DCSS starts (first launch builds its caches); character creation in one column on phones
- [x] DCSS's level and database caches built at build time and shipped (first launch ~1 s instead of a minute on phones; building them crashed iOS Safari)
- [ ] Test on physical phones, Firefox and Safari; measure memory and startup
- [x] Promoted to `playable` (played on a physical iPhone, November 2026)

## Phase 6a — Sil-Q 🟡 experimental

- [x] Feasibility report: docs/games/sil-q-feasibility.md
- [x] License/provenance report (GPL-2.0-only of upstream's GPL-2.0-or-Angband-licence offer; graphics, sounds and fonts with other terms not shipped)
- [x] WASM build of v1.5.0 with no patches: a browser display module for Sil's term interface, selected through upstream's unchanged `main.c`
- [x] Shared terminal renderer for text-grid games (`packages/term-view`, MIT): views, follow-the-player map, hit-testing, tap/long-press/pan/pinch
- [x] Saves in IndexedDB (lib/save, apex, user), export/import; savefiles interchangeable with desktop Sil-Q 1.5
- [x] Phone layout: status band, map around the player with pinch zoom, lists as tappable sheets
- [x] Context docks: title and creation choices as buttons, saved characters as Continue buttons, item prompts (letters, then named items), -more-, yes/no, direction, look/target, text, menus
- [x] Message log (Sil's repeated messages merged, not duplicated)
- [x] Touch controls from the controls audit: docks per situation (exploring, monsters in view, adjacent, low health) and context leads (stairs, forge, object or Iron Crown underfoot, fleeing with a Silmaril, an affordable ability) from new read-only snapshot fields; song prompt as song buttons; a target offered only at aim prompts; long-press looks at the pressed cell; status band shows stealth, song, hunger and conditions; buttons keep their meaning under the hjkl/Angband keysets (Sil's keymap bypass)
- [x] Engine conformance: key coverage against `process_command` and the keymaps; native vs WebAssembly replay of seeded games (screens, messages and savefiles identical)
- [x] e2e: desktop (new character, item prompt, log, save, reload, continue) and phone (title buttons, tap creation, item dock, palette, continue; tutorial: leads, song buttons, status band, direction dock, long-press look)
- [x] CI build, deploy, weekly canary
- [ ] Test on physical phones, Firefox and Safari
- [x] Promoted to `playable` (played on a physical iPhone, November 2026)

## Phase 6b — Rogue 5.4.4 🟡 experimental

- [x] Feasibility report: docs/games/rogue-feasibility.md
- [x] License/provenance report (BSD-3-Clause 5.4.4 source release, three notices retained)
- [x] WASM build with no patches: a small curses written for the port (windows as data, as Rogue needs), a browser `config.h`, the browser's "user" for the home directory, emulated K&R function pointer casts
- [x] Shared start screen for games started by name (`packages/start-screen`, MIT); curses standout as reverse video in `packages/term-view`
- [x] Saves in IndexedDB (/rogue: savefiles, scoreboard), export/import; classic semantics (saved with S, removed on restore)
- [x] Phone layout: status band, map around the hero with pinch zoom, lists as tappable sheets, long-press to identify a symbol
- [x] Context docks: --More--, scores, yes/no, direction, item prompts, lists, text
- [x] Map leads from new read-only fields (stairs, Amulet, hunger, object underfoot, armour, hallucination) and the screen: one-tap "Fight ↖B", Throw at a floating eye, Take off near an aquator; Search/Rest ×10 and the careful run in the Search fan; item lists shown at once from the dock
- [x] Engine conformance: key coverage against `command.c`; native vs WebAssembly replay (screens, scoreboard and savefiles identical)
- [x] e2e: desktop (moves, inventory, item prompt, log, save, reload, continue) and phone (band, pad, dock, sheet, direction prompt)
- [x] CI build, deploy, weekly canary
- [x] Display: Tiles setting (CC0 RLTiles-based tiles from crawl/tiles, pinned; each tile listed in LICENSES.md)
- [x] Display: 1-Bit setting (Kenney's CC0 1-Bit Pack, pinned by SHA-256; one sheet cut and tinted in the page)
- [ ] Test on physical phones, Firefox and Safari
- [x] Promoted to `playable` (played on a physical iPhone, November 2026)

## Phase 6c — HyperRogue 13.1p 🟡 experimental

- [x] Feasibility report: docs/games/hyperrogue-feasibility.md
- [x] License/provenance report (GPL-2.0-or-later; built-in font table from DejaVu Sans Bold; music and sounds not shipped)
- [x] WASM build with no patches: upstream's own web build (`hyperweb.cpp`), saving and config switched on with upstream's `CAP_` switches, a fixed command line; pinned zlib built from git
- [x] Runs on the page (not a worker): canvas sized to the shell's area at up to 2x device pixels; listeners removed and the GL context released on exit
- [x] Touch play modelled on upstream's mobile version: tap to move, slide to choose, long-press for help; dock (centre, wait, target, quest, menu) and thumb pad
- [x] Contextual touch controls (controls audit): Aim toggle with a ranged orb (upstream's "touch for ranged" mode) and the orb a tap would use; Inspect ("touch for info"); crossbow Fire toggle with Esc relabelled; Drop only with Dead Orbs; Orbs `i` in Orb Strategy; Mark `m` in the Minefield; `t` only with strong wind; Orb of Safety hint; Wait only on the pad
- [x] Score file and config in IndexedDB; the Android app's background save when the page is left; export/import (desktop `hyperrogue.log`)
- [x] Message log from the game's own log
- [x] Engine conformance: key coverage against `control.cpp`, upstream drift, native vs WebAssembly seeded games (3 seeds × 400 turns identical)
- [x] e2e: desktop (start, moves, quest screen, log, score file import kept across reloads) and phone (dock, tap to move, long-press help, Inspect mode, pad)
- [x] CI build, deploy, weekly canary
- [ ] Explain seed 7's divergence (one monster's tie-break after 324 turns)
- [ ] Measure frame rate on physical phones; test on Firefox and Safari
- [x] Promoted to `playable` (played on a physical iPhone, November 2026)

## Phase 6d — NetHack 5.0.0 🟡 experimental

- [x] Feasibility report: docs/games/nethack-feasibility.md
- [x] License/provenance report (NetHack General Public License for the game, its data and its tiles; Lua MIT)
- [x] WASM build: upstream's own web build (`make CROSS_TO_WASM=1`, the shim window port) from the pinned release; one patch so its web main file links at 5.0.0; `TILES_IN_GLYPHMAP` and upstream's generated `tile.c`, as its tile ports
- [x] Window port in the worker, answering the shim's calls as tty draws them: map, message line, two status lines, menus and text windows (paged, tty's keys), prompts, typed lines and extended commands, map clicks
- [x] Text or NetHack's own tiles (upstream's `tile2bmp` sheet)
- [x] Phone layout: status band (this turn's messages, up to three lines), map following the hero (pinch, drag), menus and text windows as large tappable sheets
- [x] Controls audit and design (docs/design/nethack-controls.md): the game's own context menus first
- [x] Map gestures: tap a cell (NetHack's `mouseaction`: travel, move, attack, open), tap the hero (`#herecmdmenu`), long-press next to the hero (`#therecmdmenu`), long-press farther away (farlook); the mouse buttons bound in `~/.nethackrc`
- [x] Context-aware dock from read-only glue (what the player sees and knows): exploring (a lead for stairs, objects, altars, fountains, thrones, hunger, shops, burden, Enhance), fighting (one-tap Fight and Fire at the monster, Cast or Zap, Quaff, Elbereth), trouble (Pray, Quaff, Elbereth, Flee)
- [x] Prompt docks: yes/no answers; item prompts (the suitable items at once, or a button each for up to three); directions (At the monster, self, up, down); positions (Select, Monster, Stairs, Yourself, tap to choose); the Elbereth engraving answered; --More-- continues by itself unless set to wait
- [x] Saves and scores in IndexedDB; save and continue as the same character; export/import; the leave dialog's Save and leave
- [x] Engine checks: upstream drift (shim calls, formats, structures); a game played under Node with the port's window port (creation, map, status, inventory, save, continue)
- [x] e2e: desktop (creation, map and status, inventory, tiles, save and continue after reload) and phone (creation by taps, band, sheets, dock, travel by tap, tiles; tap the hero, long-press, item buttons, travel by position, Elbereth)
- [x] CI build, deploy, weekly canary (latest release and the NetHack-5.0 branch)
- [ ] Native vs WebAssembly comparison of seeded games; key coverage against `cmd.c`
- [ ] Test on physical phones, Firefox and Safari
- [ ] Promote to `playable` once the above pass

## Phase 5 — First public release

- [ ] Pages deployment verified at the real URL
- [x] At least one game `playable`
- [ ] Device compatibility matrix filled from real devices

## Phase 6 — Catalog expansion (after DCSS)

~~Sil-Q~~ (experimental, Phase 6a) → ~~Rogue 5.4.4~~ (experimental, Phase 6b) → ~~HyperRogue~~ (Phase 6c) → ~~NetHack 5.0.0~~ (experimental, Phase 6d) → Angband → DRL → Cataclysm: DDA (reproduce upstream's Emscripten build first) → Shattered Pixel Dungeon → IVAN → Infra Arcana.
Watchlist: ToME (asset licensing), GearHead (noncommercial assets).

# Rogue Archive — Implementation Plan and Agent Handoff

> **Revision 2.** This revision replaces the candidate catalog and expansion order, separates technical feasibility from release readiness, records the Cataclysm: DDA browser-build discovery, strengthens licensing requirements, clarifies the purpose of the architecture and updates the agent instructions. Revision 1's architecture is otherwise unchanged. Current implementation status lives in [`ROADMAP.md`](../../ROADMAP.md), not here.

> **Purpose:** Build a polished, open-source, static-hosted library of classic roguelikes that can be played in modern desktop and mobile browsers.
>
> **Project name:** Rogue Archive (working name)
>
> **Initial hosting:** GitHub Pages from a public GitHub repository
>
> **Product promise:** Discover and play classic roguelikes in the browser. No account, backend, subscription, or native installation required. Games run locally in the browser; saves stay on the player's device unless explicitly exported.
>
> **Audience:** People who love classic roguelikes, newcomers discovering the genre, and contributors who want to port additional games.

---

## 0. Instructions to the implementation agent

You are the lead engineer responsible for planning and implementing Rogue Archive. Work autonomously, but do not sacrifice correctness, maintainability, game authenticity, or licensing compliance for speed.

### Non-negotiable principles

1. **Do not rewrite game engines or gameplay.** Prefer building the original upstream game from source and adapting its platform, input, rendering, and persistence boundaries.
2. **Do not pretend a game is playable when only its title screen or a mock interface works.** A port is not complete until its acceptance tests pass.
3. **Do not force every game into identical mechanics or controls.** Share infrastructure, not game-specific semantics.
4. **Keep upstream source provenance clear.** Pin upstream versions/commits, isolate patches, document build steps, and make updates reproducible.
5. **Treat code, game data, graphics, fonts, sound, music, and documentation as separately licensed until verified otherwise.** A source-code license does not automatically grant rights to every asset.
6. **Do not download or redistribute proprietary game assets, binaries, or add-ons.** If distribution rights are unclear, stop and report the blocker. Do not silently substitute assets.
7. **Do not submit AI-generated contributions to upstream game projects unless that project's current contribution policy permits them.** In particular, inspect each upstream project's current rules before proposing upstream PRs. Cataclysm: Dark Days Ahead currently has contribution guidance restricting LLM-sourced contributions; keep this project's porting patches in Rogue Archive and do not submit them upstream unless its policy changes and maintainers permit it.
8. **Do not add a backend.** The first release must work as a static site. No accounts, analytics, telemetry, cloud saves, multiplayer services, or server-side game execution.
9. **Do not block the whole library on one difficult port.** Each game is an independent package with its own build, test, compatibility, and release status.
10. **Keep the site fast.** The landing page must not download game engines, game assets, or large runtime packages until a player chooses a game.
11. **Make progress in small, reviewable increments.** Before major implementation, inspect the repository and existing upstream projects, write findings, and propose a short implementation sequence. Do not generate the entire application in one unreviewable change.
12. **Never claim testing was performed unless it was actually run.** Distinguish automated checks, manual browser tests, and unverified assumptions.
13. **Prefer a small collection of complete, excellent browser ports over a long list of games.** The number of listed games is not a measure of progress.

### Sequencing and porting rules (Revision 2)

- Finish **Brogue CE** before beginning DCSS.
- Finish **DCSS** before expanding the catalog further.
- Investigate existing browser ports (upstream or community) before writing a new one, and reproduce them from source before relying on them.
- Pin every upstream source version and every build toolchain.
- Produce **separate** technical feasibility and licensing/provenance reports for each game.
- Do not treat a successful compilation as a playable game.
- Test on actual mobile browsers, not only desktop emulation; record what was and was not tested.
- Keep game-specific patches isolated in that game's package.
- Record runtime size, memory use and browser compatibility for every build.
- Never mark a game `playable` until its acceptance criteria pass.

### Working method

- First inspect the repository, available tooling, and current official upstream documentation.
- Create `docs/architecture/`, `docs/games/`, `docs/decisions/`, and `licenses/`.
- Maintain an implementation checklist in `ROADMAP.md`.
- Record consequential architectural choices as short Architecture Decision Records (ADRs).
- Before implementing a game, produce a game feasibility report and a license/provenance report.
- Build a vertical slice before generalizing abstractions.
- Ask the project owner only when a decision is genuinely blocking, especially around legal rights, game selection, or a significant product trade-off. Otherwise make conservative, documented decisions.

---

# 1. Product definition

## 1.1 What Rogue Archive is

Rogue Archive is a curated library and browser runtime for classic roguelikes. It provides:

- A beautiful, fast library landing page.
- Search, filtering, game details, screenshots, descriptions, controls, and clear compatibility information.
- A consistent launch and loading experience.
- A common browser shell around independently adapted games.
- Responsive, touch-friendly controls where appropriate.
- Keyboard and mouse support for desktop.
- Local save persistence and save export/import where supported.
- PWA installation and offline caching.
- A documented contribution process for adding or updating games.
- A static deployment that can be hosted on GitHub Pages.

## 1.2 What Rogue Archive is not

The initial project is not:

- A new roguelike game or a rewrite of existing games.
- A universal emulator that promises every native game will run unchanged.
- A multiplayer platform.
- A cloud-save or account service.
- A game mod marketplace.
- A mirror for proprietary game downloads.
- A promise that every listed game is immediately playable.
- A universal visual redesign of each game.

## 1.3 Product principles

### Respect the original game

Preserve the original rules, turn economy, procedural generation, difficulty, permadeath, progression, game data, and intended play style. Do not change game balance to make touch controls easier.

### Improve access, not the game

The platform may improve presentation, input ergonomics, persistence, and discoverability. It should not silently alter the underlying gameplay. Optional quality-of-life features must be clearly identified and, where feasible, configurable.

### Modern outside, authentic inside

The library, navigation, loading screens, settings, and game information should feel like a carefully designed modern product. Once inside a game, its original visual language should remain recognizable. A game may use ASCII, tiles, a custom graphical interface, or a hybrid layout.

### Local-first

A game should run on the user's device. The website should not require an account or transmit game state. Saves and settings should remain local by default.

### Honest compatibility

Show platform, input, persistence, offline, and known limitation information per game. Avoid a generic “works everywhere” claim if a game has not been tested on a particular browser/device class.

---

# 2. Initial game catalog and prioritization

Do not attempt all games simultaneously. Build the platform around a first vertical slice, then add games in deliberate waves.

## 2.1 First two games

| Order | Game | Purpose |
|---|---|---|
| 1 | **Brogue: Community Edition** | First implementation. Validates tile rendering, map interaction, touch controls and responsive gameplay. |
| 2 | **Dungeon Crawl Stone Soup (DCSS)** | Second implementation. Validates terminal and tiles interfaces, complex prompts, menus, targeting and command handling. |

Build the shared platform around the real needs of these two games while keeping the adapter contract general enough for later ports. Do not start a third port until both are complete.

## 2.2 Expansion order after Brogue CE and DCSS

| Priority | Game | Estimated effort | Rationale |
|---:|---|---|---|
| 1 | Sil-Q | Medium | Distinct tactical roguelike; existing browser/WASM work provides a useful starting point. |
| 2 | Rogue 5.4.4 | Low–medium | Small, classic terminal roguelike; relatively straightforward integration. |
| 3 | HyperRogue | Medium–high | Unusual non-Euclidean gameplay and rendering; adds a genuinely different experience. |
| 4 | NetHack 5.0.0 | Medium–high | Genre-defining game; substantial interface and integration work. |
| 5 | Angband | Medium | Mature C codebase and traditional terminal interface. |
| 6 | DRL | Medium–high | Distinctive Doom-inspired roguelike; Pascal runtime and asset considerations. |
| 7 | Cataclysm: Dark Days Ahead | High | Existing upstream Emscripten build workflow, but substantial mobile UX and runtime complexity. |
| 8 | Shattered Pixel Dungeon | High | Excellent mobile-oriented gameplay, but a Java/libGDX porting effort. |
| 9 | IVAN | High | Interesting traditional roguelike with a custom C++ engine. |
| 10 | Infra Arcana | High | Atmospheric roguelike; requires additional runtime and licensing investigation. |

**Watchlist (outside the planned distribution catalog):**

- **Tales of Maj'Eyal (ToME)** — remains outside the planned catalog until its asset licensing is resolved (official graphics, audio and music are licensed for use with ToME only).
- **GearHead** — remains on the watchlist because of noncommercial restrictions on its assets.

These are feasibility candidates, not a declaration that any item is cleared for redistribution. Re-check current upstream repositories, licenses, contribution rules, dependencies and assets at implementation time.

## 2.3 Technical feasibility versus release readiness

An existing browser build is evidence of **feasibility**, not evidence that a game is **ready** for Rogue Archive. Evaluate every candidate independently on:

- Upstream build reproducibility.
- Browser runtime compatibility.
- Rendering and input integration.
- Mobile usability.
- Save persistence and recovery.
- Offline support.
- Runtime size and memory.
- Source-code licensing.
- Asset licensing and provenance.
- Maintenance burden.

Keep three questions separate:

1. **Can the game technically run in a browser?**
2. **Can Rogue Archive legally redistribute everything required to play it?**
3. **Can Rogue Archive deliver a sufficiently polished experience?**

A positive answer to one does not imply positive answers to the others. A game enters the public catalog as launchable only when all three are answered yes and documented.

## 2.4 Game admission states

Every catalog entry must have an explicit status:

- `planned` — candidate only; no implementation claim.
- `researching` — feasibility and licensing investigation in progress.
- `blocked` — a named technical or legal blocker exists.
- `prototype` — can launch, but does not meet full gameplay acceptance criteria.
- `playable` — required functionality and tests pass.
- `experimental` — playable, but with known limitations or limited device coverage.
- `deprecated` — retained for existing saves/documentation but not recommended for new play.

Do not show `planned`, `researching`, or `blocked` games as playable. It is acceptable to display a roadmap section separate from the playable library.

---

# 3. User experience and visual direction

## 3.1 Design concept

The site should feel like a premium digital archive or curated game library: restrained, atmospheric, tactile, and fast. Avoid a generic admin dashboard, an overly nostalgic pixel-art website, or a noisy storefront.

Suggested visual direction:

- Deep ink/charcoal background with warm paper or parchment surfaces for contrast.
- A restrained accent color (amber, copper, or muted gold) used for calls to action and selection.
- Large, expressive game artwork or screenshots.
- Elegant typography: a characterful display face paired with a highly readable sans-serif.
- Subtle borders, careful spacing, and restrained animation.
- No excessive gradients, glassmorphism, shadows, badges, or decorative UI.
- Strong light/dark contrast and accessible focus states.
- Motion should be purposeful and respect `prefers-reduced-motion`.

The visual identity should support a broad library. Do not make the whole product look like one specific game's interface.

## 3.2 Primary screens

### A. Landing / library page

Must include:

- Rogue Archive identity and concise product description.
- A featured game or rotating editorial feature that does not cause layout shift.
- A responsive game grid with cover image, title, short description, genre/tags, and playability status.
- Search.
- Filters such as playable status, interface style (ASCII/tiles/graphical), and input support.
- Recently played games, stored locally.
- A small “About this archive” and contribution link.
- No login or account prompt.

The initial page should be usable before any game runtime has been downloaded.

### B. Game detail page or panel

Include:

- Game title, short pitch, screenshots, and original project attribution.
- Developer/community and upstream project link.
- Upstream version/commit used by the port.
- Game-specific controls, including keyboard and touch mappings.
- Compatibility and known limitations.
- Offline availability/download state.
- Save support and save export/import support.
- License and asset credits.
- A prominent Play/Resume button.

### C. Launch/loading experience

- Display the selected game's identity and a concise status.
- Show meaningful stages: downloading game files, initializing runtime, loading game data, restoring save, ready.
- Provide progress only when actual progress is measurable. Do not invent a percentage.
- Permit cancellation and return to the library.
- Handle network failure, corrupt cache, unsupported browser features, and out-of-memory failures with actionable messages.
- Do not show a fake progress animation that implies work is occurring when it is not.
- Load each game's assets only when needed.

### D. In-game shell

The shared shell may provide:

- Exit/back-to-library action.
- Save status and save/export menu.
- Fullscreen toggle when supported.
- Help/controls overlay.
- Settings for shell-level behavior.
- Optional virtual keyboard.
- Optional haptics only when supported and explicitly enabled.

The game itself owns the game screen, gameplay state, menus, and game-specific commands. Do not place a generic RPG HUD over every game.

### E. Settings

- Theme: system/light/dark if appropriate.
- Text size and interface scale.
- Sound preference, if the game adapter supports it.
- Haptics preference.
- Reduced motion.
- Default input preference.
- Save export/import and local data management.
- Per-game settings should be namespaced and must not overwrite one another.

## 3.3 Responsive behavior

Design and test at minimum:

- Small phone portrait: approximately 360–390 CSS px wide.
- Large phone portrait.
- Phone landscape.
- Tablet portrait and landscape.
- Laptop/desktop at 1280 px and above.

Use responsive layouts, safe-area insets, dynamic viewport units, and touch targets appropriate for mobile. Avoid fixed layouts that assume a physical keyboard.

For gameplay, allow each adapter to select a layout strategy:

- `terminal-fit`: fit a fixed character grid to the available viewport.
- `tile-map`: map-first interface with responsive panels.
- `native-canvas`: game-controlled canvas or graphical scene.
- `custom`: game-specific layout.

Do not force a graphical game into a terminal layout or vice versa.

## 3.4 Accessibility

- Semantic HTML for the library and menus.
- Keyboard navigability and visible focus.
- Accessible names for icon-only controls.
- Sufficient color contrast.
- Respect reduced-motion settings.
- Do not rely on color alone to convey game status.
- Support browser zoom and text scaling in the site shell.
- Make touch controls usable without requiring precise gestures.
- Gestures must have an alternative button or keyboard action.
- Game-specific accessibility limitations must be documented honestly.

---

# 4. Technical architecture

## 4.1 Architectural rule: shared platform, independent game adapters

The platform should provide reusable infrastructure, but each game should remain an independent integration.

Do not create one universal “roguelike engine” abstraction. Games have different rendering models, input models, command systems, timing behavior, save formats, and runtime requirements.

The shared contract should cover lifecycle, capabilities, host integration, and persistence—not pretend all games share the same game semantics.

## 4.2 Suggested technology stack

Choose boring, well-supported technologies:

- **Frontend:** TypeScript.
- **UI:** React with Vite, or another small component-based framework if the repository already has a clear preference. Prefer React + Vite unless there is a compelling reason not to.
- **Styling:** CSS Modules or a small design-token-based CSS system. Avoid a large UI component framework unless it demonstrably helps.
- **Routing:** Static-compatible client-side routing, or simple path/hash routing. Ensure GitHub Pages deep links work with a fallback strategy.
- **Build:** Vite.
- **Game runtimes:** Emscripten/WebAssembly where practical; other WebAssembly toolchains or JavaScript ports where appropriate.
- **Persistence:** IndexedDB. Emscripten IDBFS may be used for a game's virtual filesystem, with explicit synchronization and recovery handling.
- **PWA:** Web App Manifest and service worker; use a small, well-maintained library or hand-written service worker rather than unnecessary complexity.
- **Tests:** Vitest for unit tests; Playwright for browser end-to-end tests.
- **Lint/format/type checking:** ESLint, Prettier, TypeScript strict mode.
- **CI/CD:** GitHub Actions.
- **Hosting:** GitHub Pages.

Do not introduce a backend, database server, API server, or hosted authentication provider.

## 4.3 Repository structure

Start with a monorepo so shared interfaces, design components, game metadata, build tooling, and CI remain coordinated.

```text
rogue-archive/
├── apps/
│   └── web/
│       ├── public/
│       │   ├── icons/
│       │   ├── screenshots/
│       │   └── manifest.webmanifest
│       ├── src/
│       │   ├── app/
│       │   ├── routes/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── library/
│       │   │   ├── game-details/
│       │   │   ├── game-launch/
│       │   │   ├── game-shell/
│       │   │   ├── settings/
│       │   │   └── saves/
│       │   ├── styles/
│       │   └── main.tsx
│       └── index.html
│
├── packages/
│   ├── game-api/             # Stable contracts and shared types
│   ├── game-host/            # Runtime lifecycle and adapter host
│   ├── game-storage/         # IndexedDB, save metadata, import/export
│   ├── input-core/            # Input normalization and focus handling
│   ├── touch-controls/        # Reusable control primitives
│   ├── terminal-renderer/     # Character-grid renderer, if needed
│   ├── tile-renderer/         # Reusable tile/cell renderer, if needed
│   ├── ui/                    # Shared visual components and tokens
│   └── test-fixtures/         # Fake adapters and reusable test helpers
│
├── games/
│   ├── manifest.json          # Catalog metadata index
│   ├── brogue-ce/
│   │   ├── adapter/
│   │   ├── port/
│   │   ├── patches/
│   │   ├── scripts/
│   │   ├── tests/
│   │   ├── game.config.json
│   │   ├── BUILDING.md
│   │   ├── PORTING.md
│   │   └── LICENSES.md
│   ├── dcss/
│   ├── sil-q/
│   ├── rogue/
│   └── ...                    # one package per game, added only when work starts
│
├── tools/
│   ├── build-game/
│   ├── validate-manifest/
│   ├── license-audit/
│   ├── asset-audit/
│   └── release/
│
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── games/
│   ├── contributing/
│   └── design/
│
├── licenses/
│   ├── THIRD_PARTY_NOTICES.md
│   └── asset-attributions/
│
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
│
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── LICENSE
├── package.json
├── pnpm-workspace.yaml
└── ...
```

The platform is **a common host for independently adapted games, not a universal roguelike emulator.** It shares lifecycle management, input routing, persistence, save import/export, offline caching, catalog metadata, and common loading and error handling. It does not require games to share a renderer or a control scheme. Three rendering categories remain explicit — terminal/curses, tile/map, and custom graphical — and each game's adapter translates the original game into the platform's capabilities.

This is a target structure, not a reason to create empty packages prematurely. Create a package when a real second use case justifies it. Avoid abstractions that exist only because the directory tree suggests they should.

## 4.4 Game package boundaries

Every game package owns:

- Its upstream source reference and pinned version/commit.
- Its build scripts and toolchain requirements.
- Its minimal port patches.
- Its runtime artifacts and data manifest.
- Its adapter implementation.
- Its game-specific rendering/input integration.
- Its save/load integration.
- Its tests and compatibility matrix.
- Its license and asset provenance report.
- Its known limitations and update instructions.

The shared platform must not contain game-specific conditionals such as `if (gameId === "nethack")`. Put those differences in the game's adapter or declarative configuration.

The platform may use generic capability flags to select reusable components, but game-specific behavior belongs in the adapter.

---

# 5. Common game API

## 5.1 Design goals

The common API must be:

- Small and stable.
- Asynchronous at the host boundary.
- Explicit about capabilities.
- Independent of React or any UI framework.
- Testable without loading a real WASM module.
- Versioned.
- Capable of representing terminal, tile, and custom graphical games.
- Honest about what the game adapter can and cannot do.

Do not expose a generic `attack()`, `move()`, `castSpell()`, or `openInventory()` method as a universal API. Those are game-specific commands. Instead, expose a generic input/event channel and let the adapter provide its own command catalog and control descriptors.

## 5.2 Illustrative TypeScript contracts

Use these as a starting point, not immutable code. Refine them after the first Brogue CE vertical slice.

```ts
export type GameId = string;
export type SessionId = string;

export interface GameDescriptor {
  id: GameId;
  title: string;
  version: string;
  description: string;
  upstreamUrl: string;
  sourceRevision: string;
  status: "playable" | "experimental";
  capabilities: GameCapabilities;
  assets: GameAssetDescriptor[];
}

export interface GameCapabilities {
  keyboard: boolean;
  pointer: boolean;
  touch: boolean;
  terminal: boolean;
  tiles: boolean;
  customCanvas: boolean;
  audio: boolean;
  save: boolean;
  saveExport: boolean;
  offline: boolean;
  fullscreen: boolean;
  virtualKeyboard: boolean;
}

export interface GameAdapter {
  readonly descriptor: GameDescriptor;

  initialize(host: GameHost, options: InitializeOptions): Promise<void>;
  start(options: StartOptions): Promise<void>;
  sendInput(input: GameInput): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  save?(): Promise<GameSave>;
  load?(save: GameSave): Promise<void>;
  shutdown(): Promise<void>;
}

export interface GameHost {
  emit(event: GameEvent): void;
  storage: GameStoragePort;
  logger: GameLogger;
  requestFullscreen(): Promise<boolean>;
  reportStatus(status: RuntimeStatus): void;
}

export type GameInput =
  | { type: "key"; key: string; code: string; modifiers: string[] }
  | { type: "text"; text: string }
  | { type: "pointer"; action: "down" | "up" | "move"; x: number; y: number; button?: number }
  | { type: "touch-command"; commandId: string; payload?: unknown }
  | { type: "resize"; width: number; height: number; pixelRatio: number }
  | { type: "game-specific"; name: string; payload: unknown };

export type GameEvent =
  | { type: "render"; frame: RenderFrame }
  | { type: "message"; text: string; severity?: "info" | "warning" | "error" }
  | { type: "status"; status: RuntimeStatus }
  | { type: "prompt"; prompt: GamePrompt }
  | { type: "commands"; commands: GameCommandDescriptor[] }
  | { type: "save-state"; state: SaveState }
  | { type: "audio"; event: AudioEvent }
  | { type: "exit"; reason: "user" | "game-over" | "error" };

export interface GameCommandDescriptor {
  id: string;
  label: string;
  category?: string;
  icon?: string;
  shortcut?: string;
  enabled: boolean;
  context?: string;
}

export interface GameSave {
  schemaVersion: number;
  gameId: GameId;
  gameVersion: string;
  createdAt: string;
  payload: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface GameStoragePort {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, value: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}
```

The exact event and rendering contracts should be finalized based on the first game. Avoid trying to anticipate every future engine.

## 5.3 Rendering model

Support multiple rendering modes without requiring every game to use all of them.

### Terminal renderer

A terminal frame may contain:

- A grid of cells.
- Character/glyph.
- Foreground/background color.
- Optional style flags.
- Cursor position/visibility.
- Window/panel identifier.
- Text lines and menu entries.

Preserve the semantics of the upstream game's window system. Some terminal games have multiple windows, message history, status panels, inventory menus, and prompts. A single flat string is insufficient.

### Tile renderer

A tile frame may contain:

- Tile map dimensions.
- Tile identifiers or atlas coordinates.
- Per-cell foreground/background/overlay.
- Animation state where applicable.
- Camera/viewport information.
- Highlight/selection state.

Use a canvas or WebGL only when it materially improves performance or matches the source renderer. A DOM/CSS grid can be sufficient for modest terminal maps, but benchmark it.

### Custom graphical renderer

Some games may own their own canvas or graphics context. The host should provide a mount point and lifecycle contract. Avoid taking over rendering or game timing if the upstream engine expects to own those.

## 5.4 Game prompts and menus

The adapter should surface structured prompt information when the engine exposes it, but must not infer a prompt from arbitrary text unless there is no better option.

Examples:

- Yes/no prompt.
- Direction selection.
- Item selection.
- Text entry.
- Menu selection.
- Target selection.

A prompt may include its own choices and cancellation behavior. Generic controls can render known prompt types; unknown prompts must still be accessible through the original keyboard input path.

## 5.5 API versioning

- Version the common API independently of the website.
- Each adapter declares its supported API version.
- CI validates compatibility.
- Breaking changes require migration notes.
- Do not create a complex plugin ABI before there are multiple working adapters.
- Keep game adapters in the monorepo initially; external third-party plugin loading is not a launch requirement.

---

# 6. Input, touch controls, and gameplay fidelity

## 6.1 Preserve original command semantics

Roguelikes often use keyboard commands as a core part of their design. Do not replace them with a shallow set of generic actions.

The adapter must preserve:

- Original key bindings.
- Multi-key command sequences.
- Direction selection.
- Confirmation/cancellation.
- Target selection.
- Menus and prompts.
- Repeat/continuous movement behavior.
- Wait, rest, explore, and auto-travel semantics.
- Modifier keys and command prefixes.
- Game-specific context-sensitive actions.

If the original game accepts a sequence such as a prefix followed by a direction, the adapter must preserve that sequence and not accidentally send only the final key.

## 6.2 Input layers

Use three distinct layers:

1. **Physical input:** keyboard, mouse, touch, gamepad if later supported.
2. **Normalized platform input:** key events, pointer events, semantic touch-control events.
3. **Game adapter input translation:** exact upstream commands and event calls.

Do not put game-specific key mappings in the global input package.

## 6.3 Touch-control strategy

Touch controls must be game-specific in arrangement but reusable in implementation.

Reusable primitives:

- Direction pad.
- Contextual action buttons.
- Command palette.
- Virtual keyboard.
- Radial selector (only where appropriate).
- Target selection overlay.
- Scrollable menu list.
- Long-press inspection.
- Tap-to-select grid cell.
- Swipe gestures with clear cancellation behavior.

Each game defines its own control layout using descriptors/configuration and adapter callbacks.

### Touch interaction rules

- Provide an explicit alternative to every essential gesture.
- Do not require multi-touch for core gameplay.
- Avoid small targets and controls placed under browser navigation areas.
- Respect safe-area insets.
- Support left- and right-handed layouts when controls are directional.
- Avoid sending duplicate actions from pointer and touch events.
- Prevent accidental page scrolling while interacting with a game surface, but do not disable browser zoom globally.
- Do not make swipe-to-move the only movement method.
- Add confirmation for destructive shell-level actions such as deleting a save.
- Keep the original game command available through a command/keyboard panel.

## 6.4 Context-sensitive controls

The platform may display controls based on adapter-provided state:

- A selected tile can expose inspect/move/target actions.
- A menu prompt can expose choices.
- A yes/no prompt can show explicit Yes and No buttons.
- A direction prompt can show a direction pad.
- A text prompt can show a text input.

The adapter, not the UI, determines whether a command is valid. The UI should not guess from the game screen.

## 6.5 Turn-based safety

Many roguelikes are turn-based, but not all input events are equivalent. The adapter must prevent accidental duplicate commands.

- Track whether an input is pending when the engine is processing a turn.
- Queue input only if the upstream game supports it.
- Do not assume every game can accept input while rendering or processing.
- Avoid optimistic UI that claims a turn occurred before the engine confirms it.
- Provide an emergency way to interrupt or return to a safe state when supported.
- Test double-tap, long-press, repeated key, and browser back behavior.

---

# 7. WebAssembly and runtime engineering

## 7.1 Build strategy

For each game, investigate in this order:

1. Is there an existing maintained browser/WASM port?
2. Does upstream have a terminal/window/input abstraction that can be adapted?
3. Does it depend on SDL, ncurses, OpenGL, threads, sockets, filesystem calls, or native libraries?
4. Can those dependencies be compiled or replaced with browser-compatible equivalents?
5. Is a custom browser renderer more appropriate than compiling the original renderer?
6. Are there existing community patches/build scripts that can legally be reused?
7. What is the expected binary size, initial download, runtime memory, and startup time?

Prefer Emscripten for C/C++ projects when it fits. Do not force Emscripten onto Pascal, Lua, or other runtimes if another approach is more maintainable.

## 7.2 Runtime isolation

Run each game in an isolated runtime instance. Prefer a Web Worker for the game engine when the engine and rendering integration permit it. This keeps CPU-heavy work away from the UI thread and makes lifecycle management cleaner.

However:

- Do not assume a game can run in a Worker without changes.
- Some Emscripten builds expect DOM or canvas access.
- OffscreenCanvas support and browser behavior must be tested.
- A worker may communicate with the UI through a typed message protocol.
- If a game must run on the main thread initially, keep the adapter boundary designed so it can be moved later.

Do not use pthreads/SharedArrayBuffer as a default. Threaded WebAssembly commonly requires cross-origin isolation headers (COOP/COEP). GitHub Pages does not provide arbitrary response-header configuration, so a pthread-based port may not work on the initial host. Prefer a single-threaded build unless a game genuinely requires threads and the hosting strategy is deliberately changed.

## 7.3 Emscripten filesystem and saves

Emscripten's default in-memory filesystem loses writes on reload. Use a persistence strategy deliberately.

Options:

- IDBFS mounted to the game's save directory, with `FS.syncfs()` synchronization.
- A custom adapter that exports/imports game save files as bytes.
- A combination: use the game's normal filesystem semantics inside WASM, then synchronize/export through the host.

Requirements:

- Complete initial filesystem synchronization before starting the game if needed.
- Await persistence synchronization after save operations.
- Do not report “saved” before the write is durable.
- Handle quota errors and private browsing limitations.
- Provide manual export/import for important saves.
- Keep at least one recoverable backup when replacing a save.
- Use a schema/versioned metadata record separate from the original game save.
- Never rewrite or reinterpret the game's save format unless necessary and documented.
- Test reload, browser crash/reopen, storage quota, corrupt save, and version mismatch behavior.

Do not rely on `beforeunload` as the only save mechanism. Mobile browsers may suspend or terminate a page without a reliable unload event.

## 7.4 Asset loading and memory

- Load a game's WASM, JS glue, data archive, and assets only after selection.
- Display compressed and uncompressed sizes where useful.
- Use immutable, content-hashed filenames for versioned runtime assets.
- Avoid downloading the entire library at startup.
- Release a game's Worker, WebAssembly instance, audio context, and large buffers on exit.
- Document peak memory for each game.
- Avoid loading multiple heavy game engines simultaneously.
- Provide a clear error when device memory is insufficient.
- Benchmark on mid-range phones, not only a developer laptop.

## 7.5 Browser support and compatibility

Initial target:

- Current Safari on iOS.
- Current Chrome on Android.
- Current Firefox desktop.
- Current Chrome/Edge desktop.
- Current Safari desktop where feasible.

Do not claim support for all devices without testing. Maintain a compatibility matrix per game because WebAssembly, graphics, storage, and memory behavior can vary.

Avoid browser APIs that require server configuration unavailable on GitHub Pages. Test the deployed site, not just the Vite development server.

---

# 8. Persistence, saves, and local data

## 8.1 Storage model

Use IndexedDB for platform-managed metadata and save blobs.

Suggested stores:

- `game-installs`: installed/downloaded game runtime versions.
- `game-saves`: save blobs or references to game-managed filesystem data.
- `save-metadata`: timestamps, character labels if provided, game version, and schema version.
- `recent-games`: recently launched games.
- `settings`: global and per-game preferences.
- `offline-cache-metadata`: cache version/state if required.

Do not store secrets or personal information. No account is needed.

## 8.2 Save behavior

- Preserve the native save mechanism and format.
- Show save status and timestamp.
- Autosave only when safe and supported by the engine.
- Provide explicit save/export where the game supports it.
- Make save deletion deliberate and confirmable.
- Avoid silently overwriting a newer save with an older imported save.
- Include game ID, upstream version, and port version in export metadata.
- Do not promise cross-version save compatibility. Let the game engine decide compatibility.

## 8.3 Export/import

Provide a user-accessible save export/import flow:

- Export a single save or all saves for one game.
- Use a clearly named file format such as `.roguearchive` (a documented ZIP or JSON-plus-binary container).
- Include original save bytes unchanged where possible.
- Include a manifest with game ID, game version, source revision, port version, export timestamp, and checksums.
- Import only matching game IDs.
- Validate size, checksum, schema, and expected files before replacing current data.
- Offer a backup before import.
- Never execute imported content as code.

The export format should be documented and versioned.

---

# 9. Static hosting and GitHub Pages

## 9.1 Hosting requirements

The production site must be a static build. All game execution occurs client-side.

Use GitHub Actions to:

1. Install pinned frontend dependencies.
2. Build the frontend.
3. Build or retrieve approved game runtime artifacts.
4. Validate the game manifest and artifact checksums.
5. Run tests.
6. Assemble a static deploy directory.
7. Deploy to GitHub Pages.

Use GitHub's official Pages Actions/deployment workflow rather than relying on a developer's local `gh-pages` branch process.

## 9.2 GitHub Pages path handling

Project Pages sites are served under a repository subpath, for example:

```text
https://<owner>.github.io/rogue-archive/
```

Do not hardcode root-relative paths such as `/assets/game.wasm` unless the Vite base and deployment strategy guarantee they resolve correctly.

- Configure Vite's `base` from the deployment environment.
- Use the same base path for service worker registration, manifest start URL, icons, runtime assets, and routes.
- Test direct navigation and refresh on nested routes.
- Prefer hash routing initially if it materially reduces GitHub Pages fallback complexity.
- If using history routing, include a tested 404 fallback/redirect approach.

## 9.3 Pages limits and large assets

GitHub Pages has published site size, repository size, build-time, and bandwidth limits. Keep the initial site lean and monitor usage.

- Do not commit generated multi-megabyte binaries repeatedly into Git history.
- Do not use Git LFS as an assumed solution for Pages deployment.
- Build runtime assets in Actions and publish only the current deploy artifacts.
- Keep upstream source checkouts out of the published site.
- Consider GitHub Releases or another static asset host only if real size/bandwidth needs require it.
- Measure the total published size and per-game download size.
- Lazy-load runtime artifacts.
- Set a project budget for initial landing-page transfer and per-game transfer.
- If a game makes Pages impractical, keep it out of the default deployment until a suitable distribution plan is approved.

## 9.4 Service worker and offline support

- Cache the app shell and core library metadata.
- Cache a game runtime only after the player chooses “Download for offline play” or launches it, depending on product policy.
- Show download/cache state per game.
- Use versioned cache names and clean up old versions safely.
- Never delete a user's save data during cache cleanup.
- Ensure the app can recover if a cache is partially populated or stale.
- Test update behavior while a game is running.
- Do not cache unbounded game data or old runtime versions forever.

## 9.5 Security

- Treat game data, save imports, asset manifests, and upstream build outputs as untrusted inputs.
- Validate all runtime asset URLs against a known manifest; avoid arbitrary remote script loading.
- Use dependency lockfiles and automated dependency review.
- Pin upstream source to commits or signed releases where possible.
- Verify checksums for downloaded source archives and build artifacts.
- Do not use `eval` or dynamic script injection for game integration.
- Keep WASM module permissions and host capabilities minimal.
- Avoid collecting telemetry.
- Add a Content Security Policy compatible with the chosen runtime and test it in production. Prefer self-hosted scripts/assets and avoid broad `unsafe-eval`; Emscripten runtime requirements must be evaluated rather than blindly relaxing the policy.
- Do not expose developer/debug endpoints in production.
- Do not store game save content in logs.
- Provide a `SECURITY.md` with a vulnerability reporting process.

---

# 10. Game source management and update strategy

## 10.1 Do not blindly fork every upstream repository

Use one of these approaches per game:

- **Build-time fetch:** CI fetches a pinned upstream commit or release archive, verifies it, applies Rogue Archive patches, and builds it.
- **Git submodule:** use only when the upstream repository is stable and submodule workflow is manageable for contributors.
- **Git subtree/vendor:** only when necessary for reproducibility or when upstream access/build constraints justify the maintenance cost.

Prefer build-time fetch with pinned commit and checksum when practical. Avoid a floating `main`/`master` dependency.

## 10.2 Patch discipline

- Store patches in the game's `patches/` directory.
- Each patch must have a short README explaining why it exists.
- Keep platform changes separate from gameplay changes.
- Do not change game rules to accommodate the browser.
- Avoid editing generated files.
- Rebase or reapply patches against a new upstream version in a dedicated update PR.
- Include tests demonstrating why a patch is required.
- Record any upstream issue/PR that may eventually eliminate the patch.

## 10.3 Updating a game

A game update must:

1. Identify the new upstream release/commit.
2. Review upstream changelog and breaking changes.
3. Re-check license files, asset rights, and contribution rules.
4. Update the pinned source revision.
5. Reapply or revise patches.
6. Rebuild with pinned toolchain versions.
7. Run native upstream tests where practical.
8. Run browser integration and gameplay smoke tests.
9. Verify save compatibility and document any breaking save changes.
10. Update credits and version metadata.
11. Update runtime size and compatibility data.
12. Produce a reviewable update PR.

Do not automatically update a game just because upstream has a new commit. Use deliberate release updates and optionally a scheduled report that identifies new upstream versions for human review.

---

# 11. Per-game porting methodology

Every port follows the same process, but its implementation remains game-specific.

## 11.1 Stage A — Feasibility report

Before writing port code, produce `docs/games/<game-id>-feasibility.md` containing:

- Official upstream repository and website.
- Maintained source version and pinned commit/release candidate.
- Language(s), build system, and compiler.
- Native platform dependencies.
- Renderer/windowing abstraction.
- Input abstraction.
- Filesystem and save behavior.
- Audio behavior.
- Threads, sockets, timers, and other browser compatibility concerns.
- Data and asset sizes.
- Existing browser/WASM ports and their licenses.
- Expected WASM/runtime size and memory needs.
- Likely adaptation strategy.
- Known risks.
- Go/no-go recommendation.

Do not assume an existing browser build is maintained, complete, or legally reusable. Inspect its source and build process.

## 11.2 Stage B — License and provenance report

Produce `LICENSES.md` for each game.

Track separately:

- Game source code.
- Game data/rules.
- Graphics and tiles.
- Fonts.
- Music and sound effects.
- Third-party libraries.
- Build tools and generated artifacts.
- Documentation and screenshots used by Rogue Archive.

For each item, record:

- Origin URL.
- Exact version/commit.
- License identifier and license text location.
- Copyright/attribution notices.
- Redistribution/modification permission.
- Share-alike/copyleft obligations.
- Any restrictions or exceptions.
- Whether the item may be included in the public static deployment.

If uncertain, mark `BLOCKED — RIGHTS REVIEW REQUIRED`. Do not bundle the asset.

### License inventory (required for every game)

Every game needs a license inventory covering **all** of:

- Source code.
- Game data.
- Tiles and sprites.
- Fonts.
- Audio and music.
- Third-party dependencies.
- Documentation and screenshots.
- Build scripts and generated artifacts.

A game must not enter the downloadable public catalog until every distributed component has a documented redistribution basis.

### Known points to verify at implementation time

- **Brogue CE:** code is AGPL-3.0-or-later; the tile sheet has its own CC BY-SA 4.0 notice. Verify the exact asset directory and current license.
- **DCSS:** main code is GPL-2.0-or-later, with some files under compatible or distinct licenses. Audit individual files, tiles and dependencies.
- **NetHack:** uses the **NetHack General Public License**, not simply the GPL. Tiles and any port code need separate review.
- **Sil-Q:** has a distinct licensing route (it descends from Angband via Sil). Its existing browser build excludes certain graphics and sound; treat that exclusion as a signal to audit every asset.
- **Angband:** documentation describes both GPLv2 and an alternative Angband license. Select a route deliberately and ensure the whole distribution complies.
- **Rogue 5.4.4:** identify the source precisely as a **later redistributable 5.4.4 source release** under a BSD-style license, not the original 1980 code. Verify all included notices.
- **Cataclysm DDA:** project code and content are described as CC BY-SA 3.0. That must **not** be assumed to cover bundled third-party components, tilesets, fonts or sounds. Its contribution guidance restricts LLM-sourced contributions.
- **Shattered Pixel Dungeon:** verify code licensing and asset licensing **separately**.
- **ToME / T-Engine4:** code is GPL-3.0, but official graphics, audio and music are granted for use with Tales of Maj'Eyal only. Watchlist; material redistribution blocker.
- **GearHead:** noncommercial restrictions on assets. Watchlist.
- **DRL:** source repository identifies GPL-2.0; upstream build instructions refer to additional binary data and FPC Valkyrie. Audit those separately.

These are starting points for an audit, not legal conclusions.

## 11.3 Stage C — Native build first

- Reproduce the upstream native build from a clean checkout.
- Run upstream tests.
- Document all required libraries and environment variables.
- Pin compiler/toolchain versions.
- Ensure the build is deterministic enough to diagnose changes.
- Record baseline gameplay behavior.

Do not start debugging Emscripten and upstream build problems simultaneously if a native build cannot be reproduced.

## 11.4 Stage D — Minimal WASM proof

- Compile the smallest viable upstream executable.
- Get the engine to initialize in a browser.
- Route basic input into the engine.
- Capture output and render a minimal screen.
- Demonstrate a real game start and at least one meaningful gameplay interaction.
- Demonstrate save and restore if supported.
- Record binary size, memory, startup time, and browser limitations.

At this stage, ugly rendering is acceptable. Fake gameplay is not.

## 11.5 Stage E — Adapter and presentation

- Implement the common lifecycle contract.
- Implement the game's rendering bridge.
- Implement original keyboard commands.
- Implement structured prompt/menu handling if possible.
- Add game-specific touch controls.
- Add persistence.
- Add loading and error states.
- Preserve game-specific look and feel.

## 11.6 Stage F — Gameplay and regression tests

Test:

- New game creation.
- Character/role/class selection.
- Movement in all directions.
- Wait/rest/explore if present.
- Combat.
- Inventory and equipment.
- Menus and prompts.
- Targeting.
- Level transition/stairs.
- Death/game over.
- Save and restore.
- Reloading the browser tab.
- Export/import if supported.
- Long session and repeated launch/exit.
- Browser back/navigation behavior.
- Small screen and landscape behavior.
- Keyboard-only operation.
- Touch-only operation where advertised.

Use deterministic seeds or known save fixtures where the game supports them. Do not rely only on random manual runs.

---

# 12. Game-specific investigation notes

These are initial hypotheses for the porting agents, not implementation guarantees.

## 12.1 Brogue: Community Edition

- Use the official Brogue CE repository as the source of truth.
- Inspect its display/input separation (`struct brogueConsole`) and SDL dependencies.
- Preserve its distinctive tile/character presentation and visual hierarchy.
- Touch interaction should focus on map selection, movement, contextual inspection, and menus.
- Verify tile/asset licenses independently from code.

## 12.2 DCSS

- Investigate existing community Emscripten builds and patches, then reproduce them from source.
- Prefer the official DCSS source repository as the upstream baseline.
- Determine whether to adapt the console/terminal interface first or the tile renderer.
- Preserve map visibility, messages, status, inventory, spell selection, targeting, and command prompts.
- Keep the game's command system available; do not reduce it to a handful of touch buttons.
- Ensure the selected build's patches and included tiles/assets are redistributable.

## 12.3 Sil-Q

- Start from the existing browser/WASM work as a feasibility reference; reproduce it from pinned source.
- Inventory which graphics and sounds the existing browser build excludes, and why.
- Preserve its tactical, information-rich terminal interface.

## 12.4 Rogue 5.4.4

- Pin the exact source release/commit; describe it as a later redistributable 5.4.4 release.
- Inspect curses dependencies and terminal output/input; start with a simple character-grid renderer.
- Preserve the original command style and game pacing.

## 12.5 HyperRogue

- Investigate upstream's own web build before any custom work.
- It is a custom graphical renderer case (`native-canvas`), not a terminal or tile grid.
- Verify touch interaction for hyperbolic-plane movement and the renderer's GPU requirements on mobile.

## 12.6 NetHack 5.0.0

- Inspect official NetHack sources and existing browser work (e.g. NetHackJS and NetHack's own window-port API) as research references; reproduce, do not trust.
- Preserve multiple window types, menus, message windows, status, map, prompts, and text input.
- Test multi-key commands and direction prompts carefully.
- License is the NetHack General Public License.

## 12.7 Angband

- Use the official `angband/angband` repository and its terminal abstraction.
- Preserve multiple terminal windows and command handling; a responsive terminal layout may be more faithful than a redesign.
- Select and document the license route.

## 12.8 DRL

- Investigate `chaosforgeorg/drl` and its FPC Valkyrie dependency; confirm the FreePascal toolchain can target WebAssembly maintainably.
- Separate GPL source from game data, graphics, music and sounds; do not bundle binary data because a README references it.
- Defer rather than build a brittle port if runtime or licensing cost is too high.

## 12.9 Allure of the Stars (dropped)

Removed from the roadmap in November 2026: still in beta (last release 0.11.0.0, December 2021; upstream's own README calls its browser build slow and its browser saves prone to corruption) and rarely discussed, so it is neither a classic nor a finished game. Candidates to take its place, if one is wanted: Umoria (GPL-3.0, Angband's ancestor, a curses game) or Hack 1.0.3 (BSD-type licence, the link between Rogue and NetHack).

## 12.10 Cataclysm: Dark Days Ahead

- **Technical discovery:** the upstream project already has an Emscripten build script and browser preparation steps in its release workflow. That makes CDDA a more credible technical candidate than a completely new port.
- **First step:** investigate and reproduce the upstream browser build before considering any custom port.
- Retain the **high-effort** designation because of: its large game-data footprint; complex inventory, crafting, vehicle and targeting interfaces; memory and performance requirements; save persistence complexity; mobile interaction challenges; and its contribution policy concerning LLM-generated contributions.
- Rogue Archive-specific changes stay downstream in this repository unless upstream contribution rules permit otherwise.
- Verify licenses of third-party components separately from the project's CC BY-SA license.

## 12.11 Shattered Pixel Dungeon

- Java/libGDX: investigate browser-capable backends (e.g. existing libGDX web targets) and their maintenance cost.
- Code and asset licenses must be verified separately.

## 12.12 IVAN and Infra Arcana

- Both use custom engines (C++); assess SDL and filesystem dependencies and runtime size.
- Infra Arcana requires additional runtime and licensing investigation before any implementation.

## 12.13 Watchlist: ToME and GearHead

- **ToME:** a source-only engine build does not grant permission to ship the official artwork, music or sound. Keep it out of the catalog until a complete, compliant distribution plan exists.
- **GearHead:** keep on the watchlist while its assets carry noncommercial restrictions.

---

# 13. Catalog manifest and generated metadata

Use a declarative manifest as the source of truth for the library. Do not duplicate game metadata across React components, docs, and route definitions.

Example:

```json
{
  "schemaVersion": 1,
  "games": [
    {
      "id": "nethack",
      "title": "NetHack",
      "subtitle": "The classic dungeon adventure",
      "description": "Explore a dangerous dungeon in one of the genre's defining roguelikes.",
      "status": "experimental",
      "version": "3.x",
      "sourceRevision": "PINNED_COMMIT_OR_RELEASE",
      "upstream": {
        "name": "NetHack",
        "url": "https://www.nethack.org/",
        "repository": "https://github.com/NetHack/NetHack"
      },
      "adapter": {
        "entry": "games/nethack/adapter/index.ts",
        "apiVersion": 1,
        "renderMode": "terminal"
      },
      "capabilities": {
        "keyboard": true,
        "pointer": true,
        "touch": true,
        "save": true,
        "saveExport": true,
        "offline": true
      },
      "assets": {
        "runtimeManifest": "games/nethack/runtime/manifest.json",
        "cover": "assets/games/nethack/cover.webp",
        "screenshots": []
      },
      "credits": "games/nethack/LICENSES.md",
      "controls": "games/nethack/PORTING.md",
      "knownLimitations": []
    }
  ]
}
```

The actual schema should be validated with JSON Schema or a TypeScript runtime validator. Do not treat this example as a claim that NetHack is already playable or that the placeholder version is valid.

Manifest validation should check:

- Unique IDs.
- Required fields.
- Valid status.
- Existing metadata paths.
- Supported adapter API version.
- Declared capabilities.
- License report exists.
- Runtime artifact manifest exists for playable games.
- Every runtime artifact has a checksum and size.
- Every image/asset has provenance.

The library should be generated from this manifest.

---

# 14. Performance and quality budgets

Set measurable budgets early. Initial suggested targets; adjust based on actual device testing.

## Landing page

- No WASM or game-specific asset downloads on initial page load.
- Avoid large JavaScript bundles.
- Target excellent Core Web Vitals on a mid-range mobile device.
- Keep layout stable; reserve image dimensions.
- Optimize cover images to WebP/AVIF where supported, with fallback.
- Use lazy loading for offscreen images.
- Avoid loading every game's metadata or screenshot at full resolution.

## Game startup

Track for each game:

- Compressed download size.
- Uncompressed runtime size.
- Data/asset size.
- Time to first interactive screen.
- Peak memory estimate.
- Save storage requirements.
- Offline cache size.

Do not set one universal startup-time target before measuring each engine. Show honest download and loading states.

## Runtime

- No long-running game computation on the UI thread when it can be isolated.
- Avoid unnecessary React re-renders for high-frequency render events.
- Batch rendering updates.
- Avoid allocating a large object for every terminal cell on every frame if a typed-array representation is more appropriate.
- Clean up workers, event listeners, timers, audio, and graphics resources on shutdown.
- Profile on real mobile browsers.

---

# 15. Testing strategy and definition of done

## 15.1 Platform unit tests

- Manifest parsing and validation.
- Route and GitHub Pages base-path handling.
- Input normalization.
- Input focus and keyboard capture.
- Touch command dispatch.
- Save metadata and versioning.
- Import/export checksum validation.
- Cache versioning and cleanup.
- Adapter lifecycle transitions.
- Error propagation and recovery.

## 15.2 Adapter contract tests

Every game adapter must pass shared tests for:

- Initialization.
- Start.
- Input delivery.
- Status/event delivery.
- Pause/resume if advertised.
- Save/load if advertised.
- Shutdown and resource cleanup.
- Error handling.
- Capability consistency.

Use a fake adapter to test the platform without compiling any game.

## 15.3 Browser end-to-end tests

Use Playwright to test:

- Landing page loads with no game WASM request.
- Search and filters.
- Game detail view.
- Launch and loading states.
- Game canvas/terminal mounts.
- Keyboard input.
- Touch input simulation where practical.
- Save/reload behavior.
- Exit to library.
- Offline app shell.
- Offline launch for a cached game.
- Cache update and stale cache recovery.
- GitHub Pages base path.
- Direct route refresh.
- No console errors or unhandled promise rejections.

Playwright desktop emulation does not replace testing on physical iOS Safari and Android Chrome. Maintain a manual device test checklist.

## 15.4 Per-game gameplay acceptance

A game can be labeled `playable` only when:

- It starts a new game using its normal game flow.
- A player can perform meaningful gameplay actions.
- The game's core command/menu/prompt paths are accessible.
- The original game rules remain intact.
- The advertised input modes work.
- Save/load works if the game advertises persistence.
- Exit/relaunch does not corrupt state.
- A full smoke-test checklist is documented.
- Browser/device limitations are listed.
- License and asset reports are complete.
- Runtime assets are built reproducibly from pinned source.

## 15.5 Regression fixtures

Where possible, keep:

- Small known save fixtures with clear provenance.
- Deterministic seed fixtures.
- Expected terminal/event traces.
- Screenshots for rendering regression.
- Known command sequences.

Never include user save files or copyrighted material without permission.

---

# 16. CI/CD and release process

## 16.1 Pull request checks

For every PR:

- Install dependencies from lockfile.
- Type-check.
- Lint and format-check.
- Run unit tests.
- Validate catalog manifests.
- Run license/asset manifest checks.
- Build the frontend.
- Run adapter contract tests.
- Run relevant game build/tests when affected.
- Run a small Playwright smoke suite.
- Report artifact sizes.

Do not require every large game to rebuild on every documentation-only change. Use path filters, but ensure shared API changes trigger all adapter contract checks.

## 16.2 Game build reproducibility

Pin:

- Upstream commit/release.
- Emscripten/SDK version.
- Compiler version.
- Dependency versions.
- Build flags.
- Patch set.
- Asset archive checksums.

Build scripts should run in a documented container or reproducible CI environment. Avoid relying on developer-specific system packages.

## 16.3 Deployment

Use GitHub Actions with the official Pages deployment flow:

- Build only from the protected default branch or approved release tag.
- Upload the generated static directory as a Pages artifact.
- Deploy using the Pages deployment action.
- Keep deployment permissions minimal.
- Use concurrency so stale deployments do not overtake newer commits.
- Keep preview builds separate from production.
- Do not publish unreviewed experimental game artifacts by default.

## 16.4 Release notes

Each release should state:

- New games or updates.
- Upstream versions.
- Port-specific fixes.
- Known compatibility limitations.
- Save compatibility notes.
- Runtime size changes.
- License/attribution changes.

---

# 17. AI-agent workflow and contribution model

Rogue Archive is expected to be developed substantially with coding agents. The repository must make agent work bounded, auditable, and independently testable.

## 17.1 Agent roles

### Platform architect

Owns:

- Common API.
- Runtime lifecycle.
- Frontend integration.
- Storage interfaces.
- Architecture decisions.
- Cross-game consistency.

### Game porting agent

Owns one game at a time:

- Feasibility research.
- Upstream build.
- Port patches.
- Adapter.
- Game-specific controls.
- Tests and documentation.

### UI/UX agent

Owns:

- Design system.
- Responsive library.
- Loading states.
- Game detail layouts.
- Shared touch-control primitives.
- Accessibility.

### QA agent

Owns:

- Test plans.
- Contract tests.
- Browser tests.
- Save/load validation.
- Device compatibility reports.
- Regression testing.

An agent may take more than one role, but a single PR should have a clearly bounded purpose.

## 17.2 Required agent instructions

Create `AGENTS.md` at the repository root with:

- Product principles from this document.
- Repository structure.
- Commands to build/test/lint.
- Architecture rules.
- Licensing requirements.
- Game port acceptance criteria.
- Rules against fake functionality and unverified test claims.
- Instructions to update docs and ROADMAP.
- Instructions to keep changes scoped.

Create `games/<id>/AGENTS.md` only when a game has special requirements.

## 17.3 PR requirements

Every PR must state:

- What changed and why.
- Which game/platform packages are affected.
- Upstream source version/commit.
- Any patches added or changed.
- License/asset impact.
- Tests actually run.
- Browser/device tested.
- Runtime size before/after.
- Known limitations.
- Screenshots or short recordings for visible UI changes.

No PR should silently change game rules, save formats, or common API semantics.

## 17.4 Parallel work

Good parallel tasks:

- UI design system and landing page.
- Research reports for separate games.
- License inventory.
- Independent build feasibility spikes.
- Test harness development.

Do not parallelize multiple agents editing the same common API or shared runtime without an agreed interface. Have one agent own integration and resolve conflicts.

## 17.5 AI output quality

- Require citations/links for external technical and licensing claims in research reports.
- Verify claims against upstream source, not only search snippets.
- Do not accept generated source patches without understanding their effect.
- Do not accept generated gameplay tests that merely assert that a screen rendered.
- Keep a human review step for license decisions and release approval.
- Treat generated build scripts and shell commands as code requiring review.
- Do not permit agents to add remote runtime dependencies without explicit review.

---

# 18. Documentation requirements

At minimum:

- `README.md` — project purpose, screenshots, live site, playable games, contribution entry point.
- `AGENTS.md` — agent instructions.
- `CONTRIBUTING.md` — development setup, tests, adding/updating games.
- `ROADMAP.md` — current priorities and status.
- `SECURITY.md` — security reporting.
- `docs/architecture/overview.md` — architecture and data flow.
- `docs/architecture/game-api.md` — common contracts.
- `docs/architecture/storage.md` — persistence and save format.
- `docs/architecture/deployment.md` — GitHub Pages and PWA.
- `docs/contributing/adding-a-game.md` — complete porting workflow.
- `docs/contributing/updating-a-game.md` — upstream update process.
- `docs/design/design-system.md` — UI principles and tokens.
- `games/<id>/BUILDING.md` — reproducible game build.
- `games/<id>/PORTING.md` — adapter, controls, known limitations.
- `games/<id>/LICENSES.md` — source and asset provenance.
- `licenses/THIRD_PARTY_NOTICES.md` — aggregate notices.

---

# 19. Phased implementation roadmap

The goal is to validate the hardest architectural assumptions early, not to build every package before a game works.

## Phase 0 — Repository reconnaissance and project setup

Deliverables:

- Inspect the existing repository and identify existing code, tooling, and constraints.
- Confirm the project name and repository identity as Rogue Archive.
- Review current official documentation for GitHub Pages, Vite, PWA, Emscripten, Brogue CE, and DCSS.
- Create initial `AGENTS.md`, `ROADMAP.md`, architecture overview, and ADR directory.
- Establish TypeScript, frontend build, lint, format, and test commands.
- Set up GitHub Actions checks.
- Establish a preliminary license inventory.

Acceptance:

- Clean checkout can install, lint, type-check, test, and build.
- GitHub Pages deployment works at the repository subpath.
- No game runtime is downloaded on the landing page.

## Phase 1 — Product shell and design system

Deliverables:

- Landing/library page.
- Game card and game detail view.
- Search and filters.
- Responsive navigation.
- Loading/error/empty states.
- Design tokens and reusable components.
- PWA manifest and app icons.
- Fake/test game adapter for UI development.

Acceptance:

- The app looks polished on mobile and desktop.
- Keyboard and screen-reader navigation work for the site shell.
- No game binaries are required.
- Performance is measured and documented.

## Phase 2 — Common runtime and persistence

Deliverables:

- Versioned common game API.
- Adapter host and lifecycle state machine.
- Input normalization.
- Terminal renderer baseline.
- Generic game shell.
- IndexedDB storage layer.
- Save metadata and import/export container.
- Worker integration prototype if compatible.
- Fake adapter contract tests.

Acceptance:

- Fake game can launch, receive keyboard/touch input, render events, save, reload, and shut down.
- Errors and cancellation are handled.
- No game-specific logic is embedded in the shared UI.

## Phase 3 — First real game: Brogue CE

Deliverables:

- Feasibility and license reports.
- Pinned source and reproducible native/WASM build.
- Minimal browser/WASM proof.
- Brogue CE adapter.
- Tile/map rendering and responsive game layout.
- Keyboard and pointer input support.
- Map-first touch controls and contextual interactions.
- Save/load integration.
- Gameplay tests and known limitations.

Acceptance:

- New game starts through the normal game flow.
- Meaningful play is possible without changing game rules.
- Map, menus, messages, targeting, and prompts are usable.
- Save/reload works if supported by the upstream game.
- Desktop and mobile browser smoke tests pass.
- Only then mark it playable or experimental.

## Phase 4 — Second game: Dungeon Crawl Stone Soup

Deliverables:

- Independent feasibility and license reports.
- Review of existing community browser/WASM builds and their provenance.
- Pinned upstream source and reproducible build.
- Minimal browser/WASM proof.
- DCSS adapter.
- Terminal and/or tile rendering integration, selected based on feasibility and fidelity.
- Keyboard command preservation.
- Touch controls for map navigation, menus, prompts, targeting, and common actions.
- Save/load integration.
- Gameplay and rendering regression tests.

Acceptance:

- A real game can be started and played.
- Core menus, prompts, messages, map, status, inventory, and targeting are accessible.
- The adapter preserves the game's command system and mechanics.
- Save/reload works if supported.
- Brogue CE remains functional and its adapter requires no DCSS-specific changes.
- Desktop and mobile browser smoke tests pass.

## Phase 5 — First public release

Deliverables:

- Polished library page and game detail pages.
- At least one genuinely playable game; ideally two.
- Production GitHub Pages deployment.
- PWA installation and app-shell offline support.
- Optional per-game offline download.
- Complete attribution and license pages.
- Contribution guide.
- Compatibility matrix.
- Public issue templates and roadmap.

Acceptance:

- Clean install and deployed-site smoke test pass.
- No account/backend requirement.
- Saves remain local.
- Runtime and asset sizes are documented.
- No unresolved rights issue for any distributed content.

## Phase 6 — Expand the catalog

Follow the expansion order in §2.2 (Sil-Q, Rogue 5.4.4, HyperRogue, NetHack 5.0.0, Angband, DRL, Cataclysm DDA, Shattered Pixel Dungeon, IVAN, Infra Arcana). ToME and GearHead stay on the watchlist.

Each game must independently pass the full porting process and answer all three release-readiness questions in §2.3.

## Phase 7 — Long-term improvements

Potential later work:

- Gamepad support.
- More sophisticated tile rendering.
- Optional haptics.
- Save-file management across multiple characters.
- User-selectable control layouts.
- Community-contributed ports.
- Automated upstream release monitoring.
- Additional roguelikes and variants.
- Optional desktop/mobile wrappers, only if browser/PWA limitations justify them.

Do not add social features, accounts, cloud saves, or multiplayer merely because they are common in modern games.

---

# 20. Initial architecture decisions

Record these as ADRs and revisit only with evidence.

| Decision | Initial choice | Reason |
|---|---|---|
| Hosting | GitHub Pages | Free static hosting and GitHub-native CI/CD. |
| Runtime | Client-side WASM/JS | No server-side game process. |
| Frontend | TypeScript + React + Vite | Mature ecosystem and straightforward static builds. |
| Repository | Monorepo | Shared APIs, game adapters, docs, and CI evolve together. |
| Game integration | Per-game adapters | Engines have incompatible interfaces and semantics. |
| Game source | Pinned upstream versions | Reproducibility and controlled updates. |
| Persistence | IndexedDB | Browser-local storage and offline capability. |
| Rendering | Multiple rendering modes | Terminal, tile, and custom graphical games differ. |
| Input | Original keyboard commands plus touch layer | Preserve full gameplay while improving mobile ergonomics. |
| Threading | Single-threaded baseline | Avoid COOP/COEP hosting constraints initially. |
| PWA | Yes | Installable and offline-capable app shell. |
| Accounts/backend | None | Preserve static, local-first simplicity. |
| Game catalog | Manifest-driven | One source of truth for cards, details, capabilities, and assets. |

---

# 21. First implementation tasks for Claude Code

Start with these tasks in order. Do not jump directly into porting all games.

### Task 1 — Inspect and report

- Inspect the repository.
- Identify current code and existing decisions.
- Research current upstream and official documentation for GitHub Pages, Emscripten, Brogue CE, DCSS, and the proposed stack.
- Produce a concise architecture proposal and feasibility report.
- Identify any conflicts between this plan and the existing repository.
- Do not delete or rewrite existing work without explaining why.

### Task 2 — Establish the foundation

- Create the monorepo/workspace structure only as needed.
- Configure TypeScript, React, Vite, lint, format, tests, and GitHub Actions.
- Make GitHub Pages base-path deployment work.
- Add a minimal but polished landing page.
- Add the game catalog manifest and schema validation.
- Add a fake adapter for UI and lifecycle development.

### Task 3 — Build the platform vertical slice

- Implement the smallest viable game API.
- Implement adapter lifecycle and event bridge.
- Implement terminal renderer baseline.
- Implement keyboard and touch input layers.
- Implement IndexedDB persistence.
- Implement launch, error, exit, and save states.
- Test everything with the fake adapter.

### Task 4 — Brogue CE technical spike

- Complete feasibility and license audit.
- Reproduce a native build.
- Test an Emscripten build.
- Identify rendering/input boundary.
- Demonstrate map rendering and real gameplay.
- Decide whether the common renderer needs extension.
- Only then integrate it into the common platform.

### Task 5 — DCSS technical spike

- Complete feasibility and license audit.
- Inspect existing community browser/WASM work and verify its provenance.
- Reproduce a native build and test an Emscripten build.
- Identify terminal/tile rendering, input, prompt, and save boundaries.
- Demonstrate a real game session in the browser.
- Integrate without introducing DCSS-specific logic into shared UI packages.

### Task 6 — Sil-Q follow-on research

- Inspect the existing Sil-Q browser/WASM work and the official source.
- Produce separate feasibility and license/provenance reports.
- Reproduce the build and document the integration approach.
- Do not begin until Brogue CE and DCSS are complete.

### Task 7 — Public release readiness

- Finish mobile/desktop UX.
- Add offline support.
- Verify save persistence and export/import.
- Run browser/device tests.
- Audit licenses and attributions.
- Deploy and verify the actual GitHub Pages URL.
- Publish only games that meet the acceptance criteria.

---

# 22. Definition of success

Rogue Archive succeeds when a user can:

1. Open a fast, attractive website on a phone or computer.
2. Browse a curated collection of classic roguelikes.
3. Understand what each game is, how it plays, and what controls it supports.
4. Launch a game without creating an account or installing a native application.
5. Play using the original keyboard controls or a well-designed touch interface.
6. Leave and return without losing a saved game, where save support is advertised.
7. Download a game for offline use where supported.
8. Export a save and move it to another device where supported.
9. See honest compatibility, limitations, and attribution information.
10. Contribute a new game port through a documented, reproducible process.

The project should remain maintainable as the catalog grows. Adding a game should mostly mean creating a new game package, implementing its adapter, providing its build and license reports, and registering its metadata—not rewriting the library.

**The most important architectural test is this:** after Brogue CE and DCSS are integrated, adding a third game should require little or no modification to the shared platform. If every new game requires changes throughout the frontend, the abstraction boundary is wrong.

---

# 23. Upstream references to verify

Use official project repositories and documentation as the source of truth. Re-check all versions and policies before implementation.

- GitHub Pages documentation: https://docs.github.com/en/pages
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Emscripten documentation: https://emscripten.org/docs/
- Emscripten filesystem API: https://emscripten.org/docs/api_reference/Filesystem-API.html
- NetHack: https://github.com/NetHack/NetHack
- Brogue CE: https://github.com/tmewett/BrogueCE
- DCSS: https://github.com/crawl/crawl
- Angband: https://github.com/angband/angband
- Rogue 5.4.4 source archive: https://github.com/Davidslv/rogue
- Cataclysm DDA: https://github.com/CleverRaven/Cataclysm-DDA
- Cataclysm DDA contribution policy: https://github.com/CleverRaven/Cataclysm-DDA/blob/master/CONTRIBUTING.md
- Tales of Maj'Eyal licensing: https://te4.org/license
- Tales of Maj'Eyal source/project: https://te4.org/
- DRL: https://github.com/chaosforgeorg/drl
- Sil-Q: https://github.com/sil-quirk/sil-q
- HyperRogue: https://github.com/zenorogue/hyperrogue
- Shattered Pixel Dungeon: https://github.com/00-Evan/shattered-pixel-dungeon
- IVAN: https://github.com/Attnam/ivan
- Infra Arcana: https://gitlab.com/martin-tornqvist/ia (the GitHub repository is deprecated)
- NetHackJS (research reference): https://github.com/apowers313/NetHackJS
- FPC Valkyrie: https://github.com/ChaosForge/fpcvalkyrie/

---

## Final instruction

Build Rogue Archive as a high-quality, maintainable platform—not a quick demo. **Prioritize a small collection of complete, excellent browser ports over maximizing the number of games listed.** Preserve the identity and mechanics of each original game. Keep the site static, local-first, fast, accessible, and beautiful.

When a technical or licensing uncertainty arises, investigate it and document the result. Do not invent certainty, silently work around legal restrictions, or ship an unverified port. Make the architecture earn its abstractions through working games.

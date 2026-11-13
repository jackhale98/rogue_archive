# Porting playbook

How a game is ported to Rogue Archive, distilled from the Brogue CE port (`games/brogue-ce`), which is the reference implementation. [adding-a-game.md](adding-a-game.md) is the short procedure; this is the standard every port is held to and the reasoning behind it. When a section says "Brogue:", the named file is a working example to copy from.

Contents: [1. Package layout](#1-package-layout) · [2. Build](#2-build) · [3. Platform layer](#3-the-platform-layer-inside-the-engine) · [4. Adapter](#4-the-adapter-browser-side) · [5. Phones](#5-phones-the-standard-mobile-experience) · [6. Verification](#6-verification-ladder) · [7. Updates](#7-staying-current-with-upstream) · [8. Definition of done](#8-definition-of-done) · [9. Lessons learned](#9-lessons-learned)

---

## 1. Package layout

```
games/<id>/
  upstream.env              pinned repository, tag AND commit, version
  package.json              name @rogue-archive/game-<id>, license = the game's license
  scripts/
    upstream.sh             resolves the pin (or a canary ref) — copy from Brogue
    build.sh                reproducible WASM build → dist/ + runtime-manifest.json
    test-engine.sh          engine conformance (see §6)
  port/                     files added to the upstream build (platform layer)
  patches/                  NNNN-*.patch + README.md (aim for none)
  adapter/                  TypeScript: index.ts (GameAdapter), worker.ts, renderer, input, state…
  tests/                    unit tests; conformance/ scripts; recordings/ fixtures
  BUILDING.md  PORTING.md  LICENSES.md
docs/games/<id>-feasibility.md
```

Register the lazy import in `apps/web/src/app/adapters.ts` (the only shared-code change a game should need) and add the catalog entry in `games/catalog.json`.

## 2. Build

| Rule | Why | Brogue |
|---|---|---|
| Pin tag **and** commit; verify the commit after cloning | Tags can move; builds must be reproducible | `upstream.env`, `scripts/upstream.sh`, `build.sh` |
| Pin the toolchain in `tools/toolchain.env` | Same inputs → same bytes | Emscripten 6.0.13 |
| Read source lists / include paths from **upstream's own build system** | New upstream files (e.g. a vendored library) must not break the build | `build.sh` asks upstream's Makefile for `sources` and `cflags` |
| Prefer adding files over patching upstream | Patches rot; added files are reviewable | No patches; `port/rogue-archive-platform.c` |
| Write `runtime-manifest.json` with SHA-256 per file; `buildId` is a content hash | Clients verify before executing; deploy dirs are immutable | `tools/write-runtime-manifest.mjs` |
| Single-threaded WASM, no SharedArrayBuffer | GitHub Pages cannot send COOP/COEP headers | ADR 0004 |
| Link the same object files into a Node **test harness** | Conformance tests must exercise the code we ship | `harness-<commit>/brogue-node.cjs` |
| Check reproducibility: rebuild and compare `buildId` | Proves the build is deterministic | Identical locally and in CI |

## 3. The platform layer (inside the engine)

Most roguelikes already separate the game from its platform (Brogue: `struct brogueConsole`; NetHack: window ports; Angband: `term`; DCSS: its console/tiles front ends). Implement **that** interface in one added file.

- **Select it without patching** where possible (Brogue reuses the `BROGUE_WEB` branch of `main.c` with `-DwebConsole=rogueArchiveConsole`). Use **designated initializers** for interface structs so a reordered upstream struct fails to compile.
- **Blocking input → Asyncify.** The engine's own loop stays intact; waits yield to the worker's event loop (`EM_ASYNC_JS`, `emscripten_sleep`). Sleep until input arrives when nothing animates; keep upstream's cadence when it does.
- **Output:** send the whole screen buffer (cells: glyph/sprite, foreground, background) at each wait or pause; the browser renders it.
- **Read-only state snapshot** with every frame: whatever the UI needs that the screen doesn't express cleanly (HP, nutrition, depth, cursor, the kind of input being waited for). **Never write game state.** Brogue: `ST_*` in `port/rogue-archive-platform.c`, parsed in `adapter/state.ts`.
- **Message history** from the engine's own archive, not screen scraping. Brogue: `reportMessageArchive()` → worker reads the ring buffer → `adapter/messages.ts`.
- **Saves:** mount the save directory on IDBFS with `autoPersist`; expose a "flush" the host can call on page hide/exit (Brogue calls upstream's own `flushBufferToFile()` at an input wait).

## 4. The adapter (browser side)

Implement `GameAdapter` (`packages/game-api`). Feature checklist, with Brogue examples:

| Feature | Brogue |
|---|---|
| Worker hosting the engine; download → verify SHA-256 → instantiate from a blob URL (pass `locateFile`) | `adapter/worker.ts` |
| Renderer in the mount the shell gives you; WebGL2, whole-pixel cells; game's own glyphs/tiles | `adapter/renderer.ts`, `atlas.ts` |
| Keyboard mapping that mirrors upstream's native platform exactly | `adapter/input.ts` (`keyToBrogue` mirrors `sdl2-platform.c`) |
| `commands`: every command with its **original key** (shown on buttons) | `BROGUE_COMMANDS` |
| Context detection → `touch-layout` events (dock actions with long-press `alternates`, pad on/off) | `adapter/state.ts` (`detectContext`, `controlsFor`) |
| `setPresentation` → phone layout (§5) | `adapter/views.ts`, `hud.ts` |
| `message-log` events | `adapter/messages.ts` |
| `persist`, `exportSaves`/`importSaves`, `nativeSaveExtensions` (raw files usable by the desktop game) | `adapter/index.ts`, `worker.ts` |
| `settings` descriptors, `resumeHint`, `cycleView` (desktop zoom) | `adapter/index.ts` |
| Debug hook (`?debug` / dev only): screen text, context, views, cell↔client mapping | `debug` in `adapter/index.ts` |

Keep the shared platform game-agnostic: if you need something the contract lacks, extend `packages/game-api` (with docs in `docs/architecture/game-api.md`) rather than special-casing a game in `apps/web`.

## 5. Phones: the standard mobile experience

Decided with the project owner for Brogue and the default for every game (details: [docs/design/mobile-play.md](../design/mobile-play.md)):

1. **Compact mode** (shell): touch + shorter side < 600 px. The shell hides its header, floats its tools top-right, overlays the dock and pad, and calls `setPresentation({ compact, insets, topRightReserve })`. Desktop and tablets keep the original screen.
2. **Recompose the screen from the game's own cells**, don't redesign it:
   - main view (map) full-bleed at a readable size, pinch to resize, drag to look, camera on the player within the area not covered by controls;
   - status band (health etc. from the state snapshot) + latest messages;
   - text the game draws over the main view: **modal sheet** when an answer is needed (menus, yes/no; tap outside = cancel); otherwise (descriptions) read the text out of the cells into a **reader** with large, re-flowed text — opened directly on long-press, offered with a small chip when the game shows it by itself — and draw what was underneath on the main view (Brogue: `adapter/describe.ts`, `reader.ts`). Closing the reader must not send input to the game;
   - side panels (Brogue's sidebar) as a drawer.
3. **Controls:** context-aware **dock** (tap = main action, long-press fans related actions, slide-and-release to choose) and a floating **thumb pad** (press-and-slide, hold to repeat). Every control sends the game's original keys. Contexts at minimum: exploring, targeting, `--MORE--`-style acknowledgement, yes/no, menus/typing, busy (Stop). Modifiers the game uses (Shift, Ctrl) are **latching toggles** that apply to the next action only (Brogue: `#setStickyShift` in `adapter/index.ts`).
4. **Message log** from the engine's history.
5. Safe areas: apply `env(safe-area-inset-*)` **once** (the compact shell is edge-to-edge; controls inset themselves).

## 6. Verification ladder

Every port climbs all of these; each step catches what the previous can't.

| Level | What it proves | Brogue |
|---|---|---|
| Unit tests | Input mapping equals upstream's; layout/camera/context logic | `games/brogue-ce/tests/*.test.ts` |
| **Engine equivalence** | The WASM engine behaves like upstream's | Upstream's own regression data (`test/seed_catalogs`) regenerated exactly by the Node harness |
| **Save/replay equivalence** | Same inputs → same game; saves interchangeable with the desktop game | `tests/recordings/*` replayed by native and WASM builds, identical output to the end |
| **Interface completeness (source-driven)** | Every input upstream defines is reachable | `tests/conformance/key-coverage.ts` parses `Rogue.h` |
| **Upstream drift** | Nothing we copied or rely on changed | `tests/conformance/upstream-drift.ts` |
| End-to-end (Playwright, desktop + phone emulation) | Real games start, play, save, reload, load, export/import; touch contexts; log | `e2e/<game>.spec.ts`, `e2e/<game>.mobile.spec.ts` (e.g. `brogue`, `dcss`) |
| Real devices | Comfort, performance, memory | Required before `playable` |

Prefer the game's **own** test data (seed catalogs, recordings, replay modes, regression suites) over inventing checks: they are what "behaves like the original" means.

## 7. Staying current with upstream

- **Weekly canary**: add a job for the game to `.github/workflows/upstream-canary.yml` (latest release + development branch; never deploys). Locally: `ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:brogue`.
- **Drift check** names exactly what to re-review when upstream changes something the port copied.
- **Saves across versions**: find out the game's compatibility rule (Brogue: same minor version) and decide before shipping an incompatible update (warn players, or keep the previous build playable for its saves).
- Updates are one reviewed PR per game: [updating-a-game.md](updating-a-game.md).

## 8. Definition of done

A game moves to `experimental` when all of these hold, and to `playable` when, in addition, it has been tested on physical iOS Safari and Android Chrome:

- [ ] Feasibility report and complete license/provenance inventory (code, data, tiles, fonts, audio, docs/screenshots, third-party code, generated artifacts)
- [ ] Pinned, reproducible build reading upstream's build system; runtime manifest with hashes; Node test harness
- [ ] Platform layer with read-only state snapshot and message history; no game rules changed
- [ ] Adapter: original keys, commands, contexts and dock, phone layout, message log, saves with flush/export/import (native files if the desktop game can use them)
- [ ] Verification ladder levels 1–6 in CI; canary job added
- [ ] `BUILDING.md`, `PORTING.md`, `LICENSES.md`, catalog entry (compatibility and known limitations filled honestly), cover captured from the running game
- [ ] Bundle sizes and memory recorded

## 9. Lessons learned

Things that cost time on Brogue; check for their equivalents in every port.

- **Blob-URL glue** needs `locateFile` (Emscripten otherwise resolves the `.wasm` relative to `import.meta.url`).
- **Persist immediately**: periodic syncs lose saves on reload; use IDBFS `autoPersist` plus an explicit flush on hide/exit.
- **"Text input" flags lie**: Brogue waits in text-input mode for every menu, not just typing. Derive context from several signals (flags + snapshot + on-screen prompts) and test each context.
- **Text drawn over the main view is in the same buffer** as the map: lifting it into a card means also drawing what was underneath, or it appears twice.
- **Don't float text over the action**: Brogue shows descriptions by itself mid-fight. Offer them (chip) instead of opening them; open directly only when the player asked (long-press).
- **Translucent boxes**: map glyphs show through a box's gaps; compare with the pre-box screen to separate text from map.
- **`[hidden]` vs author CSS**: a class that sets `display` overrides the `hidden` attribute; add `[hidden]{display:none}` for every element you toggle.
- **`performance.now()` starts at page load**: initialize "last time X happened" timestamps to `-Infinity`, not 0.
- **Compatibility clicks**: after a touch, the browser may send a `click` to whatever is now under the finger; suppress it on the game surface (`touchend` → `preventDefault`) and ignore taps on just-appeared UI.
- **Keys during transitions** are consumed by the game (Brogue's level fade-in): tests must wait for "waiting for input", not just "in game".
- **Acknowledgement keys differ** per game (Brogue's `--MORE--` takes Space/Escape/click, not Enter).
- **Focus**: after shell UI (menus, toolbar) return keyboard focus to the game; the shell must not treat the on-screen keyboard field as a shell control *and* forward its keys.
- **Service workers bypass Playwright `page.route`**: block them in tests that intercept requests.
- **Safe-area insets** applied at two levels double the margin.
- Brogue's debug screen text shows `?` for any non-text glyph and dialog boxes keep map glyphs in their "spaces": match contiguous substrings in tests.

### From DCSS

- **Look for an upstream browser front end first.** DCSS's WebTiles client already renders every screen from a JSON protocol. Running the game headless in the worker and serving that client unmodified (in an iframe, with a small host for the lobby's modules) gave the full official interface. A custom renderer would have taken far longer. The same may hold for other games with web front ends.
- **Use upstream's build system in its cross-compiling mode** (`CROSSHOST=wasm32-emscripten` plus one-line compiler wrappers) rather than re-deriving sources and flags. Command-line make variables reach sub-makes, so don't set ones a host-side tool must not see (e.g. `NO_PKGCONFIG`, which broke `rltiles`). Read printed make variables with `| tail -n 1`: make may first report regenerating included files.
- **Replace system calls at link time instead of patching**: defining `socket`, `sendto`, `recvfrom`, `select`, `usleep`… in an added file overrides the C library's. Link C++ with `em++`. Headless builds still link their terminal library; inert stubs suffice (`port/compat/`).
- **C++ exceptions + Asyncify:** use Emscripten's JavaScript exception handling (`-fexceptions`, everywhere: compile and link); wasm exceptions don't combine with Asyncify.
- **Don't name runtime files `.gz`:** some servers (Vite's included) send them with `Content-Encoding: gzip`, so the browser inflates them before the integrity check. Use `.gzip` and inflate in the worker.
- **An `<iframe>` is a replaced element:** with `width/height: auto` and insets it stays 300×150. Set its size explicitly.
- **Hidden panels can break upstream code**: `display:none` gave upstream's minimap a zero-size canvas, and the error aborted every map update. Wrap the one function at runtime rather than hiding the problem.
- **Option bounds:** game options often have minimums (`msg_min_height` ≥ 7). Change the presentation in the client host instead of fighting the game's options.
- **First launch can be slow** when a game builds caches (DCSS: levels and descriptions, ~10–15 s). Keep them in the persistent save directory and exclude them from exports.
- **A launcher may be needed:** servers often start games with arguments a player never sees (WebTiles: the player name). Provide the equivalent (start screen) instead of hoping the game asks.
- **Upstream test suites may need debug builds.** Native-vs-WebAssembly replay of seeded games through the same platform interface (key script in, message stream out) is a strong, cheap alternative.
- **Service workers answer navigations with the app shell.** A runtime page loaded in a frame (DCSS's client) is a navigation too; the shared worker serves runtime paths as runtime files first. Tests that start without the worker in control pass even with this bug, so run the full suite against a production build.
- **Know where the game keeps saves.** DCSS uses `SAVEDIR/saves/<name>.cs`, not `SAVEDIR` itself; a save downloaded or imported on its own goes back there.

### From Sil-Q

- **Angband-family games have a front-end interface** (`z-term.c`'s term hooks). Writing one more front end (`port/main-web.c`) beats patching: select it through upstream's own `main.c` with build flags (`-DUSE_GCU -Dinit_gcu=init_web`) so not even `main.c` changes.
- **Write the host bridge so it can also be C.** Guarding the `EM_JS` bridge with `#ifndef RA_REPLAY` let the same display module link natively with a C replay host; native vs WebAssembly then compares every screen, message and savefile.
- **Fix what the game seeds from**, in the harness only: link-time `time()`, `getpid()` (and natively `getpwuid()`/`getuid()`, which name characters and savefiles) give both builds the same seed and files.
- **Startup privilege drops fail in Emscripten** (`setregid` etc. report errors and Unix builds quit); link-time definitions that succeed fix it.
- **Merged repeats in message logs**: Sil rewrites its newest message as "… <2x>" instead of adding one. Send that as a replacement, or the log is resent.
- **"In the dungeon" flags can outlive the game**: `character_dungeon` stays set at the title menu after a game ends; combine it with `p_ptr->playing`.
- **Verify every command's key against the source.** The key-coverage check found `*` (target) commented out of Sil-Q's command switch.
- **Ghost clicks after opening UI from a touch**: an action run on pointerup that opens a dialog receives the touch's compatibility click on whatever is now under the finger. The shared dock now cancels `touchend`; do the same for any custom touch button that opens UI.

# Architecture overview

Rogue Archive is **a common host for independently adapted games, not a universal roguelike emulator.**

The platform shares lifecycle management, input routing, persistence, save import/export, offline caching, catalog metadata, and loading/error handling. It does **not** require games to share a renderer or a control scheme. Each game's adapter translates the original game into the platform's capabilities, using one of three rendering categories: terminal/curses, tile/map, or custom graphical.

```
┌──────────────────────────── apps/web (static site) ────────────────────────────┐
│ Library ── Game detail ── Settings            catalog.json (validated in CI)   │
│                    │                                                          │
│                    ▼                                                          │
│ Play shell: useGameSession ── LifecycleMachine ── touch controls ── menu       │
│        │ loadRuntime(manifest)      │ GameHost (events)       │ input          │
└────────┼────────────────────────────┼─────────────────────────┼────────────────┘
         │ lazy import                │                         ▼
         ▼                            │            ┌───────────────────────────┐
  games/<id>/adapter  ◀───────────────┘            │ GameAdapter (game-api)     │
    renderer, input mapping, worker  ───────────▶  │ initialize/start/sendInput │
         │                                         │ persist/export/import/stop │
         ▼                                         └───────────────────────────┘
  Web Worker: pinned upstream game compiled to WASM + platform layer + IDBFS saves
```

## Packages

| Package | Responsibility |
|---|---|
| `packages/game-api` | Contract types (`GameAdapter`, `GameHost`, `GameInput`, `GameEvent`, `RuntimeManifest`...), `GAME_API_VERSION`, `LifecycleMachine`, `domKeyToInput`. Framework-free. |
| `packages/game-storage` | Platform IndexedDB (settings, recent games) and the `.roguearchive` format. |
| `packages/catalog` | Catalog types/helpers for the app; Zod schema for CI. |
| `apps/web` | UI. Talks to games only through `game-api`. |
| `games/<id>` | Everything game-specific, under the game's license. |

## Data flow for a launch

1. The player opens `#/play/<id>`. The shell fetches `runtime/<id>/runtime-manifest.json` (always revalidated) and lazily imports the adapter chunk. Nothing game-related loads before this.
2. The adapter starts its worker. The worker downloads each runtime file, streaming real byte progress, **verifies its SHA-256 against the manifest**, then instantiates the module.
3. The worker mounts the game's save directory from IndexedDB, then reports `ready`. The shell transitions the lifecycle to `running` and calls `start()`.
4. Input: `keydown` → `domKeyToInput` → `adapter.sendInput` → game-specific translation → worker. Touch controls send `{ type: 'command', commandId }`; the adapter maps the id to the original key.
5. Output: the adapter renders into the mount element it was given. The shell never inspects game frames.
6. On page hide, exit or navigation the shell calls `persist()`, then `shutdown()`.

## Runtime artifacts and caching

- Built games are staged as `runtime/<id>/<buildId>/…`, where `buildId` is a hash of all file hashes. They are immutable and served cache-first by the service worker.
- `runtime/<id>/runtime-manifest.json` is small and network-first; a new build changes it, and the service worker prunes cached files from older builds of that game.
- See [deployment.md](deployment.md) and [storage.md](storage.md).

## Key decisions

See [../decisions](../decisions/). In short: static GitHub Pages hosting; per-game adapters; pinned upstream builds; Web Worker + Asyncify; single-threaded WASM; IndexedDB saves through each engine's own filesystem; hash routing; catalog-driven UI.

# Game API (version 1)

Source: [`packages/game-api/src/index.ts`](../../packages/game-api/src/index.ts). This page explains intent; the types are authoritative.

## Principles

- Small, asynchronous at the host boundary, framework-free, versioned.
- **No game semantics.** There is no `move()` or `openInventory()`. Games publish *commands* (id, label, original shortcut) and a *touch layout*; the platform renders buttons and sends back command ids.
- Adapters are honest about capabilities (`keyboard`, `pointer`, `touch`, `save`, `saveExport`, `offline`, `audio`).

## Adapter lifecycle

```
created ─initialize→ initializing ─initialized→ ready ─start→ running ─stop→ stopping ─stopped→ stopped
                         └──────── fail ─────────┴──────────────┴──→ failed
```

`LifecycleMachine` enforces this order in the shell, so the UI cannot claim a game is running when it is not.

| Method | Contract |
|---|---|
| `initialize(host, { mount, runtimeBaseUrl, runtime, settings, signal })` | Download and verify the runtime, prepare saves, mount the renderer. Report real progress through `host.emit({ type: 'status' })`. Reject with an error whose `kind` is `network`, `integrity`, `unsupported`, `out-of-memory`, `storage` or `crash`. Honor `signal`. |
| `start()` | Begin the game's normal flow (title screen, character creation...). |
| `sendInput(input)` | `key` (normalized DOM key + modifiers), `text`, `command` (touch/palette), `game-specific`. Must not throw. The adapter decides validity. |
| `persist()` | Make progress durable; resolve only when written. Called on page hide and before exit. |
| `exportSaves()` / `importSaves(files)` | Optional. Raw save files, byte for byte. Import must never overwrite silently. |
| `applySetting(key, value)`, `cycleView()`, `setVisible(visible)` | Optional conveniences. |
| `shutdown()` | Persist if needed, then release the worker, WASM memory, GL contexts and listeners. Idempotent. |

Adapters also expose `commands`, `touchLayout`, `settings` (setting descriptors the shell can render without understanding them) and `resumeHint` (shown after leaving mid-game).

## Events to the host

`status`, `error`, `message`, `input-context` (`textEntry` true while the game wants typed text, which shows the keyboard prompt), `save-state`, `setting-changed` (persisted per game), `exit`.

## Versioning

`GAME_API_VERSION` is checked when an adapter loads. Breaking changes bump it and must come with migration notes for every adapter in the monorepo. Third-party adapter loading is out of scope.

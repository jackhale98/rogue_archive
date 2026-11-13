# Storage and saves

## Where data lives

| Data | Store | Owner |
|---|---|---|
| Platform settings, per-game settings (`game:<id>` scope), recently played | IndexedDB database `rogue-archive` | `packages/game-storage` |
| Game saves and other game files | The game's own virtual filesystem, persisted to IndexedDB. For Emscripten games: an IDBFS database named after the mount point (Brogue: `/brogue`). | The game adapter/worker |
| App shell and runtime files | Cache Storage (`ra-shell-v1`, `ra-runtime-v1`) | Service worker |

Cache cleanup only ever touches Cache Storage, so it can never delete a save. "Remove all local data" in Settings deletes everything after an explicit confirmation.

## Durability rules

- Engines keep their native save format; the platform never reinterprets it.
- Emscripten games mount IDBFS with `autoPersist`, so every file the engine closes, renames or deletes is written to IndexedDB immediately.
- `persist()` is called on `visibilitychange` (hidden), `pagehide` and exit. `beforeunload` is not relied on.
- The UI does not report "saved" before the write completes.

## `.roguearchive` export format (version 1)

A UTF-8 JSON document:

```json
{
  "format": "rogue-archive-saves",
  "formatVersion": 1,
  "gameId": "brogue-ce",
  "gameVersion": "1.15.1",
  "sourceRevision": "<upstream commit>",
  "portBuildId": "<runtime buildId>",
  "exportedAt": "2026-11-13T03:00:00.000Z",
  "files": [{ "path": "Saved game.broguesave", "size": 1234, "sha256": "…", "modifiedAt": 1763000000000, "data": "<base64>" }]
}
```

Import validation, all before anything is written: total size ≤ 64 MB, ≤ 512 files, matching `gameId`, safe relative paths (no `..`, absolute paths, backslashes or control characters), no duplicates, size and SHA-256 per file. A version mismatch is shown to the player; the engine decides compatibility. Imported files never overwrite existing ones: clashes get an " (imported)" name. Imported content is only ever written as data.

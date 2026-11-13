# Storage and saves

## Where data lives

| Data | Store | Owner |
|---|---|---|
| Platform settings, per-game settings (`game:<id>` scope), recently played | IndexedDB database `rogue-archive` | `packages/game-storage` |
| Game saves and other game files | The game's own virtual filesystem, persisted to IndexedDB. For Emscripten games: an IDBFS database named after the mount point (Brogue: `/brogue`). | The game adapter/worker |
| App shell and runtime files | Cache Storage (`ra-shell-<build id>`, `ra-runtime-v1`) | Service worker |

Cache cleanup only ever touches Cache Storage, so it can never delete a save. "Remove all local data" in Settings deletes everything after an explicit confirmation.

## Durability rules

- Engines keep their native save format; the platform never reinterprets it.
- Emscripten games mount IDBFS with `autoPersist`, so every file the engine closes, renames or deletes is written to IndexedDB immediately.
- `persist()` is called on `visibilitychange` (hidden), `pagehide` and exit. `beforeunload` is not relied on.
- The UI does not report "saved" before the write completes.

## How long browsers keep saves

Everything above is site data for one origin, and browsers decide how long to keep it:

- **Best-effort (the default):** kept until the device runs short of space; then the browser clears whole origins, least recently used first. The user can always clear it.
- **Persistent:** not cleared to free space. The shell asks for it with `navigator.storage.persist()` once a game is running (`apps/web/src/app/durable-storage.ts`), and Settings → Keeping your saves shows the result, the space used and a button to ask again. Chromium browsers grant or refuse silently (more readily for an installed app or a site used often); Firefox may ask the player.
- **Safari (and the other browsers on iPhone and iPad):** script-written storage can be deleted after 7 days of Safari use without a visit to the site. A web app added to the Home Screen has its own storage and its own count of days of use, so Settings suggests installing it on Apple devices; its storage is separate from Safari's, so saves move between them by export and import. Whether a granted `persist()` lifts the 7-day rule is not documented by Apple; test on a device before relying on it.

Saves never leave the device. Export (`.roguearchive`, below) is the backup and the way to move saves between browsers and devices.

**Possible later: cloud sync.** Optional sync of the same export to the player's own Dropbox or OneDrive is compatible with having no backend: both offer OAuth with PKCE for browser-only apps and an app-specific folder (Dropbox "App folder"; OneDrive's app folder via Microsoft Graph), so the site never sees the player's other files and keeps no server or account of its own. It needs app registrations (public client IDs, the deployed URL as redirect), `connect-src` entries for the providers' API hosts, the token kept only in the player's browser, and a conflict rule (newest file wins, with the other kept as a copy).

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

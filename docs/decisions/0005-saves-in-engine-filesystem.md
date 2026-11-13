# 0005 — Saves stay in the engine's own filesystem

**Decision.** Games keep using their native file I/O and save formats. For Emscripten games the save directory is an IDBFS mount with `autoPersist`, so writes reach IndexedDB as soon as a file is closed, renamed or deleted. The platform adds `persist()` (called on page hide and exit), export/import of raw files in a documented container, and never rewrites save formats.
**Consequences.** Tab kills lose at most what the engine had not yet written; Brogue's in-memory recording buffer is flushed on `persist()`. Export/import goes through the engine worker rather than reading IndexedDB directly, which avoids coupling to IDBFS internals.

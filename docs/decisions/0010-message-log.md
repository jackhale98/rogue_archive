# 0010 — Message log as a platform feature

**Decision.** The shell provides a scrollable, colored, grouped message log; adapters feed it with `message-log` events (stable ids, updates replace). Adapters read the engine's own message history (Brogue: `messageArchive`, read-only) rather than scraping the screen.
**Consequences.** Every game gets a readable history on phones and desktop; engine conformance is unaffected because nothing is written to the game.

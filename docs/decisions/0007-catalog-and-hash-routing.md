# 0007 — Manifest-driven catalog; hash routing

**Decision.** `games/catalog.json` is the single source of truth for cards, detail pages, filters, roadmap and watchlist. Its Zod schema, which encodes rules such as "launchable games need an adapter, pinned revision and license report" and "blocked games need named blockers", runs in CI and unit tests. The browser bundle applies defaults only, so Zod is not shipped. Routes are hash-based for Pages compatibility.
**Consequences.** Adding a game's metadata is one JSON edit. Hash URLs are less pretty but always work on refresh.

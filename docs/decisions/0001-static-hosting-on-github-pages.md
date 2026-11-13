# 0001 — Static hosting on GitHub Pages; no backend

**Context.** The product promise is no accounts, no tracking and local saves. Games can run entirely client-side.
**Decision.** Ship a static site to GitHub Pages via the official Pages Actions. No servers, accounts, analytics or cloud saves.
**Consequences.** No custom headers: no COOP/COEP (see 0004) and the CSP goes in a meta tag. Site and bandwidth limits apply, so runtimes are lazy-loaded and sized. Deep links use hash routing (0007).

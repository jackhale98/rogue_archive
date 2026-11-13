# 0003 — Pinned upstream builds; content-addressed runtimes

**Decision.** Each game pins an upstream tag **and** commit (`games/<id>/upstream.env`, verified at build time) and a toolchain (`tools/toolchain.env`). CI builds runtimes from source; binaries are never committed. `runtime-manifest.json` lists every file with its SHA-256; the `buildId` is derived from them and names an immutable deploy directory. Clients verify hashes before executing anything.
**Consequences.** Reproducible, reviewable updates. Brogue CE's build has been checked to reproduce byte for byte. Upstream updates are deliberate PRs.

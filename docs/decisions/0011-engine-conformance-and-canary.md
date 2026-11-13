# 0011 — Engine conformance and upstream canary

**Decision.** Each port proves it behaves like upstream using upstream's own regression data (Brogue: seed catalogs), native-vs-WASM replay of saves/recordings, a source-driven input-coverage check and an upstream-drift check of everything copied from upstream. A weekly canary builds and tests against the latest release and development branch without deploying. Build scripts read source lists from upstream's build system.
**Consequences.** Upstream updates fail loudly and specifically, before release; "does feature X work" reduces to engine equivalence plus interface completeness rather than playing everything through.

# Security policy

Rogue Archive is a static site: there is no server, account system or stored personal data. Relevant issues include cross-site scripting, loading unverified code, Content Security Policy bypasses, save-import handling (imports must only ever be written as data), service worker cache poisoning, and supply-chain problems in build scripts or pinned upstream sources.

## Reporting

Please report vulnerabilities privately through GitHub's **"Report a vulnerability"** button (Security tab → Advisories) on this repository. Do not open a public issue for an unpatched vulnerability. Include steps to reproduce and the affected commit or deployed build ID (shown on each game page).

We aim to acknowledge reports within a week. Vulnerabilities inside a game itself should also be reported to that game's upstream project.

## Design measures

- Game runtimes are content-addressed and verified against SHA-256 checksums before they are executed.
- Production pages ship a Content Security Policy without `unsafe-eval` (only `wasm-unsafe-eval` for WebAssembly).
- Imported saves are validated (format, game id, size, checksums, path safety) and never executed.
- Upstream sources are pinned to commits that are verified at build time; toolchains are pinned.

# Updating a game

Never update automatically because upstream has new commits. An update is one reviewed PR per game.

## General process

1. Pick the new upstream **release** (not a floating branch). Read its changelog for breaking changes, save-format changes and platform-interface changes.
2. Re-check license files, asset licenses and the contribution policy. Update `LICENSES.md`.
3. Update `upstream.env` (tag and commit). If needed, update `tools/toolchain.env` in a separate commit, which means rebuilding every game that uses it.
4. Rebuild, run the game's conformance checks, unit tests and e2e tests, and play a few turns by hand: save, reload, load.
5. Decide what happens to players' saves from the previous version (see below) and say so in the release notes.
6. Update the catalog (`version`, `sourceRevision`), docs, sizes and compatibility.

## Brogue CE specifically

Brogue is the reference for how updates are made safe.

**Early warning.** `.github/workflows/upstream-canary.yml` runs weekly (and on demand) against Brogue's latest release and its development branch. It builds the port, runs engine conformance, the upstream-drift check and every e2e test, and never deploys anything. Run it locally with:

```sh
ROGUE_ARCHIVE_UPSTREAM_REF=latest-release pnpm canary:brogue   # or a tag, or master
```

**What can break, and what catches it:**

| Risk | Caught by |
|---|---|
| Upstream adds or moves source files (e.g. a vendored library) | Nothing to do: `build.sh` reads the source list and include paths from upstream's own Makefile |
| `struct brogueConsole` changes | Compile error (designated initializers) and the drift check |
| Copied code or values drift: `fontIndex`, screen geometry, tile-sheet layout and fit rules, hunger thresholds | `tests/conformance/upstream-drift.ts` names exactly what changed |
| On-screen strings the context-aware controls look for (`--MORE--`, targeting prompt, Yes/No) | Drift check, plus mobile e2e tests |
| New key commands | `key-coverage.ts` (every key code in `Rogue.h` must be reachable) |
| Level generation or rules compile differently in WASM | Seed catalogs from the new version's own `test/seed_catalogs` must match exactly |
| Fields read for the status bar renamed | Compile error in `port/rogue-archive-platform.c` |

**Saves across versions.** Brogue loads saves from the same minor version (e.g. 1.15.1 → 1.15.2). Across minor versions (1.15 → 1.16) it refuses them with "This file is from version … and cannot be opened", so it doesn't crash, but players' unfinished runs can't continue. The conformance replay shows this: a fixture from the old version stops replaying in the new one, while native and WASM still agree with each other. When updating across a minor version:

- regenerate the fixtures in `tests/recordings` with the new version (play, save, export);
- choose between telling players in advance to finish their runs, or keeping the previous build playable alongside the new one for saves made in it (runtime builds are content-addressed, so two can coexist; this needs a small catalog/shell feature that doesn't exist yet).

**Tried in practice:** in November 2026 the development branch (60 commits past 1.15.1) failed to link because it added cJSON for a new config file. That led to reading sources from upstream's Makefile. After that fix it built and passed seed catalogs, key coverage, the drift check and all 19 e2e tests. Only the 1.15.1 save fixture failed to replay, as expected for a new minor version.

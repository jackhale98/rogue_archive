# Updating a game

1. Pick the new upstream **release** (not a floating branch). Read its changelog for breaking changes, save-format changes and platform-interface changes.
2. Re-check license files, asset licenses and the contribution policy. Update `LICENSES.md`.
3. Update `upstream.env` (tag and commit). If needed, update `tools/toolchain.env` in a separate commit, which means rebuilding every game that uses it.
4. Rebuild (`scripts/build.sh`), reapply or revise patches, and re-check the platform layer against the upstream interface (for Brogue: `src/platform/platform.h`, `sdl2-platform.c`).
5. Run unit and e2e tests; manually play a few turns, save, reload and load.
6. Check that saves from the previous version load (or document that they don't; the engine decides compatibility). Note it in the release notes.
7. Update the catalog (`version`, `sourceRevision`), docs, sizes and compatibility. Open one PR per game update.

Never update automatically because upstream has new commits.

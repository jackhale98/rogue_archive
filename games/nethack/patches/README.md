# Patches to upstream NetHack

Applied in order by `scripts/build.sh` with `git apply`, on the pinned source.
Each patch says what it changes and why; none changes the game's rules.

| Patch | Why |
|---|---|
| `0001-libnh-catch-up-with-unixmain.patch` | Upstream's WebAssembly main file (`sys/libnh/libnhmain.c`) has fallen behind `sys/unix/unixmain.c` at 5.0.0: a duplicate `after_opt_showpaths()`, a static `whoami()` that `earlyarg.c` calls, and missing `get_nhuuid()`/`free_nhuuid()`. Without it the web build does not link (or aborts at start). |

These are not submitted upstream: the project's rules don't allow submitting AI-generated changes unless the upstream project accepts them.

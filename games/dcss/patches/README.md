# DCSS patches

**None.** The port builds pinned upstream source unmodified with upstream's own Makefile. It adds `port/rogue-archive-platform.cc` (the WebTiles socket replaced by the worker) and `port/compat/` (inert curses and backtrace shims for the headless build).

If a patch ever becomes necessary:

- Name it `NNNN-short-description.patch` (applied in order by `scripts/build.sh`).
- Add a section here: why it exists, whether it touches gameplay (it must not), the test demonstrating the need, and any upstream issue or PR that could remove it.
- Keep platform changes separate from anything else.

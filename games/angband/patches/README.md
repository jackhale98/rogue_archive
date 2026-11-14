# Angband patches

**None.** The port compiles pinned upstream source unmodified. It adds `port/main-web.c`, a display module for Angband's term interface (as upstream's own `main-gcu.c`, `main-x11.c`, `main-sdl2.c` and `main-win.c` are), selected through upstream's unchanged `main.c` by build flags.

If a patch ever becomes necessary:

- Name it `NNNN-short-description.patch` (applied in order by `scripts/build.sh`).
- Add a section here: why it exists, whether it touches gameplay (it must not), the test demonstrating the need, and any upstream issue or PR that could remove it.
- Keep platform changes separate from anything else.

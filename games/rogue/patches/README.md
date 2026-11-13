# Rogue patches

**None.** The port compiles the pinned Rogue 5.4.4 source release unmodified. It adds `port/config.h` (in place of the header upstream's `configure` would generate), `port/curses.h` + `port/curses-web.c` (a small curses for the browser) and `port/platform.c` (the browser's "user", so Rogue's home directory lookup works).

If a patch ever becomes necessary:

- Name it `NNNN-short-description.patch` (applied in order by `scripts/build.sh`).
- Add a section here: why it exists, whether it touches gameplay (it must not), the test demonstrating the need, and any upstream issue or PR that could remove it.
- Keep platform changes separate from anything else.

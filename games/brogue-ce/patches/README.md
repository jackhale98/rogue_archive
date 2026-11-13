# Brogue CE patches

**None.** The port compiles pinned upstream source unmodified and adds `port/rogue-archive-platform.c`.

If a patch ever becomes necessary:

- Name it `NNNN-short-description.patch` (applied in order by `scripts/build.sh`).
- Add a section here: why it exists, whether it touches gameplay (it must not), the test demonstrating the need, and any upstream issue or PR that could remove it.
- Keep platform changes separate from anything else.

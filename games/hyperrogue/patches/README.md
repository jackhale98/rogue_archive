# HyperRogue patches

**None.** The port compiles upstream's own web version (`hyperweb.cpp`) from the pinned source, unmodified. Everything the browser needs is done with upstream's own switches (`-DCAP_SAVE=1 -DCAP_CONFIG=1`, `-DMAXMDIM=4`, `-DEMSCRIPTEN_FIXED_ARG`) and one added file, `port/rogue-archive-web.cpp`, which includes `hyperweb.cpp` and adds the functions the page calls.

If a patch ever becomes necessary:

- Name it `NNNN-short-description.patch` (applied in order by `scripts/build.sh`).
- Add a section here: why it exists, whether it touches gameplay (it must not), the test demonstrating the need, and any upstream issue or PR that could remove it.
- Keep platform changes separate from anything else.

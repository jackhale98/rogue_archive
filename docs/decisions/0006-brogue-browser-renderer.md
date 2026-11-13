# 0006 — Brogue: custom platform layer and WebGL2 renderer

**Decision.** Implement Brogue CE's `struct brogueConsole` in one added C file, selected via upstream's existing `BROGUE_WEB` branch with a symbol rename, so there are no upstream patches. Render the 100×34 cell buffer with a WebGL2 shader using Brogue's own grayscale `tiles.png`, downscaled in linear light per upstream `tiles.c` rules.
**Alternatives.** Emscripten SDL2 + upstream `tiles.c` (main thread only, SDL input emulation, harder responsive and touch layout); upstream `web-platform.c` (needs a server).
**Consequences.** Close visual parity with text, tiles and hybrid modes; a simpler downscaler than upstream's (documented). Requires WebGL2, which every target browser has.

# 0004 — Engines in a Web Worker, Asyncify, single-threaded WASM

**Context.** Native roguelikes block in their input loop. Pages cannot enable cross-origin isolation, so SharedArrayBuffer/pthreads (and Atomics.wait-based blocking) are unavailable.
**Decision.** Run each engine in a dedicated module Worker. Make blocking calls yield with Emscripten Asyncify. Build single-threaded.
**Alternatives.** JSPI (not yet in every target browser), main-thread SDL builds (UI jank, harder layout and touch), pthreads (needs COOP/COEP).
**Consequences.** Some code-size and speed cost from Asyncify, acceptable for turn-based games. Re-evaluate JSPI when Safari ships it.

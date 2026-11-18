// SPDX-License-Identifier: GPL-2.0-only
/**
 * The host bridge of port/ncurses.pas, linked with `--js-library`: the
 * screen goes to `Module.raPresent(cells, cols, rows, cx, cy, cursor)`
 * (a copy of the two-byte cells), keys come from `Module.raKeyTake()`
 * (a character, a curses KEY_ code, or -1) and `Module.raKeyWait()` may
 * return a Promise (an Asyncify suspension) until one is queued. The
 * worker (adapter/worker.ts) and the Node harness provide them.
 */
addToLibrary({
  ra_present: (cells, cols, rows, cx, cy, cursor) => {
    const copy = cells ? HEAPU8.slice(cells, cells + cols * rows * 2) : null;
    Module['raPresent']?.(copy, cols, rows, cx, cy, cursor);
  },
  ra_key_take: () => Module['raKeyTake']?.() ?? -1,
  ra_key_wait__async: true,
  ra_key_wait: () =>
    Asyncify.handleSleep((wakeUp) => {
      Promise.resolve(Module['raKeyWait']?.()).then(() => wakeUp(0));
    }),
});

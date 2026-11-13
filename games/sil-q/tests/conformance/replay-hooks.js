// SPDX-License-Identifier: GPL-2.0-only
// Conformance-test hooks for the Node harness (linked with --pre-js): mount a
// fresh copy of the game data where the build expects it, and pass the key
// script through to tests/conformance/replay-platform.c.
(function () {
  if (typeof process === 'undefined') return;
  Module.preRun = (Module.preRun || []).concat(function () {
    FS.mkdir('/sil');
    FS.mkdir('/sil/lib');
    FS.mount(NODEFS, { root: process.env.RA_LIB_DIR }, '/sil/lib');
    ENV.RA_REPLAY_KEYS = process.env.RA_REPLAY_KEYS || '';
  });
})();

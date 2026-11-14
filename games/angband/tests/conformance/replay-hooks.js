// SPDX-License-Identifier: GPL-2.0-only
// Conformance-test hooks for the Node harness (linked with --pre-js): mount a
// fresh copy of the game data and an empty user directory where the build
// expects them, and pass the event script through to
// tests/conformance/replay-platform.c.
(function () {
  if (typeof process === 'undefined') return;
  Module.preRun = (Module.preRun || []).concat(function () {
    FS.mkdir('/angband');
    FS.mkdir('/angband/lib');
    FS.mkdir('/angband/user');
    FS.mount(NODEFS, { root: process.env.RA_LIB_DIR }, '/angband/lib');
    FS.mount(NODEFS, { root: process.env.RA_USER_DIR }, '/angband/user');
    ENV.RA_REPLAY_KEYS = process.env.RA_REPLAY_KEYS || '';
    ENV.RA_REPLAY_GRAPHICS = process.env.RA_REPLAY_GRAPHICS || '';
    if (process.env.RA_REPLAY_TRACE) ENV.RA_REPLAY_TRACE = process.env.RA_REPLAY_TRACE;
    ENV.TZ = 'UTC';
  });
})();

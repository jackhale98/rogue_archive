// SPDX-License-Identifier: BSD-3-Clause
// Conformance-test hooks for the Node harness (linked with --pre-js): Rogue's
// home directory (/rogue: savefiles, scoreboard) is a real directory, and the
// key script and options pass through to tests/conformance/replay-platform.c.
(function () {
  if (typeof process === 'undefined') return;
  Module.preRun = (Module.preRun || []).concat(function () {
    FS.mkdir('/rogue');
    FS.mount(NODEFS, { root: process.env.RA_HOME_DIR }, '/rogue');
    ENV.RA_REPLAY_KEYS = process.env.RA_REPLAY_KEYS || '';
    ENV.ROGUEOPTS = process.env.ROGUEOPTS || '';
  });
  // Relative paths (the savefile in ROGUEOPTS) resolve there, as natively.
  // (The runtime's start-up resets the working directory after preRun.)
  Module.onRuntimeInitialized = function () {
    FS.chdir('/rogue');
  };
})();

// SPDX-License-Identifier: GPL-2.0-or-later
// Hooks for the Node harness (linked with --pre-js). Conformance replays: the
// same key script and output as tests/conformance/replay-platform.cc, for the
// real platform layer (port/rogue-archive-platform.cc). The build also runs
// the harness with -builddb to generate the caches the site ships.
(function () {
  if (typeof process === 'undefined') return;
  var fs = require('fs');
  // The game data, as staged by build.sh, where the build expects it.
  Module.preRun = (Module.preRun || []).concat(function () {
    FS.mkdir('/crawl');
    FS.mkdir('/crawl/data');
    FS.mount(NODEFS, { root: process.env.RA_DATA_DIR }, '/crawl/data');
    // Build-time cache generation (scripts/build.sh, -builddb) writes DCSS's
    // level and database caches into a real directory.
    if (process.env.RA_SAVES_DIR) {
      FS.mkdir('/saves');
      FS.mount(NODEFS, { root: process.env.RA_SAVES_DIR }, '/saves');
    }
  });
  var inbox = ['{"msg":"attach","primary":true}'];
  var keys = (process.env.RA_REPLAY_KEYS || '')
    .split(',')
    .filter(Boolean)
    .map(function (code) {
      return '{"msg":"key","keycode":' + code + '}';
    });
  var outPath = process.env.RA_REPLAY_OUT || '/dev/null';
  var lines = [];
  var partial = [];
  var decoder = new TextDecoder();
  function finish() {
    fs.writeFileSync(outPath, lines.length ? lines.join('\n') + '\n' : '');
    process.exit(0);
  }
  Module.raSend = function (bytes) {
    var start = 0;
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 10) continue;
      partial.push(bytes.slice(start, i));
      var length = partial.reduce(function (sum, part) {
        return sum + part.length;
      }, 0);
      var whole = new Uint8Array(length);
      var at = 0;
      partial.forEach(function (part) {
        whole.set(part, at);
        at += part.length;
      });
      partial = [];
      var line = decoder.decode(whole);
      if (line.charAt(0) !== '*') lines.push(line);
      start = i + 1;
    }
    if (start < bytes.length) partial.push(bytes.slice(start));
  };
  Module.raPending = function () {
    return inbox.length > 0;
  };
  Module.raWait = function () {
    if (inbox.length === 0) {
      if (keys.length === 0) finish();
      inbox.push(keys.shift());
    }
    return Promise.resolve();
  };
  Module.raTake = function () {
    return new TextEncoder().encode(inbox.shift() || '');
  };
})();

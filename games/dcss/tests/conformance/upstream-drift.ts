// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream drift check: the port replaces the WebTiles socket and relies on a
// few things in upstream's client and message protocol. When a new upstream
// version changes any of them, this lists exactly what to re-review.
// Usage: node --experimental-strip-types upstream-drift.ts <crawl-ref/source>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2]!;
const read = (path: string) => readFileSync(join(src, path), 'utf8');
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
};

// 1. The socket calls port/rogue-archive-platform.cc replaces (tileweb.cc).
const tileweb = read('tileweb.cc');
const calls = new Set(
  [
    ...tileweb.matchAll(
      /(?<![.>\w])(socket|bind|setsockopt|sendto|recvfrom|recv|send|select|pselect|poll|accept|connect|listen)\s*\(/g,
    ),
  ].map((match) => match[1]),
);
const replaced = new Set(['socket', 'bind', 'setsockopt', 'sendto', 'recvfrom', 'select', 'pselect']);
for (const call of calls)
  check(replaced.has(call!), `tileweb.cc now calls ${call}(), which the platform layer does not replace`);
check(tileweb.includes('"attach"'), 'tileweb.cc no longer handles the "attach" control message');
check(tileweb.includes('m_msg_buf.append("\\n")'), 'tileweb.cc no longer ends each message with a newline');

// 2. Modules and globals host.js provides in place of the lobby (client.js).
const game = read('webserver/game_data/static/game.js');
const deps = /define\(\[([^\]]*)\]/.exec(game)?.[1] ?? '';
for (const module of deps.match(/"[^"]+"/g) ?? []) {
  const name = module.slice(1, -1);
  check(
    name.startsWith('./') || ['jquery', 'exports', 'comm', 'client', 'key_conversion'].includes(name),
    `game.js now depends on "${name}"`,
  );
}
const used = new Set<string>();
for (const file of [
  'game.js',
  'menu.js',
  'ui.js',
  'ui-layouts.js',
  'messages.js',
  'player.js',
  'textinput.js',
  'action_panel.js',
  'mouse_control.js',
  'debug.js',
]) {
  const code = read(`webserver/game_data/static/${file}`).replace(/\/\/.*$/gm, '');
  for (const match of code.matchAll(/\bclient\.([a-z_]+)/g)) used.add(match[1]!);
}
const provided = [
  'inhibit_messages',
  'uninhibit_messages',
  'delay',
  'in_game',
  'set_layer',
  'register_layer',
  'center_element',
  'is_watching',
  'show_dialog',
  'hide_dialog',
];
for (const name of used)
  check(provided.includes(name), `the game client now uses client.${name}, which host.js does not provide`);

// 3. game.html's server-side path template (rewritten by host.js).
check(
  read('webserver/game_data/templates/game.html').includes('/gamedata/{{ version }}/'),
  'game.html no longer uses /gamedata/{{ version }}/',
);

// 4. Messages the adapter follows (adapter/state.ts).
const handlers = [
  '"input_mode"',
  '"ui-push"',
  '"ui-pop"',
  '"menu"',
  '"close_menu"',
  '"msgs"',
  '"player"',
  '"layout"',
];
const clientSources = ['game.js', 'ui-layouts.js', 'menu.js', 'messages.js', 'player.js']
  .map((file) => read(`webserver/game_data/static/${file}`))
  .join('\n');
for (const handler of handlers)
  check(clientSources.includes(handler), `the client no longer handles ${handler}`);
const enums = read('webserver/game_data/static/enums.js');
check(
  /mouse_mode\.COMMAND = val\+\+;\s*exports\.mouse_mode\.TARGET = val\+\+;/.test(enums),
  'enums.js mouse_mode order changed (adapter/state.ts InputMode)',
);

if (problems.length) {
  console.error(`✗ upstream drift:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('✓ upstream drift: WebTiles socket interface, client modules and followed messages unchanged');

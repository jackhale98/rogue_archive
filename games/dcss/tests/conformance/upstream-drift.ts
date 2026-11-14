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

// 5. Yes/no questions are menus tagged "prompt" (adapter/state.ts).
check(
  /Menu pop\(flags, "prompt", KMC_CONFIRM\)/.test(read('prompt.cc')),
  'prompt.cc yesno() no longer uses a menu tagged "prompt"',
);

// 6. What the touch controls read from the client and the game (read only).
//    host.js map_context_reader: the client's map knowledge and monster data.
const statics = (file: string) => read(`webserver/game_data/static/${file}`);
const knowledge = statics('map_knowledge.js');
for (const name of ['get', 'visible', 'player_on_level'])
  check(new RegExp(`\\b${name}:`).test(knowledge), `map_knowledge.js no longer exports ${name}`);
check(
  /var attitude_classes = \[\s*"hostile",/.test(statics('monster_list.js')),
  'monster_list.js: attitude 0 is no longer "hostile" (host.js HOSTILE)',
);
check(
  /is_excluded\(monster\)\s*\{\s*return \(monster\.typedata\.no_exp/.test(statics('monster_list.js')),
  'monster_list.js changed which monsters it leaves out (host.js excluded())',
);
for (const field of ['"att"', '"threat"', '"mf"', '"pos"', '"quiver_desc"'])
  check(tileweb.includes(field), `tileweb.cc no longer sends ${field}`);
check(/pos: \{x: 0, y: 0\}/.test(statics('player.js')), 'player.js no longer keeps the player position');
// The client's MF_* list (enums.js) must match the game's map_feature up to MF_PORTAL.
const clientFeatures = [...enums.matchAll(/exports\.(MF_[A-Z_]+) = val\+\+;/g)].map((match) => match[1]!);
const gameFeatures = [...read('map-feature.h').matchAll(/^\s*(MF_[A-Z_]+),/gm)].map((match) => match[1]!);
const upTo = (list: string[]) => list.slice(0, list.indexOf('MF_PORTAL') + 1);
check(
  upTo(clientFeatures).length > 0 && upTo(clientFeatures).join() === upTo(gameFeatures).join(),
  'enums.js MF_* no longer match map-feature.h (host.js underfoot())',
);
const featTiles = statics('tileinfo-feat.js');
for (const tile of [
  'DNGN_ALTAR_ZIN',
  'SHOP_GENERAL',
  'DNGN_RETURN_ZOT',
  'DNGN_EXIT_ABYSS',
  'DNGN_EXIT_SEWER',
])
  check(featTiles.includes(`exports.${tile} =`), `tileinfo-feat.js no longer names ${tile}`);
check(/exports\.basetile = function/.test(statics('tileinfo-dngn.js')), 'tileinfo-dngn.js has no basetile()');
// Portal vaults' places read "a Sewer", "an Ossuary" (state.ts inPortalVault).
check(
  /!is_connected_branch\(place\.branch\)\)\s*\{\s*short_name = article_a\(short_name\);/.test(tileweb),
  'tileweb.cc no longer names one-level portal branches with an article',
);
//    Menus by tag, the stat prompt, Orb and Zot lights, spell knowledge (adapter/state.ts, input.ts).
const tags: [string, string][] = [
  ['travel.cc', 'tag = "travel";'],
  ['invent.cc', 'menu.set_tag("pickup");'],
  ['spl-cast.cc', 'spell_menu.set_tag("spell");'],
  ['ability.cc', 'abil_menu.set_tag("ability");'],
];
for (const [file, code] of tags) check(read(file).includes(code), `${file} no longer has ${code}`);
check(
  read('player-stats.cc').includes('Increase (S)trength, (I)ntelligence, or (D)exterity? '),
  'player-stats.cc changed the stat increase question',
);
check(read('message.cc').includes(`mpr("You don't know any spells.");`), 'message.cc: MSG_NO_SPELLS changed');
const status = read('status.cc');
check(
  /inf\.light_colour = LIGHTMAGENTA;\s*inf\.light_text = "Orb";/.test(status),
  'status.cc: the Orb light changed',
);
check(
  status.includes('inf.light_text = make_stringf("Zot (%d)", turns_until_zot());') &&
    /case 0:\s*inf\.light_colour = WHITE;/.test(status),
  'status.cc: the Zot light changed',
);

if (problems.length) {
  console.error(`✗ upstream drift:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  '✓ upstream drift: WebTiles socket interface, client modules, followed messages and touch-control reads unchanged',
);

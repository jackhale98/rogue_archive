// SPDX-License-Identifier: GPL-2.0-only
// Source-driven command check: every named command the touch dock and the
// command palette send must be bound, in Sil-Q's default (original) keyset,
// to the action it claims. Map commands are read from dungeon.c
// process_command; the direction digits from lib/pref/pref.prf's keymaps.
// Commands for prompts (Keys category) and the run modifier are skipped.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIL_COMMANDS } from '../../adapter/input.ts';

const root = process.argv[2]!;
const dungeon = readFileSync(join(root, 'src/dungeon.c'), 'utf8');
const start = dungeon.indexOf('static void process_command(void)');
const body = dungeon.slice(start, dungeon.indexOf('\n}\n', start));

/** What each command must do: a call or statement in its case block. */
const EXPECTED: Record<string, string> = {
  hold: 'do_cmd_hold(',
  rest: 'do_cmd_rest(',
  stealth: 'do_cmd_toggle_stealth(',
  upstairs: 'do_cmd_go_up(',
  downstairs: 'do_cmd_go_down(',
  open: 'do_cmd_open(',
  close: 'do_cmd_close(',
  bash: 'do_cmd_bash(',
  disarm: 'do_cmd_disarm(',
  tunnel: 'do_cmd_tunnel(',
  exchange: 'do_cmd_exchange(',
  alternate: 'do_cmd_alter(',
  fire: 'do_cmd_fire(1)',
  'fire-2': 'do_cmd_fire(2)',
  throw: 'do_cmd_throw(FALSE)',
  'throw-nearest': 'do_cmd_throw(TRUE)',
  sing: 'do_cmd_change_song(',
  inventory: 'do_cmd_inven(',
  equipment: 'do_cmd_equip(',
  pickup: 'do_cmd_pickup(',
  wear: 'do_cmd_wield(',
  remove: 'do_cmd_takeoff(',
  drop: 'do_cmd_drop(',
  eat: 'do_cmd_eat_food(',
  quaff: 'do_cmd_quaff_potion(',
  use: 'do_cmd_use_item(',
  activate: 'do_cmd_activate_staff(',
  play: 'do_cmd_play_instrument(',
  examine: 'do_cmd_observe(',
  inscribe: 'do_cmd_inscribe(',
  destroy: 'do_cmd_destroy(',
  prise: 'do_cmd_destroy(',
  fletchery: 'do_cmd_fletchery(',
  look: 'do_cmd_look(',
  map: 'do_cmd_view_map(',
  locate: 'do_cmd_locate(',
  monsters: 'do_cmd_view_monsters(',
  objects: 'do_cmd_view_objects(',
  character: 'do_cmd_character_sheet(',
  abilities: 'do_cmd_ability_screen(',
  smithing: 'do_cmd_smithing_screen(',
  knowledge: 'do_cmd_knowledge(',
  messages: 'do_cmd_messages(',
  help: 'do_cmd_help(',
  'game-menu': 'do_cmd_main_menu(',
  save: 'do_cmd_save_game(',
  'save-quit': 'p_ptr->playing = FALSE',
  options: 'do_cmd_options(',
  note: 'do_cmd_note(',
};

/** C case label → key code. */
function labelCode(label: string): number | null {
  const ktrl = /^KTRL\('(.)'\)$/.exec(label);
  if (ktrl) return ktrl[1]!.charCodeAt(0) & 31;
  if (label === 'ESCAPE') return 27;
  const char = /^'(\\?.)'$/.exec(label);
  if (!char) return null;
  const text = char[1]!;
  const escapes: Record<string, number> = { '\\t': 9, '\\n': 10, '\\r': 13, '\\a': 7, "\\'": 39, '\\\\': 92 };
  return text.length === 2 ? (escapes[text] ?? null) : text.charCodeAt(0);
}

// Each key's case block: from its label to the next `break;` at block level.
const blocks = new Map<number, string>();
const lines = body.split('\n');
let pending: number[] = [];
let block: string[] = [];
for (const raw of lines) {
  const line = raw.replace(/\/\/.*$/, '').trim();
  const label = /^case (.+):$/.exec(line);
  if (label) {
    if (block.length > 0) pending = [];
    block = [];
    const code = labelCode(label[1]!);
    if (code !== null) pending.push(code);
    continue;
  }
  block.push(line);
  if (/^break;$/.test(line) || /^default:/.test(line)) {
    for (const code of pending) blocks.set(code, block.join('\n'));
    pending = [];
    block = [];
  }
}

// Directions: the original keyset maps each digit to ';' (walk) + digit.
const pref = readFileSync(join(root, 'lib/pref/pref.prf'), 'utf8');
const walks = new Set<string>();
for (const match of pref.matchAll(/^A:;([1-9])\nC:0:([1-9])$/gm)) {
  if (match[1] === match[2]) walks.add(match[1]!);
}
if (!blocks.get(';'.charCodeAt(0))?.includes('do_cmd_walk(')) {
  throw new Error("';' no longer walks in process_command");
}

const problems: string[] = [];
let checked = 0;

// With another keyset, the adapter sends map commands after '\\', which
// request_command reads as "bypass keymaps" (util.c).
const util = readFileSync(join(root, 'src/util.c'), 'utf8');
const request = util.slice(util.indexOf('void request_command(void)'));
if (!/if \(ch == '\\\\'\)\s*\{[^}]*bypass keymaps/.test(request.slice(0, request.indexOf('\n}\n')))) {
  problems.push("request_command no longer bypasses keymaps after '\\\\'");
}
for (const command of SIL_COMMANDS) {
  if (command.category === 'Keys' || command.id === 'run') continue;
  const move = /^move-/.test(command.id);
  if (move) {
    const digit = String.fromCharCode(command.keys[0]!);
    if (!walks.has(digit)) problems.push(`${command.id}: '${digit}' is not a walk keymap in pref.prf`);
    checked++;
    continue;
  }
  const expected = EXPECTED[command.id];
  if (!expected) {
    problems.push(`${command.id}: no expected action recorded in key-coverage.ts`);
    continue;
  }
  if (command.keys.length !== 1) {
    problems.push(`${command.id}: expected a single key`);
    continue;
  }
  const code = command.keys[0]!;
  const found = blocks.get(code);
  if (!found)
    problems.push(`${command.id}: key ${code} (${command.shortcut}) is not bound in process_command`);
  else if (!found.includes(expected))
    problems.push(`${command.id}: key ${code} (${command.shortcut}) does not do ${expected}`);
  checked++;
}

if (problems.length > 0) {
  console.error(`Sil-Q key coverage: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Sil-Q key coverage: ${checked} commands bound as claimed`);

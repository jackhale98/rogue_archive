// SPDX-License-Identifier: BSD-3-Clause
// Source-driven command check: every named command the touch dock and the
// command palette send must be bound, in Rogue's command loop (command.c), to
// the action it claims. Rogue writes its switch with `when 'x': ...`
// (rogue.h: #define when break;case). Commands for prompts (Keys category)
// and the run modifier are skipped.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROGUE_COMMANDS } from '../../adapter/input.ts';

const root = process.argv[2]!;
const source = readFileSync(join(root, 'command.c'), 'utf8');
const start = source.indexOf('switch (ch)', source.indexOf('over:'));
const body = source.slice(start, source.indexOf('\n}\n', start));

/** What each command must do: a call or statement in its branch. */
const EXPECTED: Record<string, string> = {
  'move-nw': 'do_move(-1, -1)',
  'move-n': 'do_move(-1, 0)',
  'move-ne': 'do_move(-1, 1)',
  'move-w': 'do_move(0, -1)',
  'move-e': 'do_move(0, 1)',
  'move-sw': 'do_move(1, -1)',
  'move-s': 'do_move(1, 0)',
  'move-se': 'do_move(1, 1)',
  rest: 'Rest command',
  search: 'search()',
  downstairs: 'd_level()',
  upstairs: 'u_level()',
  pickup: 'pick_up(',
  'move-no-pickup': 'move_on = TRUE',
  'identify-trap': 'tr_name',
  fight: 'get_dir()',
  'fight-to-death': 'kamikaze = TRUE',
  throw: 'missile(',
  zap: 'do_zap()',
  inventory: 'inventory(pack, 0)',
  'inventory-one': 'picky_inven()',
  quaff: 'quaff()',
  read: 'read_scroll()',
  eat: 'eat()',
  wield: 'wield()',
  wear: 'wear()',
  'take-off': 'take_off()',
  'put-on': 'ring_on()',
  'remove-ring': 'ring_off()',
  drop: 'drop()',
  call: 'call()',
  identify: 'identify()',
  discoveries: 'discovered()',
  'last-message': 'msg(huh)',
  weapon: 'cur_weapon',
  armor: 'cur_armor',
  rings: 'cur_ring',
  status: 'status()',
  help: 'help()',
  version: 'release',
  repeat: 'last_comm',
  options: 'option()',
  redraw: 'wrefresh(curscr)',
  save: 'save_game()',
  quit: 'quit(0)',
};

/** C character literal → key code. */
function labelCode(label: string): number | null {
  const ctrl = /^CTRL\('(.)'\)$/.exec(label);
  if (ctrl) return ctrl[1]!.charCodeAt(0) & 31;
  if (label === 'ESCAPE') return 27;
  const char = /^'(\\?.)'$/.exec(label);
  if (!char) return null;
  const text = char[1]!;
  const escapes: Record<string, number> = { "\\'": 39, '\\\\': 92 };
  return text.length === 2 ? (escapes[text] ?? null) : text.charCodeAt(0);
}

// Each key's branch: from its label to the next label (Rogue's `when` breaks).
const branches = new Map<number, string>();
const label = /\b(?:when|case)\s+((?:CTRL\('.'\))|(?:'\\?.')|ESCAPE)\s*:/g;
const hits = [...body.matchAll(label)];
for (let i = 0; i < hits.length; i++) {
  const hit = hits[i]!;
  const code = labelCode(hit[1]!);
  if (code === null || branches.has(code)) continue;
  // Labels that fall through ("case 'f':" after "when 'F':") share the next branch.
  let end = hits[i + 1]?.index ?? body.length;
  let j = i + 1;
  while (j < hits.length && body.slice(hit.index! + hit[0].length, hits[j]!.index).trim() === '') {
    j++;
    end = hits[j]?.index ?? body.length;
  }
  branches.set(code, body.slice(hit.index!, end));
}

const problems: string[] = [];
let checked = 0;
for (const command of ROGUE_COMMANDS) {
  if (command.category === 'Keys' || command.id === 'run') continue;
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
  const found = branches.get(code);
  if (!found) problems.push(`${command.id}: key ${code} (${command.shortcut}) is not bound in command.c`);
  else if (!found.includes(expected))
    problems.push(`${command.id}: key ${code} (${command.shortcut}) does not do ${expected}`);
  checked++;
}

if (problems.length > 0) {
  console.error(`Rogue key coverage: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Rogue key coverage: ${checked} commands bound as claimed`);

// SPDX-License-Identifier: BSD-3-Clause
// Source-driven command check: every named command the touch dock and the
// command palette send must be bound, in Rogue's command loop (command.c), to
// the action it claims. Rogue writes its switch with `when 'x': ...`
// (rogue.h: #define when break;case). Commands for prompts (Keys category)
// are skipped; the run toggles are checked against Rogue's run keys (capitals,
// and the control codes that stop beside things), and a leading repeat count
// ("10s") against the digits Rogue reads before a command.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROGUE_COMMANDS, runKeys } from '../../adapter/input.ts';

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
  'rest-10': 'Rest command',
  'search-10': 'search()',
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
  // Consecutive labels ("when CTRL('H'): case CTRL('J'): ...") share the next branch.
  let end = hits[i + 1]?.index ?? body.length;
  let j = i + 1;
  const after = (k: number) => hits[k]!.index! + hits[k]![0].length;
  while (j < hits.length && body.slice(after(j - 1), hits[j]!.index).trim() === '') {
    j++;
    end = hits[j]?.index ?? body.length;
  }
  branches.set(code, body.slice(hit.index!, end));
}

const problems: string[] = [];
let checked = 0;

// The run toggles turn the next direction into a capital (Shift) or a control
// code (Ctrl), as the adapter's runKeys() does.
const RUNS: Record<string, { code: (letter: string) => number; expected: (letter: string) => string }> = {
  run: { code: (letter) => letter.toUpperCase().charCodeAt(0), expected: (letter) => `do_run('${letter}')` },
  'run-ctrl': { code: (letter) => runKeys('run-ctrl', letter)[0]!, expected: () => 'door_stop = TRUE' },
};
for (const [id, run] of Object.entries(RUNS)) {
  if (!ROGUE_COMMANDS.some((command) => command.id === id)) problems.push(`${id}: missing`);
  for (const letter of 'hjklyubn') {
    const code = run.code(letter);
    if (code !== runKeys(id as 'run' | 'run-ctrl', letter)[0])
      problems.push(`${id}: ${letter} is not sent as ${code}`);
    const found = branches.get(code);
    if (!found?.includes(run.expected(letter)))
      problems.push(`${id}: key ${code} (${letter}) does not do ${run.expected(letter)}`);
  }
  checked++;
}

// Counts: Rogue repeats only these commands (command.c turns the count off for others).
const countable = /switch \(ch\)\s*\{([\s\S]*?)break;\s*default:\s*count = 0;/.exec(source)?.[1] ?? '';
const countableCodes = new Set(
  [...countable.matchAll(/case\s+((?:CTRL\('.'\))|(?:'\\?.'))\s*:/g)].map((match) => labelCode(match[1]!)),
);
if (countableCodes.size === 0) problems.push('could not read the commands Rogue repeats from command.c');

for (const command of ROGUE_COMMANDS) {
  if (command.category === 'Keys' || command.id in RUNS) continue;
  const expected = EXPECTED[command.id];
  if (!expected) {
    problems.push(`${command.id}: no expected action recorded in key-coverage.ts`);
    continue;
  }
  // An optional repeat count, then the command's key.
  const digits = command.keys.findIndex((key) => key < 48 || key > 57);
  if (digits < 0 || command.keys.length !== digits + 1) {
    problems.push(`${command.id}: expected a single key, optionally after a count`);
    continue;
  }
  const code = command.keys[digits]!;
  if (digits > 0 && !countableCodes.has(code))
    problems.push(`${command.id}: Rogue ignores a count before ${command.shortcut}`);
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

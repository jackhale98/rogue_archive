// SPDX-License-Identifier: GPL-2.0-only
// Source-driven command check: every named command the touch dock and the
// command palette send must be bound, in both of Angband's keysets (original
// and roguelike), to the command it claims. The bindings are read from
// upstream's own tables: the command lists in src/ui-game.c (cmds_all, with
// the roguelike key defaulting to the original as ui-game.c's
// cmd_init does, later lists overriding earlier ones), and the keymaps in
// lib/customize/pref.prf, which take a key before the command lookup (a key
// with a keymap in a keyset never reaches the command table there).
// Movement and running are checked against pref.prf's keymaps; the store's
// keys against src/ui-store.c. Answers to prompts are not commands and are
// skipped.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANGBAND_COMMANDS, KC, commandKeys } from '../../adapter/input.ts';

const root = process.argv[2]!;
const uiGame = readFileSync(join(root, 'src/ui-game.c'), 'utf8');
const pref = readFileSync(join(root, 'lib/customize/pref.prf'), 'utf8');
const uiStore = readFileSync(join(root, 'src/ui-store.c'), 'utf8');

/** A C key expression from the tables → key code. */
function keyCode(expr: string): number | null {
  const text = expr.trim();
  const ktrl = /^KTRL\('(.)'\)$/.exec(text);
  if (ktrl) return ktrl[1]!.toUpperCase().charCodeAt(0) & 31;
  if (text === 'KC_TAB') return KC.TAB;
  if (text === 'KC_ENTER') return KC.ENTER;
  const char = /^'(\\?.)'$/.exec(text);
  if (!char) return null;
  const escapes: Record<string, number> = { "\\'": 39, '\\\\': 92, '\\0': 0 };
  return char[1]!.length === 2 ? (escapes[char[1]!] ?? null) : char[1]!.charCodeAt(0);
}

/** The lists cmds_all reaches with keymap level 0, in its order. */
const allStart = uiGame.indexOf('struct command_list cmds_all[]');
const lists = [
  ...uiGame.slice(allStart, uiGame.indexOf('};', allStart)).matchAll(/\{\s*"[^"]*",\s*(\w+),[^,]+,\s*0,/g),
].map((match) => match[1]!);
if (lists.length < 5) throw new Error('could not read cmds_all from ui-game.c');

/** [original, roguelike] key → command description, as converted_list builds them. */
const bound: [Map<number, string>, Map<number, string>] = [new Map(), new Map()];
for (const list of lists) {
  const start = uiGame.indexOf(`struct cmd_info ${list}[]`);
  const body = uiGame.slice(start, uiGame.indexOf('};', start));
  // { "Description", { key[, roguelike key] }, ... }: keys are 'c', KTRL('c') or KC_*.
  const key = String.raw`'(?:\\.|[^'])'|KTRL\('.'\)|KC_\w+`;
  const entry = new RegExp(
    String.raw`\{\s*"((?:[^"\\]|\\.)*)",\s*\{\s*((?:${key})(?:\s*,\s*(?:${key}))?)\s*\}`,
    'g',
  );
  for (const match of body.matchAll(entry)) {
    const description = match[1]!.replace(/\\"/g, '"');
    const keys = [...match[2]!.matchAll(new RegExp(key, 'g'))].map((found) => keyCode(found[0]));
    const original = keys[0] ?? null;
    const rogue = keys[1] ?? original;
    if (!original || !rogue) continue;
    bound[0].set(original, description);
    bound[1].set(rogue, description);
  }
}

/** Single keys pref.prf gives a keymap, per keyset (those never reach the command table). */
const keymapped: [Set<number>, Set<number>] = [new Set(), new Set()];
const actions = new Map<string, string[]>();
let action = '';
for (const line of pref.split('\n')) {
  const act = /^keymap-act:(.*)$/.exec(line);
  if (act) action = act[1]!;
  const input = /^keymap-input:([01]):(.*)$/.exec(line);
  if (!input) continue;
  const [mode, key] = [Number(input[1]), input[2]!];
  if ([...key].length === 1) keymapped[mode as 0 | 1].add(key.charCodeAt(0));
  const list = actions.get(`${mode}:${key}`) ?? [];
  list.push(action);
  actions.set(`${mode}:${key}`, list);
}

/** What each command must be: the description of its entry in ui-game.c's tables. */
const EXPECTED: Record<string, string> = {
  hold: 'Stand still',
  rest: 'Rest for a while',
  upstairs: 'Go up staircase',
  downstairs: 'Go down staircase',
  open: 'Open a door or a chest',
  close: 'Close a door',
  disarm: 'Disarm a trap or chest',
  tunnel: 'Dig a tunnel',
  alter: 'Alter a grid',
  jump: 'Walk into a trap',
  locate: 'Locate player on map',
  center: 'Center map',
  fire: 'Fire your missile weapon',
  'fire-nearest': 'Fire at nearest target',
  throw: 'Throw an item',
  cast: 'Cast a spell',
  browse: 'Browse a book',
  study: 'Gain new spells',
  target: 'Target monster or location',
  'target-closest': 'Target closest monster',
  inventory: 'Display inventory listing',
  equipment: 'Display equipment listing',
  quiver: 'Display quiver listing',
  pickup: 'Pick up objects',
  wear: 'Wear/wield an item',
  takeoff: 'Take off/unwield an item',
  drop: 'Drop an item',
  examine: 'Examine an item',
  eat: 'Eat some food',
  quaff: 'Quaff a potion',
  read: 'Read a scroll',
  fuel: 'Fuel your light source',
  staff: 'Use a staff',
  wand: 'Aim a wand',
  rod: 'Zap a rod',
  activate: 'Activate an object',
  use: 'Use an item',
  inscribe: 'Inscribe an object',
  uninscribe: 'Uninscribe an object',
  ignore: 'Ignore an item',
  look: 'Look around',
  map: 'Full dungeon map',
  monsters: 'Display visible monster list',
  objects: 'Display visible item list',
  character: 'Character description',
  abilities: 'View abilities',
  knowledge: 'Check knowledge',
  feeling: 'Repeat level feeling',
  messages: 'Show previous messages',
  symbol: 'Identify symbol',
  help: 'Help',
  repeat: 'Repeat previous command',
  options: 'Interact with options',
  save: "Save and don't quit",
  'save-quit': 'Save and quit',
  note: 'Take notes',
  redraw: 'Redraw the screen',
  retire: 'Retire character and quit',
};

/** Movement keys → the pref.prf names of the keys the pad sends, and their direction digits. */
const MOVES: Record<string, [string, string]> = {
  'move-nw': ['[Home]', '7'],
  'move-n': ['[Up]', '8'],
  'move-ne': ['[PageUp]', '9'],
  'move-w': ['[Left]', '4'],
  'move-e': ['[Right]', '6'],
  'move-sw': ['[End]', '1'],
  'move-s': ['[Down]', '2'],
  'move-se': ['[PageDown]', '3'],
};
const MOVE_CODES: Record<string, number> = {
  '[Home]': KC.HOME,
  '[Up]': KC.ARROW_UP,
  '[PageUp]': KC.PGUP,
  '[Left]': KC.ARROW_LEFT,
  '[Right]': KC.ARROW_RIGHT,
  '[End]': KC.END,
  '[Down]': KC.ARROW_DOWN,
  '[PageDown]': KC.PGDOWN,
};

const problems: string[] = [];
let checked = 0;
for (const command of ANGBAND_COMMANDS) {
  if (command.category === 'Keys' || command.id === 'run') continue;
  checked++;
  const move = MOVES[command.id];
  if (move) {
    const [name, digit] = move;
    if (command.keys.length !== 1 || command.keys[0] !== MOVE_CODES[name])
      problems.push(`${command.id}: should send ${name}`);
    for (const mode of [0, 1]) {
      // Walk (';' + digit) on the key, and run ('.' or ',' + digit) on Shift with it.
      if (!actions.get(`${mode}:${name}`)?.includes(`;${digit}`))
        problems.push(`${command.id}: ${name} does not walk ${digit} in keyset ${mode} (pref.prf)`);
      const run = mode === 0 ? `.${digit}` : `,${digit}`;
      if (!actions.get(`${mode}:{S}${name}`)?.includes(run))
        problems.push(`${command.id}: Shift+${name} does not run ${digit} in keyset ${mode} (pref.prf)`);
    }
    continue;
  }
  if (command.id === 'command-menu') {
    if (!/if \(key == KC_ENTER\)[\s\S]{0,200}textui_action_menu_choose/.test(uiGame))
      problems.push('command-menu: Enter no longer opens the command menu (ui-game.c)');
    continue;
  }
  const expected = EXPECTED[command.id];
  if (!expected) {
    problems.push(`${command.id}: no expected command recorded in key-coverage.ts`);
    continue;
  }
  for (const mode of [0, 1] as const) {
    const code = commandKeys(command, mode === 1)[0]!;
    const found = bound[mode].get(code);
    const keyset = mode === 0 ? 'original' : 'roguelike';
    if (keymapped[mode].has(code))
      problems.push(`${command.id}: key ${code} has a keymap in the ${keyset} keyset (pref.prf)`);
    else if (found !== expected)
      problems.push(
        `${command.id}: key ${code} is ${found ? `"${found}"` : 'unbound'} in the ${keyset} keyset, not "${expected}"`,
      );
  }
}

// The store's own keys (ui-store.c store_menu_handle).
for (const [id, key] of [
  ['buy', 'p'],
  ['sell', 's'],
  ['store-examine', 'l'],
] as const) {
  const command = ANGBAND_COMMANDS.find((candidate) => candidate.id === id)!;
  checked++;
  if (command.keys[0] !== key.charCodeAt(0) || !uiStore.includes(`case '${key}':`))
    problems.push(`${id}: '${key}' is not a store key in ui-store.c`);
}

if (problems.length > 0) {
  console.error(`Angband key coverage: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Angband key coverage: ${checked} commands bound as claimed in both keysets`);

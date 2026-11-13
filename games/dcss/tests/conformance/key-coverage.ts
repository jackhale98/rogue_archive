// SPDX-License-Identifier: GPL-2.0-or-later
// Source-driven command check: every command the touch controls and palette
// offer must send a key that upstream binds, in cmd-keys.h, to the command it
// is labelled as. A rebinding upstream fails here instead of a button quietly
// doing something else.
// Usage: node --experimental-strip-types key-coverage.ts <crawl-ref/source>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DCSS_COMMANDS, PALETTE, controlsFor, type DcssContext } from '../../adapter/input.ts';

const source = readFileSync(join(process.argv[2]!, 'cmd-keys.h'), 'utf8');

/** Upstream command each of our commands stands for. */
const EXPECTED: Record<string, string> = {
  'move-nw': 'CMD_MOVE_UP_LEFT',
  'move-n': 'CMD_MOVE_UP',
  'move-ne': 'CMD_MOVE_UP_RIGHT',
  'move-w': 'CMD_MOVE_LEFT',
  'move-e': 'CMD_MOVE_RIGHT',
  'move-sw': 'CMD_MOVE_DOWN_LEFT',
  'move-s': 'CMD_MOVE_DOWN',
  'move-se': 'CMD_MOVE_DOWN_RIGHT',
  wait: 'CMD_WAIT',
  rest: 'CMD_REST',
  explore: 'CMD_EXPLORE',
  downstairs: 'CMD_GO_DOWNSTAIRS',
  upstairs: 'CMD_GO_UPSTAIRS',
  travel: 'CMD_INTERLEVEL_TRAVEL',
  'open-door': 'CMD_OPEN_DOOR',
  'close-door': 'CMD_CLOSE_DOOR',
  autofight: 'CMD_AUTOFIGHT',
  autofire: 'CMD_AUTOFIRE',
  fire: 'CMD_FIRE',
  'fire-item': 'CMD_FIRE_ITEM_NO_QUIVER',
  quiver: 'CMD_QUIVER_ITEM',
  'primary-attack': 'CMD_PRIMARY_ATTACK',
  'weapon-swap': 'CMD_WEAPON_SWAP',
  shout: 'CMD_SHOUT',
  cast: 'CMD_CAST_SPELL',
  'force-cast': 'CMD_FORCE_CAST_SPELL',
  abilities: 'CMD_USE_ABILITY',
  evoke: 'CMD_EVOKE',
  memorise: 'CMD_MEMORISE_SPELL',
  spells: 'CMD_DISPLAY_SPELLS',
  religion: 'CMD_DISPLAY_RELIGION',
  inventory: 'CMD_DISPLAY_INVENTORY',
  pickup: 'CMD_PICKUP',
  drop: 'CMD_DROP',
  'drop-last': 'CMD_DROP_LAST',
  equip: 'CMD_EQUIP',
  unequip: 'CMD_UNEQUIP',
  wield: 'CMD_WIELD_WEAPON',
  quaff: 'CMD_QUAFF',
  read: 'CMD_READ',
  'inspect-floor': 'CMD_INSPECT_FLOOR',
  inscribe: 'CMD_INSCRIBE_ITEM',
  adjust: 'CMD_ADJUST_INVENTORY',
  autopickup: 'CMD_TOGGLE_AUTOPICKUP',
  look: 'CMD_LOOK_AROUND',
  map: 'CMD_DISPLAY_MAP',
  'full-view': 'CMD_FULL_VIEW',
  character: 'CMD_DISPLAY_CHARACTER_STATUS',
  resists: 'CMD_RESISTS_SCREEN',
  skills: 'CMD_DISPLAY_SKILLS',
  mutations: 'CMD_DISPLAY_MUTATIONS',
  experience: 'CMD_EXPERIENCE_CHECK',
  overview: 'CMD_DISPLAY_OVERMAP',
  runes: 'CMD_DISPLAY_RUNES',
  'known-items': 'CMD_DISPLAY_KNOWN_OBJECTS',
  terrain: 'CMD_SHOW_TERRAIN',
  messages: 'CMD_REPLAY_MESSAGES',
  search: 'CMD_SEARCH_STASHES',
  help: 'CMD_DISPLAY_COMMANDS',
  'game-menu': 'CMD_GAME_MENU',
  save: 'CMD_SAVE_GAME',
  note: 'CMD_MAKE_NOTE',
  annotate: 'CMD_ANNOTATE_LEVEL',
  dump: 'CMD_CHARACTER_DUMP',
  repeat: 'CMD_REPEAT_CMD',
  again: 'CMD_PREV_CMD_AGAIN',
  macros: 'CMD_MACRO_MENU',
  quit: 'CMD_QUIT',
  'next-target': 'CMD_TARGET_CYCLE_FORWARD',
  'previous-target': 'CMD_TARGET_CYCLE_BACK',
  'describe-target': 'CMD_TARGET_DESCRIBE',
  'target-here': 'CMD_TARGET_SELECT_ENDPOINT',
};
/** Keys for prompts and menus, which those prompts read directly; and the Run latch. */
const NOT_A_BINDING = new Set([
  'run',
  'confirm',
  'cancel',
  'continue',
  'yes',
  'no',
  'page-up',
  'page-down',
  'line-up',
  'line-down',
  'list',
]);

const NAMED: Record<string, string> = { Tab: "CONTROL('I')", Enter: 'CK_ENTER', Escape: 'ESCAPE' };
function token(command: (typeof DCSS_COMMANDS)[number]): string {
  const { key, ctrl } = command.keys;
  if (ctrl) return `CONTROL('${key.toUpperCase()}')`;
  if (key in NAMED) return NAMED[key]!;
  if (key === "'") return "'\\''";
  if (key === '\\') return "'\\\\'";
  return `'${key}'`;
}

// All {key, command} pairs (a key can be bound in several modes).
const bindings = new Map<string, Set<string>>();
for (const match of source.matchAll(/^\{\s*(.+?),\s*(CMD_[A-Z0-9_]+)\s*\}/gm)) {
  const [, key, command] = match;
  if (!bindings.has(key!)) bindings.set(key!, new Set());
  bindings.get(key!)!.add(command!);
}

const problems: string[] = [];
for (const command of DCSS_COMMANDS) {
  if (NOT_A_BINDING.has(command.id)) continue;
  const expected = EXPECTED[command.id];
  if (!expected) {
    problems.push(`${command.id}: no expected upstream command recorded in key-coverage.ts`);
    continue;
  }
  const bound = bindings.get(token(command));
  if (!bound?.has(expected))
    problems.push(
      `${command.id}: ${token(command)} is bound to ${bound ? [...bound].join(', ') : 'nothing'}, not ${expected}`,
    );
}

// Every command offered by any dock is a known command (no dangling ids).
const known = new Set([
  ...DCSS_COMMANDS.map((command) => command.id),
  'shell:palette',
  'shell:keyboard',
  'shell:log',
]);
const contexts: DcssContext[] = [
  'launcher',
  'loading',
  'start',
  'map',
  'menu',
  'popup',
  'more',
  'yesno',
  'prompt',
  'text',
  'targeting',
  'level-map',
  'busy',
];
for (const context of contexts) {
  for (const state of [
    { hp: 10, hpMax: 10, run: false },
    { hp: 1, hpMax: 10, run: true },
  ]) {
    const layout = controlsFor(context, state);
    for (const action of layout.actions) {
      const ids = typeof action === 'string' ? [action] : [action.command, ...(action.alternates ?? [])];
      for (const id of ids) if (!known.has(id)) problems.push(`${context}: unknown command ${id}`);
    }
  }
}
for (const id of PALETTE) if (!known.has(id)) problems.push(`palette: unknown command ${id}`);

if (problems.length) {
  console.error(`✗ key coverage:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `✓ key coverage: ${DCSS_COMMANDS.length - NOT_A_BINDING.size} commands send upstream's own bindings`,
);

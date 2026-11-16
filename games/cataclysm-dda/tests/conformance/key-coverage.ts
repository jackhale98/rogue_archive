// SPDX-License-Identifier: CC-BY-SA-3.0
// Source-driven command check against upstream's own keybindings
// (data/raw/keybindings.json, which the game's input_context reads):
//
// 1. every command the page offers names an upstream action (in normal play,
//    DEFAULTMODE, or a global action), and sends one of that action's default
//    keys, and shows that key;
// 2. every normal-play action with a default key is offered (so the palette
//    reaches everything the keyboard does);
// 3. every default keyboard key of every context can be sent by the page
//    (adapter/input.ts strokeForBinding), so the on-screen keyboard and the
//    commands can drive any screen.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CDDA_COMMANDS, COMMAND_BINDINGS, strokeForBinding } from '../../adapter/input.ts';

const root = process.argv[2]!;

interface Binding {
  input_method?: string;
  key: string | string[];
  mod?: string[];
}
interface Action {
  id: string;
  category?: string;
  name?: string;
  bindings?: Binding[];
}

const actions = JSON.parse(readFileSync(join(root, 'data/raw/keybindings.json'), 'utf8')) as Action[];
const keyboard = (binding: Binding) => !binding.input_method || binding.input_method.startsWith('keyboard');
const keyName = (binding: Binding) => (Array.isArray(binding.key) ? binding.key.join('+') : binding.key);

const problems: string[] = [];

// 1. Commands name upstream actions and send one of their default keys.
const inPlay = (action: Action) => action.category === 'DEFAULTMODE' || action.category === undefined;
for (const command of CDDA_COMMANDS) {
  const action = actions.find((candidate) => candidate.id === command.action && inPlay(candidate));
  if (!action) {
    problems.push(`${command.id}: no such action in normal play (DEFAULTMODE or global)`);
    continue;
  }
  const key = COMMAND_BINDINGS[command.id];
  const bound = (action.bindings ?? []).filter(keyboard).some((binding) => keyName(binding) === key);
  if (!bound) problems.push(`${command.id}: sends ${key}, which upstream does not bind to ${action.id}`);
}

// 2. Every keyed normal-play action is offered.
const offered = new Set(CDDA_COMMANDS.map((command) => command.action));
let keyed = 0;
for (const action of actions) {
  if (action.category !== 'DEFAULTMODE') continue;
  if (!(action.bindings ?? []).some(keyboard)) continue;
  keyed++;
  if (!offered.has(action.id))
    problems.push(`${action.id} (${action.name}): bound to a key upstream, not offered`);
}

// 3. Every default keyboard key can be sent.
let keys = 0;
const unsendable = new Set<string>();
for (const action of actions)
  for (const binding of (action.bindings ?? []).filter(keyboard)) {
    keys++;
    if (!strokeForBinding(keyName(binding), binding.mod ?? [])) unsendable.add(keyName(binding));
  }
for (const key of unsendable) problems.push(`key ${key}: the page cannot send it`);

if (problems.length > 0) {
  console.error(`Cataclysm: DDA key coverage: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Cataclysm: DDA key coverage: ${CDDA_COMMANDS.length} commands bound as claimed; all ${keyed} keyed normal-play actions offered; all ${keys} default keyboard bindings sendable`,
);

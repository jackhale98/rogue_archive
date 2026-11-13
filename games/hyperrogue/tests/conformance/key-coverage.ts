// SPDX-License-Identifier: GPL-2.0-or-later
// Source-driven command check: every command the touch dock, the thumb pad
// and the command palette send must be bound, in HyperRogue's control.cpp, to
// the action it claims. Reads the pinned upstream checkout.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HYPER_COMMANDS } from '../../adapter/input.ts';

const root = process.argv[2]!;
const control = readFileSync(join(root, 'control.cpp'), 'utf8');

/** For each command: a pattern its binding must match in control.cpp. */
const EXPECTED: Record<string, RegExp> = {
  // keys_vi = {'l','n','j','b','h','y','k','u'} (directions 0..7), used by handle_movement.
  'move-e': /keys_vi = \{\{'l',/,
  'move-se': /keys_vi = \{\{'l', 'n',/,
  'move-s': /keys_vi = \{\{'l', 'n', 'j',/,
  'move-sw': /keys_vi = \{\{'l', 'n', 'j', 'b',/,
  'move-w': /keys_vi = \{\{'l', 'n', 'j', 'b', 'h',/,
  'move-nw': /keys_vi = \{\{'l', 'n', 'j', 'b', 'h', 'y',/,
  'move-n': /keys_vi = \{\{'l', 'n', 'j', 'b', 'h', 'y', 'k',/,
  'move-ne': /keys_vi = \{\{'l', 'n', 'j', 'b', 'h', 'y', 'k', 'u'\}\}/,
  wait: /sym == '\.' \|\| sym == 's'\) movepcto\(-1, 1\)/,
  drop: /sym == 'g'[^\n]*\n\s*movepcto\(MD_DROP/,
  target: /sym == 't'[^\n]*\n[\s\S]{0,400}targetRangedOrb\(target, roKeyboard\)/,
  'fire-mode': /sym == 'f'[^\n]*\) bow::switch_fire_mode\(\)/,
  context: /uni == 'o' && DEFAULTNOR\(sym\)\) get_o_key\(\)\.second\(\)/,
  inventory: /uni == 'i' && DEFAULTNOR\(sym\) && inv::on[^\n]*\n\s*pushScreen\(inv::show\)/,
  mark: /uni == 'm' && canmove[^\n]*\n\s*mine::performMarkCommand\(mouseover\)/,
  // Tap modes: upstream's touch modes, which ra_set_touch_mode sets (a click
  // in "ranged" mode forces a ranged orb, as Shift+click; in "info" mode it
  // shows help, as right-click), and Mark, which presses m on the tapped cell.
  'aim-mode':
    /enum class tmode \{ move, info, drag, fire, ranged \}[\s\S]*touchmode == tmode::ranged\) \{[^\n]*\n[^\n]*\n\s*targetRangedOrb\(mouseover, roMouseForce\)/,
  'inspect-mode': /enum class tmode \{ move, info[\s\S]*touchmode == tmode::info\)\s*\n\s*gotoHelp\(help\)/,
  'mark-mode': /uni == 'm' && canmove[^\n]*\n\s*mine::performMarkCommand\(mouseover\)/,
  recenter: /\(sym == SDLK_F3 \|\| sym == ' '\) && DEFAULTNOR\(sym\)/,
  'rotate-left': /sym == SDLK_PAGEUP\) full_rotate_view/,
  'rotate-right': /sym == SDLK_PAGEDOWN\) full_rotate_view/,
  mission: /sym == SDLK_ESCAPE[^\n]*\n[\s\S]{0,200}showMissionScreen/,
  menu: /sym == 'v'[^\n]*DEFAULTNOR\(sym\)\)/,
  help: /sym == SDLK_F1\) gotoHelp\(help\)/,
  'new-game': /sym == SDLK_F5\)[\s\S]{0,300}restart_game\(\)/,
};

/** The shortcut each command must show (the original key). */
const SHORTCUT: Record<string, string> = {
  'move-e': 'l',
  'move-se': 'n',
  'move-s': 'j',
  'move-sw': 'b',
  'move-w': 'h',
  'move-nw': 'y',
  'move-n': 'k',
  'move-ne': 'u',
  wait: '.',
  drop: 'g',
  target: 't',
  'fire-mode': 'f',
  context: 'o',
  inventory: 'i',
  mark: 'm',
  'aim-mode': 'Shift+click',
  'inspect-mode': 'Right-click',
  'mark-mode': 'm',
  recenter: 'Space',
  'rotate-left': 'PgUp',
  'rotate-right': 'PgDn',
  mission: 'Esc',
  menu: 'v',
  help: 'F1',
  'new-game': 'F5',
};

const problems: string[] = [];
let checked = 0;
for (const command of HYPER_COMMANDS) {
  if (command.category === 'Keys') continue;
  const pattern = EXPECTED[command.id];
  if (!pattern) {
    problems.push(`${command.id}: no expected binding recorded in key-coverage.ts`);
    continue;
  }
  if (!pattern.test(control)) problems.push(`${command.id}: control.cpp no longer matches ${pattern}`);
  if (command.shortcut !== SHORTCUT[command.id])
    problems.push(`${command.id}: shows ${command.shortcut}, upstream's key is ${SHORTCUT[command.id]}`);
  checked++;
}

if (problems.length > 0) {
  console.error(`HyperRogue key coverage: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`HyperRogue key coverage: ${checked} commands bound as claimed`);

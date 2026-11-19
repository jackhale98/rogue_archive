// SPDX-License-Identifier: GPL-2.0-only
/**
 * DRL's input, as its console mode reads it: keys from a terminal through
 * curses (FPC Valkyrie's vcursesio, port/ncurses.pas). Browser keys become
 * what a terminal with the keypad on sends (characters, control codes and
 * curses KEY_ codes); vcursesio's CursesToKeyCode then gives DRL its own key
 * codes, as on Linux. Like upstream's curses driver, the console reads no
 * modifiers: Shift+arrow (run) and Ctrl+arrow (move the target) do nothing,
 * as in a Linux terminal; capital letters are Shift+letter bindings.
 *
 * Commands carry the keys DRL binds by default (drlkeybindings.pas); the
 * key-coverage check compares the two (tests/conformance/key-coverage.ts).
 */
import type {
  GameCommandDescriptor,
  GameInput,
  TouchAction,
  TouchControlLayout,
} from '@rogue-archive/game-api';
import { SHELL_COMMAND } from '@rogue-archive/game-api';

/** curses key codes (FreePascal's ncurses unit, port/ncurses.pas). */
export const KEY = {
  DOWN: 258,
  UP: 259,
  LEFT: 260,
  RIGHT: 261,
  HOME: 262,
  BACKSPACE: 263,
  F0: 264,
  DC: 330,
  IC: 331,
  NPAGE: 338,
  PPAGE: 339,
  B2: 350,
  BTAB: 353,
  END: 360,
} as const;

const ENTER = 13;
const ESCAPE = 27;
const TAB = 9;
const SPACE = 32;

const NAMED: Record<string, number> = {
  ArrowUp: KEY.UP,
  ArrowDown: KEY.DOWN,
  ArrowLeft: KEY.LEFT,
  ArrowRight: KEY.RIGHT,
  Home: KEY.HOME,
  End: KEY.END,
  PageUp: KEY.PPAGE,
  PageDown: KEY.NPAGE,
  // The numpad's 5 without NumLock.
  Clear: KEY.B2,
  Insert: KEY.IC,
  Delete: KEY.DC,
  Backspace: KEY.BACKSPACE,
  Enter: ENTER,
  Escape: ESCAPE,
  Tab: TAB,
};

/**
 * The key a terminal sends for a browser key, or null. The numpad gives
 * digits with NumLock on, as in a terminal (DRL binds 1-9 to its quick
 * keys), and Home, Up, PgUp... with it off.
 */
export function keyToCurses(input: Extract<GameInput, { type: 'key' }>): number | null {
  const { key, modifiers } = input;
  if (modifiers.meta) return null;
  if (key === 'Tab' && modifiers.shift) return KEY.BTAB;
  const named = NAMED[key];
  if (named !== undefined) return named;
  const fn = /^F([1-9]|1[0-2])$/.exec(key);
  if (fn) return KEY.F0 + Number(fn[1]);
  if (key.length !== 1) return null;
  const code = key.charCodeAt(0);
  if (code < 32 || code > 126) return null;
  if (modifiers.ctrl) {
    const upper = key.toUpperCase().charCodeAt(0);
    return upper >= 64 && upper <= 95 ? upper & 31 : null;
  }
  return code;
}

export interface DrlCommand extends GameCommandDescriptor {
  keys: number[];
}

const ch = (c: string) => c.charCodeAt(0);

function command(
  id: string,
  label: string,
  shortLabel: string,
  keys: number[],
  shortcut: string,
  category: string,
  description?: string,
): DrlCommand {
  return { id, label, shortLabel, keys, shortcut, category, ...(description ? { description } : {}) };
}

export const DRL_COMMANDS: readonly DrlCommand[] = [
  command('move-nw', 'Move up-left', '↖', [KEY.HOME], 'Home', 'Movement'),
  command('move-n', 'Move up', '↑', [KEY.UP], '↑', 'Movement'),
  command('move-ne', 'Move up-right', '↗', [KEY.PPAGE], 'PgUp', 'Movement'),
  command('move-w', 'Move left', '←', [KEY.LEFT], '←', 'Movement'),
  command('move-e', 'Move right', '→', [KEY.RIGHT], '→', 'Movement'),
  command('move-sw', 'Move down-left', '↙', [KEY.END], 'End', 'Movement'),
  command('move-s', 'Move down', '↓', [KEY.DOWN], '↓', 'Movement'),
  command('move-se', 'Move down-right', '↘', [KEY.NPAGE], 'PgDn', 'Movement'),
  command('wait', 'Wait a turn', 'Wait', [ch('w')], 'w', 'Movement'),
  command(
    'multi-wait',
    'Wait several turns',
    'Rest',
    [ch('W')],
    'W',
    'Movement',
    'Until an enemy comes into view.',
  ),
  command(
    'run',
    'Repeat move (run)',
    'Run',
    [ch(',')],
    ',',
    'Movement',
    'Then a direction: move until something comes into view.',
  ),
  command(
    'action',
    'Action',
    'Action',
    [SPACE],
    'Space',
    'Actions',
    'Open or close a door, take the stairs, press a button.',
  ),
  command(
    'fire',
    'Fire',
    'Fire',
    [ch('f')],
    'f',
    'Actions',
    'Fire the wielded weapon at the current target.',
  ),
  command('alt-fire', 'Alternative fire', 'Alt fire', [ch('F')], 'F', 'Actions'),
  command('target', 'Target', 'Target', [ch('t')], 't', 'Actions', 'Pick a target, then fire.'),
  command('alt-target', 'Alternative target', 'Alt target', [ch('T')], 'T', 'Actions'),
  command('next-target', 'Next target', 'Next', [TAB], 'Tab', 'Actions'),
  command('reload', 'Reload', 'Reload', [ch('r')], 'r', 'Actions'),
  command('alt-reload', 'Alternative reload', 'Alt reload', [ch('R')], 'R', 'Actions'),
  command('pickup', 'Pick up', 'Pick up', [ch('g')], 'g', 'Actions'),
  command('alt-pickup', 'Use or wear from the ground', 'Use here', [ch('G')], 'G', 'Actions'),
  command('unload', 'Unload weapon', 'Unload', [ch('u')], 'u', 'Actions'),
  command('swap', 'Swap weapon', 'Swap', [ch('z')], 'z', 'Actions', 'Swap the wielded and prepared weapons.'),
  command('active', 'Use active skill', 'Skill', [ch('x')], 'x', 'Actions'),
  command('look', 'Look', 'Look', [ch('l')], 'l', 'Actions'),
  command('more', 'More about the target', 'Info', [ch('m')], 'm', 'Actions'),
  command('more-self', 'More about yourself', 'Self', [ch('M')], 'M', 'Actions'),
  command('inventory', 'Inventory', 'Inventory', [ch('i')], 'i', 'Screens'),
  command('equipment', 'Equipment', 'Equip', [ch('e')], 'e', 'Screens'),
  command('traits', 'Traits', 'Traits', [ch('y')], 'y', 'Screens'),
  command('player', 'Player info', 'Player', [ch('p')], 'p', 'Screens'),
  command('messages', 'Message history', 'Messages', [ch('s')], 's', 'Screens'),
  command('assemblies', 'Known assemblies', 'Assemblies', [ch('a')], 'a', 'Screens'),
  command('help', 'Help', 'Help', [ch('h')], 'h', 'Screens'),
  command('menu', 'Game menu (save and quit)', 'Menu', [ESCAPE], 'Esc', 'Screens'),
  ...Array.from({ length: 9 }, (_, i) =>
    command(
      `quick-${i + 1}`,
      `Quick slot ${i + 1}`,
      `Slot ${i + 1}`,
      [ch(String(i + 1))],
      String(i + 1),
      'Quick slots',
    ),
  ),
  command('ok', 'OK / select', 'OK', [ENTER], 'Enter', 'Keys'),
  command('escape', 'Escape / cancel', 'Esc', [ESCAPE], 'Esc', 'Keys'),
  command('up', 'Up', '↑', [KEY.UP], '↑', 'Keys'),
  command('down', 'Down', '↓', [KEY.DOWN], '↓', 'Keys'),
  command('left', 'Left (panel)', '←', [KEY.LEFT], '←', 'Keys'),
  command('right', 'Right (panel)', '→', [KEY.RIGHT], '→', 'Keys'),
  command('page-up', 'Page up', 'PgUp', [KEY.PPAGE], 'PgUp', 'Keys'),
  command('page-down', 'Page down', 'PgDn', [KEY.NPAGE], 'PgDn', 'Keys'),
  command('backspace', 'Backspace (drop, delete)', 'Back', [KEY.BACKSPACE], 'Backspace', 'Keys'),
  command('yes', 'Yes', 'Yes', [ch('y')], 'y', 'Keys'),
  command('no', 'No', 'No', [ch('n')], 'n', 'Keys'),
];

export function findCommand(id: string): DrlCommand | undefined {
  return DRL_COMMANDS.find((candidate) => candidate.id === id);
}

/**
 * What the game shows (adapter/state.ts, detectContext): `title` is a full
 * screen without the HUD (the main menu, the choices before a game, its
 * texts); `pager` DRL's [more] prompt over the map.
 */
export type DrlContext =
  'title' | 'map' | 'look' | 'direction' | 'menu' | 'text' | 'yesno' | 'pager' | 'busy';

const PAD = {
  nw: 'move-nw',
  n: 'move-n',
  ne: 'move-ne',
  w: 'move-w',
  center: 'wait',
  e: 'move-e',
  sw: 'move-sw',
  s: 'move-s',
  se: 'move-se',
} as const;

/** Menus and the screens before a game: the arrows move, the centre selects (Enter). */
const MENU_PAD = { ...PAD, center: 'ok' } as const;

const PALETTE = DRL_COMMANDS.filter((entry) => entry.category !== 'Keys').map((entry) => entry.id);

export const DRL_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: PAD,
  actions: ['fire', 'action', 'reload', 'inventory', 'look', 'menu'],
  palette: [...PALETTE, SHELL_COMMAND.keyboard, SHELL_COMMAND.log],
};

export interface MapSituation {
  /** Health as a percentage (DRL's HUD), if shown. */
  health: number | null;
}

/** The dock for a context: tap the main action; long-press fans its related actions. */
export function controlsFor(
  context: DrlContext,
  situation: MapSituation = { health: null },
): TouchControlLayout {
  const palette = [...PALETTE, SHELL_COMMAND.keyboard, SHELL_COMMAND.log];
  switch (context) {
    case 'map': {
      const actions: (string | TouchAction)[] = [
        {
          command: 'fire',
          emphasis: 'primary',
          alternates: ['target', 'alt-fire', 'alt-target', 'next-target'],
        },
        { command: 'action', alternates: ['pickup', 'alt-pickup', 'run', 'multi-wait'] },
        { command: 'reload', alternates: ['alt-reload', 'swap', 'unload', 'active'] },
        { command: 'inventory', alternates: ['equipment', 'traits', 'player', 'assemblies'] },
        { command: 'look', alternates: ['more', 'more-self', 'messages', 'help'] },
        { command: 'menu', label: 'Menu' },
      ];
      // Low health: the med-packs and such are in the inventory, first.
      if (situation.health !== null && situation.health <= 30)
        actions.splice(0, 0, { command: 'inventory', label: 'Heal?', alternates: ['equipment'] });
      return { directionPad: PAD, actions, palette };
    }
    case 'look':
      return {
        directionPad: { ...PAD, center: null },
        actions: [
          { command: 'ok', label: 'Fire', emphasis: 'primary' },
          { command: 'next-target', label: 'Next' },
          { command: 'more', label: 'Info' },
          { command: 'escape', label: 'Cancel' },
        ],
        palette,
      };
    case 'direction':
      return {
        directionPad: { ...PAD, center: null },
        actions: [{ command: 'escape', label: 'Cancel' }],
        palette,
      };
    case 'menu':
    case 'title':
      // The pad moves through the choices (up and down; left and right
      // between panels, as the arrow keys do), Select in its centre.
      return {
        directionPad: MENU_PAD,
        actions: [
          { command: 'ok', label: 'Select', emphasis: 'primary' },
          { command: 'escape', label: 'Back', alternates: ['backspace'] },
        ],
        palette,
      };
    case 'yesno':
      return {
        actions: [
          { command: 'yes', emphasis: 'primary' },
          { command: 'no' },
          { command: 'escape', label: 'Cancel' },
        ],
        palette,
      };
    case 'text':
      return {
        actions: [
          { command: 'ok', label: 'Done', emphasis: 'primary' },
          { command: SHELL_COMMAND.keyboard, label: 'Keyboard' },
          { command: 'backspace', label: 'Delete' },
          { command: 'escape', label: 'Cancel' },
        ],
        palette,
      };
    case 'pager':
      return { actions: [{ command: 'ok', label: 'Continue', emphasis: 'primary', wide: true }], palette };
    case 'busy':
      return { actions: [{ command: 'escape', label: 'Stop' }], palette };
  }
}

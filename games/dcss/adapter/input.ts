// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * DCSS commands for touch and the command palette.
 *
 * Every command is a named shortcut for DCSS's own default key binding
 * (crawl-ref/source/cmd-keys.h, checked by tests/key-coverage.ts), delivered
 * to upstream's WebTiles client exactly like a typed key. Nothing here
 * changes what a key does; players' keyboard habits and macros keep working.
 *
 * Touch layouts are organized so that no action needs a settings or help
 * screen to find: the dock leads with the most common action for the current
 * context, a long press on each dock button fans out the related actions, and
 * the palette ("More") lists every command by category.
 */
import {
  SHELL_COMMAND,
  type GameCommandDescriptor,
  type GameInput,
  type TouchAction,
  type TouchControlLayout,
} from '@rogue-archive/game-api';

export type KeyInput = Extract<GameInput, { type: 'key' }>;

export interface KeySpec {
  key: string;
  code?: string;
  shift?: boolean;
  ctrl?: boolean;
}

export interface DcssCommand extends GameCommandDescriptor {
  keys: KeySpec;
}

export function keyInput(spec: KeySpec): KeyInput {
  return {
    type: 'key',
    key: spec.key,
    code: spec.code ?? '',
    modifiers: { shift: !!spec.shift, ctrl: !!spec.ctrl, alt: false, meta: false },
  };
}

const key = (char: string): KeySpec => ({ key: char });
const ctrl = (letter: string): KeySpec => ({ key: letter, code: `Key${letter.toUpperCase()}`, ctrl: true });

/** DCSS 0.34's commands with their default keys (cmd-keys.h). */
export const DCSS_COMMANDS: readonly DcssCommand[] = [
  // Movement: the vi keys. The pad sends these; Shift (or the Run latch) runs.
  { id: 'move-nw', label: 'Move up-left', shortcut: 'y', keys: key('y'), category: 'Movement' },
  { id: 'move-n', label: 'Move up', shortcut: 'k', keys: key('k'), category: 'Movement' },
  { id: 'move-ne', label: 'Move up-right', shortcut: 'u', keys: key('u'), category: 'Movement' },
  { id: 'move-w', label: 'Move left', shortcut: 'h', keys: key('h'), category: 'Movement' },
  { id: 'move-e', label: 'Move right', shortcut: 'l', keys: key('l'), category: 'Movement' },
  { id: 'move-sw', label: 'Move down-left', shortcut: 'b', keys: key('b'), category: 'Movement' },
  { id: 'move-s', label: 'Move down', shortcut: 'j', keys: key('j'), category: 'Movement' },
  { id: 'move-se', label: 'Move down-right', shortcut: 'n', keys: key('n'), category: 'Movement' },
  {
    id: 'run',
    label: 'Run',
    shortLabel: 'Run',
    shortcut: 'Shift+direction',
    keys: { key: 'Shift' },
    category: 'Movement',
    description: 'The next direction runs until something interesting happens.',
  },
  {
    id: 'wait',
    label: 'Wait a turn',
    shortLabel: 'Wait',
    shortcut: 's',
    keys: key('s'),
    category: 'Movement',
  },
  {
    id: 'rest',
    label: 'Rest until healed',
    shortLabel: 'Rest',
    shortcut: '5',
    keys: key('5'),
    category: 'Movement',
  },
  {
    id: 'explore',
    label: 'Auto-explore',
    shortLabel: 'Explore',
    shortcut: 'o',
    keys: key('o'),
    category: 'Movement',
  },
  {
    id: 'downstairs',
    label: 'Go down stairs',
    shortLabel: 'Down >',
    shortcut: '>',
    keys: key('>'),
    category: 'Movement',
  },
  {
    id: 'upstairs',
    label: 'Go up stairs',
    shortLabel: 'Up <',
    shortcut: '<',
    keys: key('<'),
    category: 'Movement',
  },
  {
    id: 'travel',
    label: 'Travel to a level or place',
    shortLabel: 'Travel',
    shortcut: 'G',
    keys: key('G'),
    category: 'Movement',
  },
  {
    id: 'open-door',
    label: 'Open door',
    shortLabel: 'Open',
    shortcut: 'O',
    keys: key('O'),
    category: 'Movement',
  },
  {
    id: 'close-door',
    label: 'Close door',
    shortLabel: 'Close',
    shortcut: 'C',
    keys: key('C'),
    category: 'Movement',
  },

  // Combat
  {
    id: 'autofight',
    label: 'Attack nearest',
    shortLabel: 'Fight',
    shortcut: 'Tab',
    keys: key('Tab'),
    category: 'Combat',
  },
  {
    id: 'autofire',
    label: 'Fire at nearest',
    shortLabel: 'Fire ⟶',
    shortcut: 'p',
    keys: key('p'),
    category: 'Combat',
  },
  {
    id: 'fire',
    label: 'Fire / throw (choose target)',
    shortLabel: 'Aim',
    shortcut: 'f',
    keys: key('f'),
    category: 'Combat',
  },
  {
    id: 'fire-item',
    label: 'Fire / throw an item',
    shortLabel: 'Throw',
    shortcut: 'F',
    keys: key('F'),
    category: 'Combat',
  },
  {
    id: 'quiver',
    label: 'Choose quivered action',
    shortLabel: 'Quiver',
    shortcut: 'Q',
    keys: key('Q'),
    category: 'Combat',
  },
  {
    id: 'primary-attack',
    label: 'Attack with weapon (choose target)',
    shortLabel: 'Strike',
    shortcut: 'v',
    keys: key('v'),
    category: 'Combat',
  },
  {
    id: 'weapon-swap',
    label: 'Swap weapons',
    shortLabel: 'Swap',
    shortcut: "'",
    keys: key("'"),
    category: 'Combat',
  },
  {
    id: 'shout',
    label: 'Shout / command allies',
    shortLabel: 'Shout',
    shortcut: 't',
    keys: key('t'),
    category: 'Combat',
  },

  // Magic and abilities
  { id: 'cast', label: 'Cast a spell', shortLabel: 'Cast', shortcut: 'z', keys: key('z'), category: 'Magic' },
  {
    id: 'force-cast',
    label: 'Cast without targeting',
    shortLabel: 'Force',
    shortcut: 'Z',
    keys: key('Z'),
    category: 'Magic',
  },
  {
    id: 'abilities',
    label: 'Use an ability',
    shortLabel: 'Ability',
    shortcut: 'a',
    keys: key('a'),
    category: 'Magic',
  },
  {
    id: 'evoke',
    label: 'Evoke an item',
    shortLabel: 'Evoke',
    shortcut: 'V',
    keys: key('V'),
    category: 'Magic',
  },
  {
    id: 'memorise',
    label: 'Memorise a spell',
    shortLabel: 'Learn',
    shortcut: 'M',
    keys: key('M'),
    category: 'Magic',
  },
  {
    id: 'spells',
    label: 'Known spells',
    shortLabel: 'Spells',
    shortcut: 'I',
    keys: key('I'),
    category: 'Magic',
  },
  { id: 'religion', label: 'Religion', shortLabel: 'God', shortcut: '^', keys: key('^'), category: 'Magic' },

  // Items
  {
    id: 'inventory',
    label: 'Inventory',
    shortLabel: 'Pack',
    shortcut: 'i',
    keys: key('i'),
    category: 'Items',
  },
  { id: 'pickup', label: 'Pick up', shortLabel: 'Pick up', shortcut: 'g', keys: key('g'), category: 'Items' },
  { id: 'drop', label: 'Drop', shortLabel: 'Drop', shortcut: 'd', keys: key('d'), category: 'Items' },
  {
    id: 'drop-last',
    label: 'Drop the last item(s) picked up',
    shortLabel: 'Drop last',
    shortcut: 'D',
    keys: key('D'),
    category: 'Items',
  },
  {
    id: 'equip',
    label: 'Equip (wear, wield, put on)',
    shortLabel: 'Equip',
    shortcut: 'e',
    keys: key('e'),
    category: 'Items',
  },
  {
    id: 'unequip',
    label: 'Unequip',
    shortLabel: 'Unequip',
    shortcut: 'c',
    keys: key('c'),
    category: 'Items',
  },
  {
    id: 'wield',
    label: 'Wield a weapon',
    shortLabel: 'Wield',
    shortcut: 'w',
    keys: key('w'),
    category: 'Items',
  },
  {
    id: 'quaff',
    label: 'Quaff (drink)',
    shortLabel: 'Quaff',
    shortcut: 'q',
    keys: key('q'),
    category: 'Items',
  },
  { id: 'read', label: 'Read', shortLabel: 'Read', shortcut: 'r', keys: key('r'), category: 'Items' },
  {
    id: 'inspect-floor',
    label: 'Examine items here',
    shortLabel: 'Here',
    shortcut: ';',
    keys: key(';'),
    category: 'Items',
  },
  {
    id: 'inscribe',
    label: 'Inscribe an item',
    shortLabel: 'Inscribe',
    shortcut: '{',
    keys: key('{'),
    category: 'Items',
  },
  {
    id: 'adjust',
    label: 'Adjust inventory letters',
    shortLabel: 'Adjust',
    shortcut: '=',
    keys: key('='),
    category: 'Items',
  },
  {
    id: 'autopickup',
    label: 'Toggle autopickup',
    shortLabel: 'Autopick',
    shortcut: 'Ctrl+A',
    keys: ctrl('a'),
    category: 'Items',
  },

  // Information
  {
    id: 'look',
    label: 'Look around',
    shortLabel: 'Look',
    shortcut: 'x',
    keys: key('x'),
    category: 'Information',
  },
  {
    id: 'map',
    label: 'Level map',
    shortLabel: 'Map',
    shortcut: 'X',
    keys: key('X'),
    category: 'Information',
  },
  {
    id: 'full-view',
    label: 'Monsters and items in view',
    shortLabel: 'In view',
    shortcut: 'Ctrl+X',
    keys: ctrl('x'),
    category: 'Information',
  },
  {
    id: 'character',
    label: 'Character status',
    shortLabel: 'Status',
    shortcut: '@',
    keys: key('@'),
    category: 'Information',
  },
  {
    id: 'resists',
    label: 'Resistances and equipment',
    shortLabel: 'Resists',
    shortcut: '%',
    keys: key('%'),
    category: 'Information',
  },
  {
    id: 'skills',
    label: 'Skills',
    shortLabel: 'Skills',
    shortcut: 'm',
    keys: key('m'),
    category: 'Information',
  },
  {
    id: 'mutations',
    label: 'Mutations',
    shortLabel: 'Mutations',
    shortcut: 'A',
    keys: key('A'),
    category: 'Information',
  },
  {
    id: 'experience',
    label: 'Experience',
    shortLabel: 'XP',
    shortcut: 'E',
    keys: key('E'),
    category: 'Information',
  },
  {
    id: 'overview',
    label: 'Dungeon overview',
    shortLabel: 'Overview',
    shortcut: 'Ctrl+O',
    keys: ctrl('o'),
    category: 'Information',
  },
  {
    id: 'runes',
    label: 'Runes',
    shortLabel: 'Runes',
    shortcut: '}',
    keys: key('}'),
    category: 'Information',
  },
  {
    id: 'known-items',
    label: 'Known items',
    shortLabel: 'Known',
    shortcut: '\\',
    keys: key('\\'),
    category: 'Information',
  },
  {
    id: 'terrain',
    label: 'Show terrain only',
    shortLabel: 'Terrain',
    shortcut: '|',
    keys: key('|'),
    category: 'Information',
  },
  {
    id: 'messages',
    label: 'Message history (in game)',
    shortLabel: 'History',
    shortcut: 'Ctrl+P',
    keys: ctrl('p'),
    category: 'Information',
  },
  {
    id: 'search',
    label: 'Find items and places',
    shortLabel: 'Find',
    shortcut: 'Ctrl+F',
    keys: ctrl('f'),
    category: 'Information',
  },
  {
    id: 'help',
    label: 'Help and commands',
    shortLabel: 'Help',
    shortcut: '?',
    keys: key('?'),
    category: 'Information',
  },

  // Game
  {
    id: 'game-menu',
    label: 'Game menu',
    shortLabel: 'Menu',
    shortcut: '~',
    keys: key('~'),
    category: 'Game',
  },
  { id: 'save', label: 'Save and exit', shortLabel: 'Save', shortcut: 'S', keys: key('S'), category: 'Game' },
  { id: 'note', label: 'Make a note', shortLabel: 'Note', shortcut: ':', keys: key(':'), category: 'Game' },
  {
    id: 'annotate',
    label: 'Annotate this level',
    shortLabel: 'Annotate',
    shortcut: '!',
    keys: key('!'),
    category: 'Game',
  },
  {
    id: 'dump',
    label: 'Write character dump',
    shortLabel: 'Dump',
    shortcut: '#',
    keys: key('#'),
    category: 'Game',
  },
  {
    id: 'repeat',
    label: 'Repeat a command',
    shortLabel: 'Repeat',
    shortcut: '0',
    keys: key('0'),
    category: 'Game',
  },
  {
    id: 'again',
    label: 'Do the last command again',
    shortLabel: 'Again',
    shortcut: '`',
    keys: key('`'),
    category: 'Game',
  },
  {
    id: 'macros',
    label: 'Macros and key mapping',
    shortLabel: 'Macros',
    shortcut: 'Ctrl+D',
    keys: ctrl('d'),
    category: 'Game',
  },
  {
    id: 'quit',
    label: 'Quit (abandon this character)',
    shortLabel: 'Quit',
    shortcut: 'Ctrl+Q',
    keys: ctrl('q'),
    category: 'Game',
  },

  // Keys used by prompts, menus and targeting.
  {
    id: 'confirm',
    label: 'Confirm / select',
    shortLabel: 'OK',
    shortcut: 'Enter',
    keys: key('Enter'),
    category: 'Keys',
  },
  {
    id: 'cancel',
    label: 'Cancel / close',
    shortLabel: 'Back',
    shortcut: 'Esc',
    keys: key('Escape'),
    category: 'Keys',
  },
  {
    id: 'continue',
    label: 'Continue (--more--)',
    shortLabel: 'Continue',
    shortcut: 'Space',
    keys: key(' '),
    category: 'Keys',
  },
  { id: 'yes', label: 'Yes', shortLabel: 'Yes', shortcut: 'Y', keys: key('Y'), category: 'Keys' },
  { id: 'no', label: 'No', shortLabel: 'No', shortcut: 'N', keys: key('N'), category: 'Keys' },
  {
    id: 'page-up',
    label: 'Page up',
    shortLabel: 'Page ▲',
    shortcut: 'PgUp',
    keys: key('PageUp'),
    category: 'Keys',
  },
  {
    id: 'page-down',
    label: 'Page down',
    shortLabel: 'Page ▼',
    shortcut: 'PgDn',
    keys: key('PageDown'),
    category: 'Keys',
  },
  { id: 'line-up', label: 'Up', shortLabel: '▲', shortcut: '↑', keys: key('ArrowUp'), category: 'Keys' },
  {
    id: 'line-down',
    label: 'Down',
    shortLabel: '▼',
    shortcut: '↓',
    keys: key('ArrowDown'),
    category: 'Keys',
  },
  {
    id: 'list',
    label: 'Show the choices',
    shortLabel: 'List',
    shortcut: '?',
    keys: key('?'),
    category: 'Keys',
  },
  {
    id: 'next-target',
    label: 'Next target',
    shortLabel: 'Next',
    shortcut: '+',
    keys: key('+'),
    category: 'Keys',
  },
  {
    id: 'previous-target',
    label: 'Previous target',
    shortLabel: 'Prev',
    shortcut: '-',
    keys: key('-'),
    category: 'Keys',
  },
  {
    id: 'describe-target',
    label: 'Describe what is targeted',
    shortLabel: 'Describe',
    shortcut: 'v',
    keys: key('v'),
    category: 'Keys',
  },
  {
    id: 'target-here',
    label: 'Stop at this spot',
    shortLabel: 'Here',
    shortcut: '.',
    keys: key('.'),
    category: 'Keys',
  },
];

const BY_ID = new Map(DCSS_COMMANDS.map((command) => [command.id, command]));

export function findCommand(id: string): DcssCommand | undefined {
  return BY_ID.get(id);
}

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

/** Commands the palette ("More") lists: all but single moves and prompt keys. */
export const PALETTE = DCSS_COMMANDS.filter(
  (command) => !command.id.startsWith('move-') && command.category !== 'Keys',
).map((command) => command.id);

export const DCSS_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: PAD,
  actions: ['explore', 'autofight', 'cast', 'inventory', 'look', SHELL_COMMAND.palette],
  palette: PALETTE,
};

/** What the game is waiting for, from the WebTiles messages. */
export type DcssContext =
  | 'launcher'
  | 'loading'
  | 'start'
  | 'map'
  | 'menu'
  | 'popup'
  | 'more'
  | 'yesno'
  | 'prompt'
  | 'text'
  | 'targeting'
  | 'level-map'
  | 'busy';

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/**
 * The dock for each context. In the map, six buttons cover everything:
 * long-press any of them for related actions, and "More" lists every command.
 */
export function controlsFor(
  context: DcssContext,
  state: { hp: number; hpMax: number; run: boolean },
): TouchControlLayout {
  switch (context) {
    case 'launcher':
      return { actions: [], palette: [] };
    case 'loading':
      // DCSS is starting (the start screen shows its progress); there is nothing to press yet.
      return { actions: [], palette: [] };
    case 'busy':
      return { actions: [a('cancel', { label: 'Stop' })], palette: PALETTE };
    case 'start':
      return {
        actions: [
          a('confirm', { label: 'OK', emphasis: 'primary' }),
          a('cancel', { label: 'Back' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'more':
      return {
        actions: [
          a('continue', { label: 'Continue', emphasis: 'primary', wide: true }),
          a('cancel', { label: 'Skip' }),
        ],
        palette: PALETTE,
      };
    case 'yesno':
      return {
        actions: [a('yes', { emphasis: 'primary' }), a('no'), a('cancel', { label: 'Cancel' })],
        palette: PALETTE,
      };
    case 'prompt':
      // "Quaff which item?" and similar: the choices are a key away, or typed.
      return {
        actions: [
          a('list', { label: 'Choices', emphasis: 'primary' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
          a('confirm', { label: 'OK' }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'text':
      return {
        actions: [
          a(SHELL_COMMAND.keyboard, { label: 'Type', emphasis: 'primary' }),
          a('confirm', { label: 'OK' }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'menu':
    case 'popup':
      return {
        actions: [
          a('cancel', { label: 'Close' }),
          a('page-up', { alternates: ['line-up'] }),
          a('page-down', { alternates: ['line-down'] }),
          a('confirm', { label: 'Select', emphasis: 'primary' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'targeting':
      return {
        directionPad: PAD,
        actions: [
          a('confirm', { label: 'Fire', emphasis: 'primary', alternates: ['target-here'] }),
          a('next-target', { alternates: ['previous-target'] }),
          a('describe-target', { label: 'Info' }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'level-map':
      return {
        directionPad: PAD,
        actions: [
          a('confirm', { label: 'Travel', emphasis: 'primary' }),
          a('downstairs', { label: '>', alternates: ['upstairs'] }),
          a('cancel', { label: 'Close' }),
        ],
        palette: PALETTE,
      };
    case 'map': {
      // Badly hurt and nothing in view to fight: resting is the likely next move.
      const wounded = state.hpMax > 0 && state.hp < state.hpMax * 0.5;
      return {
        directionPad: PAD,
        actions: [
          wounded
            ? a('rest', {
                emphasis: 'primary',
                alternates: ['explore', 'wait', 'run', 'downstairs', 'upstairs', 'travel'],
              })
            : state.run
              ? a('run', { label: 'Run ⇧', active: true })
              : a('explore', { alternates: ['rest', 'wait', 'run', 'downstairs', 'upstairs', 'travel'] }),
          a('autofight', {
            alternates: ['autofire', 'fire', 'fire-item', 'quiver', 'primary-attack', 'weapon-swap'],
          }),
          a('cast', { alternates: ['abilities', 'evoke', 'memorise', 'spells', 'religion', 'force-cast'] }),
          a('inventory', {
            alternates: ['pickup', 'equip', 'unequip', 'quaff', 'read', 'drop', 'inspect-floor'],
          }),
          a('look', {
            alternates: ['map', 'full-view', 'character', 'skills', 'resists', 'overview', 'mutations'],
          }),
          a(SHELL_COMMAND.palette, { label: 'More' }),
        ],
        palette: PALETTE,
      };
    }
  }
}

// SPDX-License-Identifier: GPL-2.0-only
/**
 * Sil-Q keys and commands.
 *
 * Keys are delivered as Sil reads them (term key codes: ASCII and control
 * codes). Arrow and keypad keys become Sil's own direction digits (the
 * original keyset moves with 1-9), and Shift+direction runs ('.' then the
 * direction), as Sil documents.
 *
 * Commands are named shortcuts for Sil's default (original keyset) bindings
 * (dungeon.c process_command; tests/conformance/key-coverage.ts checks them).
 * The touch dock leads with the most common action per context and fans out
 * related ones on a long press; "More" lists every command.
 */
import {
  SHELL_COMMAND,
  type GameCommandDescriptor,
  type GameInput,
  type TouchAction,
  type TouchControlLayout,
} from '@rogue-archive/game-api';

export const ESCAPE = 27;
const ctrl = (letter: string) => letter.toUpperCase().charCodeAt(0) & 31;

/** Arrow, Home/End/PageUp/PageDown and keypad keys as Sil direction digits. */
const DIRECTIONS: Record<string, string> = {
  ArrowUp: '8',
  ArrowDown: '2',
  ArrowLeft: '4',
  ArrowRight: '6',
  Home: '7',
  PageUp: '9',
  End: '1',
  PageDown: '3',
  Clear: '5',
};

/** Converts a key to the codes Sil should receive, or null if Sil has no use for it. */
export function keyToSil(input: Extract<GameInput, { type: 'key' }>): number[] | null {
  const { key, code, modifiers } = input;
  if (modifiers.meta) return null;
  let direction = DIRECTIONS[key];
  if (!direction && /^Numpad[1-9]$/.test(code)) direction = code.slice(6);
  if (direction) {
    // Shift+direction runs.
    return modifiers.shift ? ['.'.charCodeAt(0), direction.charCodeAt(0)] : [direction.charCodeAt(0)];
  }
  switch (key) {
    case 'Escape':
      return [ESCAPE];
    case 'Enter':
      return [13];
    case 'Backspace':
      return [8];
    case 'Tab':
      return [9];
    case 'Delete':
      return [127];
  }
  if (key.length !== 1) return null;
  const charCode = key.charCodeAt(0);
  if (charCode >= 0x80) return null;
  if (modifiers.ctrl) {
    const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? (/^[a-z]$/i.test(key) ? key.toUpperCase() : null);
    return letter ? [ctrl(letter)] : null;
  }
  return [charCode];
}

export interface SilCommand extends GameCommandDescriptor {
  /** Key codes sent. */
  keys: number[];
}

const k = (text: string) => [...text].map((char) => char.charCodeAt(0));

export const SIL_COMMANDS: readonly SilCommand[] = [
  { id: 'move-nw', label: 'Move up-left', shortcut: '7', keys: k('7'), category: 'Movement' },
  { id: 'move-n', label: 'Move up', shortcut: '8', keys: k('8'), category: 'Movement' },
  { id: 'move-ne', label: 'Move up-right', shortcut: '9', keys: k('9'), category: 'Movement' },
  { id: 'move-w', label: 'Move left', shortcut: '4', keys: k('4'), category: 'Movement' },
  { id: 'move-e', label: 'Move right', shortcut: '6', keys: k('6'), category: 'Movement' },
  { id: 'move-sw', label: 'Move down-left', shortcut: '1', keys: k('1'), category: 'Movement' },
  { id: 'move-s', label: 'Move down', shortcut: '2', keys: k('2'), category: 'Movement' },
  { id: 'move-se', label: 'Move down-right', shortcut: '3', keys: k('3'), category: 'Movement' },
  {
    id: 'run',
    label: 'Run',
    shortLabel: 'Run',
    shortcut: 'Shift+direction',
    keys: [],
    category: 'Movement',
    description: 'The next direction runs until something interesting happens.',
  },
  {
    id: 'hold',
    label: 'Hold still (a turn)',
    shortLabel: 'Hold',
    shortcut: 'z',
    keys: k('z'),
    category: 'Movement',
  },
  { id: 'rest', label: 'Rest', shortLabel: 'Rest', shortcut: 'Z', keys: k('Z'), category: 'Movement' },
  {
    id: 'stealth',
    label: 'Toggle stealth mode',
    shortLabel: 'Stealth',
    shortcut: 'S',
    keys: k('S'),
    category: 'Movement',
  },
  {
    id: 'upstairs',
    label: 'Go up stairs',
    shortLabel: 'Up <',
    shortcut: '<',
    keys: k('<'),
    category: 'Movement',
  },
  {
    id: 'downstairs',
    label: 'Go down stairs',
    shortLabel: 'Down >',
    shortcut: '>',
    keys: k('>'),
    category: 'Movement',
  },
  {
    id: 'open',
    label: 'Open a door or chest',
    shortLabel: 'Open',
    shortcut: 'o',
    keys: k('o'),
    category: 'Movement',
  },
  {
    id: 'close',
    label: 'Close a door',
    shortLabel: 'Close',
    shortcut: 'c',
    keys: k('c'),
    category: 'Movement',
  },
  { id: 'bash', label: 'Bash a door', shortLabel: 'Bash', shortcut: 'b', keys: k('b'), category: 'Movement' },
  {
    id: 'disarm',
    label: 'Disarm a trap or chest',
    shortLabel: 'Disarm',
    shortcut: 'D',
    keys: k('D'),
    category: 'Movement',
  },
  { id: 'tunnel', label: 'Tunnel', shortLabel: 'Tunnel', shortcut: 'T', keys: k('T'), category: 'Movement' },
  {
    id: 'exchange',
    label: 'Exchange places',
    shortLabel: 'Swap place',
    shortcut: 'X',
    keys: k('X'),
    category: 'Movement',
  },
  {
    id: 'alternate',
    label: 'Alternate action',
    shortLabel: 'Alt act',
    shortcut: '/',
    keys: k('/'),
    category: 'Movement',
  },

  {
    id: 'fire',
    label: 'Fire (first quiver)',
    shortLabel: 'Fire',
    shortcut: 'f',
    keys: k('f'),
    category: 'Combat',
  },
  {
    id: 'fire-2',
    label: 'Fire (second quiver)',
    shortLabel: 'Fire 2',
    shortcut: 'F',
    keys: k('F'),
    category: 'Combat',
  },
  {
    id: 'throw',
    label: 'Throw an item',
    shortLabel: 'Throw',
    shortcut: 't',
    keys: k('t'),
    category: 'Combat',
  },
  {
    id: 'throw-nearest',
    label: 'Throw at the nearest target',
    shortLabel: 'Throw ⟶',
    shortcut: 'Ctrl+T',
    keys: [ctrl('t')],
    category: 'Combat',
  },
  { id: 'sing', label: 'Sing a song', shortLabel: 'Sing', shortcut: 's', keys: k('s'), category: 'Combat' },

  { id: 'inventory', label: 'Inventory', shortLabel: 'Pack', shortcut: 'i', keys: k('i'), category: 'Items' },
  { id: 'equipment', label: 'Equipment', shortLabel: 'Gear', shortcut: 'e', keys: k('e'), category: 'Items' },
  { id: 'pickup', label: 'Pick up', shortLabel: 'Pick up', shortcut: 'g', keys: k('g'), category: 'Items' },
  { id: 'wear', label: 'Wear or wield', shortLabel: 'Wear', shortcut: 'w', keys: k('w'), category: 'Items' },
  { id: 'remove', label: 'Take off', shortLabel: 'Remove', shortcut: 'r', keys: k('r'), category: 'Items' },
  { id: 'drop', label: 'Drop', shortLabel: 'Drop', shortcut: 'd', keys: k('d'), category: 'Items' },
  { id: 'eat', label: 'Eat', shortLabel: 'Eat', shortcut: 'E', keys: k('E'), category: 'Items' },
  {
    id: 'quaff',
    label: 'Quaff a potion',
    shortLabel: 'Quaff',
    shortcut: 'q',
    keys: k('q'),
    category: 'Items',
  },
  { id: 'use', label: 'Use an item', shortLabel: 'Use', shortcut: 'u', keys: k('u'), category: 'Items' },
  {
    id: 'activate',
    label: 'Activate a staff',
    shortLabel: 'Staff',
    shortcut: 'a',
    keys: k('a'),
    category: 'Items',
  },
  {
    id: 'play',
    label: 'Play an instrument',
    shortLabel: 'Play',
    shortcut: 'p',
    keys: k('p'),
    category: 'Items',
  },
  {
    id: 'examine',
    label: 'Examine an item',
    shortLabel: 'Examine',
    shortcut: 'x',
    keys: k('x'),
    category: 'Items',
  },
  {
    id: 'inscribe',
    label: 'Inscribe an item',
    shortLabel: 'Inscribe',
    shortcut: '{',
    keys: k('{'),
    category: 'Items',
  },
  {
    id: 'destroy',
    label: 'Destroy an item',
    shortLabel: 'Destroy',
    shortcut: 'k',
    keys: k('k'),
    category: 'Items',
  },

  {
    id: 'fletchery',
    label: 'Make arrows (fletchery)',
    shortLabel: 'Fletch',
    shortcut: '-',
    keys: k('-'),
    category: 'Items',
  },
  {
    id: 'look',
    label: 'Look around',
    shortLabel: 'Look',
    shortcut: 'l',
    keys: k('l'),
    category: 'Information',
  },
  {
    id: 'map',
    label: 'Dungeon map',
    shortLabel: 'Map',
    shortcut: 'M',
    keys: k('M'),
    category: 'Information',
  },
  {
    id: 'locate',
    label: 'Locate yourself on the map',
    shortLabel: 'Locate',
    shortcut: 'L',
    keys: k('L'),
    category: 'Information',
  },
  {
    id: 'monsters',
    label: 'Monsters in view',
    shortLabel: 'Monsters',
    shortcut: '[',
    keys: k('['),
    category: 'Information',
  },
  {
    id: 'objects',
    label: 'Objects in view',
    shortLabel: 'Objects',
    shortcut: ']',
    keys: k(']'),
    category: 'Information',
  },
  {
    id: 'character',
    label: 'Character sheet',
    shortLabel: 'Character',
    shortcut: '@',
    keys: k('@'),
    category: 'Information',
  },
  {
    id: 'abilities',
    label: 'Abilities',
    shortLabel: 'Abilities',
    shortcut: 'Tab',
    keys: [9],
    category: 'Information',
  },
  {
    id: 'smithing',
    label: 'Smithing',
    shortLabel: 'Smithing',
    shortcut: '0',
    keys: k('0'),
    category: 'Information',
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    shortLabel: 'Knowledge',
    shortcut: '~',
    keys: k('~'),
    category: 'Information',
  },
  {
    id: 'messages',
    label: 'Previous messages (in game)',
    shortLabel: 'History',
    shortcut: 'Ctrl+P',
    keys: [ctrl('p')],
    category: 'Information',
  },
  { id: 'help', label: 'Help', shortLabel: 'Help', shortcut: '?', keys: k('?'), category: 'Information' },

  { id: 'game-menu', label: 'Main menu', shortLabel: 'Menu', shortcut: 'm', keys: k('m'), category: 'Game' },
  {
    id: 'save',
    label: 'Save (and keep playing)',
    shortLabel: 'Save',
    shortcut: 'Ctrl+S',
    keys: [ctrl('s')],
    category: 'Game',
  },
  {
    id: 'save-quit',
    label: 'Save and quit',
    shortLabel: 'Save & quit',
    shortcut: 'Ctrl+X',
    keys: [ctrl('x')],
    category: 'Game',
  },
  { id: 'options', label: 'Options', shortLabel: 'Options', shortcut: 'O', keys: k('O'), category: 'Game' },
  { id: 'note', label: 'Take a note', shortLabel: 'Note', shortcut: ':', keys: k(':'), category: 'Game' },

  {
    id: 'confirm',
    label: 'Confirm / select',
    shortLabel: 'OK',
    shortcut: 'Enter',
    keys: [13],
    category: 'Keys',
  },
  {
    id: 'cancel',
    label: 'Cancel / close',
    shortLabel: 'Back',
    shortcut: 'Esc',
    keys: [ESCAPE],
    category: 'Keys',
  },
  {
    id: 'continue',
    label: 'Continue (-more-)',
    shortLabel: 'Continue',
    shortcut: 'Space',
    keys: [32],
    category: 'Keys',
  },
  { id: 'yes', label: 'Yes', shortLabel: 'Yes', shortcut: 'y', keys: k('y'), category: 'Keys' },
  { id: 'no', label: 'No', shortLabel: 'No', shortcut: 'n', keys: k('n'), category: 'Keys' },
  {
    id: 'switch-items',
    label: 'Switch between pack and worn items',
    shortLabel: 'Worn/Pack',
    shortcut: '/',
    keys: k('/'),
    category: 'Keys',
  },
  {
    id: 'floor-item',
    label: 'The item on the floor',
    shortLabel: 'Floor',
    shortcut: '-',
    keys: k('-'),
    category: 'Keys',
  },
  {
    id: 'next-target',
    label: 'Next target',
    shortLabel: 'Next',
    shortcut: 'Space',
    keys: [32],
    category: 'Keys',
  },
  {
    id: 'select-target',
    label: 'Choose this target',
    shortLabel: 'Target',
    shortcut: 't',
    keys: k('t'),
    category: 'Keys',
  },
  {
    id: 'list',
    label: 'Show the choices',
    shortLabel: 'List',
    shortcut: '*',
    keys: k('*'),
    category: 'Keys',
  },
];

const BY_ID = new Map(SIL_COMMANDS.map((command) => [command.id, command]));

export function findCommand(id: string): SilCommand | undefined {
  return BY_ID.get(id);
}

export const PAD = {
  nw: 'move-nw',
  n: 'move-n',
  ne: 'move-ne',
  w: 'move-w',
  center: 'hold',
  e: 'move-e',
  sw: 'move-sw',
  s: 'move-s',
  se: 'move-se',
} as const;

export const PALETTE = SIL_COMMANDS.filter(
  (command) => !command.id.startsWith('move-') && command.category !== 'Keys',
).map((command) => command.id);

export const SIL_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: PAD,
  actions: ['rest', 'fire', 'inventory', 'look', SHELL_COMMAND.palette],
  palette: PALETTE,
};

export type SilContext =
  | 'title'
  | 'load'
  | 'map'
  | 'more'
  | 'yesno'
  | 'direction'
  | 'targeting'
  | 'item'
  | 'menu'
  | 'text'
  | 'screen'
  | 'busy';

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** A lettered choice on screen, as a dock button (its key is sent). */
export const CHOOSE = 'choose:';
/** A saved character, as a dock button (its name is typed). */
export const LOAD = 'load:';

/** The dock for each context. `choices` are lettered options shown on screen. */
export function controlsFor(
  context: SilContext,
  state: { hp: number; maxHp: number; run: boolean },
  choices: { key: string; label: string }[] = [],
  item: { canShow: boolean; switchTo: string | null; floor: boolean } | null = null,
  saves: readonly string[] = [],
): TouchControlLayout {
  const saveButtons = (label: (name: string) => string) =>
    saves.slice(0, 4).map((name) => a(`${LOAD}${name}`, { label: label(name), wide: true }));
  const choiceButtons = choices
    .slice(0, 8)
    .map((choice) =>
      a(`${CHOOSE}${choice.key}`, { label: choice.label ? `${choice.key}) ${choice.label}` : choice.key }),
    );
  switch (context) {
    case 'title':
      // Title and character creation: the screen's choices as large buttons;
      // on the main menu, saved characters can be continued directly.
      return {
        actions: [
          ...(choices.some((choice) => /Open saved character/.test(choice.label))
            ? saveButtons((name) => `Continue ${name}`)
            : []),
          ...choiceButtons,
          a('confirm', { label: 'OK', emphasis: 'primary' }),
          a('cancel', { label: 'Back' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'load':
      // "Open saved character": the saved characters by name.
      return {
        actions: [
          ...saveButtons((name) => name),
          a(SHELL_COMMAND.keyboard, { label: 'Type a name', emphasis: saves.length ? undefined : 'primary' }),
          a('confirm', { label: 'OK' }),
          a('cancel', { label: 'Back' }),
        ],
        palette: PALETTE,
      };
    case 'text':
      return {
        actions: [
          a(SHELL_COMMAND.keyboard, { label: 'Type', emphasis: 'primary' }),
          a('confirm', { label: 'OK' }),
          a('cancel', { label: 'Back' }),
        ],
        palette: PALETTE,
      };
    case 'busy':
      return { actions: [a('cancel', { label: 'Stop' })], palette: PALETTE };
    case 'more':
      return {
        actions: [a('continue', { emphasis: 'primary', wide: true }), a('cancel', { label: 'Skip' })],
        palette: PALETTE,
      };
    case 'yesno':
      return {
        actions: [a('yes', { emphasis: 'primary' }), a('no'), a('cancel', { label: 'Cancel' })],
        palette: PALETTE,
      };
    case 'direction':
      return {
        directionPad: PAD,
        actions: [
          a('select-target', { label: 'Nearest', emphasis: 'primary', alternates: ['list'] }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'targeting':
      return {
        directionPad: PAD,
        actions: [
          a('select-target', { emphasis: 'primary' }),
          a('next-target'),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'item':
      // "Drop which item?": the items as buttons (named once the list is shown).
      return {
        actions: [
          ...choiceButtons,
          ...(item?.canShow && choices.every((choice) => choice.label.length <= 1)
            ? [a('list', { label: 'Show items', emphasis: 'primary' as const })]
            : []),
          ...(item?.switchTo
            ? [a('switch-items', { label: item.switchTo === 'Equip' ? 'Worn' : 'Pack' })]
            : []),
          ...(item?.floor ? [a('floor-item', { label: 'Floor' })] : []),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'menu':
    case 'screen':
      return {
        actions: [
          ...choiceButtons,
          a('cancel', { label: 'Close' }),
          a('confirm', { label: 'Select', emphasis: 'primary' }),
          a('list', { label: 'Choices' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'map': {
      const wounded = state.maxHp > 0 && state.hp < state.maxHp * 0.5;
      return {
        directionPad: PAD,
        actions: [
          state.run
            ? a('run', { label: 'Run ⇧', active: true })
            : a('rest', {
                ...(wounded ? { emphasis: 'primary' as const } : {}),
                alternates: ['hold', 'run', 'stealth', 'downstairs', 'upstairs', 'pickup'],
              }),
          a('fire', { alternates: ['fire-2', 'throw', 'throw-nearest', 'sing'] }),
          a('inventory', {
            alternates: [
              'equipment',
              'wear',
              'remove',
              'eat',
              'quaff',
              'use',
              'drop',
              'activate',
              'play',
              'examine',
            ],
          }),
          a('open', {
            label: 'Doors',
            alternates: ['close', 'bash', 'disarm', 'tunnel', 'exchange', 'alternate'],
          }),
          a('look', {
            alternates: [
              'monsters',
              'objects',
              'map',
              'character',
              'abilities',
              'smithing',
              'knowledge',
              'messages',
            ],
          }),
          a(SHELL_COMMAND.palette, { label: 'More' }),
        ],
        palette: PALETTE,
      };
    }
  }
}

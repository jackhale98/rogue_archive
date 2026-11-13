// SPDX-License-Identifier: BSD-3-Clause
/**
 * Rogue keys and commands.
 *
 * Keys are delivered as Rogue reads them: letters, digits and control codes.
 * Arrow, Home/End/Page and keypad keys become Rogue's own direction letters
 * (hjklyubn); Shift+direction runs (the capital letter), as Rogue documents.
 * Digits stay digits: Rogue reads them as a repeat count.
 *
 * Commands are named shortcuts for Rogue's command keys (command.c;
 * tests/conformance/key-coverage.ts checks them). The touch dock leads with
 * the most common action per context and fans out related ones on a long
 * press; "More" lists every command.
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

/** Arrow, Home/End/PageUp/PageDown keys as Rogue's direction letters. */
const DIRECTIONS: Record<string, string> = {
  ArrowUp: 'k',
  ArrowDown: 'j',
  ArrowLeft: 'h',
  ArrowRight: 'l',
  Home: 'y',
  PageUp: 'u',
  End: 'b',
  PageDown: 'n',
};
/** The numeric keypad as directions (5 rests); the top-row digits are counts. */
const KEYPAD: Record<string, string> = {
  Numpad8: 'k',
  Numpad2: 'j',
  Numpad4: 'h',
  Numpad6: 'l',
  Numpad7: 'y',
  Numpad9: 'u',
  Numpad1: 'b',
  Numpad3: 'n',
  Numpad5: '.',
};

/** Converts a key to the codes Rogue should receive, or null if Rogue has no use for it. */
export function keyToRogue(input: Extract<GameInput, { type: 'key' }>): number[] | null {
  const { key, code, modifiers } = input;
  if (modifiers.meta) return null;
  const direction = DIRECTIONS[key] ?? KEYPAD[code];
  if (direction) {
    // Shift+direction runs (the capital letter); not for rest.
    const run = modifiers.shift && direction !== '.';
    return [(run ? direction.toUpperCase() : direction).charCodeAt(0)];
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

export interface RogueCommand extends GameCommandDescriptor {
  /** Key codes sent. */
  keys: number[];
}

const k = (text: string) => [...text].map((char) => char.charCodeAt(0));

export const ROGUE_COMMANDS: readonly RogueCommand[] = [
  { id: 'move-nw', label: 'Move up-left', shortcut: 'y', keys: k('y'), category: 'Movement' },
  { id: 'move-n', label: 'Move up', shortcut: 'k', keys: k('k'), category: 'Movement' },
  { id: 'move-ne', label: 'Move up-right', shortcut: 'u', keys: k('u'), category: 'Movement' },
  { id: 'move-w', label: 'Move left', shortcut: 'h', keys: k('h'), category: 'Movement' },
  { id: 'move-e', label: 'Move right', shortcut: 'l', keys: k('l'), category: 'Movement' },
  { id: 'move-sw', label: 'Move down-left', shortcut: 'b', keys: k('b'), category: 'Movement' },
  { id: 'move-s', label: 'Move down', shortcut: 'j', keys: k('j'), category: 'Movement' },
  { id: 'move-se', label: 'Move down-right', shortcut: 'n', keys: k('n'), category: 'Movement' },
  {
    id: 'run',
    label: 'Run',
    shortLabel: 'Run',
    shortcut: 'Shift+direction',
    keys: [],
    category: 'Movement',
    description: 'The next direction runs until something interesting happens.',
  },
  { id: 'rest', label: 'Rest a turn', shortLabel: 'Rest', shortcut: '.', keys: k('.'), category: 'Movement' },
  { id: 'search', label: 'Search', shortLabel: 'Search', shortcut: 's', keys: k('s'), category: 'Movement' },
  {
    id: 'downstairs',
    label: 'Go down stairs',
    shortLabel: 'Down >',
    shortcut: '>',
    keys: k('>'),
    category: 'Movement',
  },
  {
    id: 'upstairs',
    label: 'Go up stairs (with the Amulet)',
    shortLabel: 'Up <',
    shortcut: '<',
    keys: k('<'),
    category: 'Movement',
  },
  {
    id: 'pickup',
    label: 'Pick up',
    shortLabel: 'Pick up',
    shortcut: ',',
    keys: k(','),
    category: 'Movement',
  },
  {
    id: 'move-no-pickup',
    label: 'Move onto something without picking it up',
    shortLabel: 'Step over',
    shortcut: 'm',
    keys: k('m'),
    category: 'Movement',
  },
  {
    id: 'identify-trap',
    label: 'Identify a trap',
    shortLabel: 'Trap?',
    shortcut: '^',
    keys: k('^'),
    category: 'Movement',
  },

  { id: 'fight', label: 'Fight', shortLabel: 'Fight', shortcut: 'f', keys: k('f'), category: 'Combat' },
  {
    id: 'fight-to-death',
    label: 'Fight to the death',
    shortLabel: 'Fight!',
    shortcut: 'F',
    keys: k('F'),
    category: 'Combat',
  },
  { id: 'throw', label: 'Throw', shortLabel: 'Throw', shortcut: 't', keys: k('t'), category: 'Combat' },
  {
    id: 'zap',
    label: 'Zap a wand or staff',
    shortLabel: 'Zap',
    shortcut: 'z',
    keys: k('z'),
    category: 'Combat',
  },

  { id: 'inventory', label: 'Inventory', shortLabel: 'Pack', shortcut: 'i', keys: k('i'), category: 'Items' },
  {
    id: 'inventory-one',
    label: 'Inventory: one item',
    shortLabel: 'One item',
    shortcut: 'I',
    keys: k('I'),
    category: 'Items',
  },
  {
    id: 'quaff',
    label: 'Quaff a potion',
    shortLabel: 'Quaff',
    shortcut: 'q',
    keys: k('q'),
    category: 'Items',
  },
  { id: 'read', label: 'Read a scroll', shortLabel: 'Read', shortcut: 'r', keys: k('r'), category: 'Items' },
  { id: 'eat', label: 'Eat', shortLabel: 'Eat', shortcut: 'e', keys: k('e'), category: 'Items' },
  {
    id: 'wield',
    label: 'Wield a weapon',
    shortLabel: 'Wield',
    shortcut: 'w',
    keys: k('w'),
    category: 'Items',
  },
  { id: 'wear', label: 'Wear armor', shortLabel: 'Wear', shortcut: 'W', keys: k('W'), category: 'Items' },
  {
    id: 'take-off',
    label: 'Take armor off',
    shortLabel: 'Take off',
    shortcut: 'T',
    keys: k('T'),
    category: 'Items',
  },
  {
    id: 'put-on',
    label: 'Put on a ring',
    shortLabel: 'Ring on',
    shortcut: 'P',
    keys: k('P'),
    category: 'Items',
  },
  {
    id: 'remove-ring',
    label: 'Remove a ring',
    shortLabel: 'Ring off',
    shortcut: 'R',
    keys: k('R'),
    category: 'Items',
  },
  { id: 'drop', label: 'Drop', shortLabel: 'Drop', shortcut: 'd', keys: k('d'), category: 'Items' },
  {
    id: 'call',
    label: 'Call (name) an item',
    shortLabel: 'Call',
    shortcut: 'c',
    keys: k('c'),
    category: 'Items',
  },

  {
    id: 'identify',
    label: 'Identify a symbol on screen',
    shortLabel: 'What is?',
    shortcut: '/',
    keys: k('/'),
    category: 'Information',
  },
  {
    id: 'discoveries',
    label: 'What you have discovered',
    shortLabel: 'Known',
    shortcut: 'D',
    keys: k('D'),
    category: 'Information',
  },
  {
    id: 'last-message',
    label: 'Repeat the last message',
    shortLabel: 'Last msg',
    shortcut: 'Ctrl+P',
    keys: [ctrl('p')],
    category: 'Information',
  },
  {
    id: 'weapon',
    label: 'Current weapon',
    shortLabel: 'Weapon',
    shortcut: ')',
    keys: k(')'),
    category: 'Information',
  },
  {
    id: 'armor',
    label: 'Current armor',
    shortLabel: 'Armor',
    shortcut: ']',
    keys: k(']'),
    category: 'Information',
  },
  {
    id: 'rings',
    label: 'Current rings',
    shortLabel: 'Rings',
    shortcut: '=',
    keys: k('='),
    category: 'Information',
  },
  {
    id: 'status',
    label: 'Status line',
    shortLabel: 'Status',
    shortcut: '@',
    keys: k('@'),
    category: 'Information',
  },
  {
    id: 'help',
    label: 'Help (command list)',
    shortLabel: 'Help',
    shortcut: '?',
    keys: k('?'),
    category: 'Information',
  },
  {
    id: 'version',
    label: 'Version',
    shortLabel: 'Version',
    shortcut: 'v',
    keys: k('v'),
    category: 'Information',
  },

  {
    id: 'repeat',
    label: 'Repeat the last command',
    shortLabel: 'Again',
    shortcut: 'a',
    keys: k('a'),
    category: 'Game',
  },
  { id: 'options', label: 'Options', shortLabel: 'Options', shortcut: 'o', keys: k('o'), category: 'Game' },
  {
    id: 'redraw',
    label: 'Redraw the screen',
    shortLabel: 'Redraw',
    shortcut: 'Ctrl+R',
    keys: [ctrl('r')],
    category: 'Game',
  },
  {
    id: 'save',
    label: 'Save and stop playing',
    shortLabel: 'Save',
    shortcut: 'S',
    keys: k('S'),
    category: 'Game',
  },
  {
    id: 'quit',
    label: 'Quit (give up the character)',
    shortLabel: 'Quit',
    shortcut: 'Q',
    keys: k('Q'),
    category: 'Game',
  },

  { id: 'confirm', label: 'Enter', shortLabel: 'OK', shortcut: 'Enter', keys: [13], category: 'Keys' },
  { id: 'cancel', label: 'Cancel', shortLabel: 'Cancel', shortcut: 'Esc', keys: [ESCAPE], category: 'Keys' },
  {
    id: 'continue',
    label: 'Continue (--More--)',
    shortLabel: 'Continue',
    shortcut: 'Space',
    keys: [32],
    category: 'Keys',
  },
  { id: 'yes', label: 'Yes', shortLabel: 'Yes', shortcut: 'y', keys: k('y'), category: 'Keys' },
  { id: 'no', label: 'No', shortLabel: 'No', shortcut: 'n', keys: k('n'), category: 'Keys' },
  { id: 'list', label: 'Show the list', shortLabel: 'List', shortcut: '*', keys: k('*'), category: 'Keys' },
];

const BY_ID = new Map(ROGUE_COMMANDS.map((command) => [command.id, command]));

export function findCommand(id: string): RogueCommand | undefined {
  return BY_ID.get(id);
}

export const PAD = {
  nw: 'move-nw',
  n: 'move-n',
  ne: 'move-ne',
  w: 'move-w',
  center: 'search',
  e: 'move-e',
  sw: 'move-sw',
  s: 'move-s',
  se: 'move-se',
} as const;

export const PALETTE = ROGUE_COMMANDS.filter(
  (command) => !command.id.startsWith('move-') && command.category !== 'Keys',
).map((command) => command.id);

export const ROGUE_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: PAD,
  actions: ['search', 'fight', 'inventory', 'downstairs', 'identify', SHELL_COMMAND.palette],
  palette: PALETTE,
};

export type RogueContext =
  'start' | 'map' | 'more' | 'enter' | 'yesno' | 'direction' | 'item' | 'menu' | 'text' | 'busy';

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** A lettered choice on screen, as a dock button (its key is sent). */
export const CHOOSE = 'choose:';

/** The dock for each context. `choices` are lettered options shown on screen. */
export function controlsFor(
  context: RogueContext,
  state: { hp: number; maxHp: number; run: boolean },
  choices: { key: string; label: string }[] = [],
): TouchControlLayout {
  const choiceButtons = choices
    .slice(0, 8)
    .map((choice) =>
      a(`${CHOOSE}${choice.key}`, { label: choice.label ? `${choice.key}) ${choice.label}` : choice.key }),
    );
  switch (context) {
    case 'start':
      return { actions: [], palette: [] };
    case 'busy':
      return { actions: [a('cancel', { label: 'Stop' })], palette: PALETTE };
    case 'more':
      return { actions: [a('continue', { emphasis: 'primary', wide: true })], palette: PALETTE };
    case 'enter':
      return {
        actions: [a('confirm', { label: 'Continue', emphasis: 'primary', wide: true })],
        palette: PALETTE,
      };
    case 'yesno':
      return {
        actions: [a('yes', { emphasis: 'primary' }), a('no'), a('cancel')],
        palette: PALETTE,
      };
    case 'direction':
      // "which direction?": the pad answers it.
      return { directionPad: PAD, actions: [a('cancel')], palette: PALETTE };
    case 'item':
      // "which object do you want to read? (* for list)": the pack's letters
      // are only known once the list is shown.
      return {
        actions: [
          ...choiceButtons,
          ...(choices.length === 0 ? [a('list', { label: 'Show items', emphasis: 'primary' as const })] : []),
          a('cancel'),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'menu':
      return {
        actions: [...choiceButtons, a('continue', { label: 'Close', emphasis: 'primary' }), a('cancel')],
        palette: PALETTE,
      };
    case 'text':
      return {
        actions: [
          a(SHELL_COMMAND.keyboard, { label: 'Type', emphasis: 'primary' }),
          a('confirm'),
          a('cancel'),
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
            : a('search', {
                ...(wounded ? { emphasis: 'primary' as const } : {}),
                alternates: ['rest', 'run', 'pickup', 'move-no-pickup', 'identify-trap', 'repeat'],
              }),
          a('fight', { alternates: ['fight-to-death', 'throw', 'zap'] }),
          a('inventory', {
            alternates: [
              'eat',
              'quaff',
              'read',
              'wield',
              'wear',
              'take-off',
              'put-on',
              'remove-ring',
              'drop',
              'call',
              'inventory-one',
            ],
          }),
          a('downstairs', { label: 'Stairs', alternates: ['upstairs'] }),
          a('identify', {
            label: 'Look',
            alternates: ['discoveries', 'last-message', 'weapon', 'armor', 'rings', 'help'],
          }),
          a(SHELL_COMMAND.palette, { label: 'More' }),
        ],
        palette: PALETTE,
      };
    }
  }
}

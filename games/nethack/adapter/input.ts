// SPDX-License-Identifier: NGPL
/**
 * NetHack's commands on their original keys (Guidebook, "Commands"; the
 * default keys, number_pad off), the shell's key mapping, and the touch
 * controls for each context the window port reports.
 */
import {
  SHELL_COMMAND,
  type GameCommandDescriptor,
  type GameInput,
  type TouchAction,
  type TouchControlLayout,
} from '@rogue-archive/game-api';
import type { NhContext } from './windowport.ts';

const k = (key: string): number[] => [...key].map((c) => c.charCodeAt(0));
const ctrl = (letter: string): number => letter.toUpperCase().charCodeAt(0) - 64;
/** An extended command: #, its name, Enter. */
const ext = (name: string): number[] => [35, ...k(name), 13];

export interface NetHackCommand extends GameCommandDescriptor {
  keys: number[];
}

export const NETHACK_COMMANDS: NetHackCommand[] = [
  { id: 'move-nw', label: 'Move up-left', shortcut: 'y', keys: k('y'), category: 'Movement' },
  { id: 'move-n', label: 'Move up', shortcut: 'k', keys: k('k'), category: 'Movement' },
  { id: 'move-ne', label: 'Move up-right', shortcut: 'u', keys: k('u'), category: 'Movement' },
  { id: 'move-w', label: 'Move left', shortcut: 'h', keys: k('h'), category: 'Movement' },
  { id: 'move-e', label: 'Move right', shortcut: 'l', keys: k('l'), category: 'Movement' },
  { id: 'move-sw', label: 'Move down-left', shortcut: 'b', keys: k('b'), category: 'Movement' },
  { id: 'move-s', label: 'Move down', shortcut: 'j', keys: k('j'), category: 'Movement' },
  { id: 'move-se', label: 'Move down-right', shortcut: 'n', keys: k('n'), category: 'Movement' },
  {
    id: 'rest',
    label: 'Rest one move',
    shortLabel: 'Rest',
    shortcut: '.',
    keys: k('.'),
    category: 'Movement',
  },
  { id: 'search', label: 'Search', shortLabel: 'Search', shortcut: 's', keys: k('s'), category: 'Movement' },
  {
    id: 'search-20',
    label: 'Search 20 times',
    shortLabel: 'Search ×20',
    shortcut: '20s',
    keys: k('20s'),
    category: 'Movement',
  },
  {
    id: 'travel',
    label: 'Travel to a place',
    shortLabel: 'Travel',
    shortcut: '_',
    keys: k('_'),
    category: 'Movement',
  },
  {
    id: 'downstairs',
    label: 'Go down',
    shortLabel: 'Down',
    shortcut: '>',
    keys: k('>'),
    category: 'Movement',
  },
  { id: 'upstairs', label: 'Go up', shortLabel: 'Up', shortcut: '<', keys: k('<'), category: 'Movement' },
  { id: 'pickup', label: 'Pick up', shortLabel: 'Pick up', shortcut: ',', keys: k(','), category: 'Items' },
  { id: 'inventory', label: 'Inventory', shortLabel: 'Pack', shortcut: 'i', keys: k('i'), category: 'Items' },
  { id: 'eat', label: 'Eat', shortLabel: 'Eat', shortcut: 'e', keys: k('e'), category: 'Items' },
  {
    id: 'quaff',
    label: 'Quaff a potion',
    shortLabel: 'Quaff',
    shortcut: 'q',
    keys: k('q'),
    category: 'Items',
  },
  { id: 'read', label: 'Read', shortLabel: 'Read', shortcut: 'r', keys: k('r'), category: 'Items' },
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
    label: 'Take off armor',
    shortLabel: 'Take off',
    shortcut: 'T',
    keys: k('T'),
    category: 'Items',
  },
  {
    id: 'put-on',
    label: 'Put on an accessory',
    shortLabel: 'Put on',
    shortcut: 'P',
    keys: k('P'),
    category: 'Items',
  },
  {
    id: 'remove',
    label: 'Remove an accessory',
    shortLabel: 'Remove',
    shortcut: 'R',
    keys: k('R'),
    category: 'Items',
  },
  {
    id: 'apply',
    label: 'Apply (use) a tool',
    shortLabel: 'Apply',
    shortcut: 'a',
    keys: k('a'),
    category: 'Items',
  },
  { id: 'drop', label: 'Drop', shortLabel: 'Drop', shortcut: 'd', keys: k('d'), category: 'Items' },
  {
    id: 'drop-many',
    label: 'Drop several things',
    shortLabel: 'Drop…',
    shortcut: 'D',
    keys: k('D'),
    category: 'Items',
  },
  { id: 'zap', label: 'Zap a wand', shortLabel: 'Zap', shortcut: 'z', keys: k('z'), category: 'Combat' },
  { id: 'cast', label: 'Cast a spell', shortLabel: 'Cast', shortcut: 'Z', keys: k('Z'), category: 'Combat' },
  { id: 'throw', label: 'Throw', shortLabel: 'Throw', shortcut: 't', keys: k('t'), category: 'Combat' },
  {
    id: 'fire',
    label: 'Fire from the quiver',
    shortLabel: 'Fire',
    shortcut: 'f',
    keys: k('f'),
    category: 'Combat',
  },
  {
    id: 'fight',
    label: 'Fight in a direction',
    shortLabel: 'Fight',
    shortcut: 'F',
    keys: k('F'),
    category: 'Combat',
  },
  {
    id: 'kick',
    label: 'Kick',
    shortLabel: 'Kick',
    shortcut: 'Ctrl+D',
    keys: [ctrl('d')],
    category: 'Combat',
  },
  { id: 'open', label: 'Open a door', shortLabel: 'Open', shortcut: 'o', keys: k('o'), category: 'Actions' },
  {
    id: 'close',
    label: 'Close a door',
    shortLabel: 'Close',
    shortcut: 'c',
    keys: k('c'),
    category: 'Actions',
  },
  {
    id: 'pray',
    label: 'Pray',
    shortLabel: 'Pray',
    shortcut: '#pray',
    keys: ext('pray'),
    category: 'Actions',
  },
  {
    id: 'loot',
    label: 'Loot a box',
    shortLabel: 'Loot',
    shortcut: '#loot',
    keys: ext('loot'),
    category: 'Actions',
  },
  {
    id: 'engrave',
    label: 'Engrave',
    shortLabel: 'Engrave',
    shortcut: 'E',
    keys: k('E'),
    category: 'Actions',
  },
  {
    id: 'chat',
    label: 'Chat',
    shortLabel: 'Chat',
    shortcut: '#chat',
    keys: ext('chat'),
    category: 'Actions',
  },
  {
    id: 'offer',
    label: 'Offer a sacrifice',
    shortLabel: 'Offer',
    shortcut: '#offer',
    keys: ext('offer'),
    category: 'Actions',
  },
  {
    id: 'enhance',
    label: 'Enhance skills',
    shortLabel: 'Enhance',
    shortcut: '#enhance',
    keys: ext('enhance'),
    category: 'Actions',
  },
  {
    id: 'extended',
    label: 'Extended command',
    shortLabel: '#',
    shortcut: '#',
    keys: k('#'),
    category: 'Actions',
  },
  {
    id: 'look-here',
    label: 'Look here',
    shortLabel: 'Look here',
    shortcut: ':',
    keys: k(':'),
    category: 'Information',
  },
  {
    id: 'farlook',
    label: 'Look at a place',
    shortLabel: 'Look',
    shortcut: ';',
    keys: k(';'),
    category: 'Information',
  },
  {
    id: 'discoveries',
    label: 'Discoveries',
    shortLabel: 'Known',
    shortcut: '\\',
    keys: k('\\'),
    category: 'Information',
  },
  {
    id: 'equipment',
    label: 'Equipment in use',
    shortLabel: 'Worn',
    shortcut: '*',
    keys: k('*'),
    category: 'Information',
  },
  {
    id: 'spells',
    label: 'Known spells',
    shortLabel: 'Spells',
    shortcut: '+',
    keys: k('+'),
    category: 'Information',
  },
  {
    id: 'attributes',
    label: 'Attributes',
    shortLabel: 'You',
    shortcut: 'Ctrl+X',
    keys: [ctrl('x')],
    category: 'Information',
  },
  {
    id: 'overview',
    label: 'Dungeon overview',
    shortLabel: 'Overview',
    shortcut: 'Ctrl+O',
    keys: [ctrl('o')],
    category: 'Information',
  },
  {
    id: 'messages',
    label: 'Previous messages',
    shortLabel: 'Messages',
    shortcut: 'Ctrl+P',
    keys: [ctrl('p')],
    category: 'Information',
  },
  { id: 'help', label: 'Help', shortLabel: 'Help', shortcut: '?', keys: k('?'), category: 'Information' },
  { id: 'save', label: 'Save and quit', shortLabel: 'Save', shortcut: 'S', keys: k('S'), category: 'Game' },
  { id: 'options', label: 'Options', shortLabel: 'Options', shortcut: 'O', keys: k('O'), category: 'Game' },
  {
    id: 'redraw',
    label: 'Redraw the screen',
    shortLabel: 'Redraw',
    shortcut: 'Ctrl+R',
    keys: [ctrl('r')],
    category: 'Game',
  },
  // Prompt and menu keys.
  { id: 'confirm', label: 'Enter', shortLabel: 'OK', shortcut: 'Enter', keys: [13], category: 'Keys' },
  { id: 'cancel', label: 'Cancel', shortLabel: 'Cancel', shortcut: 'Esc', keys: [27], category: 'Keys' },
  {
    id: 'continue',
    label: 'Continue',
    shortLabel: 'Continue',
    shortcut: 'Space',
    keys: [32],
    category: 'Keys',
  },
  {
    id: 'next-page',
    label: 'Next page',
    shortLabel: 'Page ▶',
    shortcut: '>',
    keys: k('>'),
    category: 'Keys',
  },
  {
    id: 'previous-page',
    label: 'Previous page',
    shortLabel: '◀ Page',
    shortcut: '<',
    keys: k('<'),
    category: 'Keys',
  },
  { id: 'select-all', label: 'Select all', shortLabel: 'All', shortcut: '.', keys: k('.'), category: 'Keys' },
  {
    id: 'list',
    label: 'List the choices',
    shortLabel: 'List',
    shortcut: '?',
    keys: k('?'),
    category: 'Keys',
  },
  {
    id: 'list-all',
    label: 'List everything',
    shortLabel: 'All items',
    shortcut: '*',
    keys: k('*'),
    category: 'Keys',
  },
  { id: 'self', label: 'At yourself', shortLabel: 'Self', shortcut: '.', keys: k('.'), category: 'Keys' },
  { id: 'dir-down', label: 'Downwards', shortLabel: 'Down ▾', shortcut: '>', keys: k('>'), category: 'Keys' },
  { id: 'dir-up', label: 'Upwards', shortLabel: 'Up ▴', shortcut: '<', keys: k('<'), category: 'Keys' },
];

const BY_ID = new Map(NETHACK_COMMANDS.map((command) => [command.id, command]));

export function findCommand(id: string): NetHackCommand | undefined {
  return BY_ID.get(id);
}

/** The thumb pad: the eight directions, Search in the centre. */
export const PAD = {
  n: 'move-n',
  ne: 'move-ne',
  e: 'move-e',
  se: 'move-se',
  s: 'move-s',
  sw: 'move-sw',
  w: 'move-w',
  nw: 'move-nw',
  center: 'search',
} as const;

/** The command list (More): everything but the prompt keys. */
export const PALETTE = NETHACK_COMMANDS.filter((command) => command.category !== 'Keys').map(
  (command) => command.id,
);

const ARROWS: Record<string, string> = {
  ArrowUp: 'k',
  ArrowDown: 'j',
  ArrowLeft: 'h',
  ArrowRight: 'l',
  Home: 'y',
  PageUp: 'u',
  End: 'b',
  PageDown: 'n',
};
const NUMPAD: Record<string, string> = {
  Numpad8: 'k',
  Numpad2: 'j',
  Numpad4: 'h',
  Numpad6: 'l',
  Numpad7: 'y',
  Numpad9: 'u',
  Numpad1: 'b',
  Numpad3: 'n',
  Numpad5: 's',
};

/** A key from the shell as NetHack reads it (number_pad off: vi keys; Shift runs). */
export function keyToNetHack(input: Extract<GameInput, { type: 'key' }>): number[] | null {
  const { key, code, modifiers } = input;
  const direction = ARROWS[key] ?? (code in NUMPAD ? NUMPAD[code] : undefined);
  if (direction) return [(modifiers.shift ? direction.toUpperCase() : direction).charCodeAt(0)];
  if (key === 'Enter') return [13];
  if (key === 'Escape') return [27];
  if (key === 'Backspace') return [8];
  if (key === 'Tab') return [9];
  if (key.length !== 1) return null;
  const char = key.charCodeAt(0);
  if (char > 126) return null;
  if (modifiers.ctrl && /[a-z]/i.test(key)) return [ctrl(key)];
  // Meta (Alt) + letter: NetHack's M- commands (e.g. M-p pray) as the high bit.
  if (modifiers.alt && /[a-z]/i.test(key)) return [char | 0x80];
  return [char];
}

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** A choice on screen (a menu item's or prompt's key): `key:<code>`. */
export const KEY = 'key:';

const YN_LABELS: Record<string, string> = { y: 'Yes', n: 'No', q: 'Quit', a: 'All' };

/** The choices a prompt offers in its brackets ("[ynq]", "[abc or ?*]"). */
export function promptChoices(prompt: string): string[] {
  const match = /\[([^\]]*)\]/.exec(prompt);
  if (!match) return [];
  const inside = match[1]!.split(' or ')[0]!;
  const letters: string[] = [];
  for (let i = 0; i < inside.length; i++) {
    // "a-e" ranges, as getobj writes them.
    if (inside[i + 1] === '-' && inside[i + 2]) {
      const from = inside.charCodeAt(i);
      const to = inside.charCodeAt(i + 2);
      for (let c = from; c <= to && letters.length < 52; c++) letters.push(String.fromCharCode(c));
      i += 2;
    } else if (/[A-Za-z$-]/.test(inside[i]!)) letters.push(inside[i]!);
  }
  return letters;
}

export interface DockState {
  hp: number;
  hpMax: number;
  prompt: string;
  /** The open menu's items (key and text), for its dock. */
  menu: { how: number; items: { key: number; text: string }[]; page: number; pages: number } | null;
}

const MAP_FANS = {
  search: ['rest', 'search-20', 'travel', 'downstairs', 'upstairs', 'kick'],
  pickup: ['look-here', 'loot', 'drop', 'drop-many'],
  inventory: ['eat', 'quaff', 'read', 'wield', 'wear', 'take-off', 'put-on', 'remove', 'apply'],
  fight: ['throw', 'fire', 'zap', 'cast', 'kick', 'pray'],
  farlook: ['look-here', 'discoveries', 'equipment', 'attributes', 'overview', 'messages', 'help'],
};

export function controlsFor(context: NhContext | 'start', state: DockState): TouchControlLayout {
  const more = a(SHELL_COMMAND.palette, { label: 'More' });
  switch (context) {
    case 'start':
    case 'loading':
    case 'over':
      return { actions: [], palette: [] };
    case 'more':
      return {
        directionPad: PAD,
        actions: [a('continue', { emphasis: 'primary', wide: true })],
        palette: PALETTE,
      };
    case 'text':
      return {
        actions: [a('continue', { label: 'Next', emphasis: 'primary' }), a('cancel', { label: 'Close' })],
        palette: PALETTE,
      };
    case 'menu': {
      const menu = state.menu;
      const paging = menu && menu.pages > 1;
      if (menu?.how === 0)
        return {
          actions: [
            ...(paging ? [a('previous-page'), a('next-page')] : []),
            a('cancel', { label: 'Close', emphasis: 'primary' }),
          ],
          palette: PALETTE,
        };
      return {
        actions: [
          ...(menu?.how === 2
            ? [a('confirm', { label: 'Accept', emphasis: 'primary' as const }), a('select-all')]
            : []),
          ...(paging ? [a('previous-page'), a('next-page')] : []),
          a('cancel'),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    }
    case 'yn': {
      const letters = promptChoices(state.prompt).slice(0, 6);
      return {
        actions: [
          ...letters.map((letter, i) =>
            a(`${KEY}${letter.charCodeAt(0)}`, {
              label: YN_LABELS[letter] ?? letter,
              ...(i === 0 ? { emphasis: 'primary' as const } : {}),
            }),
          ),
          a('cancel'),
        ],
        palette: PALETTE,
      };
    }
    case 'item': {
      // "What do you want to eat? [fg or ?*]": the list of candidates first.
      return {
        actions: [
          a('list', { label: 'Choose', emphasis: 'primary' }),
          a('list-all'),
          a('cancel'),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    }
    case 'direction':
      return {
        directionPad: { ...PAD, center: 'self' },
        actions: [a('dir-down'), a('dir-up'), a('cancel')],
        palette: PALETTE,
      };
    case 'getlin':
    case 'extcmd':
      return {
        actions: [
          a(SHELL_COMMAND.keyboard, { label: 'Type', emphasis: 'primary' }),
          a('confirm'),
          a('cancel'),
        ],
        palette: PALETTE,
      };
    case 'map':
    default: {
      const wounded = state.hpMax > 0 && state.hp < state.hpMax / 3;
      return {
        directionPad: PAD,
        actions: [
          a('search', { alternates: MAP_FANS.search, ...(wounded ? {} : {}) }),
          a('pickup', { alternates: MAP_FANS.pickup }),
          a('inventory', { alternates: MAP_FANS.inventory }),
          a('fight', { alternates: MAP_FANS.fight }),
          a('farlook', { alternates: MAP_FANS.farlook }),
          more,
        ],
        palette: PALETTE,
      };
    }
  }
}

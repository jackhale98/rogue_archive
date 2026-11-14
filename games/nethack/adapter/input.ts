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
import { DIR_ARROWS, DIR_KEYS, MAJOR_TROUBLE, type NetHackState } from './state.ts';
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
  {
    id: 'search-10',
    label: 'Search 10 times',
    shortLabel: 'Search ×10',
    shortcut: '10s',
    keys: k('10s'),
    category: 'Movement',
  },
  {
    id: 'rest-20',
    label: 'Rest 20 moves',
    shortLabel: 'Rest ×20',
    shortcut: '20.',
    keys: k('20.'),
    category: 'Movement',
  },
  {
    id: 'travel-down',
    label: 'Travel to the stairs down',
    shortLabel: 'To stairs ▾',
    shortcut: '_ >',
    keys: k('_>.'),
    category: 'Movement',
  },
  {
    id: 'travel-up',
    label: 'Travel to the stairs up',
    shortLabel: 'To stairs ▴',
    shortcut: '_ <',
    keys: k('_<.'),
    category: 'Movement',
  },
  {
    id: 'run',
    label: 'Run (Shift + direction, G)',
    shortLabel: 'Run',
    shortcut: 'G',
    keys: k('G'),
    category: 'Movement',
  },
  {
    id: 'quiver',
    label: 'Fill the quiver',
    shortLabel: 'Quiver',
    shortcut: 'Q',
    keys: k('Q'),
    category: 'Combat',
  },
  {
    id: 'elbereth',
    label: 'Engrave Elbereth in the dust',
    shortLabel: 'Elbereth',
    shortcut: 'E - Elbereth',
    keys: [],
    category: 'Combat',
  },
  {
    id: 'pay',
    label: 'Pay the shopkeeper',
    shortLabel: 'Pay',
    shortcut: 'p',
    keys: k('p'),
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
    id: 'sit',
    label: 'Sit down',
    shortLabel: 'Sit',
    shortcut: '#sit',
    keys: ext('sit'),
    category: 'Actions',
  },
  {
    id: 'dip',
    label: 'Dip an object into something',
    shortLabel: 'Dip',
    shortcut: '#dip',
    keys: ext('dip'),
    category: 'Actions',
  },
  {
    id: 'force',
    label: 'Force a lock',
    shortLabel: 'Force',
    shortcut: '#force',
    keys: ext('force'),
    category: 'Actions',
  },
  {
    id: 'untrap',
    label: 'Untrap something',
    shortLabel: 'Untrap',
    shortcut: '#untrap',
    keys: ext('untrap'),
    category: 'Actions',
  },
  {
    id: 'tip',
    label: 'Empty a container',
    shortLabel: 'Tip',
    shortcut: '#tip',
    keys: ext('tip'),
    category: 'Actions',
  },
  {
    id: 'rub',
    label: 'Rub a lamp or a stone',
    shortLabel: 'Rub',
    shortcut: '#rub',
    keys: ext('rub'),
    category: 'Actions',
  },
  {
    id: 'invoke',
    label: "Invoke an object's special powers",
    shortLabel: 'Invoke',
    shortcut: '#invoke',
    keys: ext('invoke'),
    category: 'Actions',
  },
  {
    id: 'jump',
    label: 'Jump to another location',
    shortLabel: 'Jump',
    shortcut: '#jump',
    keys: ext('jump'),
    category: 'Actions',
  },
  {
    id: 'ride',
    label: 'Mount or dismount a steed',
    shortLabel: 'Ride',
    shortcut: '#ride',
    keys: ext('ride'),
    category: 'Actions',
  },
  {
    id: 'turn',
    label: 'Turn undead away',
    shortLabel: 'Turn',
    shortcut: '#turn',
    keys: ext('turn'),
    category: 'Actions',
  },
  {
    id: 'monster',
    label: "Use your monster form's ability",
    shortLabel: 'Monster',
    shortcut: '#monster',
    keys: ext('monster'),
    category: 'Actions',
  },
  {
    id: 'wipe',
    label: 'Wipe off your face',
    shortLabel: 'Wipe',
    shortcut: '#wipe',
    keys: ext('wipe'),
    category: 'Actions',
  },
  {
    id: 'name',
    label: 'Name a monster, object or object type',
    shortLabel: 'Name',
    shortcut: '#name',
    keys: ext('name'),
    category: 'Actions',
  },
  {
    id: 'adjust',
    label: 'Adjust inventory letters',
    shortLabel: 'Adjust',
    shortcut: '#adjust',
    keys: ext('adjust'),
    category: 'Actions',
  },
  {
    id: 'here-menu',
    label: 'What you can do here',
    shortLabel: 'Here…',
    shortcut: '#herecmdmenu',
    keys: ext('herecmdmenu'),
    category: 'Actions',
  },
  {
    id: 'terrain',
    label: 'View the map without monsters or objects',
    shortLabel: 'Terrain',
    shortcut: '#terrain',
    keys: ext('terrain'),
    category: 'Information',
  },
  {
    id: 'annotate',
    label: 'Name the current level',
    shortLabel: 'Annotate',
    shortcut: '#annotate',
    keys: ext('annotate'),
    category: 'Information',
  },
  {
    id: 'conduct',
    label: 'Voluntary challenges kept',
    shortLabel: 'Conduct',
    shortcut: '#conduct',
    keys: ext('conduct'),
    category: 'Information',
  },
  {
    id: 'chronicle',
    label: 'Journal of major events',
    shortLabel: 'Chronicle',
    shortcut: '#chronicle',
    keys: ext('chronicle'),
    category: 'Information',
  },
  {
    id: 'vanquished',
    label: 'Vanquished monsters',
    shortLabel: 'Vanquished',
    shortcut: '#vanquished',
    keys: ext('vanquished'),
    category: 'Information',
  },
  {
    id: 'pos-select',
    label: 'Choose this place',
    shortLabel: 'Select',
    shortcut: '.',
    keys: k('.'),
    category: 'Keys',
  },
  {
    id: 'pos-monster',
    label: 'Next monster',
    shortLabel: 'Monster ▸',
    shortcut: 'm',
    keys: k('m'),
    category: 'Keys',
  },
  {
    id: 'pos-monster-prev',
    label: 'Previous monster',
    shortLabel: '◂ Monster',
    shortcut: 'M',
    keys: k('M'),
    category: 'Keys',
  },
  {
    id: 'pos-object',
    label: 'Next object',
    shortLabel: 'Object ▸',
    shortcut: 'o',
    keys: k('o'),
    category: 'Keys',
  },
  { id: 'pos-door', label: 'Next door', shortLabel: 'Door ▸', shortcut: 'd', keys: k('d'), category: 'Keys' },
  {
    id: 'pos-unexplored',
    label: 'Next unexplored place',
    shortLabel: 'Unexplored ▸',
    shortcut: 'x',
    keys: k('x'),
    category: 'Keys',
  },
  {
    id: 'pos-stairs-down',
    label: 'Stairs down',
    shortLabel: 'Stairs ▾',
    shortcut: '>',
    keys: k('>'),
    category: 'Keys',
  },
  {
    id: 'pos-stairs-up',
    label: 'Stairs up',
    shortLabel: 'Stairs ▴',
    shortcut: '<',
    keys: k('<'),
    category: 'Keys',
  },
  { id: 'pos-altar', label: 'Altar', shortLabel: 'Altar', shortcut: '_', keys: k('_'), category: 'Keys' },
  { id: 'pos-self', label: 'Yourself', shortLabel: 'You', shortcut: '@', keys: k('@'), category: 'Keys' },
  {
    id: 'hands',
    label: 'Your bare hands',
    shortLabel: 'Hands',
    shortcut: '-',
    keys: k('-'),
    category: 'Keys',
  },
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
  /** The game's state snapshot (null before a game). */
  state: NetHackState | null;
  prompt: string;
  /** The open menu (how: 0 read only, 1 one, 2 several). */
  menu: { how: number; items: { key: number; text: string }[]; page: number; pages: number } | null;
  /** The game said "You feel more confident in your … skills" and #enhance hasn't been used since. */
  enhance?: boolean;
  /** This turn's messages ("d - an uncursed food ration." names an item prompt's letters). */
  messages?: readonly string[];
}

/** Item letters named by this turn's messages ("d - an uncursed food ration."). */
function itemNames(messages: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    const match = /^([a-zA-Z$]) - (.+?)\.?$/.exec(message.trim());
    if (match)
      names.set(
        match[1]!,
        match[2]!.replace(/^(an? |the )/, '').replace(/^(\d+ )?(?:uncursed|blessed|cursed) /, '$1'),
      );
  }
  return names;
}

/** An item prompt offering only a few items: each is a button. */
export const FEW_ITEMS = 3;

/** One-tap commands built from the situation: `fight:<dir>`, `fire:<dir>`, `dir:<dir>`, `text:<answer>`. */
export const FIGHT = 'fight:';
export const FIRE = 'fire:';
export const DIR = 'dir:';
export const TEXT = 'text:';

/** The keys a situational command sends (null for an unknown id). */
export function dynamicKeys(id: string): number[] | null {
  const dir = (prefix: string) => DIR_KEYS[Number(id.slice(prefix.length))];
  if (id.startsWith(FIGHT)) return dir(FIGHT) ? k(`F${dir(FIGHT)}`) : null;
  if (id.startsWith(FIRE)) return dir(FIRE) ? k(`f${dir(FIRE)}`) : null;
  if (id.startsWith(DIR)) return dir(DIR) ? k(dir(DIR)!) : null;
  if (id.startsWith(TEXT)) return [...k(id.slice(TEXT.length)), 13];
  return null;
}

const FANS = {
  search: ['rest', 'search-10', 'search-20', 'rest-20', 'here-menu'],
  travel: ['travel-down', 'travel-up', 'downstairs', 'upstairs', 'run', 'jump'],
  pack: ['eat', 'quaff', 'read', 'wear', 'wield', 'put-on', 'apply', 'drop-many', 'adjust'],
  look: ['look-here', 'discoveries', 'equipment', 'overview', 'attributes', 'terrain', 'messages', 'help'],
  fight: ['fight', 'kick', 'throw', 'fire', 'quiver', 'zap'],
  magic: ['zap', 'cast', 'apply', 'read', 'invoke', 'turn', 'monster'],
  survive: ['pray', 'elbereth', 'quaff', 'read', 'travel-up', 'eat'],
};

/** The first slot on the map: what this place or this moment calls for. */
export function mapLead(state: NetHackState, enhance = false): TouchAction | null {
  const primary = { emphasis: 'primary' as const };
  if (enhance) return a('enhance', primary);
  if (state.unpaid) return a('pay', primary);
  switch (state.underfoot) {
    case 'down':
    case 'ladder-down':
      return a('downstairs', { label: 'Down >', ...primary, alternates: FANS.travel });
    case 'up':
    case 'ladder-up':
      return a('upstairs', { label: 'Up <', alternates: FANS.travel });
    default:
      break;
  }
  if (state.objects > 0)
    return state.containerHere
      ? a('loot', { ...primary, alternates: ['pickup', 'tip', 'force', 'look-here'] })
      : a('pickup', { ...primary, alternates: ['look-here', 'loot'] });
  if (state.underfoot === 'altar' && (state.corpseHere || state.carryingCorpse))
    return a('offer', { alternates: ['look-here', 'drop'] });
  if (state.underfoot === 'fountain' || state.underfoot === 'sink')
    return a('quaff', { label: 'Drink', alternates: ['dip'] });
  if (state.underfoot === 'throne') return a('sit');
  if (state.hunger >= 2) return a('eat', state.hunger >= 3 ? primary : {});
  if (state.encumbrance >= 2) return a('drop-many');
  return null;
}

function mapControls(dock: DockState): TouchControlLayout {
  const state = dock.state;
  const more = a(SHELL_COMMAND.palette, { label: 'More' });
  if (!state) return { directionPad: PAD, actions: [more], palette: PALETTE };
  const adjacent = state.adjacent;
  const fightAt = (dir: number, char: string) =>
    a(`${FIGHT}${dir}`, {
      label: `Fight ${DIR_ARROWS[dir]}${char}`,
      emphasis: 'primary',
      alternates: FANS.fight,
    });
  const fireAt = (dir: number, char: string) =>
    a(`${FIRE}${dir}`, { label: `Fire ${DIR_ARROWS[dir]}${char}`, alternates: ['fire', 'throw', 'quiver'] });
  const magic = state.spellsKnown
    ? a('cast', { alternates: FANS.magic })
    : a('zap', { alternates: FANS.magic });
  const elbereth = a('elbereth', { alternates: FANS.survive });

  // In trouble the player can see (and prayer can fix): pray, heal, hold them off, flee.
  if (state.trouble & MAJOR_TROUBLE) {
    const near =
      adjacent.length > 0 ? fightAt(adjacent[0]!, state.adjacentChar) : a('travel-up', { label: 'Flee ▴' });
    return {
      directionPad: PAD,
      actions: [
        a('pray', { emphasis: 'primary', alternates: FANS.survive }),
        a('quaff', { alternates: ['read', 'eat', 'apply', 'zap'] }),
        elbereth,
        { ...near, emphasis: undefined },
        a('inventory', { alternates: FANS.pack }),
        more,
      ],
      palette: PALETTE,
    };
  }

  // A hostile monster next to the hero or lined up: fight.
  if (adjacent.length > 0 || state.target) {
    const target = state.target;
    const ranged =
      state.quiverReady && target
        ? fireAt(target.dir, target.char)
        : a('throw', { alternates: ['fire', 'quiver', 'zap'] });
    const first =
      adjacent.length > 0
        ? fightAt(adjacent[0]!, state.adjacentChar)
        : { ...ranged, emphasis: 'primary' as const };
    const second = adjacent.length > 0 ? ranged : a('fight', { alternates: FANS.fight });
    return {
      directionPad: PAD,
      actions: [first, second, magic, a('quaff', { alternates: ['read', 'eat', 'apply'] }), elbereth, more],
      palette: PALETTE,
    };
  }

  // Exploring.
  const lead = mapLead(state, dock.enhance);
  return {
    directionPad: PAD,
    actions: [
      ...(lead ? [lead] : []),
      a('search', { alternates: FANS.search }),
      a('travel', { alternates: FANS.travel }),
      a('inventory', { alternates: FANS.pack }),
      a('farlook', { alternates: FANS.look }),
      more,
    ],
    palette: PALETTE,
  };
}

export function controlsFor(context: NhContext | 'start', dock: DockState): TouchControlLayout {
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
      const menu = dock.menu;
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
      const letters = promptChoices(dock.prompt).slice(0, 6);
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
      // The suitable items open at once (the adapter sends `?`); these are the rest.
      const choices = promptChoices(dock.prompt);
      const hands = choices.includes('-');
      const letters = choices.filter((c) => c !== '-');
      const names = itemNames(dock.messages ?? []);
      // A few items (one food ration, two wands): one button each, named when the game has said.
      const items =
        letters.length > 0 && letters.length <= FEW_ITEMS
          ? letters.map((letter, i) => {
              const name = names.get(letter);
              return a(`${KEY}${letter.charCodeAt(0)}`, {
                label: name ? `${letter} ${name.length > 20 ? `${name.slice(0, 19)}…` : name}` : letter,
                ...(i === 0 ? { emphasis: 'primary' as const } : {}),
              });
            })
          : [];
      return {
        actions: [
          ...items,
          a('list', { label: 'Choose', ...(items.length ? {} : { emphasis: 'primary' as const }) }),
          a('list-all'),
          ...(hands ? [a('hands')] : []),
          a('cancel'),
          ...(items.length ? [] : [a(SHELL_COMMAND.keyboard, { label: 'Type' })]),
        ],
        palette: PALETTE,
      };
    }
    case 'direction': {
      const target = dock.state?.target ?? null;
      const adjacent = dock.state?.adjacent ?? [];
      const toward = adjacent.length > 0 ? { dir: adjacent[0]!, char: dock.state!.adjacentChar } : target;
      return {
        directionPad: { ...PAD, center: 'self' },
        actions: [
          ...(toward
            ? [
                a(`${DIR}${toward.dir}`, {
                  label: `At ${DIR_ARROWS[toward.dir]}${toward.char}`,
                  emphasis: 'primary' as const,
                }),
              ]
            : []),
          a('dir-down'),
          a('dir-up'),
          a('cancel'),
        ],
        palette: PALETTE,
      };
    }
    case 'position':
      // Tapping the map chooses a place; the pad moves the cursor.
      return {
        directionPad: { ...PAD, center: 'pos-select' },
        actions: [
          a('pos-select', { emphasis: 'primary' }),
          a('pos-monster', { alternates: ['pos-monster-prev', 'pos-object', 'pos-door', 'pos-unexplored'] }),
          a('pos-stairs-down', { alternates: ['pos-stairs-up', 'pos-altar'] }),
          a('pos-self'),
          a('cancel'),
        ],
        palette: PALETTE,
      };
    case 'getlin':
    case 'extcmd': {
      // Engraving: Elbereth is the usual answer.
      const engraving = /write|engrave|burn|melt|scribble/i.test(dock.prompt);
      return {
        actions: [
          ...(engraving ? [a(`${TEXT}Elbereth`, { label: 'Elbereth' })] : []),
          a(SHELL_COMMAND.keyboard, { label: 'Type', emphasis: 'primary' }),
          a('confirm'),
          a('cancel'),
        ],
        palette: PALETTE,
      };
    }
    case 'map':
    default:
      return mapControls(dock);
  }
}

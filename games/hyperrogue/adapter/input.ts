// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * HyperRogue's controls: the commands of its normal play (control.cpp
 * handleKeyNormal, handle_movement), each with its original key, and the key
 * events the page synthesises for Emscripten's SDL 1 (which reads the legacy
 * keyCode on keydown and the character from the following keypress).
 *
 * Touch play follows upstream's mobile version (mobile.cpp): tap a cell to
 * move towards it, long-press for help about what is there, and buttons for
 * what the mobile version puts in the screen's corners (menu, recentre).
 */
import type {
  GameCommandDescriptor,
  GameInput,
  TouchAction,
  TouchControlLayout,
} from '@rogue-archive/game-api';
import { SHELL_COMMAND } from '@rogue-archive/game-api';

/** One key press as SDL sees it. */
export interface KeyStroke {
  /** DOM KeyboardEvent.key */
  key: string;
  /** DOM KeyboardEvent.code */
  code: string;
  /** Legacy keyCode (what SDL 1 maps to an SDL key). */
  keyCode: number;
  /** Character for the keypress that follows keydown (0: none). */
  charCode: number;
  shift?: boolean;
}

export interface HyperCommand extends GameCommandDescriptor {
  keys: KeyStroke[];
}

/** Legacy keyCodes of the non-character keys HyperRogue uses. */
const SPECIAL: Record<string, number> = {
  Escape: 27,
  Enter: 13,
  ' ': 32,
  Backspace: 8,
  Tab: 9,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Delete: 46,
  Insert: 45,
};
/** Punctuation keyCodes (US layout), as browsers report them. */
const PUNCTUATION: Record<string, number> = {
  '.': 190,
  '>': 190,
  ',': 188,
  '<': 188,
  '/': 191,
  '?': 191,
  '-': 189,
  _: 189,
  '=': 187,
  '+': 187,
  ';': 186,
  ':': 186,
  "'": 222,
  '"': 222,
  '[': 219,
  '{': 219,
  ']': 221,
  '}': 221,
  '\\': 220,
  '|': 220,
  '`': 192,
  '~': 192,
};
const SHIFTED_DIGITS = ')!@#$%^&*(';

/** The keystroke for a DOM key (as the shell reports it), or null if SDL has no use for it. */
export function strokeFor(key: string, code = '', shift = false): KeyStroke | null {
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) {
    const digit = Number(numpad[1]);
    return { key, code, keyCode: 96 + digit, charCode: /\d/.test(key) ? key.charCodeAt(0) : 0, shift };
  }
  if (code === 'NumpadDecimal') return { key, code, keyCode: 110, charCode: key === '.' ? 46 : 0, shift };
  const fn = /^F(\d{1,2})$/.exec(key);
  if (fn) return { key, code, keyCode: 111 + Number(fn[1]), charCode: 0, shift };
  if (key in SPECIAL) {
    const keyCode = SPECIAL[key]!;
    return { key, code, keyCode, charCode: key === ' ' ? 32 : key === 'Enter' ? 13 : 0, shift };
  }
  if (key.length !== 1) return null;
  const char = key.charCodeAt(0);
  if (char >= 0x80) return null;
  if (/[a-z]/i.test(key))
    return { key, code, keyCode: key.toUpperCase().charCodeAt(0), charCode: char, shift };
  if (/\d/.test(key)) return { key, code, keyCode: char, charCode: char, shift };
  const shifted = SHIFTED_DIGITS.indexOf(key);
  if (shifted >= 0) return { key, code, keyCode: 48 + shifted, charCode: char, shift: true };
  if (key in PUNCTUATION) return { key, code, keyCode: PUNCTUATION[key]!, charCode: char, shift };
  return null;
}

/** A key from the shell (physical keyboard or on-screen keyboard). */
export function strokeForInput(input: Extract<GameInput, { type: 'key' }>): KeyStroke | null {
  if (input.modifiers.meta) return null;
  return strokeFor(input.key, input.code, input.modifiers.shift);
}

const k = (key: string, shift = false): KeyStroke => strokeFor(key, '', shift)!;

export const HYPER_COMMANDS: readonly HyperCommand[] = [
  // Movement: vi keys, as upstream's handle_movement (directions follow the screen).
  { id: 'move-nw', label: 'Move up-left', shortcut: 'y', keys: [k('y')], category: 'Movement' },
  { id: 'move-n', label: 'Move up', shortcut: 'k', keys: [k('k')], category: 'Movement' },
  { id: 'move-ne', label: 'Move up-right', shortcut: 'u', keys: [k('u')], category: 'Movement' },
  { id: 'move-w', label: 'Move left', shortcut: 'h', keys: [k('h')], category: 'Movement' },
  { id: 'move-e', label: 'Move right', shortcut: 'l', keys: [k('l')], category: 'Movement' },
  { id: 'move-sw', label: 'Move down-left', shortcut: 'b', keys: [k('b')], category: 'Movement' },
  { id: 'move-s', label: 'Move down', shortcut: 'j', keys: [k('j')], category: 'Movement' },
  { id: 'move-se', label: 'Move down-right', shortcut: 'n', keys: [k('n')], category: 'Movement' },
  {
    id: 'wait',
    label: 'Wait a turn',
    shortLabel: 'Wait',
    shortcut: '.',
    keys: [k('.')],
    category: 'Movement',
  },

  {
    id: 'recenter',
    label: 'Centre the view on you',
    shortLabel: 'Centre',
    shortcut: 'Space',
    keys: [k(' ')],
    category: 'View',
  },
  {
    id: 'rotate-left',
    label: 'Rotate the view',
    shortLabel: 'Rotate ⟲',
    shortcut: 'PgUp',
    keys: [k('PageUp')],
    category: 'View',
  },
  {
    id: 'rotate-right',
    label: 'Rotate the view the other way',
    shortLabel: 'Rotate ⟳',
    shortcut: 'PgDn',
    keys: [k('PageDown')],
    category: 'View',
  },

  {
    id: 'target',
    label: 'Use a ranged orb on the cell at the centre (with strong wind: jump where it blows)',
    shortLabel: 'Target',
    shortcut: 't',
    keys: [k('t')],
    category: 'Actions',
  },
  {
    id: 'drop',
    label: 'Drop a Dead Orb',
    shortLabel: 'Drop',
    shortcut: 'g',
    keys: [k('g')],
    category: 'Actions',
  },
  {
    id: 'fire-mode',
    label: 'Crossbow: fire mode on or off (aim, then confirm)',
    shortLabel: 'Fire',
    shortcut: 'f',
    keys: [k('f')],
    category: 'Actions',
  },
  {
    id: 'inventory',
    label: 'Orb inventory (Orb Strategy mode)',
    shortLabel: 'Orbs',
    shortcut: 'i',
    keys: [k('i')],
    category: 'Actions',
  },
  {
    id: 'mark',
    label: 'Mark or unmark a mine on the cell under the pointer (Minefield)',
    shortLabel: 'Mark',
    shortcut: 'm',
    keys: [k('m')],
    category: 'Actions',
  },
  {
    id: 'context',
    label: "World overview (or the special mode's menu)",
    shortLabel: 'Overview',
    shortcut: 'o',
    keys: [k('o')],
    category: 'Actions',
  },

  // What a tap on the map does (touch only: the adapter switches upstream's
  // own touch modes, or marks the tapped cell). The shortcut is the desktop's
  // equivalent.
  {
    id: 'aim-mode',
    label: 'Aim: the next tap uses a ranged orb, never moves',
    shortLabel: 'Aim',
    shortcut: 'Shift+click',
    keys: [],
    category: 'Touch',
    description:
      'The next tap on the map uses a ranged orb there (or the game says why it cannot); once it is used, taps move again.',
  },
  {
    id: 'inspect-mode',
    label: 'Inspect: taps tell about a cell, never move',
    shortLabel: 'Inspect',
    shortcut: 'Right-click',
    keys: [],
    category: 'Touch',
    description: 'Taps on the map show help about what is there, until switched off.',
  },
  {
    id: 'mark-mode',
    label: 'Mark: taps mark or unmark mines',
    shortLabel: 'Mark',
    shortcut: 'm',
    keys: [],
    category: 'Touch',
    description: 'Taps on the map mark or unmark a possible mine there (m), until switched off.',
  },

  {
    id: 'mission',
    label: 'Quest status and options to end or continue (Esc)',
    shortLabel: 'Quest',
    shortcut: 'Esc',
    keys: [k('Escape')],
    category: 'Game',
  },
  {
    id: 'menu',
    label: 'Main menu: settings, special modes',
    shortLabel: 'Menu',
    shortcut: 'v',
    keys: [k('v')],
    category: 'Game',
  },
  { id: 'help', label: 'Help', shortLabel: 'Help', shortcut: 'F1', keys: [k('F1')], category: 'Game' },
  {
    id: 'new-game',
    label: 'New game',
    shortLabel: 'New game',
    shortcut: 'F5',
    keys: [k('F5')],
    category: 'Game',
  },

  // Keys for dialogs.
  {
    id: 'back',
    label: 'Back (Esc)',
    shortLabel: 'Back',
    shortcut: 'Esc',
    keys: [k('Escape')],
    category: 'Keys',
  },
  {
    id: 'confirm',
    label: 'Enter',
    shortLabel: 'OK',
    shortcut: 'Enter',
    keys: [k('Enter')],
    category: 'Keys',
  },
];

const BY_ID = new Map(HYPER_COMMANDS.map((command) => [command.id, command]));

export function findCommand(id: string): HyperCommand | undefined {
  return BY_ID.get(id);
}

export const PAD = {
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

/** The palette: every key command (the tap modes are offered by the dock, where they apply). */
export const PALETTE = HYPER_COMMANDS.filter(
  (command) => !command.id.startsWith('move-') && command.category !== 'Keys' && command.category !== 'Touch',
).map((command) => command.id);

export const HYPER_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: PAD,
  actions: ['recenter', 'context', 'mission', SHELL_COMMAND.palette],
  palette: PALETTE,
};

export type HyperContext = 'loading' | 'map' | 'dialog' | 'over';

/** Upstream's touch modes the dock offers (state.ts TOUCH_MODE). */
const INSPECT = 1;
const AIM = 4;

/** What the map dock depends on: the state snapshot, and the adapter's own Mark mode. */
export interface DockState {
  ranged: boolean;
  wind: boolean;
  crossbow: boolean;
  fireMode: boolean;
  reload: number;
  deadOrbs: number;
  orbStrategy: boolean;
  minefield: boolean;
  /** Upstream's touch mode (state.ts TOUCH_MODE). */
  touchMode: number;
  markMode: boolean;
}

const QUIET: DockState = {
  ranged: false,
  wind: false,
  crossbow: false,
  fireMode: false,
  reload: 0,
  deadOrbs: 0,
  orbStrategy: false,
  minefield: false,
  touchMode: 0,
  markMode: false,
};

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** The map dock: what the situation offers first, then the view, the quest screen and More. */
function mapActions(dock: DockState): TouchAction[] {
  const actions: TouchAction[] = [];
  const inspecting = dock.touchMode === INSPECT;
  if (inspecting) actions.push(a('inspect-mode', { active: true }));
  if (dock.ranged) actions.push(a('aim-mode', { active: dock.touchMode === AIM }));
  if (dock.crossbow)
    actions.push(
      a('fire-mode', { active: dock.fireMode, label: dock.reload > 0 ? `Fire (${dock.reload})` : 'Fire' }),
    );
  // `t` targets the cell at the centre of the view, which after any move is
  // the player (rejected); with strong wind it jumps where the wind blows.
  if (dock.wind) actions.push(a('target', { label: 'Wind jump' }));
  // `g` with nothing to drop only waits a turn.
  if (dock.deadOrbs > 0) actions.push(a('drop', { label: 'Drop Dead Orb' }));
  if (dock.orbStrategy) actions.push(a('inventory'));
  if (dock.minefield) actions.push(a('mark-mode', { active: dock.markMode }));
  actions.push(
    a('recenter', { alternates: ['rotate-left', 'rotate-right'] }),
    a('context', inspecting ? {} : { alternates: ['inspect-mode'] }),
    // In fire mode Esc cancels it (the quest screen comes with the next Esc).
    dock.fireMode
      ? a('mission', { label: 'Cancel fire' })
      : a('mission', { alternates: ['help', 'new-game', 'menu'] }),
    a(SHELL_COMMAND.palette, { label: 'More' }),
  );
  return actions;
}

/** The dock for each situation. Waiting is the pad's centre. */
export function controlsFor(context: HyperContext, dock: DockState = QUIET): TouchControlLayout {
  switch (context) {
    case 'loading':
      return { actions: [], palette: [] };
    case 'dialog':
      // Menus and help are drawn by the game; tap their lines, or go back.
      return { actions: [a('back', { emphasis: 'primary' }), a('confirm')], palette: PALETTE };
    case 'over':
      // Caught: the quest screen offers to start again or look around.
      return {
        actions: [a('mission', { label: 'Options', emphasis: 'primary' }), a('new-game'), a('menu')],
        palette: PALETTE,
      };
    case 'map':
      return { directionPad: PAD, actions: mapActions(dock), palette: PALETTE };
  }
}

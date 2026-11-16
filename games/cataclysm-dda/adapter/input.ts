// SPDX-License-Identifier: CC-BY-SA-3.0
/**
 * Cataclysm: DDA's controls: the commands of normal play with their original
 * keys (upstream's data/raw/keybindings.json, category DEFAULTMODE, and the
 * global movement keys), and the key events the page synthesises for
 * Emscripten's SDL 2 (which maps the legacy keyCode on keydown to a key and
 * turns the following keypress into text input).
 *
 * The touch layout here is a placeholder (phase 1): a pad, a few obvious
 * actions, More and the keyboard. The phone design is pending
 * (docs/design/mobile-play.md, games/cataclysm-dda/UI-INVENTORY.md).
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
  /** Legacy keyCode (what Emscripten's SDL 2 maps to a scancode). */
  keyCode: number;
  /** Character for the keypress that follows keydown (0: none). */
  charCode: number;
  shift?: boolean;
  ctrl?: boolean;
}

export interface CddaCommand extends GameCommandDescriptor {
  /** Upstream's action id (keybindings.json "id"). */
  action: string;
  keys: KeyStroke[];
}

/** Legacy keyCodes of the non-character keys. */
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
/** Legacy keyCodes of the numpad's other keys. */
const NUMPAD_KEYCODES: Record<string, number> = {
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDecimal: 110,
  NumpadDivide: 111,
  NumpadEnter: 13,
};
/** keybindings.json's names for them. */
const KEYPAD_OPERATORS: Record<string, [string, string]> = {
  KEYPAD_DIVIDE: ['/', 'NumpadDivide'],
  KEYPAD_MULTIPLY: ['*', 'NumpadMultiply'],
  KEYPAD_PLUS: ['+', 'NumpadAdd'],
  KEYPAD_MINUS: ['-', 'NumpadSubtract'],
  KEYPAD_PERIOD: ['.', 'NumpadDecimal'],
};
const SHIFTED_DIGITS = ')!@#$%^&*(';
const SHIFTED_PUNCTUATION = '><?_+:"{}|~';

/** The keystroke for a DOM key (as the shell reports it), or null if SDL has no use for it. */
export function strokeFor(key: string, code = '', shift = false, ctrl = false): KeyStroke | null {
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) {
    const digit = Number(numpad[1]);
    return { key, code, keyCode: 96 + digit, charCode: /\d/.test(key) ? key.charCodeAt(0) : 0, shift, ctrl };
  }
  if (code in NUMPAD_KEYCODES) {
    const charCode = !ctrl && [...key].length === 1 ? key.charCodeAt(0) : key === 'Enter' ? 13 : 0;
    return { key, code, keyCode: NUMPAD_KEYCODES[code]!, charCode, shift, ctrl };
  }
  const fn = /^F(\d{1,2})$/.exec(key);
  if (fn) return { key, code, keyCode: 111 + Number(fn[1]), charCode: 0, shift, ctrl };
  if (key in SPECIAL) {
    const keyCode = SPECIAL[key]!;
    const charCode = ctrl ? 0 : key === ' ' ? 32 : key === 'Enter' ? 13 : 0;
    return { key, code, keyCode, charCode, shift, ctrl };
  }
  if ([...key].length !== 1) return null;
  const char = key.codePointAt(0)!;
  // Text the game types (names) may use any character: keypress text only.
  if (char >= 0x80) return { key, code, keyCode: 0, charCode: char, shift, ctrl };
  // With Ctrl, browsers send no character.
  const charCode = ctrl ? 0 : char;
  if (/[a-z]/i.test(key))
    return {
      key,
      code,
      keyCode: key.toUpperCase().charCodeAt(0),
      charCode,
      shift: shift || /[A-Z]/.test(key),
      ctrl,
    };
  if (/\d/.test(key)) return { key, code, keyCode: char, charCode, shift, ctrl };
  const shifted = SHIFTED_DIGITS.indexOf(key);
  if (shifted >= 0) return { key, code, keyCode: 48 + shifted, charCode, shift: true, ctrl };
  if (key in PUNCTUATION)
    return {
      key,
      code,
      keyCode: PUNCTUATION[key]!,
      charCode,
      shift: shift || SHIFTED_PUNCTUATION.includes(key),
      ctrl,
    };
  return null;
}

/** A key from the shell (physical keyboard or on-screen keyboard). */
export function strokeForInput(input: Extract<GameInput, { type: 'key' }>): KeyStroke | null {
  if (input.modifiers.meta) return null;
  return strokeFor(input.key, input.code, input.modifiers.shift, input.modifiers.ctrl);
}

/**
 * A key named as upstream's keybindings.json names it ("a", "RETURN", "ESC",
 * "SPACE", "TAB", "BACKTAB", "UP", "F3", "PPAGE", "KEYPAD_8"...), or null.
 */
export function strokeForBinding(name: string, mods: readonly string[] = []): KeyStroke | null {
  const shift = mods.includes('shift');
  const ctrl = mods.includes('ctrl');
  const named: Record<string, [string, string?]> = {
    RETURN: ['Enter'],
    KEYPAD_ENTER: ['Enter', 'NumpadEnter'],
    ESC: ['Escape'],
    SPACE: [' '],
    TAB: ['Tab'],
    BACKTAB: ['Tab'],
    BACKSPACE: ['Backspace'],
    DELETE: ['Delete'],
    HOME: ['Home'],
    END: ['End'],
    PPAGE: ['PageUp'],
    NPAGE: ['PageDown'],
    UP: ['ArrowUp'],
    DOWN: ['ArrowDown'],
    LEFT: ['ArrowLeft'],
    RIGHT: ['ArrowRight'],
  };
  if (name in named) {
    const [key, code] = named[name]!;
    return strokeFor(key, code ?? '', shift || name === 'BACKTAB', ctrl);
  }
  const keypad = /^KEYPAD_(\d)$/.exec(name);
  if (keypad) return strokeFor(keypad[1]!, `Numpad${keypad[1]}`, shift, ctrl);
  if (name in KEYPAD_OPERATORS) {
    const [key, code] = KEYPAD_OPERATORS[name]!;
    return strokeFor(key, code, shift, ctrl);
  }
  // The legacy form of Ctrl+letter ("CTRL+C").
  const legacyCtrl = /^CTRL\+([A-Z])$/.exec(name);
  if (legacyCtrl) return strokeFor(legacyCtrl[1]!.toLowerCase(), '', false, true);
  if (/^F\d{1,2}$/.test(name)) return strokeFor(name, '', shift, ctrl);
  if ([...name].length === 1) return strokeFor(ctrl ? name.toLowerCase() : name, '', shift, ctrl);
  return null;
}

const k = (name: string): KeyStroke => {
  const stroke = strokeForBinding(name);
  if (!stroke) throw new Error(`no keystroke for ${name}`);
  return stroke;
};

/** [action id, label, short label, key as keybindings.json names it, category] */
type Row = [string, string, string, string, string];

// Labels are upstream's action names (keybindings.json "name"), shortened
// for buttons. The order is the palette's.
const ROWS: Row[] = [
  // Movement: the global direction actions (vi keys; arrows and the numpad work too).
  ['LEFTUP', 'Move up-left', '↖', 'y', 'Movement'],
  ['UP', 'Move up', '↑', 'k', 'Movement'],
  ['RIGHTUP', 'Move up-right', '↗', 'u', 'Movement'],
  ['LEFT', 'Move left', '←', 'h', 'Movement'],
  ['RIGHT', 'Move right', '→', 'l', 'Movement'],
  ['LEFTDOWN', 'Move down-left', '↙', 'b', 'Movement'],
  ['DOWN', 'Move down', '↓', 'j', 'Movement'],
  ['RIGHTDOWN', 'Move down-right', '↘', 'n', 'Movement'],
  ['pause', 'Pause (wait a turn)', 'Wait', '.', 'Movement'],
  ['LEVEL_UP', 'Go up', 'Up <', '<', 'Movement'],
  ['LEVEL_DOWN', 'Go down', 'Down >', '>', 'Movement'],
  ['open_movement', 'Movement mode menu', 'Move mode', '"', 'Movement'],
  ['wait', 'Wait for several minutes', 'Wait…', '|', 'Movement'],
  ['sleep', 'Sleep', 'Sleep', '$', 'Movement'],
  ['control_vehicle', 'Control vehicle', 'Drive', '^', 'Movement'],

  ['look', 'Look around', 'Look', ';', 'World'],
  ['examine', 'Examine nearby terrain or furniture', 'Examine', 'e', 'World'],
  ['pickup', 'Pick up items from one nearby tile', 'Pick up', 'g', 'World'],
  ['open', 'Open door', 'Open', 'o', 'World'],
  ['close', 'Close door', 'Close', 'c', 'World'],
  ['smash', 'Smash nearby terrain', 'Smash', 's', 'World'],
  ['grab', 'Grab something nearby', 'Grab', 'G', 'World'],
  ['haul', 'Haul items along the ground', 'Haul', '\\', 'World'],
  ['butcher', 'Butcher', 'Butcher', 'B', 'World'],
  ['chat', 'Chat with NPC', 'Chat', 'C', 'World'],
  ['peek', 'Peek around corners', 'Peek', 'X', 'World'],
  ['listitems', 'List all items around the player', 'Items', 'V', 'World'],
  ['map', 'View map', 'Map', 'm', 'World'],
  ['zones', 'Zones manager', 'Zones', 'Y', 'World'],
  ['loot', 'Zone activities', 'Zone act.', 'O', 'World'],

  ['inventory', 'Open inventory', 'Inventory', 'i', 'Items'],
  ['advinv', 'Advanced Inventory Manager', 'AIM', '/', 'Items'],
  ['apply', 'Use item', 'Use', 'a', 'Items'],
  ['apply_wielded', 'Use wielded item', 'Use wielded', 'A', 'Items'],
  ['wield', 'Wield', 'Wield', 'w', 'Items'],
  ['wear', 'Wear item', 'Wear', 'W', 'Items'],
  ['take_off', 'Take off worn item', 'Take off', 'T', 'Items'],
  ['eat', 'Consume item', 'Eat', 'E', 'Items'],
  ['read', 'Read', 'Read', 'R', 'Items'],
  ['drop', 'Drop item', 'Drop', 'd', 'Items'],
  ['drop_adj', 'Drop item to adjacent tile', 'Drop near', 'D', 'Items'],
  ['insert', 'Insert item', 'Insert', 'v', 'Items'],
  ['unload', 'Unload item', 'Unload', 'U', 'Items'],
  ['reload_item', 'Reload item', 'Reload', 'r', 'Items'],
  ['compare', 'Compare two items', 'Compare', 'I', 'Items'],
  ['organize', 'Swap inventory letters', 'Letters', '=', 'Items'],
  ['sort_armor', 'Sort armor', 'Armor', '+', 'Items'],
  ['item_action_menu', 'Item action menu', 'Item menu', '%', 'Items'],

  ['fire', 'Fire wielded item', 'Fire', 'f', 'Combat'],
  ['select_fire_mode', 'Toggle attack mode of wielded item', 'Fire mode', 'F', 'Combat'],
  ['select_default_ammo', 'Select default ammo for wielded weapon', 'Ammo', 'F3', 'Combat'],
  ['throw', 'Throw item', 'Throw', 't', 'Combat'],
  ['autoattack', 'Autoattack', 'Attack', 'TAB', 'Combat'],
  ['pick_style', 'Select martial arts style', 'Style', '_', 'Combat'],
  ['safemode', 'Toggle safe mode', 'Safe mode', '!', 'Combat'],
  ['ignore_enemy', 'Ignore nearby enemy', 'Ignore', "'", 'Combat'],
  ['whitelist_enemy', 'Whitelist enemy', 'Whitelist', '~', 'Combat'],
  ['cast_spell', 'Supernatural abilities', 'Abilities', ']', 'Combat'],

  ['craft', 'Craft items', 'Craft', '&', 'Make'],
  ['recraft', 'Recraft last recipe', 'Recraft', '-', 'Make'],
  ['construct', 'Construct terrain', 'Build', '*', 'Make'],
  ['disassemble', 'Disassemble items', 'Disassemble', '(', 'Make'],

  ['player_data', 'View player info', 'Character', '@', 'Character'],
  ['bionics', 'View/activate bionics', 'Bionics', 'p', 'Character'],
  ['mutations', 'View/activate mutations', 'Mutations', '[', 'Character'],
  ['medical', 'View medical', 'Medical', 'N', 'Character'],
  ['bodystatus', 'View body status', 'Body', '{', 'Character'],
  ['missions', 'View missions', 'Missions', 'M', 'Character'],
  ['factions', 'View factions', 'Factions', '#', 'Character'],
  ['diary', 'Open diary / achievements / scores', 'Diary', ')', 'Character'],
  ['messages', 'View message log', 'Messages', 'P', 'Character'],

  ['action_menu', 'Action menu', 'Actions', 'RETURN', 'Game'],
  ['main_menu', 'Main menu', 'Menu', 'ESC', 'Game'],
  ['help', 'View help', 'Help', '0', 'Game'],
  ['save', 'Save and quit', 'Save', 'S', 'Game'],
  ['zoom_in', 'Zoom in', 'Zoom +', 'z', 'Game'],
  ['zoom_out', 'Zoom out', 'Zoom −', 'Z', 'Game'],
  ['HELP_KEYBINDINGS', 'Display keybindings menu', 'Keys', '?', 'Game'],

  // Keys for menus and prompts (the global actions every menu registers).
  ['CONFIRM', 'Confirm choice (Enter)', 'OK', 'RETURN', 'Keys'],
  ['QUIT', 'Exit screen (Esc)', 'Back', 'ESC', 'Keys'],
  ['NEXT_TAB', 'Next tab', 'Tab →', 'TAB', 'Keys'],
  ['PREV_TAB', 'Previous tab', '← Tab', 'BACKTAB', 'Keys'],
  ['PAGE_UP', 'Page up', 'Pg up', 'PPAGE', 'Keys'],
  ['PAGE_DOWN', 'Page down', 'Pg dn', 'NPAGE', 'Keys'],
  ['CONFIRM_MULTIPLE', 'Space', 'Space', 'SPACE', 'Keys'],
];

/** Shown on buttons: the key as a player types it. */
function shortcutLabel(name: string): string {
  const names: Record<string, string> = {
    RETURN: 'Enter',
    ESC: 'Esc',
    TAB: 'Tab',
    BACKTAB: 'Shift+Tab',
    PPAGE: 'PgUp',
    NPAGE: 'PgDn',
    SPACE: 'Space',
  };
  return names[name] ?? name;
}

export const CDDA_COMMANDS: readonly CddaCommand[] = ROWS.map(
  ([action, label, shortLabel, key, category]) => ({
    id: action,
    action,
    label,
    shortLabel,
    shortcut: shortcutLabel(key),
    category,
    keys: [k(key)],
  }),
);

/** The upstream key name of each command (for the key coverage check). */
export const COMMAND_BINDINGS: Readonly<Record<string, string>> = Object.fromEntries(
  ROWS.map(([action, , , key]) => [action, key]),
);

/**
 * Keys for the start screens and menus that are not upstream actions of the
 * map (so not in CDDA_COMMANDS, which the key coverage check holds to
 * upstream's bindings): main menu shortcuts, menu arrows, yes/no.
 */
const helper = (id: string, label: string, shortLabel: string, keys: string[]): CddaCommand => ({
  id,
  action: id,
  label,
  shortLabel,
  shortcut: keys.map(shortcutLabel).join(' '),
  category: 'Keys',
  keys: keys.map(k),
});
export const HELPER_COMMANDS: readonly CddaCommand[] = [
  // The main menu (main_menu.cpp): n New Game, then its sub-menu's d (Play
  // Now!, default scenario) or o (Play Now!, random scenario); a Load.
  helper('ra:play-now', 'Play Now! (default scenario, default character)', 'Play Now!', ['n', 'd']),
  helper('ra:play-now-random', 'Play Now! (random scenario)', 'Random start', ['n', 'o']),
  helper('ra:new-game', 'New Game (custom, preset or random character)', 'New game', ['n']),
  helper('ra:load', 'Load a saved game', 'Load', ['a']),
  // Menus take the arrow keys (their letters are often entry hotkeys).
  helper('ra:up', 'Up', '↑', ['UP']),
  helper('ra:down', 'Down', '↓', ['DOWN']),
  helper('ra:left', 'Left', '←', ['LEFT']),
  helper('ra:right', 'Right', '→', ['RIGHT']),
  // Yes/no questions want a capital Y by default (FORCE_CAPITAL_YN: "(Case Sensitive)").
  helper('ra:yes', 'Yes', 'Yes', ['Y']),
  helper('ra:no', 'No', 'No', ['N']),
  // Character creation (newcharacter.cpp): > finishes on the description tab, * picks at random.
  helper('ra:finish', 'Finish the character', 'Finish', ['>']),
  helper('ra:random', 'Random choice', 'Random', ['*']),
];

const BY_ID = new Map([...CDDA_COMMANDS, ...HELPER_COMMANDS].map((command) => [command.id, command]));
export function findCommand(id: string): CddaCommand | undefined {
  return BY_ID.get(id);
}

export const PAD = {
  nw: 'LEFTUP',
  n: 'UP',
  ne: 'RIGHTUP',
  w: 'LEFT',
  center: 'pause',
  e: 'RIGHT',
  sw: 'LEFTDOWN',
  s: 'DOWN',
  se: 'RIGHTDOWN',
} as const;

const PAD_IDS = new Set<string>(Object.values(PAD));
/** The palette: every command except the pad's. */
export const PALETTE = CDDA_COMMANDS.filter(
  (command) => !PAD_IDS.has(command.id) || command.id === 'pause',
).map((command) => command.id);

/** What the adapter tells apart (state.ts detectContext). */
export type CddaContext = 'loading' | 'title' | 'map' | 'direction' | 'menu' | 'text' | 'busy';

/** Menus: the pad sends arrow keys (Page up/down on the diagonals), Enter in its centre. */
export const MENU_PAD = {
  nw: 'PAGE_UP',
  n: 'ra:up',
  ne: 'PAGE_UP',
  w: 'ra:left',
  center: 'CONFIRM',
  e: 'ra:right',
  sw: 'PAGE_DOWN',
  s: 'ra:down',
  se: 'PAGE_DOWN',
} as const;

const MORE: TouchAction = { command: SHELL_COMMAND.palette, label: 'More' };
const TYPE: TouchAction = { command: SHELL_COMMAND.keyboard, label: 'Keyboard' };
const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** Yes/no questions (popup.cpp, query_yn): their keybinding contexts. */
const YES_NO = new Set(['YESNO', 'YESNOQUIT', 'YES_NO_ALWAYS_NEVER']);

/**
 * Controls for each screen. On the map (phase 1, pending design): the pad
 * and Inventory, Look and Actions. The start screens and menus (enough to
 * start and play a game by touch; the full phone design is still to come):
 * - the main menu: Play Now! (the quickest way into a game), New game and
 *   Load, with the pad moving along the menu and Enter in its centre;
 * - yes/no questions: Yes and No;
 * - character creation: the tabs, Random, Finish on the last tab;
 * - other menus and popups: the pad (arrows), Back and OK.
 * `inputContext` is the game's keybinding context (keybindings.json category).
 */
export function controlsFor(context: CddaContext, inputContext = ''): TouchControlLayout {
  switch (context) {
    case 'map':
      return {
        directionPad: PAD,
        actions: ['inventory', 'look', 'action_menu', MORE, TYPE],
        palette: PALETTE,
      };
    case 'direction':
      return { directionPad: PAD, actions: ['QUIT', MORE, TYPE], palette: PALETTE };
    case 'title':
      return {
        directionPad: MENU_PAD,
        actions: [
          a('ra:new-game', { label: 'New game' }),
          a('ra:load', { label: 'Load' }),
          a('ra:play-now-random', { label: 'Random start' }),
          a('QUIT', { label: 'Back' }),
          a('ra:play-now', { label: 'Play Now!', emphasis: 'primary', wide: true }),
        ],
        reading: true,
        palette: PALETTE,
      };
    case 'text':
      return {
        actions: [
          a('QUIT', { label: 'Back' }),
          a('CONFIRM', { label: 'OK' }),
          { ...TYPE, emphasis: 'primary' },
        ],
        reading: true,
        palette: PALETTE,
      };
    case 'menu':
      if (YES_NO.has(inputContext))
        return {
          actions: [
            a('ra:no', { label: 'No' }),
            ...(inputContext === 'YESNOQUIT' ? [a('QUIT', { label: 'Cancel' })] : []),
            a('ra:yes', { label: 'Yes', emphasis: 'primary', wide: true }),
          ],
          reading: true,
          palette: PALETTE,
        };
      if (inputContext.startsWith('NEW_CHAR_'))
        return {
          directionPad: MENU_PAD,
          actions: [
            a('PREV_TAB', { label: '← Tab' }),
            a('NEXT_TAB', { label: 'Tab →' }),
            a('ra:random', { label: 'Random' }),
            a('QUIT', { label: 'Back' }),
            TYPE,
            inputContext === 'NEW_CHAR_DESCRIPTION'
              ? a('ra:finish', { label: 'Finish', emphasis: 'primary', wide: true })
              : a('CONFIRM', { label: 'OK', emphasis: 'primary' }),
          ],
          reading: true,
          palette: PALETTE,
        };
      return {
        directionPad: MENU_PAD,
        actions: [
          a('QUIT', { label: 'Back' }),
          MORE,
          TYPE,
          a('CONFIRM', { label: 'OK', emphasis: 'primary' }),
        ],
        reading: true,
        palette: PALETTE,
      };
    default:
      return { actions: [MORE, TYPE], palette: PALETTE };
  }
}

export const CDDA_TOUCH_LAYOUT: TouchControlLayout = controlsFor('map');

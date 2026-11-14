// SPDX-License-Identifier: GPL-2.0-only
/**
 * Angband keys, mouse clicks and commands.
 *
 * Input reaches the game as Angband's own events (ui-event.h): a keycode with
 * modifiers (KC_ENTER, ESCAPE, ARROW_UP, Ctrl letters as KTRL(...), keypad
 * digits with KC_MOD_KEYPAD), or a mouse click on a screen cell, which
 * Angband's menus take and which on the map walks or travels there
 * (ui-context.c textui_process_click, the mouse_movement option). The worker
 * passes them on as one number each: a key is `code | mods << 21`, a click
 * `-(1 + x + y * 256 + button * 65536)`.
 *
 * Commands are named shortcuts for Angband's own bindings (src/ui-game.c's
 * command tables, in the original and the roguelike keyset;
 * tests/conformance/key-coverage.ts checks each). Movement uses the arrow and
 * Home/PageUp/End/PageDown keys, which upstream's pref.prf maps to walking in
 * both keysets, and Shift with them to run.
 */
import {
  SHELL_COMMAND,
  type GameCommandDescriptor,
  type GameInput,
  type TouchAction,
  type TouchControlLayout,
} from '@rogue-archive/game-api';

/** Angband keycodes (ui-event.h). */
export const KC = {
  ENTER: 0x9c,
  TAB: 0x9d,
  DELETE: 0x9e,
  BACKSPACE: 0x9f,
  ESCAPE: 0xe000,
  ARROW_DOWN: 0x80,
  ARROW_LEFT: 0x81,
  ARROW_RIGHT: 0x82,
  ARROW_UP: 0x83,
  F1: 0x84,
  HOME: 0x94,
  PGUP: 0x95,
  END: 0x96,
  PGDOWN: 0x97,
  INSERT: 0x98,
} as const;

/** Keycode modifiers (ui-event.h KC_MOD_*). */
export const MOD = { CONTROL: 0x01, SHIFT: 0x02, ALT: 0x04, META: 0x08, KEYPAD: 0x10 } as const;

/** One input event for the worker (see the file comment). */
export function keyEvent(code: number, mods = 0): number {
  return code | (mods << 21);
}

/** A mouse click on a screen cell; `button` 1 or 2, `mods` KC_MOD_* (Term_mousepress packs them). */
export function clickEvent(x: number, y: number, button = 1, mods = 0): number {
  return -(1 + x + y * 256 + (button | (mods << 4)) * 65536);
}

const ktrl = (letter: string) => letter.toUpperCase().charCodeAt(0) & 31;
const ch = (char: string) => char.charCodeAt(0);

/** DOM keys with an Angband keycode of their own. */
const SPECIAL: Record<string, number> = {
  Escape: KC.ESCAPE,
  Enter: KC.ENTER,
  Tab: KC.TAB,
  Backspace: KC.BACKSPACE,
  Delete: KC.DELETE,
  ArrowUp: KC.ARROW_UP,
  ArrowDown: KC.ARROW_DOWN,
  ArrowLeft: KC.ARROW_LEFT,
  ArrowRight: KC.ARROW_RIGHT,
  Home: KC.HOME,
  End: KC.END,
  PageUp: KC.PGUP,
  PageDown: KC.PGDOWN,
  Insert: KC.INSERT,
};

/**
 * Converts a key to the event Angband should receive, or null if it has no
 * use for it. Mirrors upstream's SDL2 front end: special keys as KC_* codes
 * with their modifiers (Shift+arrow runs through pref.prf's keymaps), keypad
 * digits with KC_MOD_KEYPAD, Ctrl+letter as the control character.
 */
export function keyToAngband(input: Extract<GameInput, { type: 'key' }>): number[] | null {
  const { key, code, modifiers } = input;
  if (modifiers.meta) return null;
  let mods = (modifiers.ctrl ? MOD.CONTROL : 0) | (modifiers.alt ? MOD.ALT : 0);
  const keypad = /^Numpad([0-9])$/.exec(code);
  if (keypad && /^[0-9]$/.test(key)) return [keyEvent(ch(keypad[1]!), mods | MOD.KEYPAD)];
  const special = SPECIAL[key] ?? (/^F([1-9]|1[0-5])$/.test(key) ? KC.F1 + Number(key.slice(1)) - 1 : null);
  if (special !== null) {
    if (modifiers.shift) mods |= MOD.SHIFT;
    return [keyEvent(special, mods)];
  }
  if ([...key].length !== 1) return null;
  const charCode = key.codePointAt(0)!;
  if (modifiers.ctrl) {
    const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? (/^[a-z]$/i.test(key) ? key.toUpperCase() : null);
    if (letter) return [keyEvent(ktrl(letter), modifiers.alt ? MOD.ALT : 0)];
    return [keyEvent(charCode, mods)];
  }
  return [keyEvent(charCode, mods)];
}

/** Text typed with the device keyboard: one key event per character. */
export function textToAngband(text: string): number[] {
  return [...text].map((char) => (char === '\n' ? KC.ENTER : keyEvent(char.codePointAt(0)!)));
}

export interface AngbandCommand extends GameCommandDescriptor {
  /** Key codes in the original keyset. */
  keys: number[];
  /** Key codes in the roguelike keyset, when they differ. */
  rogue?: number[];
}

const c = (
  id: string,
  label: string,
  shortLabel: string,
  keys: number[],
  category: string,
  extra: Partial<AngbandCommand> = {},
): AngbandCommand => ({ id, label, shortLabel, keys, category, ...extra });

const name = (code: number): string =>
  code === KC.TAB ? 'Tab' : code < 32 ? `Ctrl+${String.fromCharCode(code + 64)}` : String.fromCharCode(code);

/** The original keyset's key, shown on buttons (Rest's Enter answers its prompt). */
const shortcut = (keys: number[]): string => name(keys[0]!);

/** The roguelike keyset's key, in the command list's description, where it differs. */
function rogueNote(command: AngbandCommand): string | undefined {
  if (!command.rogue || command.rogue.join() === command.keys.join()) return command.description;
  const note = `Roguelike keyset: ${command.rogue.map(name).join('')}.`;
  return command.description ? `${command.description} ${note}` : note;
}

const RAW: AngbandCommand[] = [
  c('move-nw', 'Move up-left', '↖', [KC.HOME], 'Movement', { shortcut: '7 · Home' }),
  c('move-n', 'Move up', '↑', [KC.ARROW_UP], 'Movement', { shortcut: '8 · ↑' }),
  c('move-ne', 'Move up-right', '↗', [KC.PGUP], 'Movement', { shortcut: '9 · PageUp' }),
  c('move-w', 'Move left', '←', [KC.ARROW_LEFT], 'Movement', { shortcut: '4 · ←' }),
  c('move-e', 'Move right', '→', [KC.ARROW_RIGHT], 'Movement', { shortcut: '6 · →' }),
  c('move-sw', 'Move down-left', '↙', [KC.END], 'Movement', { shortcut: '1 · End' }),
  c('move-s', 'Move down', '↓', [KC.ARROW_DOWN], 'Movement', { shortcut: '2 · ↓' }),
  c('move-se', 'Move down-right', '↘', [KC.PGDOWN], 'Movement', { shortcut: '3 · PageDown' }),
  c('run', 'Run', 'Run', [], 'Movement', {
    shortcut: 'Shift+direction',
    description: 'The next direction runs until something interesting happens.',
  }),
  c('hold', 'Stay still (a turn; enters a shop)', 'Hold', [ch(',')], 'Movement', { rogue: [ch('.')] }),
  c('rest', 'Rest as needed', 'Rest', [ch('R'), KC.ENTER], 'Movement', {
    description: "Rest until healed or disturbed (R, then Enter for Angband's '&': as needed).",
  }),
  c('upstairs', 'Go up a staircase', 'Up <', [ch('<')], 'Movement'),
  c('downstairs', 'Go down a staircase', 'Down >', [ch('>')], 'Movement'),
  c('open', 'Open a door or a chest', 'Open', [ch('o')], 'Movement'),
  c('close', 'Close a door', 'Close', [ch('c')], 'Movement'),
  c('disarm', 'Disarm a trap or chest', 'Disarm', [ch('D')], 'Movement'),
  c('tunnel', 'Dig a tunnel', 'Tunnel', [ch('T')], 'Movement', { rogue: [ktrl('t')] }),
  c('alter', 'Alter a grid (open, dig, disarm)', 'Alter', [ch('+')], 'Movement'),
  c('jump', 'Walk into a trap', 'Into trap', [ch('W')], 'Movement', { rogue: [ch('-')] }),
  c('locate', 'Locate player on map', 'Locate', [ch('L')], 'Movement', { rogue: [ch('W')] }),
  c('center', 'Center map', 'Center', [ktrl('l')], 'Movement', { rogue: [ch('@')] }),

  c('fire', 'Fire your missile weapon', 'Fire', [ch('f')], 'Combat', { rogue: [ch('t')] }),
  c('fire-nearest', 'Fire at nearest target', 'Fire ⟶', [ch('h')], 'Combat', { rogue: [KC.TAB] }),
  c('throw', 'Throw an item', 'Throw', [ch('v')], 'Combat'),
  c('cast', 'Cast a spell', 'Cast', [ch('m')], 'Combat'),
  c('browse', 'Browse a book', 'Browse', [ch('b')], 'Combat', { rogue: [ch('P')] }),
  c('study', 'Gain new spells', 'Study', [ch('G')], 'Combat'),
  c('target', 'Target monster or location', 'Target', [ch('*')], 'Combat'),
  c('target-closest', 'Target closest monster', 'Target near', [ch("'")], 'Combat'),

  c('inventory', 'Display inventory listing', 'Pack', [ch('i')], 'Items'),
  c('equipment', 'Display equipment listing', 'Gear', [ch('e')], 'Items'),
  c('quiver', 'Display quiver listing', 'Quiver', [ch('|')], 'Items'),
  c('pickup', 'Pick up objects', 'Pick up', [ch('g')], 'Items'),
  c('wear', 'Wear/wield an item', 'Wear', [ch('w')], 'Items'),
  c('takeoff', 'Take off/unwield an item', 'Take off', [ch('t')], 'Items', { rogue: [ch('T')] }),
  c('drop', 'Drop an item', 'Drop', [ch('d')], 'Items'),
  c('examine', 'Examine an item', 'Examine', [ch('I')], 'Items'),
  c('eat', 'Eat some food', 'Eat', [ch('E')], 'Items'),
  c('quaff', 'Quaff a potion', 'Quaff', [ch('q')], 'Items'),
  c('read', 'Read a scroll', 'Read', [ch('r')], 'Items'),
  c('fuel', 'Fuel your light source', 'Fuel', [ch('F')], 'Items'),
  c('staff', 'Use a staff', 'Staff', [ch('u')], 'Items', { rogue: [ch('Z')] }),
  c('wand', 'Aim a wand', 'Wand', [ch('a')], 'Items', { rogue: [ch('z')] }),
  c('rod', 'Zap a rod', 'Rod', [ch('z')], 'Items', { rogue: [ch('a')] }),
  c('activate', 'Activate an object', 'Activate', [ch('A')], 'Items'),
  c('use', 'Use an item', 'Use', [ch('U')], 'Items', { rogue: [ch('X')] }),
  c('inscribe', 'Inscribe an object', 'Inscribe', [ch('{')], 'Items'),
  c('uninscribe', 'Uninscribe an object', 'Uninscribe', [ch('}')], 'Items'),
  c('ignore', 'Ignore an item', 'Ignore', [ch('k')], 'Items', { rogue: [ktrl('d')] }),

  c('look', 'Look around', 'Look', [ch('l')], 'Information', { rogue: [ch('x')] }),
  c('map', 'Full dungeon map', 'Map', [ch('M')], 'Information'),
  c('monsters', 'Display visible monster list', 'Monsters', [ch('[')], 'Information'),
  c('objects', 'Display visible item list', 'Objects', [ch(']')], 'Information'),
  c('character', 'Character description', 'Character', [ch('C')], 'Information'),
  c('abilities', 'View abilities', 'Abilities', [ch('S')], 'Information'),
  c('knowledge', 'Check knowledge', 'Knowledge', [ch('~')], 'Information'),
  c('feeling', 'Repeat level feeling', 'Feeling', [ktrl('f')], 'Information'),
  c('messages', 'Show previous messages', 'History', [ktrl('p')], 'Information'),
  c('symbol', 'Identify symbol', 'Symbol', [ch('/')], 'Information'),
  c('help', 'Help', 'Help', [ch('?')], 'Information'),
  c('command-menu', "Angband's command menu", 'Commands', [KC.ENTER], 'Information', {
    shortcut: 'Enter',
    description: 'Every command, in menus (Angband opens them with Enter on the map).',
  }),
  c('repeat', 'Repeat previous command', 'Repeat', [ch('n')], 'Game', { rogue: [ktrl('v')] }),

  c('options', 'Interact with options', 'Options', [ch('=')], 'Game'),
  c('save', "Save and don't quit", 'Save', [ktrl('s')], 'Game'),
  c('save-quit', 'Save and quit', 'Save & quit', [ktrl('x')], 'Game'),
  c('note', 'Take notes', 'Note', [ch(':')], 'Game'),
  c('redraw', 'Redraw the screen', 'Redraw', [ktrl('r')], 'Game'),
  c('retire', 'Retire character and quit', 'Retire', [ch('Q')], 'Game'),

  // Answers to prompts.
  c('confirm', 'Confirm / select', 'OK', [KC.ENTER], 'Keys', { shortcut: 'Enter' }),
  c('cancel', 'Cancel / close', 'Back', [KC.ESCAPE], 'Keys', { shortcut: 'Esc' }),
  c('continue', 'Continue', 'Continue', [KC.ENTER], 'Keys', { shortcut: 'Enter' }),
  c('yes', 'Yes', 'Yes', [ch('y')], 'Keys'),
  c('no', 'No', 'No', [ch('n')], 'Keys'),
  c('show-equip', 'Switch to equipment', 'Worn', [ch('/')], 'Keys'),
  c('show-inven', 'Switch to the pack', 'Pack', [ch('/')], 'Keys'),
  c('show-quiver', 'Switch to the quiver', 'Quiver', [ch('|')], 'Keys'),
  c('floor-item', 'An item on the floor', 'Floor', [ch('-')], 'Keys'),
  c('aim-closest', 'Aim at the closest target', 'Closest', [ch("'")], 'Keys'),
  c('aim-target', 'Aim at the current target', 'At target', [ch('t')], 'Keys'),
  c('choose-target', 'Choose a target', 'Choose target', [ch('*')], 'Keys'),
  c('next-target', 'Next target', 'Next', [32], 'Keys', { shortcut: 'Space' }),
  c('select-target', 'Target this', 'Target', [ch('t')], 'Keys'),
  c('recall', 'Recall what you know of this monster', 'Recall', [ch('r')], 'Keys'),
  c('buy', 'Purchase an item', 'Buy', [ch('p')], 'Keys'),
  c('sell', 'Sell an item', 'Sell', [ch('s')], 'Keys'),
  c('store-examine', 'Examine an item in the store', 'Examine', [ch('l')], 'Keys'),
  c('random', 'Random choice', 'Random', [ch('*')], 'Keys'),
  c('page', 'Next page', 'Next page', [32], 'Keys', { shortcut: 'Space' }),
];

export const ANGBAND_COMMANDS: readonly AngbandCommand[] = RAW.map((command) => ({
  ...command,
  shortcut: command.shortcut ?? shortcut(command.keys),
  description: rogueNote(command),
}));

const BY_ID = new Map(ANGBAND_COMMANDS.map((command) => [command.id, command]));

export function findCommand(id: string): AngbandCommand | undefined {
  return BY_ID.get(id);
}

/** The keys a command sends in the keyset in use. */
export function commandKeys(command: AngbandCommand, roguelike: boolean): number[] {
  return roguelike && command.rogue ? command.rogue : command.keys;
}

/** Direction digit (1-9) → the movement command and its key. */
export const DIRECTION_COMMANDS: Record<number, string> = {
  7: 'move-nw',
  8: 'move-n',
  9: 'move-ne',
  4: 'move-w',
  6: 'move-e',
  1: 'move-sw',
  2: 'move-s',
  3: 'move-se',
};

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

/** Menus and creation: the arrows move, Enter in the centre. */
export const MENU_PAD = { ...PAD, center: 'confirm' } as const;
/** Direction prompts: a direction, nothing in the centre. */
export const DIRECTION_PAD = { ...PAD, center: null };

export const PALETTE = ANGBAND_COMMANDS.filter(
  (command) => !command.id.startsWith('move-') && command.category !== 'Keys',
).map((command) => command.id);

export const ANGBAND_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: PAD,
  actions: ['rest', 'inventory', 'look', SHELL_COMMAND.palette],
  palette: PALETTE,
};

export type AngbandContext =
  | 'select'
  | 'birth'
  | 'map'
  | 'store'
  | 'more'
  | 'yesno'
  | 'direction'
  | 'aim'
  | 'targeting'
  | 'item'
  | 'menu'
  | 'text'
  | 'busy';

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** A lettered choice on screen, as a dock button (its key is sent). */
export const CHOOSE = 'choose:';
/** A row of Angband's savefile menu, as a dock button (clicked twice: the menu takes a double click). */
export const SAVE_ROW = 'save-row:';
/** Attack the adjacent monster: a move in its direction (`attack:<digit>`). */
export const ATTACK = 'attack:';

/**
 * What the docks need to know: the snapshot's read-only fields
 * (port/main-web.c). Only hp, maxHp and run are required; the rest default
 * to "nothing special".
 */
export interface DockState {
  hp: number;
  maxHp: number;
  /** The Run modifier is latched (the next direction runs). */
  run: boolean;
  underFeature?: 'none' | 'down' | 'up' | 'shop';
  underObjects?: number;
  monstersInView?: number;
  monstersAdjacent?: number;
  attackDir?: number;
  canFire?: boolean;
  quiver?: number;
  caster?: boolean;
  canCast?: boolean;
  doorsAdjacent?: number;
  depth?: number;
  /** The prompt line (aim prompts say whether a target is set). */
  prompt?: string;
  /** The bottom line (where pages such as the scores say how to leave them). */
  bottom?: string;
}

/** Below this share of health the danger dock leads with healing. */
const LOW_HEALTH = 0.5;

const PACK_ALTERNATES = [
  'equipment',
  'quiver',
  'wear',
  'takeoff',
  'eat',
  'quaff',
  'read',
  'use',
  'drop',
  'examine',
  'fuel',
];
const LOOK_ALTERNATES = ['map', 'monsters', 'objects', 'character', 'knowledge', 'messages', 'locate'];
const DOOR_ALTERNATES = ['open', 'close', 'disarm', 'tunnel', 'alter'];
const MAGIC_ALTERNATES = ['browse', 'study', 'staff', 'wand', 'rod', 'activate'];

/** The lead on the map: what is underfoot. Null when nothing stands out. */
export function mapLead(state: DockState): TouchAction | null {
  const primary = { emphasis: 'primary' as const };
  switch (state.underFeature) {
    case 'down':
      return a('downstairs', { ...primary, alternates: ['upstairs'] });
    case 'up':
      return a('upstairs', { ...primary, alternates: ['downstairs'] });
    case 'shop':
      return a('hold', { label: 'Enter shop', ...primary });
  }
  if ((state.underObjects ?? 0) > 0) return a('pickup', primary);
  return null;
}

/** The map dock for the situation: exploring, monsters in view, adjacent, low health. */
function mapControls(state: DockState): TouchControlLayout {
  const lead = mapLead(state);
  const leading = lead ? [lead] : [];
  const inView = state.monstersInView ?? 0;
  const adjacent = state.monstersAdjacent ?? 0;
  const wounded = state.maxHp > 0 && state.hp < state.maxHp * LOW_HEALTH;
  const pack = a('inventory', { alternates: PACK_ALTERNATES });
  const look = a('look', { alternates: LOOK_ALTERNATES });
  const more = a(SHELL_COMMAND.palette, { label: 'More', alternates: ['command-menu'] });
  const run = state.run ? a('run', { label: 'Run ⇧', active: true }) : null;
  const cast = state.caster ? [a('cast', { alternates: MAGIC_ALTERNATES })] : [];
  // One tap at a visible monster: fire at the nearest (with a launcher and
  // ammunition), else throw.
  const shoot = state.canFire
    ? a('fire-nearest', { label: 'Fire', alternates: ['fire', 'throw', 'target-closest'] })
    : a('throw', { alternates: ['fire', 'target-closest'] });
  let actions: TouchAction[];
  if (wounded && inView > 0) {
    // Low health with monsters about: drink, read (Phase Door), or leave by the stairs underfoot.
    const stairs = state.underFeature === 'down' || state.underFeature === 'up' ? leading : [];
    actions = [
      ...stairs,
      a('quaff', { ...(stairs.length ? {} : { emphasis: 'primary' as const }), alternates: ['eat', 'use'] }),
      a('read'),
      ...(adjacent > 0 && state.attackDir ? [a(`${ATTACK}${state.attackDir}`, { label: 'Attack' })] : []),
      pack,
      more,
    ];
  } else if (adjacent > 0 && state.attackDir) {
    // In melee: attack the adjacent monster (a move into it).
    actions = [
      ...leading,
      a(`${ATTACK}${state.attackDir}`, { label: 'Attack', emphasis: 'primary', alternates: ['hold'] }),
      ...cast,
      shoot,
      pack,
      more,
    ];
  } else if (inView > 0) {
    actions = [...leading, { ...shoot, emphasis: 'primary' as const }, ...cast, look, pack, more];
  } else {
    // Exploring: a door next to the player puts Open first.
    const rest =
      (state.doorsAdjacent ?? 0) > 0
        ? a('open', { label: 'Door', alternates: [...DOOR_ALTERNATES.filter((id) => id !== 'open'), 'rest'] })
        : a('rest', {
            ...(wounded && !lead ? { emphasis: 'primary' as const } : {}),
            alternates: ['hold', 'run', ...DOOR_ALTERNATES, 'downstairs', 'upstairs', 'pickup'],
          });
    actions = [...leading, run ?? rest, ...cast, pack, look, more];
  }
  // A latched Run stays visible whatever the situation.
  if (run && !actions.includes(run)) actions.splice(leading.length, 0, run);
  return { directionPad: PAD, actions, palette: PALETTE };
}

/** Item prompt's switches, from the prompt line. */
export interface ItemSwitches {
  equip: boolean;
  inven: boolean;
  quiver: boolean;
  floor: boolean;
}

/** The dock for each context. `choices` are lettered options shown on screen. */
export function controlsFor(
  context: AngbandContext,
  state: DockState,
  choices: { key: string; label: string }[] = [],
  item: ItemSwitches | null = null,
  saves: readonly { row: number; label: string }[] = [],
): TouchControlLayout {
  const choiceButtons = (limit = 8) =>
    choices
      .slice(0, limit)
      .map((choice) =>
        a(`${CHOOSE}${choice.key}`, { label: choice.label ? `${choice.key}) ${choice.label}` : choice.key }),
      );
  const prompt = state.prompt ?? '';
  switch (context) {
    case 'select':
      // Angband's savefile menu: each row as a button.
      return {
        directionPad: MENU_PAD,
        actions: [
          ...saves.slice(0, 6).map((save) =>
            a(`${SAVE_ROW}${save.row}`, {
              label: save.label === 'New game' ? 'New character' : `Continue ${save.label}`,
              wide: true,
              ...(save.label === 'New game' && saves.length === 1 ? { emphasis: 'primary' as const } : {}),
            }),
          ),
        ],
        palette: PALETTE,
      };
    case 'birth':
      // Character creation: the screen's choices, the arrows (stats: left and right), OK.
      return {
        directionPad: MENU_PAD,
        actions: [
          ...choiceButtons(),
          a('confirm', { label: 'OK', emphasis: 'primary' }),
          a('random', { label: 'Random' }),
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
      // Pages such as the scores leave with Escape, and page with any other key.
      if (/Press ESC to exit/.test(state.bottom ?? ''))
        return {
          actions: [a('cancel', { label: 'Done', emphasis: 'primary', wide: true }), a('page')],
          palette: PALETTE,
        };
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
      return { directionPad: DIRECTION_PAD, actions: [a('cancel', { label: 'Cancel' })], palette: PALETTE };
    case 'aim':
      // Fire, throw, cast at: the closest monster, or choose a target (tap the map works too).
      return {
        directionPad: DIRECTION_PAD,
        actions: [
          a('aim-closest', /'5' for target/.test(prompt) ? {} : { emphasis: 'primary' }),
          ...(/'5' for target/.test(prompt) ? [a('aim-target', { emphasis: 'primary' as const })] : []),
          a('choose-target'),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'targeting':
      // Look and target mode: the next thing, recall, target it, close.
      return {
        directionPad: DIRECTION_PAD,
        actions: [
          a('next-target', { emphasis: 'primary' }),
          a('select-target'),
          a('recall'),
          a('cancel', { label: 'Close' }),
        ],
        palette: PALETTE,
      };
    case 'item':
      // "Drop which item?": the items as buttons, the other lists, cancel.
      return {
        actions: [
          ...choiceButtons(),
          ...(item?.equip ? [a('show-equip')] : []),
          ...(item?.inven ? [a('show-inven')] : []),
          ...(item?.quiver ? [a('show-quiver')] : []),
          ...(item?.floor ? [a('floor-item')] : []),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'store':
      // A store or the home: the wares by letter (each opens its own menu), buy, sell, leave.
      return {
        directionPad: MENU_PAD,
        actions: [
          a('buy', { emphasis: 'primary' }),
          a('sell'),
          a('store-examine'),
          a('inventory', { alternates: ['equipment', 'quiver', 'wear', 'takeoff', 'examine'] }),
          a('cancel', { label: 'Leave' }),
          ...choiceButtons(6),
        ],
        palette: PALETTE,
      };
    case 'menu':
      return {
        directionPad: MENU_PAD,
        actions: [
          ...choiceButtons(),
          a('cancel', { label: 'Close' }),
          a('confirm', { label: 'Select', emphasis: 'primary' }),
          a('page', { label: 'Page' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'map':
      return mapControls(state);
  }
}

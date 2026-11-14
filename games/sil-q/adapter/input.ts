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
 * If the player turns on another keyset (the hjkl_movement or angband_keyset
 * option), the adapter sends map commands after Sil's own keymap bypass (`\`),
 * so each button still does what it says.
 * The touch dock leads with the most useful action for the situation (what is
 * underfoot, monsters in view or adjacent, low health) and fans out related
 * ones on a long press; "More" lists every command.
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
    // Destroy on the Iron Crown underfoot asks to prise out a Silmaril (cmd3.c do_cmd_destroy).
    id: 'prise',
    label: 'Prise a Silmaril from the Iron Crown',
    shortLabel: 'Prise',
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
  {
    // Aim prompts (get_aim_dir) take 'f' (or 't', '5', 'z') for the target or the closest monster.
    id: 'aim-nearest',
    label: 'Aim at the target or the closest monster',
    shortLabel: 'Nearest',
    shortcut: 'f',
    keys: k('f'),
    category: 'Keys',
  },
  {
    id: 'choose-target',
    label: 'Choose a target',
    shortLabel: 'Choose target',
    shortcut: '*',
    keys: k('*'),
    category: 'Keys',
  },
  {
    id: 'recall',
    label: 'Recall what you know of this monster',
    shortLabel: 'Recall',
    shortcut: 'r',
    keys: k('r'),
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

/**
 * Menus and character creation: Sil reads 8/2 to move between lines and 4/6
 * to lower or raise a value (stats, skills), so the pad works there too, with
 * Enter in the centre.
 */
export const MENU_PAD = { ...PAD, center: 'confirm' } as const;

export const PALETTE = SIL_COMMANDS.filter(
  (command) => !command.id.startsWith('move-') && command.category !== 'Keys' && command.id !== 'prise',
).map((command) => command.id);

/** Commands that are typed at Sil's command prompt (not answers to a prompt), which keysets remap. */
export function isMapCommand(command: SilCommand): boolean {
  return command.category !== 'Keys' && !command.id.startsWith('move-') && command.keys.length > 0;
}

/** Direction digits that move a cursor by (dx, dy) cells: diagonal steps first, then straight. */
export function stepsTo(dx: number, dy: number): number[] {
  const keys: number[] = [];
  const diagonal = Math.min(Math.abs(dx), Math.abs(dy));
  const digit = (sx: number, sy: number) => '789456123'.charCodeAt((sy + 1) * 3 + (sx + 1));
  for (let i = 0; i < diagonal; i++) keys.push(digit(Math.sign(dx), Math.sign(dy)));
  const restX = dx - diagonal * Math.sign(dx);
  const restY = dy - diagonal * Math.sign(dy);
  for (let i = 0; i < Math.abs(restX); i++) keys.push(digit(Math.sign(restX), 0));
  for (let i = 0; i < Math.abs(restY); i++) keys.push(digit(0, Math.sign(restY)));
  return keys;
}

/** Sil's keymap bypass (util.c request_command): the next key is the underlying command. */
export const KEYMAP_BYPASS = '\\'.charCodeAt(0);

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
  | 'aim'
  | 'song'
  | 'targeting'
  | 'item'
  | 'menu'
  | 'text'
  | 'screen'
  | 'busy';

const a = (command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction => ({ command, ...extra });

/** A lettered choice on screen, as a dock button (its key is sent). */
export const CHOOSE = 'choose:';
/**
 * Throw a flask of oil: `t` and the flask's letter (`oil:<letter>`); the aim
 * prompt follows. ("Throw at nearest" only takes items made for throwing,
 * which flasks are not.)
 */
export const OIL = 'oil:';
/** A saved character, as a dock button (its name is typed). */
export const LOAD = 'load:';

/**
 * What the docks need to know: the snapshot's read-only fields (port/main-web.c)
 * and the prompt line. Only hp, maxHp and run are required; the rest default to
 * "nothing special" (no monsters, nothing underfoot).
 */
export interface DockState {
  hp: number;
  maxHp: number;
  /** The Run modifier is latched (the next direction runs). */
  run: boolean;
  stealthMode?: boolean;
  /** Current song (SNG_* index; 100 or absent for none). */
  song1?: number;
  underFeature?: 'none' | 'down' | 'up' | 'forge';
  underObject?: 'none' | 'object' | 'crown';
  onTheRun?: boolean;
  newExp?: number;
  abilityCost?: number;
  monstersInView?: number;
  monstersAdjacent?: number;
  bow?: boolean;
  quiver1?: number;
  doorsAdjacent?: number;
  /** The throw prompt's letter for a flask of oil in the pack ('' or absent: none). */
  flask?: string;
  /** The prompt line (aim, look/target and song prompts word their options there). */
  prompt?: string;
}

/** Sil's song names by SNG_* index (lib/edit/ability.txt without "Song of "); the song prompt's letters are 'a' + index. */
export const SONG_NAMES: readonly string[] = [
  'Elbereth',
  'Challenge',
  'Delvings',
  'Freedom',
  'Silence',
  'Staunching',
  'Thresholds',
  'the Trees',
  'Slaying',
  'Staying',
  'Lorien',
  'Mastery',
];

/** Below this share of health the danger dock leads with healing. */
const LOW_HEALTH = 0.5;

const PACK_ALTERNATES = [
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
];
const LOOK_ALTERNATES = [
  'monsters',
  'objects',
  'map',
  'character',
  'abilities',
  'smithing',
  'knowledge',
  'messages',
];
const DOOR_ALTERNATES = ['open', 'close', 'bash', 'disarm', 'tunnel', 'alternate'];

/**
 * The context lead on the map: what is underfoot, the flight from Angband,
 * an ability the player can afford. Null when nothing stands out.
 */
export function mapLead(state: DockState): TouchAction | null {
  const under = state.underFeature ?? 'none';
  const primary = { emphasis: 'primary' as const };
  if (state.underObject === 'crown') return a('prise', { ...primary, alternates: ['pickup'] });
  if (state.onTheRun)
    // Escaping with a Silmaril: up is the way out.
    return a('upstairs', { ...(under === 'up' ? primary : {}), alternates: ['downstairs'] });
  if (under === 'down') return a('downstairs', { ...primary, alternates: ['upstairs'] });
  if (under === 'up') return a('upstairs', { ...primary, alternates: ['downstairs'] });
  if (state.underObject === 'object') return a('pickup', primary);
  if (under === 'forge') return a('smithing', { label: 'Smith', ...primary });
  const cost = state.abilityCost ?? -1;
  if (cost >= 0 && (state.newExp ?? 0) >= cost)
    return a('abilities', { label: 'Abilities', alternates: ['character'] });
  return null;
}

/** The map dock for the situation: exploring, monsters in view, adjacent, low health. */
function mapControls(state: DockState): TouchControlLayout {
  const lead = mapLead(state);
  const leading = lead ? [lead] : [];
  const inView = state.monstersInView ?? 0;
  const adjacent = state.monstersAdjacent ?? 0;
  const wounded = state.maxHp > 0 && state.hp < state.maxHp * LOW_HEALTH;
  const song = SONG_NAMES[state.song1 ?? -1];
  const sing = a('sing', { label: song ? `Sing: ${song}` : 'Sing', ...(song ? { active: true } : {}) });
  const stealth = a('stealth', {
    ...(state.stealthMode ? { active: true } : {}),
    alternates: ['sing', 'run'],
  });
  const canFire = !!state.bow && (state.quiver1 ?? 0) > 0;
  const throwing = a('throw', { alternates: ['throw-nearest', 'fire', 'fire-2'] });
  const shoot = canFire ? a('fire', { alternates: ['fire-2', 'throw', 'throw-nearest'] }) : throwing;
  const pack = a('inventory', { alternates: [...PACK_ALTERNATES, 'fire', 'throw'] });
  const look = a('look', { alternates: LOOK_ALTERNATES });
  const more = a(SHELL_COMMAND.palette, { label: 'More' });
  const run = state.run ? a('run', { label: 'Run ⇧', active: true }) : null;
  const oil = state.flask
    ? a(`${OIL}${state.flask}`, { label: 'Oil', alternates: ['throw', 'throw-nearest'] })
    : null;
  let actions: TouchAction[];
  if (wounded && inView > 0) {
    // Low health with enemies about: heal, or leave by the stairs underfoot.
    const stairs = state.underFeature === 'down' || state.underFeature === 'up' ? leading : [];
    actions = [
      ...stairs,
      a('quaff', { ...(stairs.length ? {} : { emphasis: 'primary' as const }), alternates: ['use'] }),
      a('eat', { label: 'Eat herb' }),
      sing,
      pack,
      look,
      more,
    ];
  } else if (adjacent > 0) {
    // In melee (attack by moving into the monster with the pad): hold, sing, throw, swap places.
    actions = [
      ...leading,
      a('hold', { alternates: ['rest'] }),
      sing,
      oil ?? throwing,
      a('exchange', { alternates: DOOR_ALTERNATES }),
      pack,
      more,
    ];
  } else if (inView > 0) {
    // A flask of oil takes Look's place (Look stays on a long press of the map).
    actions = oil
      ? [...leading, shoot, oil, sing, stealth, pack, more]
      : [...leading, shoot, sing, stealth, look, pack, more];
  } else {
    // Exploring: a door next to the player turns Rest into the door's alternate action.
    const rest =
      (state.doorsAdjacent ?? 0) > 0
        ? a('alternate', {
            label: 'Door',
            alternates: [...DOOR_ALTERNATES.filter((id) => id !== 'alternate'), 'rest', 'hold', 'run'],
          })
        : a('rest', {
            ...(wounded && !lead ? { emphasis: 'primary' as const } : {}),
            alternates: ['hold', 'run', 'exchange', ...DOOR_ALTERNATES, 'downstairs', 'upstairs', 'pickup'],
          });
    actions = [...leading, stealth, run ?? rest, pack, look, more];
  }
  // A latched Run stays visible whatever the situation.
  if (run && !actions.includes(run)) actions.splice(leading.length, 0, run);
  return { directionPad: PAD, actions, palette: PALETTE };
}

/** The dock for each context. `choices` are lettered options shown on screen. */
export function controlsFor(
  context: SilContext,
  state: DockState,
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
  const prompt = state.prompt ?? '';
  switch (context) {
    case 'title':
      // Title and character creation: the screen's choices as large buttons;
      // on the main menu, saved characters can be continued directly.
      return {
        directionPad: MENU_PAD,
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
      // Open, close, bash, tunnel, disarm (get_rep_dir): a direction, nothing else.
      return { directionPad: PAD, actions: [a('cancel', { label: 'Cancel' })], palette: PALETTE };
    case 'aim': {
      // Fire, throw, songs, staffs (get_aim_dir): the target or the closest monster, or choose one.
      const targeted = /'f' for target/.test(prompt);
      return {
        directionPad: PAD,
        actions: [
          a('aim-nearest', { label: targeted ? 'Target' : 'Nearest', emphasis: 'primary' }),
          a('choose-target', { label: targeted ? 'Re-target' : 'Choose target' }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    }
    case 'song':
      // "Sing which song": the songs by name (the one being sung marked), stop, exchange themes.
      return {
        actions: [
          ...choices.map((choice) => {
            const index = choice.key.charCodeAt(0) - 'a'.charCodeAt(0);
            const current = /^[a-l]$/.test(choice.key) && index === state.song1;
            return a(`${CHOOSE}${choice.key}`, { label: choice.label, ...(current ? { active: true } : {}) });
          }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    case 'targeting': {
      // Look/target mode; its prompt lists what it takes: "[(r)ecall, (t)arget, (m)anual, <dir>]".
      const more = /-more-/.test(prompt);
      return {
        directionPad: PAD,
        actions: [
          ...(/\(t\)arget/.test(prompt) ? [a('select-target', { emphasis: 'primary' as const })] : []),
          ...(more || /\(m\)anual/.test(prompt) ? [a('next-target', { label: more ? 'More' : 'Next' })] : []),
          ...(/\(r\)ecall/.test(prompt) ? [a('recall')] : []),
          a('cancel', { label: 'Cancel' }),
        ],
        palette: PALETTE,
      };
    }
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
        directionPad: MENU_PAD,
        actions: [
          ...choiceButtons,
          a('cancel', { label: 'Close' }),
          a('confirm', { label: 'Select', emphasis: 'primary' }),
          a('list', { label: 'Choices' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette: PALETTE,
      };
    case 'map':
      return mapControls(state);
  }
}

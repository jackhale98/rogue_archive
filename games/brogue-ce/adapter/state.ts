// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Game state and input context for context-aware controls.
 *
 * The platform layer sends a read-only snapshot of a few game values with
 * every frame (field order mirrors the ST_* enum in port/rogue-archive-
 * platform.c). Combined with what is on screen, it tells us what Brogue is
 * waiting for, so touch controls can offer the right actions. Nothing here
 * changes the game: every control still sends Brogue's original keys.
 */
import { SHELL_COMMAND, type TouchAction, type TouchControlLayout } from '@rogue-archive/game-api';
import { CELL_BYTES, COLS, MAP_ORIGIN_X } from './constants.ts';
import { findItemDetails, findTextOverlay } from './camera.ts';
import { PLAYBACK_PALETTE } from './input.ts';

export interface BrogueState {
  hp: number;
  maxHp: number;
  nutrition: number;
  strength: number;
  depth: number;
  deepest: number;
  gold: number;
  cursor: { x: number; y: number } | null;
  cursorMode: boolean;
  textInput: boolean;
  colorsDance: boolean;
  playback: boolean;
  waiting: boolean;
  /** Down/up stairs on this level (map coordinates), when known to the game. */
  down: { x: number; y: number } | null;
  up: { x: number; y: number } | null;
  /** An enemy `x` would attack (upstream adjacentFightingDir()). Only read at a command prompt. */
  enemyAdjacent: boolean;
  /** Hostile monsters in view. Only read at a command prompt. */
  enemiesVisible: number;
  /** `T` would throw the last thrown item again (it is still carried). */
  canRethrow: boolean;
  /** `Z` rests until better (hurt or affected), rather than 100 turns. */
  needsRest: boolean;
  /** Turns of the current search, 0 to 4 (the fifth is the stronger search). */
  searching: number;
  /** Inventory letter of the first food carried. */
  foodLetter: string | null;
  playbackPaused: boolean;
  omniscience: boolean;
}

export function parseState(raw: Int32Array): BrogueState {
  const at = (i: number) => raw[i] ?? 0;
  const cursorX = at(7);
  const cursorY = at(8);
  const food = at(23);
  // Stairs are only reported in game; (0, 0) is a wall corner, never stairs.
  const stairs = (x: number, y: number) => (x > 0 || y > 0 ? { x, y } : null);
  return {
    hp: at(0),
    maxHp: at(1),
    nutrition: at(2),
    strength: at(3),
    depth: at(4),
    deepest: at(5),
    gold: at(6),
    cursor: cursorX >= 0 && cursorY >= 0 ? { x: cursorX, y: cursorY } : null,
    cursorMode: at(9) !== 0,
    textInput: at(14) !== 0,
    colorsDance: at(15) !== 0,
    playback: at(16) !== 0,
    waiting: at(17) !== 0,
    up: stairs(at(10), at(11)),
    down: stairs(at(12), at(13)),
    enemyAdjacent: at(18) !== 0,
    enemiesVisible: at(19),
    canRethrow: at(20) !== 0,
    needsRest: at(21) !== 0,
    searching: at(22),
    foodLetter: food >= 97 && food <= 122 ? String.fromCharCode(food) : null,
    playbackPaused: at(24) !== 0,
    omniscience: at(25) !== 0,
  };
}

/** Upstream Rogue.h: STOMACH_SIZE 2150, HUNGER_THRESHOLD 350, WEAK 150, FAINT 50. */
export function hungerLabel(nutrition: number): string | null {
  if (nutrition <= 0) return 'Starving';
  if (nutrition < 50) return 'Faint';
  if (nutrition < 150) return 'Weak';
  if (nutrition < 350) return 'Hungry';
  return null;
}

export type BrogueContext =
  'title' | 'busy' | 'more' | 'yesno' | 'menu' | 'item' | 'targeting' | 'map' | 'playback';

function screenRows(cells: Uint8Array, from: number, to: number): string {
  let text = '';
  for (let y = from; y < to; y++) {
    for (let x = 0; x < COLS; x++) {
      const offset = (y * COLS + x) * CELL_BYTES;
      const sprite = cells[offset]! | (cells[offset + 1]! << 8);
      text += sprite >= 32 && sprite < 127 ? String.fromCharCode(sprite) : ' ';
    }
    text += '\n';
  }
  return text;
}

function hasMore(cells: Uint8Array): boolean {
  return screenRows(cells, 0, 34).includes('--MORE--');
}

/** What the screen's text says that the state snapshot can't: the pending prompt, exploration done. */
export interface ScreenHints {
  /** The targeting prompt: throwing, zapping a staff or wand, or looking (keyboard cursor). */
  aim?: 'throw' | 'zap' | 'look';
  /** The newest message says the level has nothing left to explore. */
  explored?: boolean;
}

/** Reads hints from Brogue's message lines (rows 0-2; the newest message is the lowest). */
export function readHints(cells: Uint8Array): ScreenHints {
  // Messages start right of the sidebar (upstream mapToWindowX(0)).
  const lines = screenRows(cells, 0, 3)
    .split('\n')
    .map((line) => line.slice(MAP_ORIGIN_X));
  const messages = lines.join('\n');
  const newest = lines.findLast((line) => line.trim() !== '') ?? '';
  const hints: ScreenHints = {};
  // Items.c throwCommand: "Throw <item> where?"; useStaffOrWand: "Zapping your <item>:".
  if (/\bThrow\b.* where\?/.test(messages)) hints.aim = 'throw';
  else if (/\bZapping your\b/.test(messages)) hints.aim = 'zap';
  else if (!messages.includes('<tab>') || /Examine what\?/.test(messages)) hints.aim = 'look';
  if (newest.includes('I see no path for further exploration')) hints.explored = true;
  return hints;
}

/**
 * What Brogue is waiting for. `waiting` false means the engine is busy
 * (animating, auto-exploring, travelling); callers debounce that so brief
 * animations don't flicker the controls.
 */
export function detectContext(inGame: boolean, state: BrogueState, cells: Uint8Array): BrogueContext {
  if (!inGame) return 'title';
  // A recording plays back: its own controls, whether running (busy) or paused.
  if (state.playback && (!state.waiting || (!state.textInput && !hasMore(cells)))) return 'playback';
  if (!state.waiting) return 'busy';
  if (hasMore(cells)) return 'more';
  if (state.textInput) {
    const overlay = findTextOverlay(cells);
    if (overlay) {
      const box = screenRows(cells, overlay.y, overlay.y + overlay.height);
      if (/\bYes\b/.test(box) && /\bNo\b/.test(box)) return 'yesno';
    }
    // An item chosen in the inventory: its details panel with action buttons.
    if (findItemDetails(cells)) return 'item';
    return 'menu';
  }
  const messages = screenRows(cells, 0, 3);
  if (messages.includes('<tab>') || state.cursorMode) return 'targeting';
  return 'map';
}

const PAD = {
  nw: 'move-nw',
  n: 'move-n',
  ne: 'move-ne',
  w: 'move-w',
  center: 'rest',
  e: 'move-e',
  sw: 'move-sw',
  s: 'move-s',
  se: 'move-se',
} as const;

function a(command: string, extra: Omit<TouchAction, 'command'> = {}): TouchAction {
  return { command, ...extra };
}

/** The action an item's details most likely lead to: use it, else wear it, else take it off. */
function primaryItemAction(ids: string[]): string | undefined {
  return ['apply', 'equip', 'unequip', 'throw', 'drop'].find((id) => ids.includes(id));
}

/**
 * The details panel's actions for the dock: the main ones as buttons (the
 * likely one emphasized), naming items (Relabel, Call) as long-press options
 * on the last of them, to keep the dock short.
 */
function itemDock(ids: string[]): TouchAction[] {
  const naming: string[] = ids.filter((id) => id === 'relabel' || id === 'call');
  const main = ids.filter((id) => !naming.includes(id));
  const primary = primaryItemAction(main);
  return main.map((id, index) =>
    a(id, {
      ...(id === primary ? { emphasis: 'primary' as const } : {}),
      ...(index === main.length - 1 && naming.length ? { alternates: naming } : {}),
    }),
  );
}

const PACK_OPTIONS = ['apply', 'throw', 'equip', 'unequip', 'drop', 'swap'];

const same = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y;

/** The dock on the map: quiet (exploring) or in danger (an enemy in view or adjacent). */
function mapDock(state: BrogueState, shift: boolean, hints: ScreenHints): TouchAction[] {
  const danger = state.enemyAdjacent || state.enemiesVisible > 0;
  const hungry = hungerLabel(state.nutrition) !== null && state.foodLetter !== null;
  const wounded = state.maxHp > 0 && state.hp < state.maxHp * 0.5;
  // `>` shows the route to the stairs (the cursor moves onto them); a second `>` goes.
  const route = same(state.cursor, state.down) ? 'descend' : same(state.cursor, state.up) ? 'ascend' : null;
  const restLong = state.needsRest ? 'auto-rest' : 'rest-100';
  // One button leads, in order of urgency: the stairs route shown, then hunger,
  // then fighting or throwing in danger, or (quiet) resting when badly hurt or
  // the stairs once the level is explored.
  const lead = route
    ? 'route'
    : hungry
      ? 'eat'
      : danger
        ? state.enemyAdjacent
          ? 'fight'
          : state.canRethrow
            ? 'rethrow'
            : null
        : wounded
          ? 'rest'
          : hints.explored
            ? 'stairs'
            : null;
  const primary = (is: boolean) => (is ? { emphasis: 'primary' as const } : {});
  const actions: TouchAction[] = [];

  if (route) {
    actions.push(
      a(route, {
        label: route === 'descend' ? 'Go ↓' : 'Go ↑',
        emphasis: 'primary',
        alternates: ['explore', route === 'descend' ? 'ascend' : 'descend', 'shift'],
      }),
    );
  }
  if (hungry) actions.push(a('eat', primary(lead === 'eat')));

  // Shift + a move runs until something interesting happens; while latched, show it.
  const run = a('shift', { label: 'Run ⇧', active: shift });
  if (danger) {
    // `x` fights an adjacent enemy (and explores otherwise). Resting and searching
    // stay reachable on a long-press, never as the main button.
    actions.push(
      shift
        ? run
        : a('explore', {
            label: state.enemyAdjacent ? 'Fight' : 'Explore',
            ...primary(lead === 'fight'),
            alternates: ['search', 'rest', 'shift'],
          }),
    );
    // Throwing in one tap: the same item again (at the nearest target), or choose one.
    actions.push(
      state.canRethrow ? a('rethrow', { ...primary(lead === 'rethrow'), alternates: ['throw'] }) : a('throw'),
    );
  } else {
    if (shift) actions.push(run);
    else if (lead === 'stairs')
      actions.push(a('descend', { emphasis: 'primary', alternates: ['explore', 'ascend', 'shift'] }));
    else if (!route) actions.push(a('explore', { alternates: ['descend', 'ascend', 'shift'] }));
    actions.push(
      lead === 'rest'
        ? a(restLong, { label: 'Rest', emphasis: 'primary', alternates: ['search', 'long-search', 'rest'] })
        : a('search', {
            ...(state.searching > 0 ? { label: `Search ${state.searching}/5` } : {}),
            alternates: ['long-search', 'rest', restLong],
          }),
    );
  }
  actions.push(
    a('inventory', {
      label: 'Pack',
      alternates: state.foodLetter && !hungry ? [...PACK_OPTIONS, 'eat'] : PACK_OPTIONS,
    }),
  );
  actions.push(a('look'));
  actions.push(a(SHELL_COMMAND.palette, { label: 'More' }));
  return actions;
}

/** Watching a recording: Brogue's playback keys (Recordings.c executePlaybackInput). */
function playbackDock(state: BrogueState): TouchAction[] {
  return [
    a('playback-pause', { label: state.playbackPaused ? 'Play' : 'Pause', emphasis: 'primary' }),
    a('playback-slower'),
    a('playback-faster'),
    a('playback-next-turn', {
      alternates: ['playback-previous-turn', 'playback-next-level', 'playback-previous-level'],
    }),
    a('playback-omniscience', { active: state.omniscience }),
    a(SHELL_COMMAND.palette, { label: 'More' }),
  ];
}

/** The targeting dock's confirm button, named for what confirming does. */
const AIM_LABEL = { throw: 'Throw', zap: 'Zap', look: 'Go' } as const;

/** Touch controls for each context. Long-press alternates fan out from their button. */
export function controlsFor(
  context: BrogueContext,
  state: BrogueState,
  palette: string[],
  shift = false,
  /** For 'item': the details panel's actions (camera.ts itemActions). */
  itemActionIds: string[] = [],
  /** From the screen's text (readHints). */
  hints: ScreenHints = {},
): TouchControlLayout {
  // A latching Shift: tap it, then the next action is sent with Shift held.
  const shiftAction = (label: string) => a('shift', { label, active: shift });
  switch (context) {
    case 'title':
      // Phones show the title menu as large buttons (title.ts); other title
      // screens (high scores, the seed prompt) get Back, OK and typing.
      return {
        actions: [
          a('cancel', { label: 'Back' }),
          a('confirm', { label: 'OK' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette,
      };
    case 'busy':
      return { actions: [a('cancel', { label: 'Stop', emphasis: 'primary' })], palette };
    case 'more':
      return { actions: [a('acknowledge', { label: 'Continue', emphasis: 'primary', wide: true })], palette };
    case 'yesno':
      return {
        actions: [a('confirm', { label: 'Yes', emphasis: 'primary' }), a('cancel', { label: 'No' })],
        palette,
      };
    case 'menu':
      return {
        actions: [
          a('cancel', { label: 'Back' }),
          // In item menus, Shift + choosing an item shows its details instead of using it.
          shiftAction('Shift ⓘ'),
          a('confirm', { label: 'OK' }),
          a(SHELL_COMMAND.keyboard, { label: 'Type' }),
        ],
        palette,
      };
    case 'item':
      // The panel's own buttons, plus stepping through the inventory and Back.
      return {
        actions: [
          ...itemDock(itemActionIds),
          a('previous-item', { alternates: ['next-item'] }),
          a('next-item'),
          a('cancel', { label: 'Back' }),
        ],
        palette,
      };
    case 'targeting':
      return {
        directionPad: PAD,
        actions: [
          a('confirm', { label: hints.aim ? AIM_LABEL[hints.aim] : 'Confirm', emphasis: 'primary' }),
          a('next-target', { label: 'Next', alternates: ['shift'] }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette,
      };
    case 'map':
      return { directionPad: PAD, actions: mapDock(state, shift, hints), palette };
    case 'playback':
      return { actions: playbackDock(state), palette: PLAYBACK_PALETTE };
  }
}

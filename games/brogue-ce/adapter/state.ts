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
import { CELL_BYTES, COLS } from './constants.ts';
import { findTextOverlay } from './camera.ts';

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
}

export function parseState(raw: Int32Array): BrogueState {
  const at = (i: number) => raw[i] ?? 0;
  const cursorX = at(7);
  const cursorY = at(8);
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

export type BrogueContext = 'title' | 'busy' | 'more' | 'yesno' | 'menu' | 'targeting' | 'map';

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

/**
 * What Brogue is waiting for. `waiting` false means the engine is busy
 * (animating, auto-exploring, travelling); callers debounce that so brief
 * animations don't flicker the controls.
 */
export function detectContext(inGame: boolean, state: BrogueState, cells: Uint8Array): BrogueContext {
  if (!inGame) return 'title';
  if (!state.waiting) return 'busy';
  const screen = screenRows(cells, 0, 34);
  if (screen.includes('--MORE--')) return 'more';
  if (state.textInput) {
    const overlay = findTextOverlay(cells);
    if (overlay) {
      const box = screenRows(cells, overlay.y, overlay.y + overlay.height);
      if (/\bYes\b/.test(box) && /\bNo\b/.test(box)) return 'yesno';
    }
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

/** Touch controls for each context. Long-press alternates fan out from their button. */
export function controlsFor(
  context: BrogueContext,
  state: BrogueState,
  palette: string[],
  shift = false,
): TouchControlLayout {
  // A latching Shift: tap it, then the next action is sent with Shift held.
  const shiftAction = (label: string) => a('shift', { label, active: shift });
  switch (context) {
    case 'title':
      return { actions: [], palette };
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
    case 'targeting':
      return {
        directionPad: PAD,
        actions: [
          a('confirm', { label: 'Confirm', emphasis: 'primary' }),
          a('next-target', { label: 'Next', alternates: ['shift'] }),
          a('cancel', { label: 'Cancel' }),
        ],
        palette,
      };
    case 'map': {
      // When badly hurt, resting until healed is the likely next move: lead with it.
      const wounded = state.maxHp > 0 && state.hp < state.maxHp * 0.5;
      const rest = wounded
        ? a('auto-rest', { label: 'Rest', emphasis: 'primary', alternates: ['search', 'rest'] })
        : a('search', { alternates: ['rest', 'auto-rest'] });
      return {
        directionPad: PAD,
        actions: [
          // Shift + a move runs until something interesting happens; while latched, show it.
          shift ? shiftAction('Run ⇧') : a('explore', { alternates: ['descend', 'ascend', 'shift'] }),
          rest,
          a('inventory', { label: 'Pack', alternates: ['apply', 'equip', 'throw', 'unequip', 'drop'] }),
          a(SHELL_COMMAND.palette, { label: 'More' }),
        ],
        palette,
      };
    }
  }
}

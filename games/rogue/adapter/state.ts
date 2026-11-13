// SPDX-License-Identifier: BSD-3-Clause
/**
 * Rogue's state for the shell: the read-only snapshot port/curses-web.c sends
 * with each frame, and what the game is waiting for (from that snapshot and
 * the prompts Rogue prints).
 */
import { findText, rowText, type Grid, type Rect } from '@rogue-archive/term-view';
import type { RogueContext } from './input.ts';

/** Screen layout (rogue.h NUMLINES x NUMCOLS): message line, map, status line. */
export const MESSAGE_ROW = 0;
export const STATUS_ROW = 23;

export interface RogueState {
  inGame: boolean;
  hp: number;
  maxHp: number;
  /** Dungeon level. */
  level: number;
  heroX: number;
  heroY: number;
  gold: number;
  waiting: boolean;
  /** A window other than the main screen is in front: a list, help, or a detection overlay. */
  overlay: boolean;
}

/** Mirrors the ST_* order in port/curses-web.c. */
export function parseState(raw: Int32Array): RogueState {
  return {
    inGame: raw[0] === 1,
    hp: raw[1] ?? 0,
    maxHp: raw[2] ?? 0,
    level: raw[3] ?? 0,
    heroX: raw[4] ?? 0,
    heroY: raw[5] ?? 0,
    gold: raw[6] ?? 0,
    waiting: raw[7] === 1,
    overlay: raw[8] === 1,
  };
}

/** The map area of the screen (between the message and status lines). */
export function mapRect(grid: Grid): Rect {
  return { x: 0, y: MESSAGE_ROW + 1, width: grid.cols, height: grid.rows - 2 };
}

/** The hero's screen cell (Rogue's map coordinates are screen coordinates). */
export function heroCell(state: RogueState): { x: number; y: number } | null {
  return state.inGame ? { x: state.heroX, y: state.heroY } : null;
}

/**
 * Text drawn over the map (the inventory, discoveries, a help page), if any,
 * with its "a) " labels.
 */
export function mapOverlay(grid: Grid): Rect | null {
  const text = findText(grid, mapRect(grid), 3);
  if (!text) return null;
  // Lists label each line "a) " before the text proper.
  const x = Math.max(0, text.x - 3);
  return { x, y: text.y, width: text.x + text.width - x, height: text.height };
}

/**
 * A lettered list on screen (the inventory, "which object" lists): the box
 * from the first to the last "a) ..." line, labels included. Rogue draws them
 * from the top line down, over the map or on a cleared screen.
 */
export function listBox(grid: Grid): Rect | null {
  let top = -1;
  let bottom = -1;
  let left = grid.cols;
  let right = 0;
  for (let y = 0; y < grid.rows; y++) {
    const line = rowText(grid, y);
    const label = /(?:^|\s)([a-z])\) \S/.exec(line);
    if (!label) continue;
    const x = label.index + (label[0].startsWith(label[1]!) ? 0 : 1);
    if (top < 0) top = y;
    bottom = y;
    left = Math.min(left, x);
    right = Math.max(right, line.trimEnd().length);
  }
  if (top < 0) return null;
  return { x: left, y: top, width: right - left, height: bottom - top + 1 };
}

export interface Choice {
  key: string;
  label: string;
}

/** Lettered choices on screen ("a) some food", ...), in reading order. */
export function screenChoices(grid: Grid, region?: Rect): Choice[] {
  const choices: Choice[] = [];
  const seen = new Set<string>();
  const from = region?.y ?? 0;
  const to = region ? region.y + region.height : grid.rows;
  for (let y = from; y < to; y++) {
    const line = rowText(grid, y, region?.x ?? 0, region ? region.x + region.width : grid.cols);
    for (const match of line.matchAll(/(?:^|\s)([a-z])\) ([^ ].*?)(?=\s{2,}|$)/g)) {
      const key = match[1]!;
      const label = match[2]!.trim();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      choices.push({ key, label });
    }
  }
  return choices;
}

const anyRow = (grid: Grid, pattern: RegExp) => {
  for (let y = 0; y < grid.rows; y++) if (pattern.test(rowText(grid, y))) return true;
  return false;
};

export function detectContext(grid: Grid, state: RogueState): RogueContext {
  if (!state.waiting) return 'busy';
  const top = rowText(grid, MESSAGE_ROW).trimEnd();
  // The tombstone and the scores end with "[Press return to continue]".
  if (anyRow(grid, /\[Press return to continue\]/)) return 'enter';
  if (/--More--/.test(top) || anyRow(grid, /--Press space to continue--/)) {
    // A list, help, Discoveries or a detection overlay (another window in
    // front) is read, then closed: a sheet. Only the message line's
    // --More-- is a plain acknowledgement.
    return listBox(grid) || state.overlay ? 'menu' : 'more';
  }
  // Prompts wait with the cursor after the question on the message line. A
  // question can stay on screen after it is answered or cancelled (get_dir
  // returns on Escape without clearing it); at the command prompt Rogue puts
  // the cursor on the hero.
  const prompting = grid.cursor?.y === MESSAGE_ROW;
  if (prompting) {
    if (/which direction\?/i.test(top)) return 'direction';
    if (/\(\* for list\):?$/.test(top)) return 'item';
    if (/really quit\?|save file \(.*\)\?|Do you wish to overwrite it\?|\? *\(y\/n\)|\[y\/n\]/i.test(top))
      return 'yesno';
    // Typing a name ("file name:", "what do you want to call it?", options).
    if (grid.cursor?.visible && /[:?] ?\S*$/.test(top)) return 'text';
  }
  if (state.inGame) return 'map';
  return 'busy';
}

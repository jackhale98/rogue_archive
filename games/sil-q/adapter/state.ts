// SPDX-License-Identifier: GPL-2.0-only
/**
 * Sil-Q's state for the shell: the read-only snapshot port/main-web.c sends
 * with each frame, and what the game is waiting for (from that snapshot and
 * the prompts Sil prints on the top line).
 */
import { findText, rowText, type Grid, type Rect } from '@rogue-archive/term-view';
import type { SilContext } from './input.ts';

/** Screen layout (defines.h): message line, sidebar, map, status line. */
export const ROW_MAP = 1;
export const COL_MAP = 13;

export interface SilState {
  inDungeon: boolean;
  hp: number;
  maxHp: number;
  voice: number;
  maxVoice: number;
  /** Depth in levels (each level is 50 feet). */
  depth: number;
  playerX: number;
  playerY: number;
  panelX: number;
  panelY: number;
  messageCount: number;
  waiting: boolean;
}

/** Mirrors the ST_* order in port/main-web.c. */
export function parseState(raw: Int32Array): SilState {
  return {
    inDungeon: raw[0] === 1,
    hp: raw[1] ?? 0,
    maxHp: raw[2] ?? 0,
    voice: raw[3] ?? 0,
    maxVoice: raw[4] ?? 0,
    depth: raw[5] ?? 0,
    playerX: raw[6] ?? 0,
    playerY: raw[7] ?? 0,
    panelX: raw[8] ?? 0,
    panelY: raw[9] ?? 0,
    messageCount: raw[10] ?? 0,
    waiting: raw[11] === 1,
  };
}

/** The map area of the screen. */
export function mapRect(grid: Grid): Rect {
  return { x: COL_MAP, y: ROW_MAP, width: grid.cols - COL_MAP, height: grid.rows - ROW_MAP - 1 };
}

/** The player's screen cell, if on the map. */
export function playerCell(state: SilState): { x: number; y: number } | null {
  if (!state.inDungeon) return null;
  return { x: state.playerX - state.panelX + COL_MAP, y: state.playerY - state.panelY + ROW_MAP };
}

/** Text drawn over the map (a menu, list or description), if any, with its "a) " labels. */
export function mapOverlay(grid: Grid): Rect | null {
  const text = findText(grid, mapRect(grid), 2);
  if (!text) return null;
  // Lists label each line "a) " before the text proper.
  // ("a) 3 Fragments": the word found is "Fragments", six columns after "a").
  const x = Math.max(COL_MAP, text.x - 6);
  return { x, y: text.y, width: text.x + text.width - x, height: text.height };
}

export interface Choice {
  key: string;
  label: string;
}

/** Lettered choices on screen ("a) Tutorial", "b) New character"...), in reading order. */
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

/** An item prompt on the top line, e.g. "(Inven: a-b, * to see, / for Equip, ESC) Drop which item?" */
export interface ItemPrompt {
  /** The letters that can be chosen now. */
  letters: string[];
  /** The list is not shown yet ('*' shows it). */
  canShow: boolean;
  /** The other item set '/' switches to, if offered ("Equip" or "Inven"). */
  switchTo: string | null;
  /** '-' picks the item on the floor. */
  floor: boolean;
}

export function itemPrompt(top: string): ItemPrompt | null {
  const match = /^\((Inven|Equip|Floor):([^)]*)\)/.exec(top.trimStart());
  if (!match) return null;
  const options = match[2]!;
  const letters: string[] = [];
  const range = /\b([a-z])-([a-z])\b/.exec(options);
  if (range) {
    for (let c = range[1]!.charCodeAt(0); c <= range[2]!.charCodeAt(0); c++)
      letters.push(String.fromCharCode(c));
  }
  return {
    letters,
    canShow: /\* to see/.test(options),
    switchTo: /\/ for (Equip|Inven)/.exec(options)?.[1] ?? null,
    floor: /- for floor/.test(options),
  };
}

/** The title menu asking for the name of the saved character to open. */
export function isLoadPrompt(grid: Grid): boolean {
  const cursor = grid.cursor;
  return !!cursor?.visible && /Open saved character/.test(rowText(grid, cursor.y, 0, cursor.x));
}

/** The look/target prompt: "You see an Orc [(t)arget, (m)anual, <dir>]". */
const TARGETING = /\[[^\]]*(<dir>|\(t\)arget|\(m\)anual|ESC)[^\]]*\]\s*$/;

export function detectContext(grid: Grid, state: SilState): SilContext {
  if (!state.waiting) return 'busy';
  const top = rowText(grid, 0);
  if (/-more-/.test(top)) return 'more';
  if (/\[y\/n\]/i.test(top)) return 'yesno';
  if (/^\s*Direction\b/.test(top)) return 'direction';
  if (TARGETING.test(top.trimEnd())) return 'targeting';
  if (itemPrompt(top)) return 'item';
  if (!state.inDungeon) return isLoadPrompt(grid) ? 'load' : 'title';
  // A text field (inscriptions, notes, quantities): the cursor waits on the prompt line.
  if (grid.cursor?.visible && grid.cursor.y === 0 && top.trim().length > 0) return 'text';
  if (mapOverlay(grid)) return 'menu';
  return 'map';
}

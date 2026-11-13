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

export function detectContext(grid: Grid, state: SilState): SilContext {
  if (!state.waiting) return 'busy';
  const top = rowText(grid, 0);
  if (/-more-/.test(top)) return 'more';
  if (/\[y\/n\]|\(y\/n\)/i.test(top)) return 'yesno';
  if (/Direction|direction\?/.test(top)) return 'direction';
  if (/\bESC\b.*\b(t|target)\b|\btarget\b.*\[/i.test(top)) return 'targeting';
  if (!state.inDungeon) return 'title';
  if (grid.cursor?.visible && /:\s*$/.test(top.trimEnd() + ' ') === false && /: /.test(top)) return 'text';
  if (mapOverlay(grid)) return 'menu';
  return 'map';
}

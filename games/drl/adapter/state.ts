// SPDX-License-Identifier: GPL-2.0-only
/**
 * What DRL's console shows, read from its own screen: the 80x25 layout of
 * its console mode (drlio.pas, drlhudviews.pas): messages on rows 0-1, the
 * map on rows 2-21 (row 2 also carries its right-aligned hints and prompts),
 * the HUD on rows 22-24; menus and screens are boxes drawn with the curses
 * line characters. The adapter reads, never writes: what the player sees is
 * what DRL drew.
 */
import { rowText, type Grid, type Rect } from '@rogue-archive/term-view';
import type { DrlContext } from './input.ts';

export const COLS = 80;
export const ROWS = 25;
export const MESSAGE_ROWS = [0, 1] as const;
export const PROMPT_ROW = 2;
export const MAP_TOP = 2;
export const MAP_BOTTOM = 21;
export const HUD_TOP = 22;

/** A cell's character code for the curses alternate character set: 128 + its letter (adapter/worker.ts). */
export const ACS = (letter: string) => 0x80 | letter.charCodeAt(0);

const ACS_GLYPHS: Record<string, string> = {
  j: '┘',
  k: '┐',
  l: '┌',
  m: '└',
  n: '┼',
  q: '─',
  t: '├',
  u: '┤',
  v: '┴',
  w: '┬',
  x: '│',
  a: '▒',
  '~': '·',
  f: '°',
  g: '±',
  '0': '█',
  '`': '◆',
};

/** The text drawn for a cell's character code (the console's code page: ASCII, and the line characters). */
export function glyph(code: number): string {
  if (code >= 0x80) return ACS_GLYPHS[String.fromCharCode(code & 0x7f)] ?? '?';
  return String.fromCharCode(code);
}

/** A row as text, with the line characters as they look. */
export function screenRow(grid: Grid, y: number): string {
  let text = '';
  for (let x = 0; x < grid.cols; x++) {
    const code = grid.cells[(y * grid.cols + x) * 2]!;
    text += code === 0 ? ' ' : glyph(code);
  }
  return text;
}

export function screenText(grid: Grid): string {
  return Array.from({ length: grid.rows }, (_, y) => screenRow(grid, y).trimEnd()).join('\n');
}

export interface DrlHud {
  name: string;
  armor: string;
  /** Health in percent (DRL shows a percentage, or current/maximum). */
  health: number;
  healthText: string;
  exp: string;
  weapon: string;
  level: string;
}

/** DRL's HUD (rows 22-24, drawn by TDRLIO.DrawHud), or null when it is not on screen. */
export function parseHud(grid: Grid): DrlHud | null {
  if (grid.rows < ROWS) return null;
  const top = rowText(grid, HUD_TOP);
  const middle = rowText(grid, HUD_TOP + 1);
  const bottom = rowText(grid, HUD_TOP + 2);
  const health = /^\s*Health:\s*(\d+)(?:%|\s*\/\s*(\d+))/.exec(middle);
  if (!health || !/\bA:/.test(top)) return null;
  const current = Number(health[1]);
  const max = health[2] ? Number(health[2]) : 0;
  const percent = max > 0 ? Math.round((current * 100) / max) : current;
  const armor = /A:\s*(.*)$/.exec(top)?.[1]?.trim() ?? '';
  return {
    name: top.slice(0, top.indexOf('A:')).trim(),
    armor,
    health: percent,
    healthText: max > 0 ? `${current}/${max}` : `${current}%`,
    exp: /Exp:\s*([\d/%\s]+?)\s{2,}/.exec(`${middle}  `)?.[1]?.replace(/\s+/g, '') ?? '',
    weapon: /W:\s*(.*)$/.exec(middle)?.[1]?.trim() ?? '',
    level: bottom.trim(),
  };
}

/** Rows whose text has a run of at least `min` horizontal line characters. */
function lineRows(grid: Grid, min = 8): { y: number; from: number; to: number }[] {
  const q = ACS('q');
  const rows: { y: number; from: number; to: number }[] = [];
  for (let y = 0; y < grid.rows; y++) {
    let run = 0;
    let best = { from: 0, to: -1 };
    let start = 0;
    for (let x = 0; x <= grid.cols; x++) {
      const code = x < grid.cols ? grid.cells[(y * grid.cols + x) * 2]! : 0;
      if (code === q) {
        if (run === 0) start = x;
        run++;
      } else {
        if (run > best.to - best.from + 1) best = { from: start, to: x - 1 };
        run = 0;
      }
    }
    if (best.to - best.from + 1 >= min) rows.push({ y, ...best });
  }
  return rows;
}

/**
 * A box DRL draws (a menu, a list, a full screen such as the inventory): the
 * rectangle between its top and bottom line, or null.
 */
export function boxRect(grid: Grid): Rect | null {
  const rows = lineRows(grid);
  if (rows.length < 2) return null;
  const top = rows[0]!;
  const bottom = rows[rows.length - 1]!;
  if (bottom.y - top.y < 2) return null;
  const from = Math.min(...rows.map((row) => row.from));
  const to = Math.max(...rows.map((row) => row.to));
  return { x: from, y: top.y, width: to - from + 1, height: bottom.y - top.y + 1 };
}

/** The text of rows near the top that DRL uses for prompts and modes. */
function promptText(grid: Grid): string {
  return [0, 1, 2].map((y) => rowText(grid, y)).join('\n');
}

/** What the game is waiting for, from its screen and the terminal cursor. */
export function detectContext(grid: Grid): DrlContext {
  const text = screenText(grid);
  const hud = parseHud(grid);
  const prompts = promptText(grid);
  if (/Type a name|Enter (?:a |your )?seed|Type (?:a |the )?seed/i.test(text)) return 'text';
  if (/\[more\] press <|^\s*Press <[^>]+>\.\.\./m.test(prompts)) return 'pager';
  if (/\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)/i.test(text)) return 'yesno';
  if (/choose direction/.test(prompts)) return 'direction';
  const box = boxRect(grid);
  if (box) return 'menu';
  if (hud) {
    if (/= LOOK MODE =/.test(prompts)) return 'look';
    // Targeting draws its action on row 2 and puts the cursor on the target.
    if (grid.cursor?.visible) return 'look';
    return 'map';
  }
  // Full screens: the main menu, DRL's choices before a game, its texts.
  if (/\S/.test(text)) return 'title';
  return 'busy';
}

/** Whether a menu's footer offers panels (<Left,Right> panels). */
export function hasPanels(grid: Grid): boolean {
  return /<Left,Right>/.test(screenText(grid));
}

/** The player on the map: the '@' DRL draws, else the terminal cursor. */
export function playerCell(grid: Grid): { x: number; y: number } | null {
  const at = '@'.charCodeAt(0);
  for (let y = MAP_TOP; y <= MAP_BOTTOM; y++)
    for (let x = 0; x < grid.cols; x++) if (grid.cells[(y * grid.cols + x) * 2] === at) return { x, y };
  return grid.cursor?.visible ? { x: grid.cursor.x, y: grid.cursor.y } : null;
}

/** The message lines (rows 0-1), without the prompts DRL also draws there. */
export function messageLines(grid: Grid): string[] {
  return MESSAGE_ROWS.map((y) => rowText(grid, y).trim()).filter(Boolean);
}

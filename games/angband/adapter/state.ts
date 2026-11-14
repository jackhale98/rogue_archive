// SPDX-License-Identifier: GPL-2.0-only
/**
 * Angband's state for the shell: the read-only snapshot port/main-web.c sends
 * with each frame, and what the game is waiting for (from that snapshot and
 * the prompts Angband prints, mostly on the top line).
 */
import { findText, rowText, type Grid, type Rect } from '@rogue-archive/term-view';
import type { AngbandContext } from './input.ts';

export interface AngbandState {
  /** A character is in the game (the town or the dungeon), alive. */
  inGame: boolean;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  /** Dungeon level (each is 50 feet; 0 is the town). */
  depth: number;
  playerX: number;
  playerY: number;
  /** The map panel's offset in the dungeon. */
  offsetX: number;
  offsetY: number;
  /** Where the map starts on screen (after the sidebar). */
  colMap: number;
  rowMap: number;
  messageCount: number;
  waiting: boolean;
  roguelike: boolean;
  level: number;
  gold: number;
  /** Graphics mode in use (0: text; lib/tiles/list.txt). */
  graphics: number;
  underFeature: 'none' | 'down' | 'up' | 'shop';
  underObjects: number;
  monstersInView: number;
  monstersAdjacent: number;
  /** Direction digit (1-9) to an adjacent visible monster, 0 if none. */
  attackDir: number;
  canFire: boolean;
  quiver: number;
  caster: boolean;
  canCast: boolean;
  doorsAdjacent: number;
  /** Resting, running or following a path. */
  busy: boolean;
  mouseMovement: boolean;
  isDead: boolean;
  /** A character is loaded or being created. */
  generated: boolean;
}

const UNDER_FEATURE = ['none', 'down', 'up', 'shop'] as const;

/** Mirrors the ST_* order in port/main-web.c. */
export function parseState(raw: Int32Array): AngbandState {
  const at = (i: number, fallback = 0) => raw[i] ?? fallback;
  return {
    inGame: at(0) === 1,
    hp: at(1),
    maxHp: at(2),
    sp: at(3),
    maxSp: at(4),
    depth: at(5),
    playerX: at(6),
    playerY: at(7),
    offsetX: at(8),
    offsetY: at(9),
    colMap: at(10, 13),
    rowMap: at(11, 1),
    messageCount: at(12),
    waiting: at(13) === 1,
    roguelike: at(14) !== 0,
    level: at(15),
    gold: at(16),
    graphics: at(17),
    underFeature: UNDER_FEATURE[at(18)] ?? 'none',
    underObjects: at(19),
    monstersInView: at(20),
    monstersAdjacent: at(21),
    attackDir: at(22),
    canFire: at(23) !== 0,
    quiver: at(24),
    caster: at(25) !== 0,
    canCast: at(26) !== 0,
    doorsAdjacent: at(27),
    busy: at(28) !== 0,
    mouseMovement: at(29) !== 0,
    isDead: at(30) !== 0,
    generated: at(31) !== 0,
  };
}

/** The map area of the screen: right of the sidebar, between the message and status lines. */
export function mapRect(grid: Grid, state: AngbandState): Rect {
  const x = Math.min(grid.cols - 1, state.colMap);
  const y = Math.min(grid.rows - 2, state.rowMap);
  return { x, y, width: grid.cols - x, height: grid.rows - y - 1 };
}

/** The player's screen cell, if on the map. */
export function playerCell(state: AngbandState): { x: number; y: number } | null {
  if (!state.inGame) return null;
  return { x: state.playerX - state.offsetX + state.colMap, y: state.playerY - state.offsetY + state.rowMap };
}

/** Text drawn over the map (a menu, list or description), if any. */
export function mapOverlay(grid: Grid, state: AngbandState): Rect | null {
  const text = findText(grid, mapRect(grid, state), 2);
  if (!text) return null;
  // Lists label each line "a) " before the text proper ("a) 3 Rations": the
  // first word found is "Rations", five columns after "a").
  const x = Math.max(state.colMap, text.x - 6);
  return { x, y: text.y, width: text.x + text.width - x, height: text.height };
}

export interface Choice {
  key: string;
  label: string;
}

/** Lettered choices on screen ("a) Human", "c) 40 Rations of Food"...), in reading order. */
export function screenChoices(grid: Grid, region?: Rect): Choice[] {
  const choices: Choice[] = [];
  const seen = new Set<string>();
  const from = region?.y ?? 0;
  const to = region ? region.y + region.height : grid.rows;
  for (let y = from; y < to; y++) {
    const line = rowText(grid, y, region?.x ?? 0, region ? region.x + region.width : grid.cols);
    for (const match of line.matchAll(/(?:^|\s)([a-zA-Z])\) ([^ ].*?)(?=\s{2,}|$)/g)) {
      const key = match[1]!;
      const label = match[2]!.trim();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      choices.push({ key, label });
    }
  }
  return choices;
}

/** A row of Angband's savefile menu: "New game", or "Use <file>: <description>". */
export interface SaveChoice {
  /** Screen row (the menu takes a click, then a second click to choose). */
  row: number;
  /** The savefile's name, or null for "New game". */
  name: string | null;
  label: string;
}

/** Angband's own savefile menu (main.c -c, ui-game.c select_savefile). */
export function saveMenu(grid: Grid): SaveChoice[] | null {
  if (!/^Select the save to use/.test(rowText(grid, 0))) return null;
  const choices: SaveChoice[] = [];
  for (let y = 3; y < grid.rows; y++) {
    const line = rowText(grid, y).trim();
    if (!line) continue;
    if (line === 'New game') choices.push({ row: y, name: null, label: 'New game' });
    const use = /^Use ([^:]+?)(?::\s*(.*))?$/.exec(line);
    if (use) choices.push({ row: y, name: use[1]!, label: use[2] ? `${use[1]}: ${use[2]}` : use[1]! });
  }
  return choices;
}

/** An item prompt, e.g. "Drop which item? (Inven: a-d, / for Equip, | for Quiver, - for floor, ESC)". */
export interface ItemPrompt {
  /** The list the prompt shows (Inven, Equip, Quiver, Floor). */
  list: string;
  /** The other lists '/', '|' and '-' switch to, if offered. */
  equip: boolean;
  inven: boolean;
  quiver: boolean;
  floor: boolean;
}

export function itemPrompt(top: string): ItemPrompt | null {
  const match = /\((Inven|Equip|Quiver|Floor):([^)]*)\)/.exec(top);
  if (!match) return null;
  const options = match[2]!;
  return {
    list: match[1]!,
    equip: /\/ for Equip/.test(options),
    inven: /\/ for Inven/.test(options),
    quiver: /\| for Quiver/.test(options),
    floor: /- for floor/.test(options),
  };
}

/**
 * Aim prompts (ui-input.c textui_get_aim_dir) offer the closest target ("'")
 * and a choice ('*'), and the current target ('5' or 't') when one is set.
 */
export function aimPrompt(top: string): { targetSet: boolean } | null {
  const match = /^Direction \('(\*' or <click> to target|5' for target)/.exec(top.trimStart());
  return match ? { targetSet: match[1]!.startsWith('5') } : null;
}

/**
 * Look and target mode (ui-target.c): the top line describes the grid under
 * the cursor and ends with its offset from the player ("..., 4 S, 0 E.").
 */
export function isTargeting(top: string): boolean {
  return /, \d+ [NS], \d+ [EW]\.?\s*$/.test(top.trimEnd());
}

/** "Press any key", "-more-", "Press Return": the game waits for any key. */
const CONTINUE =
  /-more-|\[Press any key to continue\]|Press any key|Hit any key|Press Return \(or Escape\)|any other key to (?:continue|page forward|accept)|\(press any key\)/i;

/** A store or the home: the shopkeeper's line and "Gold Remaining" at the bottom. */
export function isStore(grid: Grid): boolean {
  return /Gold Remaining:/.test(rowText(grid, grid.rows - 1)) && /\(\d+\)\s*$|Home/.test(rowText(grid, 1));
}

export function detectContext(grid: Grid, state: AngbandState): AngbandContext {
  if (!state.waiting) return 'busy';
  const top = rowText(grid, 0);
  if (saveMenu(grid)) return 'select';
  if (isTargeting(top)) return 'targeting';
  if (/-more-/.test(top)) return 'more';
  if (/\[y\/n\]/i.test(top)) return 'yesno';
  if (aimPrompt(top)) return 'aim';
  if (/^\s*Direction\b/.test(top)) return 'direction';
  if (itemPrompt(top)) return 'item';
  const bottom = rowText(grid, grid.rows - 1);
  if (CONTINUE.test(top) || CONTINUE.test(bottom)) return 'more';
  // A text field (names, quantities, inscriptions, rest counts): the cursor waits on the prompt line.
  const cursor = grid.cursor;
  const textField =
    !!cursor?.visible && cursor.y === 0 && top.trim().length > 0 && cursor.x >= top.trimEnd().length - 12;
  if (!state.inGame) return textField ? 'text' : 'birth';
  if (isStore(grid)) return textField ? 'text' : 'store';
  if (textField) return 'text';
  if (mapOverlay(grid, state)) return 'menu';
  return 'map';
}

export type StatusTone = 'good' | 'info' | 'warn' | 'bad';

/**
 * Angband's own status line (the bottom row: light, hunger, speed, depth,
 * timed effects, what is underfoot), for the phone band, as on screen.
 */
export function statusLine(grid: Grid): string {
  return rowText(grid, grid.rows - 1)
    .replace(/\s{2,}/g, ' · ')
    .replace(/^ · | · $/g, '')
    .trim();
}

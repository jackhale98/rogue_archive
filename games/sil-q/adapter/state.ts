// SPDX-License-Identifier: GPL-2.0-only
/**
 * Sil-Q's state for the shell: the read-only snapshot port/main-web.c sends
 * with each frame, and what the game is waiting for (from that snapshot and
 * the prompts Sil prints on the top line).
 */
import { findText, rowText, type Grid, type Rect } from '@rogue-archive/term-view';
import { SONG_NAMES, type SilContext } from './input.ts';

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
  /** The keyset Sil applies to commands: 0 original, 1 original with hjkl, 2 Angband-like, 3 Angband-like with hjkl. */
  keyset: number;
  stealthMode: boolean;
  /** Current song and minor theme (SNG_* index; SONG_NONE if none). */
  song1: number;
  song2: number;
  food: number;
  blind: number;
  confused: number;
  afraid: number;
  poisoned: number;
  cut: number;
  stun: number;
  entranced: number;
  /** 2 is normal speed. */
  speed: number;
  /** Turns of light left, or -1 if the light does not burn out (or there is none). */
  lightTurns: number;
  underFeature: 'none' | 'down' | 'up' | 'forge';
  underObject: 'none' | 'object' | 'crown';
  onTheRun: boolean;
  newExp: number;
  /** Price of the cheapest ability whose prerequisites are met, or -1. */
  abilityCost: number;
  monstersInView: number;
  monstersAdjacent: number;
  bow: boolean;
  quiver1: number;
  quiver2: number;
  doorsAdjacent: number;
}

/** SNG_NOTHING: no song. */
export const SONG_NONE = 100;

export function songName(song: number): string | null {
  return SONG_NAMES[song] ?? null;
}

const UNDER_FEATURE = ['none', 'down', 'up', 'forge'] as const;
const UNDER_OBJECT = ['none', 'object', 'crown'] as const;

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
    keyset: raw[12] ?? 0,
    stealthMode: (raw[13] ?? 0) !== 0,
    song1: raw[14] ?? SONG_NONE,
    song2: raw[15] ?? SONG_NONE,
    food: raw[16] ?? 0,
    blind: raw[17] ?? 0,
    confused: raw[18] ?? 0,
    afraid: raw[19] ?? 0,
    poisoned: raw[20] ?? 0,
    cut: raw[21] ?? 0,
    stun: raw[22] ?? 0,
    entranced: raw[23] ?? 0,
    speed: raw[24] ?? 2,
    lightTurns: raw[25] ?? -1,
    underFeature: UNDER_FEATURE[raw[26] ?? 0] ?? 'none',
    underObject: UNDER_OBJECT[raw[27] ?? 0] ?? 'none',
    onTheRun: (raw[28] ?? 0) !== 0,
    newExp: raw[29] ?? 0,
    abilityCost: raw[30] ?? -1,
    monstersInView: raw[31] ?? 0,
    monstersAdjacent: raw[32] ?? 0,
    bow: (raw[33] ?? 0) !== 0,
    quiver1: raw[34] ?? 0,
    quiver2: raw[35] ?? 0,
    doorsAdjacent: raw[36] ?? 0,
  };
}

/** Food thresholds (defines.h PY_FOOD_*). */
const FOOD_STARVE = 1;
const FOOD_WEAK = 1000;
const FOOD_ALERT = 2000;
const FOOD_FULL = 5000;

export type StatusTone = 'good' | 'info' | 'warn' | 'bad';
export interface StatusTag {
  text: string;
  tone: StatusTone;
}

/**
 * What Sil's sidebar and status line show about the player's condition, for
 * the phone status band: stealth mode, songs, hunger, timed conditions, speed,
 * a fading light. Wording and thresholds follow xtra1.c (prt_hunger, prt_cut...).
 */
export function statusTags(state: SilState): StatusTag[] {
  const tags: StatusTag[] = [];
  if (state.stealthMode) tags.push({ text: 'Stealth', tone: 'info' });
  const song1 = songName(state.song1);
  const song2 = songName(state.song2);
  if (song1) tags.push({ text: `♪ ${song1}${song2 ? ` + ${song2}` : ''}`, tone: 'info' });
  if (state.food < FOOD_STARVE) tags.push({ text: 'Starving', tone: 'bad' });
  else if (state.food < FOOD_WEAK) tags.push({ text: 'Weak', tone: 'bad' });
  else if (state.food < FOOD_ALERT) tags.push({ text: 'Hungry', tone: 'warn' });
  else if (state.food >= FOOD_FULL) tags.push({ text: 'Full', tone: 'good' });
  if (state.entranced) tags.push({ text: 'Entranced', tone: 'bad' });
  if (state.blind) tags.push({ text: 'Blind', tone: 'warn' });
  if (state.confused) tags.push({ text: 'Confused', tone: 'warn' });
  if (state.afraid) tags.push({ text: 'Afraid', tone: 'warn' });
  if (state.poisoned) tags.push({ text: `Poisoned ${state.poisoned}`, tone: 'warn' });
  if (state.cut > 100) tags.push({ text: 'Mortal wound', tone: 'bad' });
  else if (state.cut > 0) tags.push({ text: `Bleeding ${state.cut}`, tone: state.cut > 20 ? 'bad' : 'warn' });
  if (state.stun > 100) tags.push({ text: 'Knocked out', tone: 'bad' });
  else if (state.stun > 50) tags.push({ text: 'Heavy stun', tone: 'bad' });
  else if (state.stun > 0) tags.push({ text: 'Stun', tone: 'warn' });
  if (state.speed < 2) tags.push({ text: 'Slow', tone: 'warn' });
  else if (state.speed > 2) tags.push({ text: 'Fast', tone: 'good' });
  if (state.lightTurns >= 0 && state.lightTurns <= 100)
    tags.push({ text: `Light ${state.lightTurns}`, tone: state.lightTurns <= 20 ? 'bad' : 'warn' });
  return tags;
}

/** The song prompt: "(Songs: s,a,f,x, * to see) Sing which song: ". */
export interface SongPrompt {
  /** Song letters that can be chosen ('a' + SNG_* index). */
  songs: string[];
  /** 'x' exchanges the song and the minor theme (woven themes). */
  exchange: boolean;
}

export function songPrompt(top: string): SongPrompt | null {
  const match = /^\(Songs: ([^)]*)\) Sing which song:/.exec(top.trimStart());
  if (!match) return null;
  const options = match[1]!.split(',').map((option) => option.trim());
  return {
    songs: options.filter((option) => /^[a-l]$/.test(option)),
    exchange: options.includes('x'),
  };
}

/**
 * An aim prompt (xtra2.c get_aim_dir): "Direction ('f' for closest, '*' to choose a target, ...)?"
 * or, with a target set, "('f' for target, '*' to re-target, ...)". Plain direction
 * prompts (get_rep_dir: open, close, bash, tunnel, disarm) take no target.
 */
export function aimPrompt(top: string): 'closest' | 'target' | null {
  const match = /^\s*Direction \('f' for (closest|target)/.exec(top);
  return (match?.[1] as 'closest' | 'target' | undefined) ?? null;
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
  // Look/target first: its prompt can carry a "-more-" of its own (Space shows more).
  if (TARGETING.test(top.trimEnd())) return 'targeting';
  if (/-more-/.test(top)) return 'more';
  if (/\[y\/n\]/i.test(top)) return 'yesno';
  if (aimPrompt(top)) return 'aim';
  if (/^\s*Direction\b/.test(top)) return 'direction';
  if (songPrompt(top)) return 'song';
  if (itemPrompt(top)) return 'item';
  if (!state.inDungeon) return isLoadPrompt(grid) ? 'load' : 'title';
  // A text field (inscriptions, notes, quantities): the cursor waits on the prompt line.
  if (grid.cursor?.visible && grid.cursor.y === 0 && top.trim().length > 0) return 'text';
  if (mapOverlay(grid)) return 'menu';
  return 'map';
}

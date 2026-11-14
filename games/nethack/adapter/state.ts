// SPDX-License-Identifier: NGPL
/**
 * NetHack's read-only state snapshot (port/rogue-archive-glue.c ra_state):
 * only what the player can see or knows.
 */

export type Underfoot =
  'none' | 'down' | 'up' | 'ladder-down' | 'ladder-up' | 'altar' | 'fountain' | 'sink' | 'throne' | 'trap';

const UNDERFOOT: readonly Underfoot[] = [
  'none',
  'down',
  'up',
  'ladder-down',
  'ladder-up',
  'altar',
  'fountain',
  'sink',
  'throne',
  'trap',
];

/** port/rogue-archive-glue.c RA_TROUBLE_* */
export const TROUBLE = {
  stoned: 1,
  slimed: 2,
  strangled: 4,
  sick: 8,
  hunger: 16,
  hp: 32,
  engulfed: 64,
  trapped: 128,
  levitating: 256,
  blind: 512,
} as const;

/** Trouble the player can see that prayer can fix: the "in trouble" dock. */
export const MAJOR_TROUBLE =
  TROUBLE.stoned | TROUBLE.slimed | TROUBLE.strangled | TROUBLE.sick | TROUBLE.hunger | TROUBLE.hp;

/** NetHack's direction keys in its xdir/ydir order (h y k u l n j b), and arrows for labels. */
export const DIR_KEYS = 'hykulnjb';
export const DIR_ARROWS = ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'];
/** Each direction's step (xdir, ydir). */
export const DIR_STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

export interface NetHackState {
  /** The move loop is running (a game is in progress). */
  inGame: boolean;
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
  depth: number;
  /** The hero's map position (NetHack's coordinates: x 1..79, y 0..20). */
  x: number;
  y: number;
  moves: number;
  /** u.uhs: 0 satiated, 1 not hungry, 2 hungry, 3 weak, 4 fainting, 5 fainted, 6 starved. */
  hunger: number;
  /** What the hero stands on. */
  underfoot: Underfoot;
  /** Objects seen here. */
  objects: number;
  containerHere: boolean;
  corpseHere: boolean;
  /** Directions (indices into DIR_KEYS) with a displayed hostile monster next to the hero. */
  adjacent: number[];
  /** The displayed symbol of the first of them. */
  adjacentChar: string;
  /** The nearest displayed hostile in a straight line within 8 squares, or null. */
  target: { dir: number; char: string; distance: number } | null;
  /** TROUBLE flags. */
  trouble: number;
  /** 0 unencumbered, 1 burdened, 2 stressed, 3 strained, 4 overtaxed, 5 overloaded. */
  encumbrance: number;
  /** The quiver holds something to fire or throw as it is. */
  quiverReady: boolean;
  spellsKnown: boolean;
  /** In a shop with unpaid items. */
  unpaid: boolean;
  carryingCorpse: boolean;
  /** getpos is running (choosing a position). */
  choosingPosition: boolean;
}

export function parseState(raw: ArrayLike<number>): NetHackState {
  const flags = raw[12] ?? 0;
  const adjacent = raw[13] ?? 0;
  return {
    inGame: raw[0] === 1,
    hp: raw[1] ?? 0,
    hpMax: raw[2] ?? 0,
    energy: raw[3] ?? 0,
    energyMax: raw[4] ?? 0,
    depth: raw[5] ?? 0,
    x: raw[6] ?? 0,
    y: raw[7] ?? 0,
    moves: raw[8] ?? 0,
    hunger: raw[9] ?? 1,
    underfoot: UNDERFOOT[raw[10] ?? 0] ?? 'none',
    objects: raw[11] ?? 0,
    containerHere: (flags & 1) !== 0,
    corpseHere: (flags & 2) !== 0,
    adjacent: [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => (adjacent >> i) & 1),
    adjacentChar: raw[14] ? String.fromCharCode(raw[14]) : '',
    target:
      (raw[15] ?? -1) >= 0
        ? { dir: raw[15]!, char: raw[16] ? String.fromCharCode(raw[16]) : '', distance: raw[17] ?? 0 }
        : null,
    trouble: raw[18] ?? 0,
    encumbrance: raw[19] ?? 0,
    quiverReady: raw[20] === 1,
    spellsKnown: raw[21] === 1,
    unpaid: raw[22] === 1,
    carryingCorpse: raw[23] === 1,
    choosingPosition: raw[24] === 1,
  };
}

/** The hero's cell on the 80×24 screen (the map starts on row 1, column 0 is x 1). */
export function heroCell(state: NetHackState): { x: number; y: number } | null {
  return state.inGame ? { x: state.x - 1, y: state.y + 1 } : null;
}

/** The direction (index into DIR_KEYS) from the hero towards a screen cell, as NetHack reads a sloppy click. */
export function directionTo(state: NetHackState, cell: { x: number; y: number }): number | null {
  const hero = heroCell(state);
  if (!hero) return null;
  const dx = Math.sign(cell.x - hero.x);
  const dy = Math.sign(cell.y - hero.y);
  if (dx === 0 && dy === 0) return null;
  return DIR_STEPS.findIndex(([x, y]) => x === dx && y === dy);
}

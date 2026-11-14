// SPDX-License-Identifier: NGPL
/** NetHack's read-only state snapshot (port/rogue-archive-glue.c ra_state). */

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
}

export function parseState(raw: ArrayLike<number>): NetHackState {
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
  };
}

/** The hero's cell on the 80×24 screen (the map starts on row 1, column 0 is x 1). */
export function heroCell(state: NetHackState): { x: number; y: number } | null {
  return state.inGame ? { x: state.x - 1, y: state.y + 1 } : null;
}

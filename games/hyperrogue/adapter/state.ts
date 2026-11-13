// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * HyperRogue's read-only state snapshot (port/rogue-archive-web.cpp
 * ra_state) and what the player is looking at.
 */
import type { HyperContext } from './input.ts';

export interface HyperState {
  /** The map is the only screen (no menu, help or quest screen open). */
  inMap: boolean;
  treasure: number;
  kills: number;
  turns: number;
  /** False once the player is caught: the game is over. */
  canMove: boolean;
  land: number;
  landTreasure: number;
  orbs: number;
}

/** Mirrors the RA_* order in port/rogue-archive-web.cpp. */
export const STATE_FIELDS = 8;

export function parseState(raw: ArrayLike<number>): HyperState {
  return {
    inMap: raw[0] === 1,
    treasure: raw[1] ?? 0,
    kills: raw[2] ?? 0,
    turns: raw[3] ?? 0,
    canMove: raw[4] === 1,
    land: raw[5] ?? 0,
    landTreasure: raw[6] ?? 0,
    orbs: raw[7] ?? 0,
  };
}

export function detectContext(state: HyperState | null): HyperContext {
  if (!state) return 'loading';
  if (!state.inMap) return 'dialog';
  return state.canMove ? 'map' : 'over';
}

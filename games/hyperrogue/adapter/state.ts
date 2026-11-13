// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * HyperRogue's read-only state snapshot (port/rogue-archive-web.cpp
 * ra_state) and what the player is looking at.
 */
import type { HyperContext } from './input.ts';

/** Upstream's touch modes (control.cpp `enum class tmode`): what a click on the map does. */
export const TOUCH_MODE = { move: 0, info: 1, drag: 2, fire: 3, ranged: 4 } as const;

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
  /** The player holds an orb (or strong wind) a click on a distant cell may use. */
  ranged: boolean;
  /** The orb (eItem) a click on the cell under the pointer would use; 0: none. */
  targetOrb: number;
  /** Strong wind (Whirlwind): `t` jumps where it blows. */
  wind: boolean;
  /** Crossbow mode: `f` switches fire mode. */
  crossbow: boolean;
  /** Fire mode is on: clicks aim the crossbow, Esc cancels. */
  fireMode: boolean;
  /** Turns until the crossbow can fire again. */
  reload: number;
  /** Dead Orbs carried (`g` drops one). */
  deadOrbs: number;
  /** Orb Strategy mode: `i` opens the orb inventory. */
  orbStrategy: boolean;
  /** In or next to the Minefield: `m` marks mines. */
  minefield: boolean;
  /** Orb of Safety charge: leaving now saves the game. */
  safety: number;
  /** What a click on the map does (TOUCH_MODE). */
  touchMode: number;
}

/** Mirrors the RA_* order in port/rogue-archive-web.cpp. */
export const STATE_FIELDS = 19;

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
    ranged: raw[8] === 1,
    targetOrb: raw[9] ?? 0,
    wind: (raw[10] ?? 0) > 0,
    crossbow: raw[11] === 1,
    fireMode: raw[12] === 1,
    reload: raw[13] ?? 0,
    deadOrbs: raw[14] ?? 0,
    orbStrategy: raw[15] === 1,
    minefield: raw[16] === 1,
    safety: raw[17] ?? 0,
    touchMode: raw[18] ?? TOUCH_MODE.move,
  };
}

export function detectContext(state: HyperState | null): HyperContext {
  if (!state) return 'loading';
  if (!state.inMap) return 'dialog';
  return state.canMove ? 'map' : 'over';
}

/** What the adapter itself is doing with taps (besides the game's touch mode). */
export interface TouchUi {
  /** Taps mark or unmark mines (`m` on the tapped cell) instead of moving. */
  markMode: boolean;
  /** A finger is on the game: the pointer is where it is. */
  touching: boolean;
  /** The name of the orb `targetOrb` names. */
  targetOrbName: string;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The lines of the small hint over the game: what a tap does now, the orb a
 * tap there would use, and whether leaving keeps the game (Orb of Safety).
 */
export function hintFor(state: HyperState | null, ui: TouchUi): string[] {
  if (!state || !state.inMap || !state.canMove) return [];
  const lines: string[] = [];
  const orb = state.targetOrb && ui.targetOrbName ? capitalise(ui.targetOrbName) : '';
  if (ui.markMode) lines.push('Mark: tap a cell to mark or unmark a mine');
  else if (state.fireMode)
    lines.push(
      state.reload > 0
        ? `Crossbow reloading: ${state.reload} turn${state.reload === 1 ? '' : 's'}`
        : 'Fire: tap to aim, tap the same cell again to fire',
    );
  else if (state.touchMode === TOUCH_MODE.info) lines.push('Inspect: tap a cell to read about it');
  else if (state.touchMode === TOUCH_MODE.ranged)
    lines.push(
      ui.touching && orb ? `Aim: release to use ${orb}` : 'Aim: tap a cell to use a ranged orb on it',
    );
  else if (ui.touching && orb) lines.push(`Release uses ${orb}`);
  if (state.safety > 0) lines.push(`Orb of Safety (${state.safety}): leaving now keeps this game`);
  return lines;
}

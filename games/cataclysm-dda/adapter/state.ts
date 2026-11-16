// SPDX-License-Identifier: CC-BY-SA-3.0
/**
 * The game's read-only snapshot (port/rogue-archive-web.cpp ra_state) and
 * what the adapter derives from it.
 */
import type { CddaContext } from './input.ts';

export interface CddaState {
  /** The keybinding context the game waits in (keybindings.json "category"), or "". */
  context: string;
  /** Every context waiting, outermost first. */
  contexts: string[];
  /** Which of a few telling actions the waiting context registers (inventory, look, QUIT...). */
  registers: string[];
  /** Waiting for any input. */
  waiting: boolean;
  /** Waiting for a raw key ("press any key"), outside any context. */
  rawWait: boolean;
  /** Input waits so far (it changes whenever the game asks again). */
  waits: number;
  inGame: boolean;
  mainMenu: boolean;
  termX: number;
  termY: number;
  cellW: number;
  cellH: number;
  player?: {
    x: number;
    y: number;
    z: number;
    absX: number;
    absY: number;
    absZ: number;
    name: string;
    dead: boolean;
  };
  turn?: number;
  /** game::uquit (0 playing, 2 saved and quit, 4 died...). */
  quit?: number;
  /** Titles of the ImGui windows open (menus, popups). */
  imgui: string[];
}

export function parseState(json: string): CddaState | null {
  try {
    return JSON.parse(json) as CddaState;
  } catch {
    return null;
  }
}

/** Contexts in which the game takes typed text. */
const TEXT_CONTEXTS = new Set(['STRING_INPUT', 'STRING_EDITOR']);

export function detectContext(state: CddaState | null): CddaContext {
  if (!state || (!state.waiting && !state.inGame && !state.mainMenu)) return 'loading';
  if (!state.waiting) return 'busy';
  if (TEXT_CONTEXTS.has(state.context)) return 'text';
  // The map and direction prompts ("Examine where?") share DEFAULTMODE.
  if (state.inGame && state.context === 'DEFAULTMODE')
    return (state.registers ?? []).includes('inventory') ? 'map' : 'direction';
  if (state.mainMenu && state.context === 'MAIN_MENU') return 'title';
  return 'menu';
}

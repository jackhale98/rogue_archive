// SPDX-License-Identifier: BSD-3-Clause
// Typed messages between the Rogue adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';

export interface VerifiedFile {
  url: string;
  file: RuntimeFile;
}

/** A saved game: Rogue keeps one savefile per character, <name>.save in its home directory. */
export interface SavedGame {
  name: string;
  modifiedAt: number;
}

export type ToWorker =
  | { type: 'init'; glue: VerifiedFile; wasm: VerifiedFile }
  /** Start Rogue for this character: a new game, or restore its savefile. */
  | { type: 'start'; name: string; restore: boolean }
  /** Key codes for the game (ASCII and control codes, as Rogue reads them). */
  | { type: 'keys'; keys: number[] }
  | { type: 'flush'; id: number }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; files: SaveFile[] };

export type FromWorker =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  | { type: 'ready'; saves: SavedGame[] }
  | {
      type: 'frame';
      cols: number;
      rows: number;
      /** Two bytes per cell: character, 1 if standout (reverse video). */
      cells: Uint8Array;
      cursor: { x: number; y: number; visible: boolean };
      /** Read-only game state; see adapter/state.ts for the field order. */
      state: Int32Array;
    }
  /** The game ended (Rogue exits after saving, dying or quitting); a fresh process is ready. */
  | { type: 'exit'; status: number; saved: boolean; saves: SavedGame[] }
  | { type: 'saves'; saves: SavedGame[] }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

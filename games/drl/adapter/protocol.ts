// SPDX-License-Identifier: GPL-2.0-only
// Typed messages between the DRL adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';

export interface VerifiedFile {
  url: string;
  file: RuntimeFile;
}

export type ToWorker =
  | { type: 'init'; glue: VerifiedFile; wasm: VerifiedFile; data: VerifiedFile }
  /** Starts DRL (again after it exits from its main menu). */
  | { type: 'start' }
  /** Keys for the game: characters or curses KEY_ codes (adapter/input.ts). */
  | { type: 'keys'; keys: number[] }
  | { type: 'flush'; id: number }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; files: SaveFile[] };

export type FromWorker =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  | { type: 'ready'; hasSave: boolean }
  | {
      type: 'frame';
      cols: number;
      rows: number;
      /** Two bytes per cell: character, attribute (port/ncurses.pas). */
      cells: Uint8Array;
      cursor: { x: number; y: number; visible: boolean };
    }
  /** DRL ended (Exit from its main menu); `restarted`: started again at its main menu. */
  | { type: 'exit'; status: number; restarted: boolean }
  /** Whether a saved game exists (user/drl/save). */
  | { type: 'saves'; hasSave: boolean }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

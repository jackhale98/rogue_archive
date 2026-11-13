// SPDX-License-Identifier: GPL-2.0-only
// Typed messages between the Sil-Q adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';

export interface VerifiedFile {
  url: string;
  file: RuntimeFile;
}

export type ToWorker =
  | { type: 'init'; glue: VerifiedFile; wasm: VerifiedFile; data: VerifiedFile }
  | { type: 'start'; args: string[] }
  /** Key codes for the game (ASCII and control codes, as Sil reads them). */
  | { type: 'keys'; keys: number[] }
  | { type: 'flush'; id: number }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; files: SaveFile[] };

export type FromWorker =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  | { type: 'ready' }
  | {
      type: 'frame';
      cols: number;
      rows: number;
      /** Two bytes per cell: character, Angband colour index. */
      cells: Uint8Array;
      cursor: { x: number; y: number; visible: boolean };
      /** Read-only game state; see adapter/state.ts for the field order. */
      state: Int32Array;
    }
  /** Angband's colour table: 256 entries of [kv, r, g, b]. */
  | { type: 'palette'; table: Uint8Array }
  /** A new message (oldest first); `color` is an Angband colour index. */
  | { type: 'message'; text: string; color: number }
  | { type: 'exit'; status: number }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

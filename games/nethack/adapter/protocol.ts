// SPDX-License-Identifier: NGPL
// Typed messages between the NetHack adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';
import type { NhContext, NhFrame } from './windowport.ts';

export interface VerifiedFile {
  url: string;
  file: RuntimeFile;
}

/** A saved game: NetHack keeps one save file per character (save/<uid><name>). */
export interface SavedGame {
  name: string;
  modifiedAt: number;
}

export type ToWorker =
  | { type: 'init'; glue: VerifiedFile; wasm: VerifiedFile }
  /** Start NetHack as this character: its saved game if it has one, else a new game. */
  | { type: 'start'; name: string }
  /** A key (ASCII and control codes, as NetHack reads them) or a click on a map cell. */
  | { type: 'input'; key?: number; click?: { x: number; y: number; button: number } }
  | { type: 'flush'; id: number }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; files: SaveFile[] };

export type FrameMessage = Omit<NhFrame, 'context'> & { type: 'frame'; context: NhContext };

export type FromWorker =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  | { type: 'ready'; saves: SavedGame[] }
  | FrameMessage
  /** A message the game printed (for the shell's log). */
  | { type: 'message'; text: string }
  /** The game ended (saved, died or quit); a fresh process is ready. */
  | { type: 'exit'; saved: boolean; saves: SavedGame[] }
  | { type: 'saves'; saves: SavedGame[] }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

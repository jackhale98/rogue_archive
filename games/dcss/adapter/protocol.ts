// SPDX-License-Identifier: GPL-2.0-or-later
// Typed messages between the DCSS adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';

export interface VerifiedFile {
  url: string;
  file: RuntimeFile;
}

/** A saved character found in the save directory. */
export interface SavedCharacter {
  name: string;
  /** Path relative to the save directory. */
  path: string;
  modifiedAt: number;
}

export type ToWorker =
  | { type: 'init'; glue: VerifiedFile; wasm: VerifiedFile; data: VerifiedFile }
  | { type: 'start'; args: string[] }
  /** A WebTiles control message for the game (JSON text, as the client would send it). */
  | { type: 'send'; text: string }
  | { type: 'flush'; id: number }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; files: SaveFile[] };

export type FromWorker =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  /** Loaded (or a game ended and a fresh process is ready), with the saved characters. */
  | { type: 'ready'; characters: SavedCharacter[] }
  /** WebTiles messages from the game for the client, in order (JSON text each). */
  | { type: 'messages'; lines: string[] }
  /** The game process ended (death, save, quit); `reason` is from its exit_reason message. */
  | { type: 'exit'; status: number; reason: string; message: string; characters: SavedCharacter[] }
  /** The saved characters changed (e.g. after an import). */
  | { type: 'characters'; characters: SavedCharacter[] }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

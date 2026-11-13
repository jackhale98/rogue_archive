// SPDX-License-Identifier: AGPL-3.0-or-later
// Typed messages between the Brogue adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';

/** [eventType, param1, param2, controlKey, shiftKey] */
export type BrogueEventTuple = [number, number, number, number, number];

/** One entry of Brogue's message archive. `id` increases for every new entry. */
export interface ArchivedMessage {
  id: number;
  turn: number;
  count: number;
  foldable: boolean;
  /** Raw message bytes including Brogue's color escapes (COLOR_ESCAPE + r, g, b). */
  bytes: number[];
}

export type ToWorker =
  | {
      type: 'init';
      glue: { url: string; file: RuntimeFile };
      wasm: { url: string; file: RuntimeFile };
    }
  | { type: 'start'; args: string[] }
  | { type: 'event'; event: BrogueEventTuple }
  | { type: 'modifiers'; shift: boolean; ctrl: boolean }
  | { type: 'flush'; id: number }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; files: SaveFile[] };

export type FromWorker =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  | { type: 'ready' }
  | {
      type: 'frame';
      cells: Uint8Array;
      playerX: number;
      playerY: number;
      mode: number;
      inGame: boolean;
      /** Read-only game state; see adapter/state.ts for the field order. */
      state: Int32Array;
    }
  | { type: 'graphics-mode'; mode: number }
  /** Brogue's message history: new entries (and the updated newest one); `reset` starts over. */
  | { type: 'messages'; reset: boolean; entries: ArchivedMessage[] }
  | { type: 'notify'; eventId: number; data1: number; data2: number; str1: string; str2: string }
  | { type: 'exit'; status: number }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

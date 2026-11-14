// SPDX-License-Identifier: GPL-2.0-only
// Typed messages between the Angband adapter (main thread) and its Web Worker.

import type { GameError, RuntimeFile, RuntimeStatus, SaveFile } from '@rogue-archive/game-api';

export interface VerifiedFile {
  url: string;
  file: RuntimeFile;
}

export type ToWorker =
  | { type: 'init'; glue: VerifiedFile; wasm: VerifiedFile; data: VerifiedFile }
  /** Starts Angband with these arguments (again after each save and quit). */
  | { type: 'start'; args: string[] }
  /** Input events (adapter/input.ts keyEvent, clickEvent). */
  | { type: 'events'; events: number[] }
  /** Switch Angband's graphics mode (0: text) at its next wait for input. */
  | { type: 'graphics'; mode: number }
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
      /** Two bytes per cell: character (Latin-1), colour (bit 7: a solid block). */
      cells: Uint8Array;
      /** Two entries per cell: foreground and terrain tile (0x8000 | row << 7 | col), 0 if none. */
      tiles: Uint16Array;
      cursor: { x: number; y: number; visible: boolean };
      /** Read-only game state; see adapter/state.ts for the field order. */
      state: Int32Array;
    }
  /** Angband's colour table: entries of [kv, r, g, b]. */
  | { type: 'palette'; table: Uint8Array }
  /**
   * A new message (oldest first), or with `repeat` the newest message's new
   * text after Angband counted a repeat of it ("... <2x>"). `color` is an
   * Angband colour index.
   */
  | { type: 'message'; text: string; color: number; repeat: boolean }
  /** Savefiles (user/Angband/save), most recently played first. */
  | { type: 'saves'; names: string[] }
  /** Angband ended (a save and quit, or quitting at its savefile menu). */
  | { type: 'exit'; status: number; restarted: boolean }
  | { type: 'flushed'; id: number; error?: string }
  | { type: 'exported'; id: number; files: SaveFile[]; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

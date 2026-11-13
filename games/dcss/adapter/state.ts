// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the shell needs to know about the game, followed from the same
 * WebTiles messages the client renders (read only; nothing is sent back):
 * the player's status for the phone status band, and what the game is waiting
 * for (moving on the map, a menu, a --more-- prompt, targeting...) so the touch
 * controls can offer the right actions.
 */
import type { DcssContext } from './input.ts';

/** upstream enums.js mouse_mode (input_mode messages). */
export const InputMode = {
  NORMAL: 0,
  COMMAND: 1,
  TARGET: 2,
  TARGET_DIR: 3,
  TARGET_PATH: 4,
  MORE: 5,
  MACRO: 6,
  PROMPT: 7,
  YESNO: 8,
} as const;

/** upstream enums.js ui (ui_state messages). */
export const UiState = { NORMAL: 0, CRT: 1, VIEW_MAP: 2 } as const;

export interface StatusLight {
  light: string;
  text: string;
  col?: number;
}

/** The "player" message fields the shell shows. The game sends only changes. */
export interface PlayerState {
  name: string;
  species: string;
  title: string;
  god: string;
  hp: number;
  hp_max: number;
  mp: number;
  mp_max: number;
  xl: number;
  place: string;
  depth: number;
  turn: number;
  time: number;
  gold: number;
  status: StatusLight[];
}

export interface WebTilesMessage {
  msg: string;
  [field: string]: unknown;
}

/** Splits the game's output (JSON text lines, often "multi" batches) into messages. */
export function parseLines(lines: readonly string[]): WebTilesMessage[] {
  const out: WebTilesMessage[] = [];
  const add = (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const record = message as { msg?: unknown; msgs?: unknown };
    if (Array.isArray(record.msgs)) record.msgs.forEach(add);
    else if (typeof record.msg === 'string') out.push(record as WebTilesMessage);
  };
  for (const line of lines) {
    try {
      add(JSON.parse(line));
    } catch {
      // The client reports malformed messages itself.
    }
  }
  return out;
}

export class GameTracker {
  player: Partial<PlayerState> = {};
  inputMode: number = InputMode.NORMAL;
  uiState: number = UiState.NORMAL;
  layer = '';
  /** Open popups (ui-push), by type, innermost last. */
  popups: string[] = [];
  /** Open menus (menu / close_menu), innermost last. */
  menus: string[] = [];
  /** A text field the game asked for (init_input / close_input). */
  textInput = false;
  more = false;
  /** Whether a character exists (the game has drawn the map at least once). */
  inGame = false;

  reset(): void {
    this.player = {};
    this.inputMode = InputMode.NORMAL;
    this.uiState = UiState.NORMAL;
    this.layer = '';
    this.popups = [];
    this.menus = [];
    this.textInput = false;
    this.more = false;
    this.inGame = false;
  }

  /** Applies one message; returns true if anything the shell shows may have changed. */
  apply(message: WebTilesMessage): boolean {
    switch (message.msg) {
      case 'player':
        Object.assign(this.player, message);
        return true;
      case 'input_mode':
        this.inputMode = Number(message.mode);
        return true;
      case 'ui_state':
        this.uiState = Number(message.state);
        return true;
      case 'layer':
        this.layer = String(message.layer);
        return true;
      case 'map':
        if (!this.inGame) {
          this.inGame = true;
          return true;
        }
        return false;
      case 'ui-push':
        this.popups.push(String(message.type ?? 'popup'));
        return true;
      case 'ui-pop':
        this.popups.pop();
        return true;
      case 'menu':
        this.menus.push(String(message.tag ?? 'menu'));
        return true;
      case 'close_menu':
        this.menus.pop();
        return true;
      case 'close_all_menus':
        this.menus = [];
        return true;
      case 'init_input':
        this.textInput = true;
        return true;
      case 'close_input':
        this.textInput = false;
        return true;
      case 'msgs':
        if ('more' in message) {
          this.more = !!message.more;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  context(): DcssContext {
    const top = this.popups[this.popups.length - 1];
    if (top === 'newgame-choice' || top === 'game-menu' || top === 'seed-selection') return 'start';
    if (top === 'msgwin-get-line') return 'text';
    if (top) return 'popup';
    // Yes/no questions are small menus tagged "prompt" (prompt.cc yesno()).
    if (this.menus[this.menus.length - 1] === 'prompt') return 'yesno';
    if (this.menus.length > 0) return 'menu';
    if (this.textInput) return 'text';
    switch (this.inputMode) {
      case InputMode.MORE:
        return 'more';
      case InputMode.YESNO:
        return 'yesno';
      case InputMode.PROMPT:
        return 'prompt';
      case InputMode.TARGET:
      case InputMode.TARGET_DIR:
      case InputMode.TARGET_PATH:
        return 'targeting';
      default:
        break;
    }
    if (this.more) return 'more';
    if (this.uiState === UiState.VIEW_MAP) return 'level-map';
    if (this.layer === 'crt' || this.uiState === UiState.CRT) return this.inGame ? 'popup' : 'start';
    if (!this.inGame) return 'loading';
    if (this.inputMode === InputMode.COMMAND) return 'map';
    return 'busy';
  }
}

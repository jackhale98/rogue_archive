// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * DCSS message text for the shell's message log.
 *
 * Messages arrive in WebTiles "msgs" messages as formatted strings: text with
 * colour tags such as `<lightred>` ... `</lightred>`, where `<<` is a literal
 * `<`. This follows upstream's util.js formatted_string_to_html, producing
 * coloured runs instead of HTML.
 */
import type { LogEntry } from '@rogue-archive/game-api';

/** Upstream's WebTiles palette (game_data/static/style.css). */
export const PALETTE = [
  '#000000',
  '#005afa',
  '#4e9a06',
  '#06989a',
  '#b30009',
  '#cd21cb',
  '#8f5902',
  '#babdb6',
  '#555753',
  '#5e78ff',
  '#8ae234',
  '#34e2e2',
  '#ef2929',
  '#fd59fa',
  '#fce94f',
  '#eeeeec',
] as const;

const COLOURS: Record<string, number> = {
  black: 0,
  blue: 1,
  green: 2,
  cyan: 3,
  red: 4,
  magenta: 5,
  brown: 6,
  lightgrey: 7,
  lightgray: 7,
  darkgrey: 8,
  darkgray: 8,
  lightblue: 9,
  lightgreen: 10,
  lightcyan: 11,
  lightred: 12,
  lightmagenta: 13,
  yellow: 14,
  h: 14,
  white: 15,
  w: 15,
};

export interface Run {
  text: string;
  color?: string;
}

/** Splits a DCSS formatted string into coloured runs (background tags are dropped). */
export function formattedToRuns(formatted: string): Run[] {
  const runs: Run[] = [];
  const stack: number[] = [];
  const push = (text: string) => {
    if (!text) return;
    const top = stack[stack.length - 1];
    const color = top === undefined ? undefined : PALETTE[top];
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.text += text;
    else runs.push(color === undefined ? { text } : { text, color });
  };
  const pattern = /<?<(\/?(bg:)?[a-z]*)>?|>/gi;
  let at = 0;
  for (let match = pattern.exec(formatted); match; match = pattern.exec(formatted)) {
    push(formatted.slice(at, match.index));
    at = match.index + match[0].length;
    const whole = match[0];
    let name = (match[1] ?? '').toLowerCase();
    const closing = name.startsWith('/');
    if (closing) name = name.slice(1);
    const background = name.startsWith('bg:');
    if (background) name = name.slice(3);
    if (name in COLOURS && !whole.startsWith('<<') && whole.endsWith('>')) {
      if (background) continue;
      if (closing) stack.pop();
      else stack.push(COLOURS[name]!);
    } else {
      push(whole.startsWith('<<') ? whole.slice(1) : whole);
    }
  }
  push(formatted.slice(at));
  return runs;
}

export function plainText(formatted: string): string {
  return formattedToRuns(formatted)
    .map((run) => run.text)
    .join('');
}

export interface GameMessage {
  text: string;
  turn?: number;
  channel?: number;
  repeats?: number;
}

/**
 * Keeps the message log in step with the game: new messages are appended;
 * "rollback" removes the newest ones (DCSS rewrites messages, e.g. to fold a
 * repeat into "x2"). Ids only grow, so the shell can merge updates.
 */
export class MessageLog {
  #nextId = 1;
  #entries: LogEntry[] = [];

  reset(): void {
    this.#entries = [];
  }

  /** Applies one "msgs" message; returns the entries to send to the shell (or null). */
  apply(message: { messages?: GameMessage[]; rollback?: number; old_msgs?: number }): {
    reset: boolean;
    entries: LogEntry[];
  } | null {
    const removed = (message.rollback ?? 0) + (message.old_msgs ?? 0);
    let reset = false;
    if (removed > 0) {
      this.#entries.splice(Math.max(0, this.#entries.length - removed), removed);
      reset = true;
    }
    const added: LogEntry[] = [];
    for (const item of message.messages ?? []) {
      if (!item.text) continue;
      const runs = formattedToRuns(item.text);
      if (!runs.some((run) => run.text.trim())) continue;
      const entry: LogEntry = {
        id: this.#nextId++,
        runs: item.repeats && item.repeats > 1 ? [...runs, { text: ` x${item.repeats}` }] : runs,
        ...(item.turn !== undefined ? { group: `turn ${item.turn}` } : {}),
      };
      added.push(entry);
    }
    this.#entries.push(...added);
    if (this.#entries.length > 1000) this.#entries.splice(0, this.#entries.length - 1000);
    if (reset) return { reset: true, entries: [...this.#entries] };
    return added.length > 0 ? { reset: false, entries: added } : null;
  }
}

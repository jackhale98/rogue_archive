// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Turns entries of Brogue's message archive into log lines: decodes color
 * escapes (upstream encodeMessageColor: COLOR_ESCAPE, then red, green, blue as
 * COLOR_VALUE_INTERCEPT + 0..100) and applies Brogue's presentation (capital
 * first letter, final period, "(x3)" / "(many)" repeat counts).
 */
import type { LogEntry } from '@rogue-archive/game-api';
import type { ArchivedMessage } from './protocol.ts';

const COLOR_ESCAPE = 25;
const COLOR_VALUE_INTERCEPT = 25;
/** Upstream MAX_MESSAGE_REPEATS. */
const MAX_MESSAGE_REPEATS = 100;

function channel(byte: number): number {
  return Math.round((Math.max(0, Math.min(100, byte - COLOR_VALUE_INTERCEPT)) * 255) / 100);
}

export function decodeMessage(bytes: readonly number[]): { text: string; color?: string }[] {
  const runs: { text: string; color?: string }[] = [];
  let color: string | undefined;
  let text = '';
  const flush = () => {
    if (text) runs.push(color ? { text, color } : { text });
    text = '';
  };
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte === COLOR_ESCAPE) {
      // A truncated escape at the very end carries no text; drop it.
      flush();
      color = `rgb(${channel(bytes[i + 1] ?? 0)},${channel(bytes[i + 2] ?? 0)},${channel(bytes[i + 3] ?? 0)})`;
      i += 3;
      continue;
    }
    // Brogue messages are ASCII; anything else is shown as a space.
    text += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ' ';
  }
  flush();
  return runs;
}

export function toLogEntry(message: ArchivedMessage): LogEntry {
  const runs = decodeMessage(message.bytes);
  // Capitalize the first letter, as Brogue does when it displays messages.
  for (const run of runs) {
    const index = run.text.search(/[A-Za-z]/);
    if (index >= 0) {
      run.text = run.text.slice(0, index) + run.text[index]!.toUpperCase() + run.text.slice(index + 1);
      break;
    }
    if (run.text.trim()) break;
  }
  const last = runs[runs.length - 1];
  if (last && /[A-Za-z0-9)\]>]$/.test(last.text.trimEnd())) last.text = `${last.text.trimEnd()}.`;
  if (message.count > 1) {
    runs.push({ text: message.count >= MAX_MESSAGE_REPEATS ? ' (many)' : ` (x${message.count})` });
  }
  return { id: message.id, group: `Turn ${message.turn}`, runs };
}

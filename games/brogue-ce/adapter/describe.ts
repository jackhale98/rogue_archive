// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reads a text box Brogue has drawn over the map (a monster or item
 * description) out of the screen cells as re-flowable paragraphs, so phones can
 * show it in a large, readable panel instead of at map scale.
 *
 * Brogue wraps description text to the box width and starts paragraphs with an
 * indent or a blank line; we undo the wrapping and keep each run's color.
 */
import type { Rect } from './camera.ts';
import { CELL_BYTES, COLS } from './constants.ts';

export interface TextRun {
  text: string;
  color: string;
}

export interface Description {
  /** Identifies this description: box position plus its first paragraph. */
  key: string;
  /** A short label for the box (its first line). */
  title: string;
  paragraphs: TextRun[][];
}

function lineRuns(
  cells: Uint8Array,
  y: number,
  from: number,
  to: number,
  underlay: Uint8Array | null,
): TextRun[] {
  const runs: TextRun[] = [];
  for (let x = from; x < to; x++) {
    const offset = (y * COLS + x) * CELL_BYTES;
    const sprite = cells[offset]! | (cells[offset + 1]! << 8);
    // Brogue's boxes are translucent: map glyphs show through the gaps. A cell
    // that matches the dungeon from before the box appeared is a gap, not text.
    const behind = underlay ? underlay[offset]! | (underlay[offset + 1]! << 8) : -1;
    const char = sprite >= 32 && sprite < 127 && sprite !== behind ? String.fromCharCode(sprite) : ' ';
    const color = `rgb(${cells[offset + 2]},${cells[offset + 3]},${cells[offset + 4]})`;
    const last = runs[runs.length - 1];
    if (last && (last.color === color || char === ' ')) last.text += char;
    else runs.push({ text: char, color });
  }
  return runs;
}

const textOf = (runs: TextRun[]) => runs.map((run) => run.text).join('');

/**
 * @param underlay the screen as it was before the box appeared (same layout as
 * `cells`), used to tell the box's text from map glyphs showing through it.
 */
export function readDescription(
  cells: Uint8Array,
  box: Rect,
  underlay: Uint8Array | null = null,
): Description {
  const lines: TextRun[][] = [];
  for (let y = box.y; y < box.y + box.height; y++)
    lines.push(lineRuns(cells, y, box.x, box.x + box.width, underlay));

  // Drop the box's empty margins.
  const texts = lines.map(textOf);
  const left = Math.min(...texts.filter((t) => t.trim()).map((t) => t.length - t.trimStart().length));
  const paragraphs: TextRun[][] = [];
  let current: TextRun[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = texts[i]!;
    if (!text.trim()) {
      current = null; // a blank line ends the paragraph
      continue;
    }
    const indent = text.length - text.trimStart().length - (Number.isFinite(left) ? left : 0);
    if (indent >= 2) current = null; // an indented line starts a new paragraph
    // Trim this line's leading/trailing spaces, then join it to the paragraph with one space.
    const runs = lines[i]!.map((run) => ({ ...run }));
    while (runs.length && !runs[0]!.text.trim()) runs.shift();
    while (runs.length && !runs[runs.length - 1]!.text.trim()) runs.pop();
    if (runs.length) {
      runs[0]!.text = runs[0]!.text.trimStart();
      runs[runs.length - 1]!.text = runs[runs.length - 1]!.text.trimEnd();
    }
    if (!current) {
      current = [];
      paragraphs.push(current);
    } else {
      current.push({ text: ' ', color: runs[0]?.color ?? '' });
    }
    current.push(...runs);
  }
  const title = textOf(paragraphs[0] ?? [])
    .replace(/\s+/g, ' ')
    .trim();
  return {
    // Position and first paragraph identify a description; the rest of the box
    // can flicker between frames (animated terrain showing through it).
    key: `${box.x},${box.y},${box.width},${box.height}:${title}`,
    title: title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title,
    paragraphs,
  };
}

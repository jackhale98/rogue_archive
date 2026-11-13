// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Content-aware camera for zoomed play on small screens.
 *
 * Brogue draws everything (map, sidebar, messages, menus, descriptions) into
 * one fixed 100x34 grid. When the player zooms in, the view follows the
 * player, which would cut off anything Brogue shows elsewhere: a monster
 * description, the inventory, a confirmation dialog. So we look at the frame:
 * if readable text is drawn over the dungeon map, the camera must keep that
 * text in view too, zooming out only as far as needed. It zooms back in when
 * the text goes away.
 */
import { CELL_BYTES, COLS, DCOLS, DROWS, MAP_ORIGIN_X, MAP_ORIGIN_Y } from './constants.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cells around the player that stay visible when zoomed. */
const PLAYER_MARGIN_X = 5;
const PLAYER_MARGIN_Y = 3;
/** A "word" is this many ASCII letters in a row; monster glyphs never line up like that in practice. */
const MIN_WORD = 4;
const MIN_WORDS = 2;
/** Text boxes have a border/background a little beyond their text. */
const OVERLAY_PADDING = 2;

function isLetter(sprite: number): boolean {
  return (sprite >= 65 && sprite <= 90) || (sprite >= 97 && sprite <= 122);
}

/**
 * Bounding box (screen cells) of text drawn over the dungeon map, or null.
 * Text glyphs are ASCII sprites in every display mode, while map features in
 * tiles mode are sprites >= 256, so this works in text, tiles and hybrid modes.
 */
export function findTextOverlay(cells: Uint8Array): Rect | null {
  const spriteAt = (x: number, y: number) => {
    const offset = (y * COLS + x) * CELL_BYTES;
    return cells[offset]! | (cells[offset + 1]! << 8);
  };
  const mapLeft = MAP_ORIGIN_X;
  const mapRight = MAP_ORIGIN_X + DCOLS - 1;
  const isText = (x: number, y: number) => {
    const sprite = spriteAt(x, y);
    return sprite > 32 && sprite < 127;
  };
  /** Grows [from, to] over neighbouring text, allowing single spaces between words. */
  const extend = (y: number, from: number, to: number): [number, number] => {
    let left = from;
    while (left - 1 >= mapLeft && (isText(left - 1, y) || (left - 2 >= mapLeft && isText(left - 2, y))))
      left--;
    let right = to;
    while (right + 1 <= mapRight && (isText(right + 1, y) || (right + 2 <= mapRight && isText(right + 2, y))))
      right++;
    return [left, right];
  };

  let words = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = MAP_ORIGIN_Y; y < MAP_ORIGIN_Y + DROWS; y++) {
    let run = 0;
    for (let x = mapLeft; x <= mapRight + 1; x++) {
      if (x <= mapRight && isLetter(spriteAt(x, y))) {
        run++;
        continue;
      }
      if (run >= MIN_WORD) {
        words++;
        const [left, right] = extend(y, x - run, x - 1);
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      run = 0;
    }
  }
  if (words < MIN_WORDS) return null;
  const x0 = Math.max(mapLeft, minX - OVERLAY_PADDING);
  const y0 = Math.max(MAP_ORIGIN_Y, minY - OVERLAY_PADDING);
  const x1 = Math.min(mapRight, maxX + OVERLAY_PADDING);
  const y1 = Math.min(MAP_ORIGIN_Y + DROWS - 1, maxY + OVERLAY_PADDING);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export function union(a: Rect, b: Rect | null): Rect {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** What the zoomed camera must keep on screen: the player's surroundings plus any text overlay. */
export function cameraFocus(
  playerScreen: { x: number; y: number } | null,
  overlay: Rect | null,
): Rect | null {
  if (!playerScreen) return null;
  const around: Rect = {
    x: playerScreen.x - PLAYER_MARGIN_X,
    y: playerScreen.y - PLAYER_MARGIN_Y,
    width: PLAYER_MARGIN_X * 2 + 1,
    height: PLAYER_MARGIN_Y * 2 + 1,
  };
  return union(around, overlay);
}

/** Plain text of message rows 0..2 (the message area right of the sidebar), with per-run colors. */
export interface MessageRun {
  text: string;
  color: string;
}

export function messageLines(cells: Uint8Array, rows = 3): MessageRun[][] {
  const lines: MessageRun[][] = [];
  for (let y = 0; y < rows; y++) {
    const runs: MessageRun[] = [];
    for (let x = MAP_ORIGIN_X; x < COLS; x++) {
      const offset = (y * COLS + x) * CELL_BYTES;
      const sprite = cells[offset]! | (cells[offset + 1]! << 8);
      const char = sprite >= 32 && sprite < 127 ? String.fromCharCode(sprite) : ' ';
      const color = `rgb(${cells[offset + 2]},${cells[offset + 3]},${cells[offset + 4]})`;
      const last = runs[runs.length - 1];
      if (last && (last.color === color || char === ' ')) last.text += char;
      else runs.push({ text: char, color });
    }
    const lastRun = runs[runs.length - 1];
    if (lastRun) lastRun.text = lastRun.text.trimEnd();
    lines.push(runs.filter((run) => run.text.length > 0));
  }
  return lines;
}

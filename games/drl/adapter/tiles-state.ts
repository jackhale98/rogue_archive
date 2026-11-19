// SPDX-License-Identifier: GPL-2.0-only
/**
 * The graphical (tiles) mode's text and window, as plain functions (unit
 * tested): DRL draws its text over the graphics with Valkyrie's GL console,
 * an 80x25 grid of cells (bin/data/drl/fonts/default: font10x19.png, 80 25)
 * in the same layout as its console mode: messages on rows 0-1, the HUD on
 * rows 22-24, menus in boxes. port/webgl.js hands the host the cells
 * (vglconsole.pas TGLCell: foreground RGBA, background RGBA, glyph,
 * padding); here they become the console mode's screen format (two bytes a
 * cell: the character, with the line characters as the curses alternate
 * character set, and the curses colour), so adapter/state.ts reads both.
 */
import type { Grid } from '@rogue-archive/term-view';
import { ACS } from './state.ts';

export const CONSOLE_COLS = 80;
export const CONSOLE_ROWS = 25;
/** font10x19.png, DRL's GL console font. */
export const FONT_WIDTH = 10;
export const FONT_HEIGHT = 19;
/** DRL's UI needs its 80x25 cells of 10x19 pixels. */
export const MIN_WINDOW = { width: CONSOLE_COLS * FONT_WIDTH, height: CONSOLE_ROWS * FONT_HEIGHT };

/**
 * Valkyrie's 16 colours (viotypes.pas IOColors, RRGGBBAA), in its own order
 * (black, blue, green, cyan, red, magenta, brown, light grey, then bright),
 * and the curses colour each is in the console mode (black, red, green,
 * yellow, blue, magenta, cyan, white; +8 bold).
 */
const IO_COLORS = [
  0x000000, 0x00009f, 0x009f00, 0x009f9f, 0x9f0000, 0x9f009f, 0x9f9f00, 0xcccccc, 0x808080, 0x0000ff,
  0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
];
const CURSES_OF_IO = [0, 4, 2, 6, 1, 5, 3, 7, 8, 12, 10, 14, 9, 13, 11, 15];

/** The nearest curses colour of a cell colour (RRGGBBAA). */
export function cursesColour(rgba: number): number {
  const r = (rgba >>> 24) & 0xff;
  const g = (rgba >>> 16) & 0xff;
  const b = (rgba >>> 8) & 0xff;
  let best = 0;
  let bestDistance = Infinity;
  IO_COLORS.forEach((rgb, i) => {
    const d = ((rgb >> 16) - r) ** 2 + (((rgb >> 8) & 0xff) - g) ** 2 + ((rgb & 0xff) - b) ** 2;
    if (d < bestDistance) [best, bestDistance] = [i, d];
  });
  return CURSES_OF_IO[best]!;
}

/** Code page 437's line and block characters (DRL's font) as the curses alternate characters. */
const CP437_ACS: Record<number, string> = {
  196: 'q',
  205: 'q',
  179: 'x',
  186: 'x',
  218: 'l',
  201: 'l',
  191: 'k',
  187: 'k',
  192: 'm',
  200: 'm',
  217: 'j',
  188: 'j',
  195: 't',
  204: 't',
  180: 'u',
  185: 'u',
  193: 'v',
  202: 'v',
  194: 'w',
  203: 'w',
  197: 'n',
  206: 'n',
  176: 'a',
  177: 'a',
  178: 'a',
  219: '0',
  250: '~',
  249: '~',
  248: 'f',
  241: 'g',
  4: '`',
};

/** The console mode's character code for a glyph of the GL console. */
export function consoleChar(glyph: number): number {
  if (glyph >= 32 && glyph < 127) return glyph;
  if (glyph === 0) return 32;
  const acs = CP437_ACS[glyph];
  return acs ? ACS(acs) : '?'.charCodeAt(0);
}

/** The GL console's cells (four 32-bit values each) as a console-mode screen, or null. */
export function consoleGrid(raw: Uint32Array, cols = CONSOLE_COLS): Grid | null {
  const count = Math.floor(raw.length / 4);
  if (count < cols || count % cols !== 0) return null;
  const rows = count / cols;
  const cells = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) {
    cells[i * 2] = consoleChar(raw[i * 4 + 2]!);
    cells[i * 2 + 1] = cursesColour(raw[i * 4]!);
  }
  return { cols, rows, cells, cursor: { x: 0, y: 0, visible: false } };
}

/**
 * settings.lua (Valkyrie's configuration, `key = value,` lines) with DRL's
 * window set to the size the page gives it, windowed: DRL sizes its window
 * once, from these, when it starts (drlgfxio.pas). The rest of the player's
 * settings stay as they are; without the file, DRL's defaults apply to them.
 */
export function settingsForWindow(text: string | null, size: { width: number; height: number }): string {
  const values: Record<string, string> = {
    screen_width: String(Math.round(size.width)),
    screen_height: String(Math.round(size.height)),
    fullscreen: 'false',
  };
  if (!text || !/configuration\s*=\s*\{/.test(text))
    return `configuration = {\n${Object.entries(values)
      .map(([key, value]) => `  ${key} = ${value},`)
      .join('\n')}\n}\n`;
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^(\\s*${key}\\s*=\\s*)[^,\\n]*(,?)`, 'm');
    out = line.test(out)
      ? out.replace(line, `$1${value}$2`)
      : out.replace(/configuration\s*=\s*\{/, (m) => `${m}\n  ${key} = ${value},`);
  }
  return out;
}

/**
 * The window (canvas pixels) for a page area (CSS pixels): one pixel a CSS
 * pixel, as DRL picks its own tile and font scales from the window size
 * (drlgfxio.pas RecalculateScaling: larger on large windows); more where the
 * area is smaller than DRL's 80x25 interface, which then fits it; the canvas
 * is shown at the area's size (sharp-edged, the art is pixel art).
 */
export function windowFor(area: { width: number; height: number }): {
  width: number;
  height: number;
  scale: number;
} {
  const width = Math.max(1, area.width);
  const height = Math.max(1, area.height);
  const scale = Math.max(1, (MIN_WINDOW.width + 20) / width, MIN_WINDOW.height / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

/**
 * Where a console cell is in the window (canvas pixels): Valkyrie's GL
 * console is centred at the top, FONT_WIDTH x its font multiplier a
 * column; its rows are spaced to fill the window's height
 * (drlgfxio.pas CalculateConsoleParams: line space = (height - 25 x 19 x
 * multiplier) div 25 div multiplier); the multiplier is 2 on windows of at
 * least 1600x900, else 1 (RecalculateScaling, font_multiplier 0: DRL's
 * default).
 */
export function consoleCell(
  window: { width: number; height: number },
  x: number,
  y: number,
): { x: number; y: number; width: number; height: number } {
  const multiplier = window.width >= 1600 && window.height >= 900 ? 2 : 1;
  const width = FONT_WIDTH * multiplier;
  const left = Math.trunc((window.width - CONSOLE_COLS * width) / 2);
  const lineSpace = Math.max(
    Math.trunc(
      Math.trunc((window.height - CONSOLE_ROWS * FONT_HEIGHT * multiplier) / CONSOLE_ROWS) / multiplier,
    ),
    0,
  );
  const height = (FONT_HEIGHT + lineSpace) * multiplier;
  return { x: left + x * width, y: y * height, width, height };
}

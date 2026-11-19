// SPDX-License-Identifier: GPL-2.0-only
// The Tiles display: DRL's graphical mode's text read back, its window, the
// keys it is sent, and the GLSL rewrite of port/webgl.js.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KEY } from '../adapter/input.ts';
import { ACS, detectContext, parseHud, screenText } from '../adapter/state.ts';
import {
  CONSOLE_COLS,
  CONSOLE_ROWS,
  consoleCell,
  consoleChar,
  consoleGrid,
  cursesColour,
  settingsForWindow,
  windowFor,
} from '../adapter/tiles-state.ts';
import { domKey } from '../adapter/tiles.ts';

const WHITE = 0xffffffff;
const LIGHT_GREY = 0xccccccff;
const YELLOW = 0xffff00ff;

/** Valkyrie GL console cells (fg, bg, glyph, padding) from text rows. */
function cells(rows: Record<number, string>, fg: Record<number, number> = {}): Uint32Array {
  const raw = new Uint32Array(CONSOLE_COLS * CONSOLE_ROWS * 4);
  for (let y = 0; y < CONSOLE_ROWS; y++) {
    const text = rows[y] ?? '';
    for (let x = 0; x < CONSOLE_COLS; x++) {
      const i = (y * CONSOLE_COLS + x) * 4;
      const char = text[x] ?? ' ';
      raw[i] = fg[y] ?? LIGHT_GREY;
      raw[i + 2] = char === '─' ? 196 : char.charCodeAt(0);
    }
  }
  return raw;
}

describe("the graphical mode's text", () => {
  it("maps Valkyrie's colours to the console mode's curses colours", () => {
    expect(cursesColour(LIGHT_GREY)).toBe(7);
    expect(cursesColour(WHITE)).toBe(15);
    expect(cursesColour(YELLOW)).toBe(11); // bright yellow, as the console's selected entries
    expect(cursesColour(0x9f0000ff)).toBe(1); // red
    expect(cursesColour(0x00009fff)).toBe(4); // blue
    expect(cursesColour(0xfe0101ff)).toBe(9); // nearest: light red
  });

  it('maps code page 437 line characters to the curses alternate set', () => {
    expect(consoleChar(196)).toBe(ACS('q'));
    expect(consoleChar(179)).toBe(ACS('x'));
    expect(consoleChar(65)).toBe(65);
    expect(consoleChar(0)).toBe(32);
    expect(consoleChar(1)).toBe('?'.charCodeAt(0));
  });

  it("reads the graphical HUD (level first) and the contexts as in the console's layout", () => {
    const raw = cells({
      1: '  Welcome to DRL...',
      22: '                                                             Phobos Base Entry',
      23: '  Pixels                     A: none                                   E633225',
      24: '  Health: 100% Exp:  1/0%    W: pistol (2d4) [6/6] (40)',
    });
    const grid = consoleGrid(raw)!;
    expect(grid.cols).toBe(80);
    expect(grid.rows).toBe(25);
    expect(screenText(grid)).toContain('Welcome to DRL...');
    expect(parseHud(grid)).toEqual({
      name: 'Pixels',
      armor: 'none',
      health: 100,
      healthText: '100%',
      exp: '1/0%',
      weapon: 'pistol (2d4) [6/6] (40)',
      level: 'Phobos Base Entry',
    });
    expect(detectContext(grid)).toBe('map');
    const menu = consoleGrid(
      cells({
        7: `                         ${'─'.repeat(30)}`,
        9: '                            Continue',
        15: '                            Save & Quit',
        17: `                         ${'─'.repeat(30)}`,
        23: '  Pixels                     A: none',
        24: '  Health: 100% Exp:  1/0%    W: pistol',
      }),
    )!;
    expect(detectContext(menu)).toBe('menu');
  });

  it('refuses cells that are not whole rows', () => {
    expect(consoleGrid(new Uint32Array(4 * 81))).toBeNull();
  });
});

describe("DRL's window", () => {
  it('is one pixel a CSS pixel where DRL fits, larger where its 80x25 text does not', () => {
    expect(windowFor({ width: 1280, height: 756 })).toEqual({ width: 1280, height: 756, scale: 1 });
    const phone = windowFor({ width: 412, height: 915 });
    expect(phone.width).toBeGreaterThanOrEqual(800);
    expect(phone.height / phone.width).toBeCloseTo(915 / 412, 2);
    const sideways = windowFor({ width: 915, height: 412 });
    expect(sideways.height).toBeGreaterThanOrEqual(475);
  });

  it("finds the GL console's cells as drlgfxio.pas places them", () => {
    // 1280x800: one font pixel a pixel, rows spaced to 32 pixels (line space 13), centred.
    expect(consoleCell({ width: 1280, height: 800 }, 0, 0)).toEqual({ x: 240, y: 0, width: 10, height: 32 });
    expect(consoleCell({ width: 1280, height: 800 }, 79, 24)).toEqual({
      x: 1030,
      y: 768,
      width: 10,
      height: 32,
    });
    // 1920x1080: the font doubled.
    expect(consoleCell({ width: 1920, height: 1080 }, 0, 1)).toEqual({
      x: 160,
      y: 42,
      width: 20,
      height: 42,
    });
  });

  it("sets the window in DRL's settings and keeps the rest", () => {
    const settings =
      '-- this file is auto-generated, edit at own risk\nconfiguration = {\n  config_version = 0,\n  screen_width = 0,\n  screen_height = 0,\n  fullscreen = true,\n  glow_fx = true,\n}\n';
    const out = settingsForWindow(settings, { width: 1280, height: 756 });
    expect(out).toContain('  screen_width = 1280,');
    expect(out).toContain('  screen_height = 756,');
    expect(out).toContain('  fullscreen = false,');
    expect(out).toContain('  glow_fx = true,');
    expect(out.startsWith('-- this file is auto-generated')).toBe(true);
    expect(settingsForWindow(null, { width: 820, height: 1670 })).toBe(
      'configuration = {\n  screen_width = 820,\n  screen_height = 1670,\n  fullscreen = false,\n}\n',
    );
  });
});

describe('keys for SDL', () => {
  it('sends the browser key a keyboard would, with Shift where the character needs it', () => {
    expect(domKey(13)).toEqual({ key: 'Enter', code: 'Enter' });
    expect(domKey(KEY.UP)).toEqual({ key: 'ArrowUp', code: 'ArrowUp' });
    expect(domKey(KEY.B2)).toEqual({ key: 'Clear', code: 'Numpad5' });
    expect(domKey('i'.charCodeAt(0))).toEqual({ key: 'i', code: 'KeyI' });
    expect(domKey('W'.charCodeAt(0))).toEqual({ key: 'W', code: 'KeyW', shift: true });
    expect(domKey('5'.charCodeAt(0))).toEqual({ key: '5', code: 'Digit5' });
    expect(domKey('?'.charCodeAt(0))).toEqual({ key: '?', code: 'Slash', shift: true });
    expect(domKey(KEY.F0 + 1)).toEqual({ key: 'F1', code: 'F1' });
    expect(domKey(KEY.BTAB)).toEqual({ key: 'Tab', code: 'Tab', shift: true });
    expect(domKey(1)).toEqual({ key: 'a', code: 'KeyA', ctrl: true });
    expect(domKey(200)).toBeNull();
  });
});

describe('GLSL 3.30 to GLSL ES 3.00 (port/webgl.js)', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../port/webgl.js'), 'utf8');
  let library: Record<string, unknown> = {};
  new Function('addToLibrary', source)((lib: Record<string, unknown>) => {
    library = lib;
  });
  const shaders = library.$raShaders as {
    rewrite(s: string): string;
    fixes: [string, string][];
    width: number;
  };
  // rewrite() refers to itself by its library name.
  (globalThis as Record<string, unknown>).raShaders = shaders;

  it('changes the version, adds precisions, leaves other shaders alone', () => {
    const out = shaders.rewrite('#version 330 core\nout vec4 c;\nvoid main() { c = vec4(1.0); }\n');
    expect(out.startsWith('#version 300 es\nprecision highp float;')).toBe(true);
    expect(out).toContain('precision highp usampler2D;');
    expect(out).not.toContain('330');
    expect(shaders.rewrite('#version 300 es\nvoid main() {}')).toBe('#version 300 es\nvoid main() {}');
  });

  it("reads texture buffers as 2D integer textures (Valkyrie's GL console)", () => {
    const out = shaders.rewrite(
      '#version 330\nuniform usamplerBuffer udata;\nvoid main(void) {\n  uvec4 d = texelFetch( udata, index ).rgba;\n}\n',
    );
    expect(out).toContain('uniform usampler2D udata;');
    expect(out).toContain(
      `texelFetch(udata, ivec2((index) % ${shaders.width}, (index) / ${shaders.width}), 0).rgba`,
    );
  });

  it('splits vertex-input arrays (the sprite transitions) into single inputs', () => {
    const out = shaders.rewrite(
      '#version 330 core\nlayout (location = 7) in vec4 colors[4];\nvoid main() {\n  x = colors[1];\n}\n',
    );
    expect(out).toContain('layout (location = 7) in vec4 ra_colors_0;');
    expect(out).toContain('layout (location = 10) in vec4 ra_colors_3;');
    expect(out).toContain('vec4 colors[4];');
    expect(out).toMatch(/void main\(\) \{\ncolors\[0\] = ra_colors_0;[\s\S]*colors\[3\] = ra_colors_3;/);
  });

  it("makes GLSL 3.30's implicit int-to-float conversions explicit", () => {
    for (const [from, to] of shaders.fixes) {
      const out = shaders.rewrite(`#version 330 core\nvoid main() { if (${from} true) {} }\n`);
      expect(out).toContain(to);
    }
  });
});

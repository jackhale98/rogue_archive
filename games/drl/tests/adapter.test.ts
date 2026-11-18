// SPDX-License-Identifier: GPL-2.0-only
import { describe, expect, it } from 'vitest';
import type { Grid } from '@rogue-archive/term-view';
import { DRL_COMMANDS, KEY, controlsFor, keyToCurses } from '../adapter/input.ts';
import { importPath } from '../adapter/saves.ts';
import { ACS, boxRect, detectContext, glyph, parseHud, playerCell, screenText } from '../adapter/state.ts';

const none = { shift: false, ctrl: false, alt: false, meta: false };
const key = (k: string, modifiers = none) => keyToCurses({ type: 'key', key: k, code: '', modifiers });

/** A 80x25 grid from text rows ('─' is the curses line character); `colours` per row, default 7. */
function grid(rows: Record<number, string>, colours: Record<number, number> = {}): Grid {
  const cells = new Uint8Array(80 * 25 * 2);
  for (let y = 0; y < 25; y++) {
    const text = rows[y] ?? '';
    for (let x = 0; x < 80; x++) {
      const char = text[x] ?? ' ';
      cells[(y * 80 + x) * 2] = char === '─' ? ACS('q') : char === '│' ? ACS('x') : char.charCodeAt(0);
      cells[(y * 80 + x) * 2 + 1] = colours[y] ?? 7;
    }
  }
  return { cols: 80, rows: 25, cells };
}

// DRL's console HUD, as it draws it (rows 22-24).
const HUD = {
  22: '  Tester                     A: none',
  23: '  Health: 100% Exp:  1/0%    W: pistol (2d4) [6/6] (40)',
  24: '                                                             Phobos Base Entry',
};

describe('keys as a terminal sends them', () => {
  it('maps the arrows, keypad keys and controls to curses codes', () => {
    expect(key('ArrowUp')).toBe(KEY.UP);
    expect(key('Home')).toBe(KEY.HOME);
    expect(key('End')).toBe(KEY.END);
    expect(key('PageUp')).toBe(KEY.PPAGE);
    expect(key('PageDown')).toBe(KEY.NPAGE);
    expect(key('Clear')).toBe(KEY.B2);
    expect(key('Enter')).toBe(13);
    expect(key('Escape')).toBe(27);
    expect(key('Backspace')).toBe(KEY.BACKSPACE);
    expect(key('F1')).toBe(KEY.F0 + 1);
    expect(key('Tab', { ...none, shift: true })).toBe(KEY.BTAB);
  });

  it('sends characters as typed, Ctrl+letter as a control code, nothing for Meta', () => {
    expect(key('f')).toBe(102);
    expect(key('F', { ...none, shift: true })).toBe(70);
    expect(key('7')).toBe(55);
    expect(key('a', { ...none, ctrl: true })).toBe(1);
    expect(key('a', { ...none, meta: true })).toBeNull();
    expect(key('Shift')).toBeNull();
  });

  it('gives every command a key and a unique id', () => {
    const ids = DRL_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of DRL_COMMANDS) expect(command.keys.length).toBeGreaterThan(0);
  });
});

describe('reading the screen', () => {
  it('reads the HUD', () => {
    const hud = parseHud(grid(HUD));
    expect(hud).toMatchObject({
      name: 'Tester',
      armor: 'none',
      health: 100,
      healthText: '100%',
      level: 'Phobos Base Entry',
    });
    expect(hud?.weapon).toBe('pistol (2d4) [6/6] (40)');
    expect(parseHud(grid({}))).toBeNull();
  });

  it('reads health shown as current/maximum', () => {
    const hud = parseHud(grid({ ...HUD, 23: '  Health: 35/50   Exp:  1/0%    W: pistol' }));
    expect(hud?.health).toBe(70);
    expect(hud?.healthText).toBe('35/50');
  });

  it('tells the map, menus, prompts and full screens apart', () => {
    expect(detectContext(grid({ ...HUD, 11: ' ...@...' }))).toBe('map');
    const menu = {
      ...HUD,
      7: '                         ──────────────────────────────',
      9: '                            Continue',
      17: '                         ──────────────────────────────',
    };
    expect(detectContext(grid(menu))).toBe('menu');
    expect(boxRect(grid(menu))).toEqual({ x: 25, y: 7, width: 30, height: 11 });
    expect(
      detectContext(
        grid({ ...HUD, 1: '                                                                 = LOOK MODE =' }),
      ),
    ).toBe('look');
    // Targeting: its action in yellow at the start of row 2.
    expect(detectContext(grid({ ...HUD, 2: 'Fire pistol' }, { 2: 11 }))).toBe('look');
    expect(detectContext(grid({ ...HUD, 2: '   [more] press <Enter>...' }))).toBe('pager');
    expect(detectContext(grid({ ...HUD, 2: 'Open door, choose direction...' }))).toBe('direction');
    expect(detectContext(grid({ 13: '                        Type a name for your character' }))).toBe(
      'text',
    );
    expect(detectContext(grid({ 15: '                              ----- New game -----' }))).toBe('title');
    expect(detectContext(grid({}))).toBe('busy');
  });

  it('finds the player and draws the line characters', () => {
    expect(playerCell(grid({ ...HUD, 11: ' ...@...' }))).toEqual({ x: 4, y: 11 });
    expect(glyph(ACS('q'))).toBe('─');
    expect(glyph(ACS('l'))).toBe('┌');
    expect(glyph(65)).toBe('A');
    expect(screenText(grid({ 0: '──' })).split('\n')[0]).toBe('──');
  });
});

describe('the dock', () => {
  it('leads the map with Fire, and offers inventory first at low health', () => {
    const map = controlsFor('map', { health: 100 });
    expect(map.directionPad?.center).toBe('wait');
    expect(map.actions[0]).toMatchObject({ command: 'fire', emphasis: 'primary' });
    expect(controlsFor('map', { health: 20 }).actions[0]).toMatchObject({ command: 'inventory' });
  });

  it('answers menus, prompts and typing', () => {
    expect(controlsFor('menu').actions[0]).toMatchObject({ command: 'ok', label: 'Select' });
    expect(
      controlsFor('menu', { health: null, panels: true }).actions.map((a) =>
        typeof a === 'string' ? a : a.command,
      ),
    ).toContain('right');
    expect(controlsFor('pager').actions[0]).toMatchObject({ command: 'ok', wide: true });
    expect(controlsFor('yesno').actions.map((a) => (typeof a === 'string' ? a : a.command))).toEqual([
      'yes',
      'no',
      'escape',
    ]);
    expect(controlsFor('text').actions[0]).toMatchObject({ command: 'ok', label: 'Done' });
  });
});

describe('imported files', () => {
  it('go where desktop DRL keeps them', () => {
    expect(importPath('save')).toBe('user/drl/save');
    expect(importPath('score.wad')).toBe('user/drl/score.wad');
    expect(importPath('user/drl/mortem/x.txt')).toBe('user/drl/mortem/x.txt');
    expect(importPath('settings.lua')).toBe('settings.lua');
    expect(importPath('runtime.log')).toBeNull();
    expect(importPath('../etc/passwd')).toBeNull();
    expect(importPath('other/file')).toBeNull();
  });
});

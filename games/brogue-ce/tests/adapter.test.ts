import { describe, expect, it } from 'vitest';
import { glyphRect } from '../adapter/atlas.ts';
import { COLS, EventType, Key, ROWS } from '../adapter/constants.ts';
import {
  BROGUE_COMMANDS,
  BROGUE_TOUCH_LAYOUT,
  commandToBrogue,
  keyToBrogue,
  textToBrogue,
} from '../adapter/input.ts';
import { computeLayout } from '../adapter/renderer.ts';

const none = { shift: false, ctrl: false, alt: false, meta: false };
const key = (k: string, code = '', modifiers = none) => keyToBrogue({ type: 'key', key: k, code, modifiers });

describe('keyToBrogue (mirrors upstream sdl2-platform.c)', () => {
  it('maps special keys to Brogue key codes', () => {
    expect(key('ArrowUp')).toEqual([EventType.KEYSTROKE, Key.UP_ARROW, 0, 0, 0]);
    expect(key('Escape')?.[1]).toBe(0o33);
    expect(key('Enter')?.[1]).toBe(0o12);
    expect(key('Backspace')?.[1]).toBe(0o177);
    expect(key('Tab', 'Tab', { ...none, shift: true })).toEqual([EventType.KEYSTROKE, Key.TAB, 0, 0, 1]);
  });

  it('passes printable ASCII through unchanged, including shifted symbols', () => {
    expect(key('k')?.[1]).toBe('k'.charCodeAt(0));
    expect(key('>', 'Period', { ...none, shift: true })).toEqual([EventType.KEYSTROKE, 62, 0, 0, 1]);
    expect(key('S', 'KeyS', { ...none, shift: true })?.[1]).toBe(83);
  });

  it('maps Ctrl+letter like SDL and numpad digits to NUMPAD codes', () => {
    expect(key('x', 'KeyX', { ...none, ctrl: true })).toEqual([
      EventType.KEYSTROKE,
      'x'.charCodeAt(0),
      0,
      1,
      0,
    ]);
    expect(key('X', 'KeyX', { ...none, ctrl: true, shift: true })?.[1]).toBe('X'.charCodeAt(0));
    expect(key('End', 'Numpad1', { ...none, shift: true })?.[1]).toBe(49);
  });

  it('ignores keys Brogue cannot use', () => {
    expect(key('F3', 'F3')).toBeNull();
    expect(key('é', 'KeyE')).toBeNull();
    expect(key('a', 'KeyA', { ...none, alt: true })).toBeNull();
  });
});

describe('commands and text', () => {
  it('maps every touch command to its upstream key', () => {
    const ids = [
      ...Object.values(BROGUE_TOUCH_LAYOUT.directionPad!),
      ...BROGUE_TOUCH_LAYOUT.actions,
      ...BROGUE_TOUCH_LAYOUT.palette,
    ];
    for (const id of ids) if (id) expect(commandToBrogue(id), id).not.toBeNull();
    expect(commandToBrogue('explore')?.[1]).toBe('x'.charCodeAt(0));
    expect(commandToBrogue('move-nw')?.[1]).toBe('y'.charCodeAt(0));
    expect(commandToBrogue('nope')).toBeNull();
  });

  it('has unique command ids', () => {
    expect(new Set(BROGUE_COMMANDS.map((c) => c.id)).size).toBe(BROGUE_COMMANDS.length);
  });

  it('turns typed text into keystrokes', () => {
    expect(textToBrogue('ab\n').map((e) => e[1])).toEqual([97, 98, Key.RETURN]);
    expect(textToBrogue('ü')).toEqual([]);
  });
});

describe('computeLayout', () => {
  it('fits the whole screen with whole-pixel cells', () => {
    const layout = computeLayout(1280, 756, 1, 1, null);
    expect(layout.cellWidth).toBe(12);
    expect(layout.cellHeight).toBe(22);
    expect(layout.originX).toBe(Math.floor((1280 - COLS * 12) / 2));
    expect(layout.originY).toBeGreaterThanOrEqual(0);
    expect(layout.originY + ROWS * layout.cellHeight).toBeLessThanOrEqual(756);
  });

  it('accounts for device pixel ratio', () => {
    const layout = computeLayout(400, 300, 3, 1, null);
    expect(layout.width).toBe(1200);
    expect(layout.cellWidth).toBe(12);
  });

  it('keeps the focused cell on screen when zoomed, clamped to the grid edges', () => {
    const centered = computeLayout(400, 600, 1, 2.2, { x: 50, y: 17 });
    const cx = centered.originX + 50.5 * centered.cellWidth;
    expect(Math.abs(cx - 200)).toBeLessThanOrEqual(1);
    const edge = computeLayout(400, 600, 1, 2.2, { x: 0, y: 0 });
    expect(edge.originX).toBe(0);
    const far = computeLayout(400, 600, 1, 2.2, { x: COLS - 1, y: ROWS - 1 });
    expect(far.originX + COLS * far.cellWidth).toBe(400);
  });
});

describe('glyphRect', () => {
  it('stretches "s" sprites and centers fitted ones', () => {
    expect(glyphRect('s', 10, 20)).toEqual([0, 0, 10, 20]);
    const [x, y, w, h] = glyphRect('f', 20, 20);
    expect(h).toBe(20);
    expect(w).toBeLessThan(20);
    expect(x).toBeCloseTo((20 - w) / 2);
    expect(y).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { glyphRect } from '../adapter/atlas.ts';
import { cameraFocus, findTextOverlay, messageLines } from '../adapter/camera.ts';
import { COLS, EventType, Key, ROWS } from '../adapter/constants.ts';
import {
  BROGUE_COMMANDS,
  BROGUE_TOUCH_LAYOUT,
  commandToBrogue,
  keyToBrogue,
  textToBrogue,
} from '../adapter/input.ts';
import { computeLayout } from '../adapter/renderer.ts';
import { compactViews, hitTest, sheetSource } from '../adapter/views.ts';

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
      ...BROGUE_TOUCH_LAYOUT.actions.map((action) => (typeof action === 'string' ? action : action.command)),
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

  it('keeps the focus rectangle on screen when zoomed, clamped to the grid edges', () => {
    const cell = (x: number, y: number) => ({ x, y, width: 1, height: 1 });
    const centered = computeLayout(400, 600, 1, 2.2, cell(50, 17));
    expect(centered.zoom).toBeGreaterThan(2);
    const cx = centered.originX + 50.5 * centered.cellWidth;
    expect(Math.abs(cx - 200)).toBeLessThanOrEqual(1);
    expect(computeLayout(400, 600, 1, 2.2, cell(0, 0)).originX).toBe(0);
    const far = computeLayout(400, 600, 1, 2.2, cell(COLS - 1, ROWS - 1));
    expect(far.originX + COLS * far.cellWidth).toBe(400);
  });

  it('zooms out only as far as needed to keep a text overlay in view', () => {
    const overlay = { x: 21, y: 3, width: 40, height: 20 };
    const layout = computeLayout(844, 340, 1, 2.2, overlay, 54);
    expect(layout.zoom).toBeLessThan(2.2);
    const left = layout.originX + overlay.x * layout.cellWidth;
    const right = layout.originX + (overlay.x + overlay.width) * layout.cellWidth;
    const top = layout.originY + overlay.y * layout.cellHeight;
    const bottom = layout.originY + (overlay.y + overlay.height) * layout.cellHeight;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(844);
    expect(top).toBeGreaterThanOrEqual(54);
    expect(bottom).toBeLessThanOrEqual(340);
  });

  it('falls back to the whole screen when the focus is too large to zoom', () => {
    const layout = computeLayout(844, 340, 1, 2.2, { x: 0, y: 0, width: COLS, height: ROWS }, 54);
    expect(layout).toMatchObject({ zoom: 1, inset: 0 });
  });
});

function frame(text: Record<number, [number, string]>): Uint8Array {
  const cells = new Uint8Array(COLS * ROWS * 8);
  for (const [row, [col, line]] of Object.entries(text)) {
    for (let i = 0; i < line.length; i++) {
      const offset = (Number(row) * COLS + col + i) * 8;
      cells[offset] = line.charCodeAt(i);
      cells[offset + 2] = 200;
    }
  }
  return cells;
}

describe('camera', () => {
  it('finds text drawn over the map and ignores map glyphs and the sidebar', () => {
    expect(findTextOverlay(frame({ 10: [40, '#..kk..#'], 11: [40, '##@..r##'] }))).toBeNull();
    expect(findTextOverlay(frame({ 5: [0, 'Health Nutrition Strength'] }))).toBeNull();
    const overlay = findTextOverlay(
      frame({ 6: [25, 'A goblin conjurer'], 8: [25, 'has 50% chance to hit you'] }),
    );
    expect(overlay).toEqual({ x: 23, y: 4, width: 2 + 25 + 2, height: 7 });
  });

  it('keeps the player and any overlay in focus', () => {
    expect(cameraFocus(null, null)).toBeNull();
    const focus = cameraFocus({ x: 70, y: 20 }, { x: 23, y: 4, width: 29, height: 7 })!;
    expect(focus.x).toBe(23);
    expect(focus.x + focus.width).toBe(76);
    expect(focus.y).toBe(4);
    expect(focus.y + focus.height).toBe(24);
  });

  it('extracts colored message lines', () => {
    const lines = messageLines(frame({ 0: [21, 'Welcome, adventurer!'] }));
    expect(lines[0]!.map((run) => run.text).join('')).toBe('Welcome, adventurer!');
    expect(lines[0]![0]!.color).toBe('rgb(200,0,0)');
    expect(lines[1]).toEqual([]);
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

describe('compact views', () => {
  const base = {
    width: 1688,
    height: 780,
    dpr: 2,
    band: 90,
    insets: { top: 0, right: 300, bottom: 0, left: 260 },
    mapCellCss: 18,
    pan: { x: 0, y: 0 },
    player: { x: 60, y: 20 },
    focus: null,
    overlay: null,
    overlayKind: 'none' as const,
    drawer: null,
  };

  it('shows the map at a readable size, centered on the player', () => {
    const [map] = compactViews(base);
    expect(map!.name).toBe('map');
    expect(map!.cellHeight).toBe(36);
    const playerX = map!.originX + 60.5 * map!.cellWidth;
    const freeCenter = 260 + (1688 - 260 - 300) / 2;
    expect(Math.abs(playerX - freeCenter)).toBeLessThanOrEqual(map!.cellWidth);
  });

  it('lifts menus into a dimmed, modal sheet that dismisses on outside taps', () => {
    const overlay = { x: 55, y: 4, width: 44, height: 9 };
    const views = compactViews({ ...base, overlay, overlayKind: 'sheet' });
    const sheet = views.find((view) => view.name === 'sheet')!;
    expect(views[0]!.dim).toBeGreaterThan(0.5);
    expect(sheet.src).toEqual(overlay);
    expect(sheet.cellHeight).toBeGreaterThan(36);
    expect(hitTest(views, sheet.x + 1, sheet.y + 1)).toMatchObject({
      kind: 'cell',
      x: 55,
      y: 4,
      view: 'sheet',
    });
    expect(hitTest(views, 5, 400)).toEqual({ kind: 'dismiss', view: 'sheet' });
  });

  it('extends large screens into the message area but leaves small boxes alone', () => {
    expect(sheetSource({ x: 55, y: 3, width: 44, height: 9 })).toEqual({ x: 55, y: 3, width: 44, height: 9 });
    expect(sheetSource({ x: 21, y: 3, width: 79, height: 29 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 32,
    });
  });

  it('places a description card away from where the player is looking', () => {
    const overlay = { x: 30, y: 5, width: 30, height: 8 };
    const low = compactViews({ ...base, overlay, overlayKind: 'peek', focus: { x: 60, y: 30 } });
    const high = compactViews({
      ...base,
      overlay,
      overlayKind: 'peek',
      focus: { x: 60, y: 4 },
      player: { x: 60, y: 4 },
    });
    const cardLow = low.find((view) => view.name === 'peek')!;
    const cardHigh = high.find((view) => view.name === 'peek')!;
    expect(cardLow.y).toBeLessThan(cardHigh.y);
    expect(cardLow.modal).toBe(false);
  });
});

describe('description card placement', () => {
  const base = {
    width: 1688,
    height: 780,
    dpr: 2,
    band: 90,
    insets: { top: 0, right: 300, bottom: 0, left: 260 },
    mapCellCss: 18,
    pan: { x: 0, y: 0 },
    overlay: { x: 30, y: 5, width: 34, height: 10 },
    overlayKind: 'peek' as const,
    drawer: null,
  };
  const at = (views: ReturnType<typeof compactViews>, cell: { x: number; y: number }) => {
    const map = views[0]!;
    return {
      x: map.originX + (cell.x + 0.5) * map.cellWidth,
      y: map.originY + (cell.y + 0.5) * map.cellHeight,
    };
  };
  const inside = (
    view: { x: number; y: number; width: number; height: number },
    p: { x: number; y: number },
  ) => p.x >= view.x && p.x <= view.x + view.width && p.y >= view.y && p.y <= view.y + view.height;

  it('never covers the player or the monster being described', () => {
    for (const [player, look] of [
      [
        { x: 60, y: 20 },
        { x: 64, y: 17 },
      ],
      [
        { x: 40, y: 10 },
        { x: 45, y: 26 },
      ],
      [
        { x: 80, y: 28 },
        { x: 30, y: 6 },
      ],
    ] as const) {
      const views = compactViews({ ...base, player, focus: look });
      const card = views.find((view) => view.name === 'peek')!;
      expect(inside(card, at(views, player))).toBe(false);
      expect(inside(card, at(views, look))).toBe(false);
    }
  });

  it('keeps description text compact', () => {
    const views = compactViews({ ...base, player: { x: 60, y: 20 }, focus: null });
    expect(views.find((view) => view.name === 'peek')!.cellHeight).toBeLessThanOrEqual(18 * 2);
  });
});

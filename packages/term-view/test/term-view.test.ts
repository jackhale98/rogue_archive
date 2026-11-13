import { describe, expect, it } from 'vitest';
import { findText, fittedView, followView, hitTest, rowText, type Grid } from '../src/index.ts';

/** A grid from text rows (colour 1 everywhere). */
function grid(lines: string[], cols = 40): Grid {
  const cells = new Uint8Array(cols * lines.length * 2);
  lines.forEach((line, y) => {
    for (let x = 0; x < cols; x++) {
      cells[(y * cols + x) * 2] = (line[x] ?? ' ').charCodeAt(0);
      cells[(y * cols + x) * 2 + 1] = 1;
    }
  });
  return { cols, rows: lines.length, cells };
}

describe('views', () => {
  it('fits a region into a box, centred, with whole-pixel cells', () => {
    const view = fittedView(
      'screen',
      { x: 0, y: 0, width: 80, height: 24 },
      { x: 0, y: 0, width: 1000, height: 600 },
    );
    expect(view.cellHeight).toBe(20);
    expect(view.cellWidth).toBe(12);
    expect(view.width).toBe(960);
    expect(view.x).toBe(20);
    expect(view.originY).toBe(view.y);
  });

  it('follows a focus cell and never scrolls past the edges', () => {
    const src = { x: 13, y: 1, width: 67, height: 22 };
    const area = { x: 0, y: 0, width: 300, height: 300 };
    const centred = followView('map', src, area, 20, { x: 40, y: 12 });
    // The focus cell is in the middle of the area.
    expect(centred.originX + 40 * centred.cellWidth + centred.cellWidth / 2).toBeCloseTo(150, -1);
    const corner = followView('map', src, area, 20, { x: 13, y: 1 });
    // At the map's corner the first cell sits at the area's corner.
    expect(corner.originX + 13 * corner.cellWidth).toBe(0);
    expect(corner.originY + 1 * corner.cellHeight).toBe(0);
  });

  it('hit-tests cells, and modal views report taps outside them', () => {
    const map = fittedView(
      'map',
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 100, height: 200 },
    );
    const sheet = {
      ...fittedView('sheet', { x: 0, y: 0, width: 4, height: 2 }, { x: 0, y: 0, width: 40, height: 40 }),
      modal: true,
    };
    expect(hitTest([map], map.x + 1, map.y + 1)).toEqual({ kind: 'cell', x: 0, y: 0, view: 'map' });
    expect(hitTest([map, sheet], 90, 190)).toEqual({ kind: 'dismiss', view: 'sheet' });
    expect(hitTest([map], -5, -5)).toBeNull();
  });
});

describe('text helpers', () => {
  it('reads a row', () => {
    expect(rowText(grid(['  a) Tutorial'], 20), 0).trimEnd()).toBe('  a) Tutorial');
  });

  it('finds text drawn over a map, ignoring map symbols', () => {
    const g = grid([
      '#....#..........',
      '#.@..#  a) Fragments of Lembas',
      '#....#  b) Wooden Torches',
      '######..........',
    ]);
    const text = findText(g, { x: 0, y: 0, width: 40, height: 4 }, 2);
    expect(text).toEqual({ x: 11, y: 1, width: 19, height: 2 });
    expect(findText(grid(['#.@..#', '######']), { x: 0, y: 0, width: 40, height: 2 })).toBeNull();
  });
});

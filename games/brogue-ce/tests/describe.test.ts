import { describe, expect, it } from 'vitest';
import { readDescription } from '../adapter/describe.ts';
import { COLS, ROWS } from '../adapter/constants.ts';

function screen(lines: [number, number, string, number[]?][]): Uint8Array {
  const cells = new Uint8Array(COLS * ROWS * 8);
  for (const [x, y, text, rgb = [230, 230, 230]] of lines) {
    for (let i = 0; i < text.length; i++) {
      const offset = (y * COLS + x + i) * 8;
      cells[offset] = text.charCodeAt(i);
      cells[offset + 2] = rgb[0]!;
      cells[offset + 3] = rgb[1]!;
      cells[offset + 4] = rgb[2]!;
    }
  }
  return cells;
}

describe('readDescription', () => {
  it('re-flows wrapped lines into paragraphs and keeps colors', () => {
    const cells = screen([
      [50, 6, '     The jackal prowls the caverns for'],
      [50, 7, 'intruders to rend with its powerful jaws.'],
      [50, 8, '     The jackal has a 44% chance to hit you,', [230, 100, 100]],
      [50, 9, 'typically hits for 10% of your current health.', [230, 100, 100]],
    ]);
    const description = readDescription(cells, { x: 48, y: 4, width: 50, height: 8 });
    const texts = description.paragraphs.map((p) => p.map((run) => run.text).join(''));
    expect(texts).toEqual([
      'The jackal prowls the caverns for intruders to rend with its powerful jaws.',
      'The jackal has a 44% chance to hit you, typically hits for 10% of your current health.',
    ]);
    expect(description.paragraphs[1]![0]!.color).toBe('rgb(230,100,100)');
    expect(description.title).toMatch(/^The jackal prowls/);
  });

  it('treats blank lines as paragraph breaks and titles the box with its first line', () => {
    const cells = screen([
      [30, 5, 'A dagger <12>', [230, 230, 100]],
      [30, 7, 'A simple iron dagger with a'],
      [30, 8, 'well-worn wooden handle.'],
    ]);
    const description = readDescription(cells, { x: 28, y: 3, width: 40, height: 8 });
    expect(description.title).toBe('A dagger <12>');
    expect(description.paragraphs.map((p) => p.map((run) => run.text).join(''))).toEqual([
      'A dagger <12>',
      'A simple iron dagger with a well-worn wooden handle.',
    ]);
  });

  it('gives different boxes different keys', () => {
    const a = readDescription(screen([[30, 5, 'A dagger']]), { x: 28, y: 3, width: 20, height: 5 });
    const b = readDescription(screen([[30, 5, 'A sword']]), { x: 28, y: 3, width: 20, height: 5 });
    expect(a.key).not.toBe(b.key);
  });
});

describe('translucent boxes', () => {
  it('drops map glyphs showing through the gaps', () => {
    const before = screen([[30, 7, '#####~~~~~']]);
    const cells = screen([[30, 7, '#####~~~~~']]);
    for (const [i, c] of [...'suit'].entries()) {
      const offset = (7 * COLS + 31 + i) * 8;
      cells[offset] = c.charCodeAt(0);
    }
    const description = readDescription(cells, { x: 28, y: 5, width: 20, height: 5 }, before);
    expect(description.paragraphs.map((p) => p.map((run) => run.text).join(''))).toEqual(['suit']);
  });
});

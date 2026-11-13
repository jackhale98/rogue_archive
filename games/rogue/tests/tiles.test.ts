import { describe, expect, it } from 'vitest';
import oneBit from '../tiles/one-bit.json';
import rlTiles from '../tiles/tiles.json';

/** Every symbol Rogue draws on the map: terrain, items and the 26 monsters. */
const MAP_SYMBOLS = [...'@.#-|+%^:!?/=])*,ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

describe('tile mappings', () => {
  it('RLTiles maps every map symbol', () => {
    expect(Object.keys(rlTiles.symbols).sort()).toEqual([...MAP_SYMBOLS].sort());
  });

  it('1-Bit maps every map symbol to a tile inside the 48x22 sheet', () => {
    expect(Object.keys(oneBit.symbols).sort()).toEqual([...MAP_SYMBOLS].sort());
    const tiles: { at: number[]; tint?: string }[] = [oneBit.floor, ...Object.values(oneBit.symbols)];
    for (const tile of tiles) {
      const [row, column] = tile.at;
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(22);
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(48);
      if (tile.tint) expect(tile.tint).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

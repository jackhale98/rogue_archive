// SPDX-License-Identifier: BSD-3-Clause
/**
 * The map's symbols drawn as pictures, in two styles:
 *
 * - Display: Tiles: one file per symbol from the CC0 export of Dungeon Crawl
 *   Stone Soup's tiles (based on the public-domain RLTiles); tiles/tiles.json
 *   maps each symbol to a file.
 * - Display: 1-Bit: Kenney's 1-Bit Pack (CC0), one sheet the page cuts up;
 *   tiles/one-bit.json gives each symbol's place in it and an optional tint.
 *
 * scripts/build.sh ships the files; each is checked against the runtime
 * manifest before use. Rogue shows only an item's class ("!" is any potion),
 * so each class has one picture. Monsters and items stand on a floor tile.
 */
import type { RuntimeFile } from '@rogue-archive/game-api';
import rlTiles from '../tiles/tiles.json';
import oneBit from '../tiles/one-bit.json';

export type TileStyle = 'tiles' | 'one-bit';

/** Symbols that are terrain themselves (no floor drawn under them). */
const TERRAIN = new Set(['.', '#', '-', '|', '+', '%']);

export interface TileSet {
  /** The images for a symbol (floor first where it stands on one), or null to draw the glyph. */
  images(code: number): readonly CanvasImageSource[] | null;
}

async function verifiedImage(url: string, file: RuntimeFile): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${file.path} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256) throw new Error(`${file.path} failed its integrity check.`);
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

class SymbolTiles implements TileSet {
  readonly #bySymbol = new Map<number, readonly CanvasImageSource[]>();

  constructor(floor: CanvasImageSource | undefined, symbols: Iterable<[string, CanvasImageSource]>) {
    for (const [symbol, image] of symbols) {
      const layers = floor && !TERRAIN.has(symbol) ? [floor, image] : [image];
      this.#bySymbol.set(symbol.charCodeAt(0), layers);
    }
  }

  images(code: number): readonly CanvasImageSource[] | null {
    return this.#bySymbol.get(code) ?? null;
  }
}

/** Display: Tiles (RLTiles): one file per symbol. */
async function loadRlTiles(files: readonly RuntimeFile[], baseUrl: string): Promise<TileSet> {
  const wanted = new Set([rlTiles.floor, ...Object.values(rlTiles.symbols)]);
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    files
      .filter((file) => file.path.startsWith('tiles/') && wanted.has(file.path.slice('tiles/'.length)))
      .map(async (file) => {
        images.set(
          file.path.slice('tiles/'.length),
          await verifiedImage(new URL(file.path, baseUrl).href, file),
        );
      }),
  );
  const symbols: [string, CanvasImageSource][] = [];
  for (const [symbol, path] of Object.entries(rlTiles.symbols)) {
    const image = images.get(path);
    if (image) symbols.push([symbol, image]);
  }
  return new SymbolTiles(images.get(rlTiles.floor), symbols);
}

interface SheetTile {
  at: readonly number[];
  tint?: string;
}

/** One tile cut from the sheet, its opaque pixels recoloured if it has a tint. */
function cutTile(sheet: ImageBitmap, tile: SheetTile, size: number): CanvasImageSource {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas for the tiles.');
  const [row = 0, column = 0] = tile.at;
  context.drawImage(sheet, column * size, row * size, size, size, 0, 0, size, size);
  if (tile.tint) {
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = tile.tint;
    context.fillRect(0, 0, size, size);
  }
  return canvas;
}

/** Display: 1-Bit (Kenney's 1-Bit Pack): one sheet, cut and tinted here. */
async function loadOneBit(files: readonly RuntimeFile[], baseUrl: string): Promise<TileSet> {
  const path = `tiles/one-bit/${oneBit.sheet}`;
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`${path} is not in the runtime manifest.`);
  const sheet = await verifiedImage(new URL(file.path, baseUrl).href, file);
  const symbols = Object.entries(oneBit.symbols as Record<string, SheetTile>).map(
    ([symbol, tile]): [string, CanvasImageSource] => [symbol, cutTile(sheet, tile, oneBit.size)],
  );
  return new SymbolTiles(cutTile(sheet, oneBit.floor, oneBit.size), symbols);
}

/** Downloads and checks a tile style's files (listed in the runtime manifest). */
export function loadTiles(
  style: TileStyle,
  files: readonly RuntimeFile[],
  baseUrl: string,
): Promise<TileSet> {
  return style === 'one-bit' ? loadOneBit(files, baseUrl) : loadRlTiles(files, baseUrl);
}

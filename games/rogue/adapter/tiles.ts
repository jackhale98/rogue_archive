// SPDX-License-Identifier: BSD-3-Clause
/**
 * Display: Tiles. Rogue's map symbols drawn with tiles from the CC0 export of
 * Dungeon Crawl Stone Soup's tiles (based on the public-domain RLTiles);
 * tiles/tiles.json maps each symbol to a file, scripts/build.sh ships them.
 *
 * Rogue shows only an item's class ("!" is any potion), so each class has
 * one picture. Monsters and items stand on a floor tile.
 */
import type { RuntimeFile } from '@rogue-archive/game-api';
import mapping from '../tiles/tiles.json';

/** Symbols that are terrain themselves (no floor drawn under them). */
const TERRAIN = new Set(['.', '#', '-', '|', '+', '%']);

async function verifiedImage(url: string, file: RuntimeFile): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${file.path} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256) throw new Error(`${file.path} failed its integrity check.`);
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

export class RogueTiles {
  readonly #bySymbol = new Map<number, readonly CanvasImageSource[]>();

  private constructor(images: Map<string, ImageBitmap>) {
    const floor = images.get(mapping.floor);
    for (const [symbol, path] of Object.entries(mapping.symbols)) {
      const image = images.get(path);
      if (!image) continue;
      const layers = floor && !TERRAIN.has(symbol) ? [floor, image] : [image];
      this.#bySymbol.set(symbol.charCodeAt(0), layers);
    }
  }

  /** Downloads and checks the tiles the runtime manifest lists. */
  static async load(files: readonly RuntimeFile[], baseUrl: string): Promise<RogueTiles> {
    const wanted = new Set([mapping.floor, ...Object.values(mapping.symbols)]);
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
    return new RogueTiles(images);
  }

  /** The images for a symbol (floor first where it stands on one), or null to draw the glyph. */
  images(code: number): readonly CanvasImageSource[] | null {
    return this.#bySymbol.get(code) ?? null;
  }
}

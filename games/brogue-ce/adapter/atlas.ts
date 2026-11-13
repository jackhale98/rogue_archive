// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Builds a glyph/tile mask atlas sized exactly to the current cell size.
 *
 * Brogue CE ships one high-resolution grayscale sheet (tiles.png: 16x24
 * sprites of 128x232 px) and its SDL renderer downscales each sprite to the
 * window's cell size in linear light. We do the same here so the browser
 * version keeps the desktop look at any size, then tint each cell on the GPU
 * with Brogue's per-cell foreground and background colors.
 *
 * Simplifications versus upstream tiles.c (documented in PORTING.md): no
 * sub-pixel sharpening search, no text baseline snapping, no animated wall-top
 * waves. Fit/stretch rules per sprite follow upstream's TileProcessing table.
 */
import { SHEET, TILE_PROCESSING } from './constants.ts';

export interface SourceSheet {
  /** 8-bit luminance per source pixel (the sheet is grayscale). ~11 MB, kept for re-layouts. */
  luminance: Uint8Array;
  width: number;
  height: number;
}

export async function decodeSheet(png: Blob): Promise<SourceSheet> {
  const bitmap = await createImageBitmap(png);
  if (bitmap.width !== SHEET.width || bitmap.height !== SHEET.height) {
    throw new Error(`Unexpected tile sheet size ${bitmap.width}x${bitmap.height}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const luminance = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < luminance.length; i++, p += 4) luminance[i] = rgba[p]!; // R == G == B
  // Release the large canvas backing store promptly (matters on mobile).
  canvas.width = 0;
  canvas.height = 0;
  return { luminance, width: SHEET.width, height: SHEET.height };
}

/** Where a sprite is drawn inside a cell, in target pixels. */
export function glyphRect(
  mode: string,
  cellWidth: number,
  cellHeight: number,
): [number, number, number, number] {
  if (mode === 's') return [0, 0, cellWidth, cellHeight];
  const maxStretch = mode === 'f' ? 1.2 : 1.4;
  const aspect = SHEET.tileWidth / SHEET.tileHeight;
  let w: number;
  let h: number;
  if (cellWidth / cellHeight > aspect) {
    h = cellHeight;
    w = Math.min(cellWidth, cellHeight * aspect * maxStretch);
  } else {
    w = cellWidth;
    h = Math.min(cellHeight, (cellWidth / aspect) * maxStretch);
  }
  return [(cellWidth - w) / 2, (cellHeight - h) / 2, w, h];
}

/**
 * Returns a single-channel atlas (SHEET.cols * cellWidth by SHEET.rows * cellHeight)
 * where each byte is the sprite's coverage at that pixel.
 */
export function buildAtlas(sheet: SourceSheet, cellWidth: number, cellHeight: number): Uint8Array {
  const atlasWidth = SHEET.cols * cellWidth;
  const out = new Uint8Array(atlasWidth * SHEET.rows * cellHeight);
  const acc = new Float32Array(cellWidth * cellHeight);
  const mapX = new Int32Array(SHEET.tileWidth);
  const mapY = new Int32Array(SHEET.tileHeight);
  // Linear-light approximation with gamma 2, as upstream tiles.c does.
  const linear = new Float32Array(256);
  for (let v = 0; v < 256; v++) linear[v] = (v / 255) ** 2;

  for (let row = 0; row < SHEET.rows; row++) {
    for (let col = 0; col < SHEET.cols; col++) {
      const mode = TILE_PROCESSING[row]![col]!;
      const [gx, gy, gw, gh] = glyphRect(mode, cellWidth, cellHeight);
      for (let sx = 0; sx < SHEET.tileWidth; sx++)
        mapX[sx] = Math.floor(gx + ((sx + 0.5) * gw) / SHEET.tileWidth);
      for (let sy = 0; sy < SHEET.tileHeight; sy++)
        mapY[sy] = Math.floor(gy + ((sy + 0.5) * gh) / SHEET.tileHeight);
      // Source pixels that land on one target pixel when the glyph fills it.
      const samplesPerPixel = (SHEET.tileWidth / gw) * (SHEET.tileHeight / gh);

      acc.fill(0);
      const originX = col * SHEET.tileWidth;
      const originY = row * SHEET.tileHeight;
      for (let sy = 0; sy < SHEET.tileHeight; sy++) {
        const ty = mapY[sy]!;
        if (ty < 0 || ty >= cellHeight) continue;
        const srcRow = (originY + sy) * sheet.width + originX;
        const accRow = ty * cellWidth;
        for (let sx = 0; sx < SHEET.tileWidth; sx++) {
          const byte = sheet.luminance[srcRow + sx]!;
          if (byte === 0) continue;
          const v = linear[byte]!;
          const tx = mapX[sx]!;
          if (tx >= 0 && tx < cellWidth) acc[accRow + tx]! += v;
        }
      }

      const baseX = col * cellWidth;
      const baseY = row * cellHeight;
      for (let ty = 0; ty < cellHeight; ty++) {
        for (let tx = 0; tx < cellWidth; tx++) {
          const coverage = Math.min(1, Math.sqrt(acc[ty * cellWidth + tx]! / samplesPerPixel));
          out[(baseY + ty) * atlasWidth + baseX + tx] = Math.round(coverage * 255);
        }
      }
    }
  }
  return out;
}

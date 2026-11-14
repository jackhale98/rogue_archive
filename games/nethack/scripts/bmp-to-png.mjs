// SPDX-License-Identifier: MIT
// Converts the 8-bit (palette) BMP that NetHack's own tile2bmp writes into an
// indexed PNG with the same pixels, cropped to whole 16x16 tiles from the top.
// The tiles' background colour (71,108,108 in win/share/*.txt, which window
// ports treat as the background) becomes transparent.
// Usage: node bmp-to-png.mjs <in.bmp> <out.png>
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { deflateSync } from 'node:zlib';

const [input, output] = process.argv.slice(2);
const bmp = readFileSync(input);
if (bmp.toString('latin1', 0, 2) !== 'BM') throw new Error(`${input} is not a BMP`);
const offset = bmp.readUInt32LE(10);
const headerSize = bmp.readUInt32LE(14);
const width = bmp.readInt32LE(18);
const rawHeight = bmp.readInt32LE(22);
const bits = bmp.readUInt16LE(28);
const compression = bmp.readUInt32LE(30);
if (bits !== 8 || compression !== 0) throw new Error(`expected an uncompressed 8-bit BMP, got ${bits} bits`);
const colors = bmp.readUInt32LE(46) || 256;
const bottomUp = rawHeight > 0;
const height = Math.abs(rawHeight);
const stride = Math.ceil(width / 4) * 4;
// tile2bmp's rows of tiles start at the top of the image.
const rows = Math.floor(height / 16) * 16;

const palette = Buffer.alloc(colors * 3);
for (let i = 0; i < colors; i++) {
  const p = 14 + headerSize + i * 4; // BGRA
  palette[i * 3] = bmp[p + 2];
  palette[i * 3 + 1] = bmp[p + 1];
  palette[i * 3 + 2] = bmp[p];
}
const alpha = Buffer.alloc(colors, 255);
for (let i = 0; i < colors; i++)
  if (palette[i * 3] === 71 && palette[i * 3 + 1] === 108 && palette[i * 3 + 2] === 108) alpha[i] = 0;
const raw = Buffer.alloc((width + 1) * rows);
for (let y = 0; y < rows; y++) {
  const src = offset + (bottomUp ? height - 1 - y : y) * stride;
  raw[y * (width + 1)] = 0; // filter: none
  bmp.copy(raw, y * (width + 1) + 1, src, src + width);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(rows, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 3; // indexed colour
writeFileSync(
  output,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', palette),
    chunk('tRNS', alpha),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
process.stdout.write(`${output}: ${width}x${rows}, ${(width / 16) * (rows / 16)} tile slots\n`);

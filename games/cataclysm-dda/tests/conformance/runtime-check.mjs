// SPDX-License-Identifier: CC-BY-SA-3.0
// Checks the built runtime (games/cataclysm-dda/dist): the WebAssembly module
// exports the page's interface (port/rogue-archive-web.cpp), and the data
// package holds what upstream's web bundle holds (build-scripts/
// prepare-web.sh) with only the shipped tilesets (LICENSES.md).
// Usage: node runtime-check.mjs <dist>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const dist = process.argv[2];
const problems = [];

const manifest = JSON.parse(readFileSync(join(dist, 'runtime-manifest.json'), 'utf8'));
const size = (path) => manifest.files.find((file) => file.path === path)?.size;
for (const path of ['cataclysm-tiles.mjs', 'cataclysm-tiles.wasm', 'cataclysm-data.data.gzip'])
  if (!size(path)) problems.push(`runtime-manifest.json lists no ${path}`);

const wasm = await WebAssembly.compile(readFileSync(join(dist, 'cataclysm-tiles.wasm')));
const exports = new Set(WebAssembly.Module.exports(wasm).map((entry) => entry.name));
for (const name of ['main', 'ra_state', 'ra_screen_text', 'ra_messages', 'ra_message_count', 'ra_stop'])
  if (!exports.has(name)) problems.push(`the module does not export ${name}`);

// The file packager's metadata is in the glue (--pre-js): every packaged path.
const glue = readFileSync(join(dist, 'cataclysm-tiles.mjs'), 'utf8');
const files = [...glue.matchAll(/"filename":\s*"([^"]+)"/g)].map((match) => match[1]);
const has = (prefix) => files.some((file) => file.startsWith(prefix));
for (const prefix of [
  '/data/core/',
  '/data/json/',
  '/data/mods/dda/',
  '/data/mods/Magiclysm/',
  '/data/font/Terminus.ttf',
  '/data/raw/keybindings.json',
  '/data/names/',
  '/data/motd/',
  '/data/credits/',
  '/data/title/',
  '/data/fontdata.json',
  '/gfx/UltimateCataclysm/tile_config.json',
  '/gfx/Larwick_Overmap/tile_config.json',
])
  if (!has(prefix)) problems.push(`the data package lacks ${prefix}`);
for (const prefix of [
  '/data/mods/MA/',
  '/data/mods/TEST_DATA/',
  '/data/mods/Aftershock/',
  '/gfx/Ultica_iso/',
  '/gfx/MshockXotto+/',
  '/lang/',
])
  if (has(prefix)) problems.push(`the data package should not hold ${prefix}`);

const data = gunzipSync(readFileSync(join(dist, 'cataclysm-data.data.gzip')));

if (problems.length > 0) {
  console.error(`Cataclysm: DDA runtime: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
console.log(
  `Cataclysm: DDA runtime: ${exports.size} exports include the page's interface; ${files.length} data files ` +
    `(${mb(data.length)} LZ4 package, ${mb(size('cataclysm-data.data.gzip'))} sent); ` +
    `module ${mb(size('cataclysm-tiles.wasm'))}, glue ${mb(size('cataclysm-tiles.mjs'))}`,
);

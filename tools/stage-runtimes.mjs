#!/usr/bin/env node
// Copies each built game runtime (games/<id>/dist) into the web app's public
// directory as runtime/<id>/<buildId>/..., and writes runtime/<id>/runtime-manifest.json
// pointing at it. Build directories are immutable and content-addressed, so
// they can be cached forever; the small manifest is always revalidated.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(join(root, 'games/catalog.json'), 'utf8'));
const outRoot = join(root, 'apps/web/public/runtime');
const strict = process.argv.includes('--strict');
let missing = 0;

for (const game of catalog.games) {
  if (!game.runtimeManifest) continue;
  const dist = join(root, 'games', game.id, 'dist');
  const manifestPath = join(dist, 'runtime-manifest.json');
  if (!existsSync(manifestPath)) {
    console.warn(`! ${game.id}: no runtime build at ${manifestPath} (run its build script).`);
    missing++;
    continue;
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.gameId !== game.id)
    throw new Error(`${manifestPath} is for ${manifest.gameId}, not ${game.id}`);

  // Verify every file against the manifest before publishing it.
  for (const file of manifest.files) {
    const bytes = await readFile(join(dist, file.path));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== file.sha256 || bytes.length !== file.size) {
      throw new Error(`${game.id}: ${file.path} does not match runtime-manifest.json; rebuild the game.`);
    }
  }

  const gameOut = join(outRoot, game.id);
  await rm(gameOut, { recursive: true, force: true });
  await mkdir(join(gameOut, manifest.buildId), { recursive: true });
  for (const entry of await readdir(dist)) {
    if (entry === 'runtime-manifest.json') continue;
    await cp(join(dist, entry), join(gameOut, manifest.buildId, entry), { recursive: true });
  }
  await writeFile(
    join(gameOut, 'runtime-manifest.json'),
    JSON.stringify({ ...manifest, baseUrl: `${manifest.buildId}/` }, null, 2) + '\n',
  );
  const size = manifest.files.reduce((sum, file) => sum + file.size, 0);
  console.log(`✓ ${game.id}: build ${manifest.buildId} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

if (missing && strict) {
  console.error(`${missing} launchable game(s) have no runtime build.`);
  process.exit(1);
}

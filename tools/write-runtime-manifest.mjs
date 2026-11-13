#!/usr/bin/env node
// Writes runtime-manifest.json for a built game runtime directory: every file
// with its size and SHA-256, plus pinned provenance. The web app refuses to
// load runtime files that are not listed here.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    game: { type: 'string' },
    'upstream-repo': { type: 'string' },
    'upstream-tag': { type: 'string' },
    'upstream-commit': { type: 'string' },
    toolchain: { type: 'string' },
  },
});
for (const key of ['dir', 'game', 'upstream-repo', 'upstream-tag', 'upstream-commit', 'toolchain']) {
  if (!values[key]) throw new Error(`missing --${key}`);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name !== 'runtime-manifest.json') out.push(full);
  }
  return out.sort();
}

const files = [];
const total = createHash('sha256');
for (const full of await walk(values.dir)) {
  const bytes = await readFile(full);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = relative(values.dir, full).split('\\').join('/');
  total.update(`${path}\0${sha256}\n`);
  files.push({ path, size: (await stat(full)).size, sha256 });
}

const manifest = {
  schemaVersion: 1,
  gameId: values.game,
  // Content hash of the whole runtime; used as the immutable deploy directory.
  buildId: total.digest('hex').slice(0, 16),
  upstream: {
    repository: values['upstream-repo'],
    tag: values['upstream-tag'],
    commit: values['upstream-commit'],
  },
  toolchain: values.toolchain,
  files,
};
await writeFile(join(values.dir, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`runtime-manifest.json: ${files.length} files, buildId ${manifest.buildId}`);

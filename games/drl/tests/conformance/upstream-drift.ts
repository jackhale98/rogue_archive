// SPDX-License-Identifier: GPL-2.0-only
// Upstream drift: the upstream files the port copies from or relies on, by
// SHA-256 (drift.json). When upstream changes one, this names it and what to
// re-review; after reviewing, `--update` records the new hashes.
// Usage: node --experimental-strip-types upstream-drift.ts <drl checkout> <fpcvalkyrie checkout> [--update]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Entry {
  sha256: string;
  review: string;
}

const [drlRoot, valkyrieRoot, flag] = process.argv.slice(2);
if (!drlRoot || !valkyrieRoot) throw new Error('usage: upstream-drift.ts <drl> <fpcvalkyrie> [--update]');
const recordPath = join(dirname(fileURLToPath(import.meta.url)), 'drift.json');
const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, Entry>;
const roots: Record<string, string> = { drl: drlRoot, fpcvalkyrie: valkyrieRoot };

const changed: string[] = [];
for (const [key, entry] of Object.entries(record)) {
  const [repo, ...rest] = key.split('/');
  const path = join(roots[repo!]!, ...rest);
  const sha256 = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing';
  if (sha256 === entry.sha256) continue;
  changed.push(`${key} (${sha256 === 'missing' ? 'removed' : 'changed'}): ${entry.review}`);
  entry.sha256 = sha256;
}
if (flag === '--update') {
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(changed.length ? `Recorded ${changed.length} new hashes.` : 'No drift.');
} else if (changed.length) {
  console.error(`Upstream drift: re-review, then run with --update\n- ${changed.join('\n- ')}`);
  process.exit(1);
} else {
  console.log(`No upstream drift: ${Object.keys(record).length} files the port relies on are unchanged.`);
}

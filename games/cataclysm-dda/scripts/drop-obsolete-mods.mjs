#!/usr/bin/env node
// Removes the mods upstream's web bundle leaves out (build-scripts/
// prepare-web.sh): every mod whose modinfo.json marks it "obsolete". Usage:
//   node drop-obsolete-mods.mjs <data/mods directory>
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: drop-obsolete-mods.mjs <mods directory>');
for (const entry of readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const info = join(dir, entry.name, 'modinfo.json');
  if (!existsSync(info)) continue;
  const records = JSON.parse(readFileSync(info, 'utf8'));
  // As upstream's `jq '.[] | select(.type == "MOD_INFO") | .obsolete'`.
  const obsolete = (Array.isArray(records) ? records : [records]).some(
    (record) => record.type === 'MOD_INFO' && record.obsolete,
  );
  if (obsolete) {
    console.log(`${entry.name} is obsolete, excluded`);
    rmSync(join(dir, entry.name), { recursive: true });
  }
}

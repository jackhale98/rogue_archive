// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream drift check: the port relies on a few functions of upstream's web
// main file (hyperweb.cpp) and on the emergency save hyperroid makes when it
// goes to the background. If upstream changes any of them, this names what to
// re-review (adapter/index.ts, port/rogue-archive-web.cpp, scripts/build.sh)
// before the fingerprints below are updated.
// Usage: node --experimental-strip-types upstream-drift.ts <upstream-checkout> [--print]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2]!;
const print = process.argv.includes('--print');

/** The text of a C++ function: from its signature to the matching closing brace. */
function functionText(file: string, signature: string): string | null {
  const source = readFileSync(join(root, file), 'utf8');
  const start = source.indexOf(signature);
  if (start < 0) return null;
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

const WATCHED: { file: string; signature: string; why: string; sha256: string }[] = [
  {
    file: 'hyperweb.cpp',
    signature: 'EX void get_canvas_size()',
    why: 'the game sizes itself from the element with id this_wide (adapter/index.ts #layout, ra_resize)',
    sha256: '18084e2363b4ec5fa57ae8634706de9bd569bf0a81ec1b16301a3c9d6265ba51',
  },
  {
    file: 'hyperweb.cpp',
    signature: 'EX void emscripten_get_commandline()',
    why: 'EMSCRIPTEN_FIXED_ARG sets the command line (scripts/build.sh FIXED_ARG)',
    sha256: '01b1beea23ed5b800510e2df1f59457cda8c4cb6417ae85e62315c1f4e083a51',
  },
  {
    file: 'hyperweb.cpp',
    signature: 'EX void initweb()',
    why: 'resize and fullscreen callbacks the adapter removes on exit; the demo menu -noscr turns off',
    sha256: '862714607c9a92e0b23d22c7c142c69b9eb1a50d5b2e24c314d64efc0625409c',
  },
  {
    file: 'hyperroid/app/src/main/jni/hyper.cpp',
    signature: 'Java_com_roguetemple_hyperroid_HyperRogue_keepinmemory',
    why: 'ra_save() makes the same emergency save (port/rogue-archive-web.cpp)',
    sha256: '1d5ca2aa1c71f280ff8da1d175681ae72fb1983cedfb39ade936232b4b988c5e',
  },
];

const problems: string[] = [];
for (const watched of WATCHED) {
  const text = functionText(watched.file, watched.signature);
  if (!text) {
    problems.push(`${watched.file}: ${watched.signature} not found — ${watched.why}`);
    continue;
  }
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (print) console.log(`${watched.signature}: ${sha256}`);
  else if (sha256 !== watched.sha256)
    problems.push(`${watched.file}: ${watched.signature} changed — re-review: ${watched.why}`);
}

if (print) process.exit(0);
if (problems.length > 0) {
  console.error(`HyperRogue upstream drift: ${problems.length} change(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`HyperRogue upstream drift: ${WATCHED.length} watched functions unchanged`);

// Upstream drift check: the port copies a few values from Brogue's source and
// relies on some of its on-screen strings. When a new upstream version changes
// any of them, this fails with a list of exactly what to re-review, instead of
// the port quietly misbehaving.
// Usage: node --experimental-strip-types upstream-drift.ts <upstream-src-dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLS,
  MESSAGE_LINES,
  ROWS,
  SHEET,
  STAT_BAR_WIDTH,
  TILE_PROCESSING,
} from '../../adapter/constants.ts';

const src = process.argv[2]!;
const read = (path: string) => readFileSync(join(src, path), 'utf8');
const here = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
};

// 1. Screen geometry and nutrition thresholds (adapter/constants.ts, adapter/state.ts).
const rogueH = read('src/brogue/Rogue.h');
const define = (name: string) =>
  new RegExp(`#define\\s+${name}\\s+(.+?)\\s*(//.*)?$`, 'm').exec(rogueH)?.[1]?.trim();
check(define('COLS') === String(COLS), `COLS changed to ${define('COLS')} (constants.ts has ${COLS})`);
check(
  define('MESSAGE_LINES') === String(MESSAGE_LINES),
  `MESSAGE_LINES changed (constants.ts has ${MESSAGE_LINES})`,
);
check(
  define('STAT_BAR_WIDTH') === String(STAT_BAR_WIDTH),
  `STAT_BAR_WIDTH changed (constants.ts has ${STAT_BAR_WIDTH})`,
);
check(
  /\(31 \+ MESSAGE_LINES\)/.test(define('ROWS') ?? '') && ROWS === 34,
  `ROWS changed to ${define('ROWS')}`,
);
check(define('STOMACH_SIZE') === '2150', 'STOMACH_SIZE changed: review hungerLabel() in adapter/state.ts');
check(
  define('HUNGER_THRESHOLD') === '(STOMACH_SIZE - 1800)',
  'HUNGER_THRESHOLD changed: review hungerLabel()',
);
check(define('WEAK_THRESHOLD') === '150', 'WEAK_THRESHOLD changed: review hungerLabel()');
check(define('FAINT_THRESHOLD') === '50', 'FAINT_THRESHOLD changed: review hungerLabel()');

// 2. Tile sheet geometry and fit rules (copied from src/platform/tiles.c).
const tilesC = read('src/platform/tiles.c');
for (const [name, value] of [
  ['PNG_WIDTH', SHEET.width],
  ['PNG_HEIGHT', SHEET.height],
  ['TILE_WIDTH', SHEET.tileWidth],
  ['TILE_HEIGHT', SHEET.tileHeight],
  ['TILE_ROWS', SHEET.rows],
  ['TILE_COLS', SHEET.cols],
] as const) {
  const found = new RegExp(`#define\\s+${name}\\s+(\\d+)`).exec(tilesC)?.[1];
  check(found === String(value), `tiles.c ${name} is ${found}, constants.ts SHEET has ${value}`);
}
const processing = /TileProcessing\[TILE_ROWS\]\[TILE_COLS\+1\] = \{([\s\S]*?)\};/.exec(tilesC)?.[1];
const upstreamRows = [...(processing ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check(
  JSON.stringify(upstreamRows) === JSON.stringify(TILE_PROCESSING),
  'tiles.c TileProcessing table changed: update TILE_PROCESSING in constants.ts',
);

// 3. Code copied from sdl2-platform.c into port/rogue-archive-platform.c.
const normalize = (code: string) =>
  code
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
const body = (code: string, signature: RegExp) => {
  const start = code.search(signature);
  if (start < 0) return null;
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return normalize(code.slice(code.indexOf('{', start), i + 1));
  }
  return null;
};
const sdl = read('src/platform/sdl2-platform.c');
const ours = here('../../port/rogue-archive-platform.c');
const sig = /static int fontIndex\(enum displayGlyph glyph\)/;
check(
  body(sdl, sig) !== null && body(sdl, sig) === body(ours, sig),
  'sdl2-platform.c fontIndex() changed: re-copy it into port/rogue-archive-platform.c',
);

// 4. The platform interface we implement.
const platformH = read('src/platform/platform.h');
const consoleStruct = /struct brogueConsole \{([\s\S]*?)\n\};/.exec(platformH)?.[1] ?? '';
const members = [...consoleStruct.matchAll(/\(\*(\w+)\)/g)].map((m) => m[1]);
const expected = [
  'gameLoop',
  'pauseForMilliseconds',
  'nextKeyOrMouseEvent',
  'plotChar',
  'remap',
  'modifierHeld',
  'notifyEvent',
  'takeScreenshot',
  'setGraphicsMode',
];
check(
  JSON.stringify(members) === JSON.stringify(expected),
  `struct brogueConsole members changed: ${members.join(', ')}`,
);
const mainC = read('src/platform/main.c');
check(
  /#elif BROGUE_WEB\s+currentConsole = webConsole;/.test(mainC),
  'main.c no longer selects webConsole under BROGUE_WEB: review the console selection in scripts/build.sh',
);

// 5. On-screen strings the context-aware controls look for (adapter/state.ts).
const allSource = ['src/brogue/IO.c', 'src/brogue/Items.c'].map(read).join('\n');
check(allSource.includes('--MORE--'), 'The "--MORE--" prompt text changed: review detectContext()');
check(
  /where\? \(<hjklyubn>, mouse, or <tab>\)/.test(allSource),
  'The targeting prompt changed: review the "<tab>" check in detectContext()',
);
// confirm() draws "Yes"/"No" with the first letter highlighted: "%sY%ses" / "%sN%so".
check(
  allSource.includes('%sY%ses') && allSource.includes('%sN%so'),
  'confirm() button labels changed: review the yes/no check in detectContext()',
);

if (problems.length) {
  console.error('Upstream changed things the port depends on. Review each before updating the pin:');
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(
  '✓ upstream drift: geometry, tile rules, copied code, platform interface and prompt strings unchanged',
);

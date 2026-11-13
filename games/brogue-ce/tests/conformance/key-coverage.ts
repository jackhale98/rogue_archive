// Source-driven input check: every key code that upstream Brogue defines in
// Rogue.h must be producible by our keyboard mapping. Printable ASCII comes
// straight from the key; everything else must have an explicit mapping.
// Usage: node --experimental-strip-types key-coverage.ts <upstream-src-dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyToBrogue } from '../../adapter/input.ts';

const rogueH = readFileSync(join(process.argv[2]!, 'src/brogue/Rogue.h'), 'utf8');
const start = rogueH.indexOf('// Keyboard commands:');
const end = rogueH.indexOf('#define min(');
const block = rogueH.slice(start, end);

// Upstream codes that no desktop platform sends, with the reason.
const NOT_SENT: Record<string, string> = {
  SHIFT_TAB_KEY:
    'Cocoa-only alias; Brogue treats it exactly like TAB_KEY, which we send with the shift flag (as SDL does).',
  UNKNOWN_KEY: 'Internal placeholder used by the recording format.',
};

const DOM_CANDIDATES = [
  'Escape',
  'Enter',
  'Backspace',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
];
const none = { shift: false, ctrl: false, alt: false, meta: false };
const producible = new Set<number>();
for (const key of DOM_CANDIDATES) {
  const event = keyToBrogue({ type: 'key', key, code: key, modifiers: none });
  if (event) producible.add(event[1]);
}
for (let c = 32; c < 127; c++) {
  const event = keyToBrogue({ type: 'key', key: String.fromCharCode(c), code: '', modifiers: none });
  if (event) producible.add(event[1]);
}

/** Parses a C character literal ('k', ' ', '\\', '\t', '\033'), a number, or (a + b). */
function parseValue(raw: string): number | null {
  const literal = /^'(.*)'$/.exec(raw);
  if (literal) {
    const body = literal[1]!;
    if (body.length === 1) return body.charCodeAt(0);
    if (/^\\[0-7]{1,3}$/.test(body)) return parseInt(body.slice(1), 8);
    const escapes: Record<string, number> = { '\\t': 9, '\\n': 10, '\\\\': 92, "\\'": 39 };
    return escapes[body] ?? null;
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  const sum = /^\((\d+)\s*\+\s*(\d+)\)$/.exec(raw);
  return sum ? Number(sum[1]) + Number(sum[2]) : null;
}

let checked = 0;
const problems: string[] = [];
for (const match of block.matchAll(/^#define\s+(\w+)\s+('(?:\\.|[^'\\])*'|\S+)/gm)) {
  const [, name, raw] = match as unknown as [string, string, string];
  if (!/_KEY$|_ARROW$|^NUMPAD_\d$/.test(name)) continue;
  const value = parseValue(raw);
  if (value === null) {
    problems.push(`${name}: could not parse value ${raw}`);
    continue;
  }
  checked++;
  if (NOT_SENT[name]) continue;
  if (!producible.has(value)) problems.push(`${name} (${value}) cannot be produced by keyToBrogue`);
}

if (checked < 50) problems.push(`only parsed ${checked} key definitions; did Rogue.h change shape?`);
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(
  `✓ key coverage: all ${checked} upstream key codes are reachable (${Object.keys(NOT_SENT).length} documented exceptions)`,
);

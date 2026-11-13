// SPDX-License-Identifier: GPL-2.0-or-later
// Replays tests/conformance/scenarios.json on the native and WebAssembly
// builds (see scripts/test-engine.sh) and compares every message the game
// sends to the client. Usage: node replay.mjs <native-binary> <node-harness> <data-dir> <work-dir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [native, harness, dataDir, work] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const { scenarios } = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'));

function keyCodes(keys) {
  const codes = [];
  const named = { TAB: 9, ESC: 27, ENTER: 13, SPACE: 32 };
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === '{') {
      const end = keys.indexOf('}', i);
      const name = keys.slice(i + 1, end);
      if (name in named) codes.push(named[name]);
      else if (/^CTRL-[A-Z]$/.test(name)) codes.push(name.charCodeAt(5) - 64);
      else throw new Error(`Unknown key {${name}}`);
      i = end;
    } else codes.push(keys.codePointAt(i));
  }
  return codes.join(',');
}

/**
 * DCSS draws two kinds of randomness that its game seed does not control, by
 * design (rng::UI and pre-seed state): which variant of a tile is shown
 * (tilepick.cc ui_random) and the placeholder title of the not-yet-created
 * player. Those presentation-only fields are ignored; everything else must
 * match, including every map cell's feature, glyph, colour and position.
 */
const PRESENTATION_ONLY = new Set(['t', 'doll', 'tile', 'mcache']);
function strip(value, preGame) {
  if (Array.isArray(value)) return value.map((item) => strip(item, preGame));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRESENTATION_ONLY.has(key)) continue;
    if (preGame && value.msg === 'player' && key === 'title') continue;
    out[key] = strip(item, preGame);
  }
  return out;
}
function normalize(lines) {
  let seenMap = false;
  return lines.map((line) => {
    try {
      const message = JSON.parse(line);
      const normalized = JSON.stringify(strip(message, !seenMap));
      if (line.includes('"msg":"map"')) seenMap = true;
      return normalized;
    } catch {
      return line;
    }
  });
}

let failed = 0;
for (const scenario of scenarios) {
  const args = [
    '-headless',
    '-webtiles-socket',
    '/tmp/ra.sock',
    '-await-connection',
    '-name',
    'Tester',
    '-seed',
    String(scenario.seed),
  ];
  const outputs = {};
  for (const [label, command, prefix] of [
    ['native', native, []],
    ['wasm', process.execPath, [harness]],
  ]) {
    const dir = join(work, `${scenario.name}-${label}`);
    rmSync(dir, { recursive: true, force: true });
    // The native build's save directory is compiled in; start it empty too.
    if (label === 'native' && process.env.RA_NATIVE_SAVES)
      rmSync(process.env.RA_NATIVE_SAVES, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const out = join(dir, 'messages.jsonl');
    const result = spawnSync(command, [...prefix, ...args], {
      cwd: dir,
      env: {
        ...process.env,
        LC_ALL: 'C.UTF-8',
        RA_REPLAY_KEYS: keyCodes(scenario.keys),
        RA_REPLAY_OUT: out,
        RA_DATA_DIR: dataDir,
      },
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
    });
    if (result.status !== 0) {
      console.error(
        `✗ ${scenario.name}: ${label} exited with ${result.status ?? result.signal}\n${(result.stderr || '').slice(-2000)}`,
      );
      failed++;
      continue;
    }
    outputs[label] = normalize(readFileSync(out, 'utf8').split('\n').filter(Boolean));
  }
  if (!outputs.native || !outputs.wasm) continue;
  const a = outputs.native;
  const b = outputs.wasm;
  const first = a.findIndex((line, i) => line !== b[i]);
  if (first === -1 && a.length === b.length) {
    const maps = a.filter((line) => line.includes('"msg":"map"')).length;
    console.log(`✓ ${scenario.name}: ${a.length} messages identical (${maps} map updates)`);
  } else {
    const at = first === -1 ? Math.min(a.length, b.length) : first;
    console.error(
      `✗ ${scenario.name}: native and WebAssembly differ at message ${at} of ${a.length}/${b.length}`,
    );
    console.error(`  native: ${(a[at] ?? '(end)').slice(0, 400)}`);
    console.error(`  wasm:   ${(b[at] ?? '(end)').slice(0, 400)}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);

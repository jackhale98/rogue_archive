// SPDX-License-Identifier: GPL-2.0-only
// Replays each scenario's key script in the native and WebAssembly builds
// (each from a fresh copy of the game data) and requires identical output:
// every screen at every key wait, the state snapshot and every message.
// Usage: node replay.mjs --native <bin> --wasm <cjs> --lib <dir> --runs <dir> --scenarios <json>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    native: { type: 'string' },
    wasm: { type: 'string' },
    lib: { type: 'string' },
    runs: { type: 'string' },
    scenarios: { type: 'string' },
  },
});

/** "b{CR}{ESC}{^X}" → key codes. */
export function parseKeys(spec) {
  const named = { CR: 13, ESC: 27, TAB: 9, SPACE: 32, BS: 8 };
  const codes = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] === '{') {
      const end = spec.indexOf('}', i);
      const token = spec.slice(i + 1, end);
      if (token.startsWith('^')) codes.push(token.charCodeAt(1) & 31);
      else if (token in named) codes.push(named[token]);
      else throw new Error(`Unknown key token {${token}}`);
      i = end;
    } else {
      codes.push(spec.charCodeAt(i));
    }
  }
  return codes;
}

function freshLib(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(args.lib, join(dir, 'lib'), { recursive: true });
}

function run(command, commandArgs, env, cwd) {
  return execFileSync(command, commandArgs, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'latin1',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 300_000,
  });
}

const scenarios = JSON.parse(readFileSync(args.scenarios, 'utf8')).scenarios;
let failed = 0;
for (const scenario of scenarios) {
  const keys = parseKeys(scenario.keys.join('')).join(',');
  const nativeDir = join(args.runs, 'native');
  const wasmDir = join(args.runs, 'wasm');
  freshLib(nativeDir);
  freshLib(wasmDir);
  const native = run(args.native, ['-mgcu'], { RA_REPLAY_KEYS: keys }, nativeDir);
  const wasm = run(process.execPath, [args.wasm, '-mgcu'], {
    RA_REPLAY_KEYS: keys,
    RA_LIB_DIR: join(wasmDir, 'lib'),
  });
  writeFileSync(join(args.runs, `${scenario.name}.native.txt`), native, 'latin1');
  writeFileSync(join(args.runs, `${scenario.name}.wasm.txt`), wasm, 'latin1');

  const problems = [];
  if (!/^== end after \d+ keys$/m.test(native)) problems.push('the native run did not use up its keys');
  for (const text of scenario.expect ?? []) {
    if (!native.includes(text)) problems.push(`expected text not seen: ${JSON.stringify(text)}`);
  }
  if (native !== wasm) {
    const a = native.split('\n');
    const b = wasm.split('\n');
    let line = 0;
    while (line < a.length && a[line] === b[line]) line++;
    problems.push(
      `outputs differ at line ${line + 1}:\n    native: ${JSON.stringify(a[line])}\n    wasm:   ${JSON.stringify(b[line])}`,
    );
  }
  // Savefiles the game wrote must be byte-identical too.
  const saves = (dir) => {
    const path = join(dir, 'lib/save');
    return existsSync(path)
      ? readdirSync(path)
          .filter((name) => !name.startsWith('.'))
          .sort()
      : [];
  };
  const nativeSaves = saves(nativeDir);
  if (nativeSaves.join() !== saves(wasmDir).join()) problems.push('the builds wrote different savefiles');
  else
    for (const name of nativeSaves) {
      const a = readFileSync(join(nativeDir, 'lib/save', name));
      const b = readFileSync(join(wasmDir, 'lib/save', name));
      if (!a.equals(b)) problems.push(`savefile ${name} differs`);
    }
  const frames = (native.match(/^== frame /gm) ?? []).length;
  const messages = (native.match(/^msg /gm) ?? []).length;
  if (problems.length > 0) {
    failed++;
    console.error(`FAIL ${scenario.name}`);
    for (const problem of problems) console.error(`  ${problem}`);
  } else {
    console.log(
      `ok   ${scenario.name}: ${frames} screens, ${messages} messages and ${nativeSaves.length} savefile(s) identical`,
    );
  }
}
if (failed > 0) {
  console.error(`${failed} scenario(s) failed; outputs are in ${args.runs}`);
  process.exit(1);
}

// SPDX-License-Identifier: BSD-3-Clause
// Replays each scenario's key script in the native and WebAssembly builds
// (each from a fresh copy of the game data) and requires identical output:
// every screen at every key wait, the state snapshot and every message.
// Usage: node replay.mjs --native <bin> --wasm <cjs> --runs <dir> --scenarios <json>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    native: { type: 'string' },
    wasm: { type: 'string' },
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

function freshDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
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

/**
 * Files must be byte-identical, except one stretch of a savefile: save.c
 * writes the "24 x 80" screen-size line from an 80-byte stack buffer whole
 * (encwrite(buf, 80, ...)), so the bytes after the text are whatever was on
 * the stack. Restoring reads only the text. Each encwrite restarts its
 * encoding, so nothing after the buffer depends on those bytes.
 */
function sameFile(name, a, b) {
  if (a.length !== b.length) return false;
  if (!name.endsWith('.save')) return a.equals(b);
  const header = 28 + 80; // vers.c version[] (27 characters + NUL) + the screen-size buffer
  const textEnd = 28 + 9; // "24 x 80\n" + NUL
  for (let i = 0; i < a.length; i++) {
    if (i >= textEnd && i < header) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const scenarios = JSON.parse(readFileSync(args.scenarios, 'utf8')).scenarios;
let failed = 0;
for (const scenario of scenarios) {
  const keys = parseKeys(scenario.keys.join('')).join(',');
  const nativeDir = join(args.runs, 'native');
  const wasmDir = join(args.runs, 'wasm');
  freshDir(nativeDir);
  freshDir(wasmDir);
  // Relative savefile names: each build runs in its own home directory.
  const options = { RA_REPLAY_KEYS: keys, ROGUEOPTS: scenario.options ?? 'name=Tester,file=Tester.save' };
  const extra = scenario.args ?? [];
  const native = run(args.native, extra, options, nativeDir);
  const wasm = run(process.execPath, [args.wasm, ...extra], { ...options, RA_HOME_DIR: wasmDir });
  writeFileSync(join(args.runs, `${scenario.name}.native.txt`), native, 'latin1');
  writeFileSync(join(args.runs, `${scenario.name}.wasm.txt`), wasm, 'latin1');

  const problems = [];
  if (!scenario.exits && !/^== end after \d+ keys$/m.test(native))
    problems.push('the native run did not use up its keys');
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
  // Savefiles and the scoreboard the game wrote must be byte-identical too.
  const saves = (dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => /\.(save|scr)$/.test(name))
          .sort()
      : [];
  const nativeSaves = saves(nativeDir);
  if (nativeSaves.join() !== saves(wasmDir).join()) problems.push('the builds wrote different savefiles');
  else
    for (const name of nativeSaves) {
      const a = readFileSync(join(nativeDir, name));
      const b = readFileSync(join(wasmDir, name));
      if (!sameFile(name, a, b)) problems.push(`file ${name} differs`);
    }
  const frames = (native.match(/^== frame /gm) ?? []).length;
  if (problems.length > 0) {
    failed++;
    console.error(`FAIL ${scenario.name}`);
    for (const problem of problems) console.error(`  ${problem}`);
  } else {
    console.log(`ok   ${scenario.name}: ${frames} screens and ${nativeSaves.length} file(s) identical`);
  }
}
if (failed > 0) {
  console.error(`${failed} scenario(s) failed; outputs are in ${args.runs}`);
  process.exit(1);
}

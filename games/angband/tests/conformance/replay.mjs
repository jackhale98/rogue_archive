// SPDX-License-Identifier: GPL-2.0-only
// Replays each scenario's event script in the native and WebAssembly builds
// (each from a fresh copy of the game data and an empty user directory) and
// requires identical output: every screen at every key wait, the state
// snapshot, every message, and every file the game wrote (savefiles, scores).
// Usage: node replay.mjs --native <bin> --wasm <cjs> --lib <dir> --runs <dir> --scenarios <json>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseEvents } from './events.mjs';

const { values: args } = parseArgs({
  options: {
    native: { type: 'string' },
    wasm: { type: 'string' },
    lib: { type: 'string' },
    runs: { type: 'string' },
    scenarios: { type: 'string' },
  },
});

function freshDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'angband/user'), { recursive: true });
  cpSync(args.lib, join(dir, 'angband/lib'), { recursive: true });
}

function run(command, commandArgs, env, cwd) {
  return execFileSync(command, commandArgs, {
    cwd,
    env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', ...env },
    encoding: 'latin1',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 300_000,
  });
}

/** Every file under a directory, as relative paths. */
function files(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path, `${prefix}${name}/`) : [`${prefix}${name}`];
    });
}

const GAME_ARGS = ['-c', '-mgcu', '--', '-n'];
const scenarios = JSON.parse(readFileSync(args.scenarios, 'utf8')).scenarios;
let failed = 0;
for (const scenario of scenarios) {
  const events = parseEvents(scenario.keys.join('')).join(',');
  const env = { RA_REPLAY_KEYS: events, RA_REPLAY_GRAPHICS: String(scenario.graphics ?? '') };
  const nativeDir = join(args.runs, 'native');
  const wasmDir = join(args.runs, 'wasm');
  freshDir(nativeDir);
  freshDir(wasmDir);
  const native = run(args.native, GAME_ARGS, env, nativeDir);
  const wasm = run(process.execPath, [args.wasm, ...GAME_ARGS], {
    ...env,
    RA_LIB_DIR: join(wasmDir, 'angband/lib'),
    RA_USER_DIR: join(wasmDir, 'angband/user'),
  });
  writeFileSync(join(args.runs, `${scenario.name}.native.txt`), native, 'latin1');
  writeFileSync(join(args.runs, `${scenario.name}.wasm.txt`), wasm, 'latin1');

  const problems = [];
  if (!/^== end after \d+ events$/m.test(native)) problems.push('the native run did not use up its events');
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
  // Files the game wrote (savefiles, scores, pref files) must be byte-identical too.
  const nativeUser = join(nativeDir, 'angband/user');
  const wasmUser = join(wasmDir, 'angband/user');
  const written = files(nativeUser);
  if (written.join() !== files(wasmUser).join()) problems.push('the builds wrote different files');
  else
    for (const name of written) {
      const a = readFileSync(join(nativeUser, name));
      const b = readFileSync(join(wasmUser, name));
      if (!a.equals(b)) problems.push(`${name} differs`);
    }
  for (const name of scenario.expectFiles ?? [])
    if (!written.includes(name)) problems.push(`expected file not written: ${name}`);
  const frames = (native.match(/^== frame /gm) ?? []).length;
  const messages = (native.match(/^msg /gm) ?? []).length;
  if (problems.length > 0) {
    failed++;
    console.error(`FAIL ${scenario.name}`);
    for (const problem of problems) console.error(`  ${problem}`);
  } else {
    console.log(
      `ok   ${scenario.name}: ${frames} screens, ${messages} messages and ${written.length} file(s) identical`,
    );
  }
}
if (failed > 0) {
  console.error(`${failed} scenario(s) failed; outputs are in ${args.runs}`);
  process.exit(1);
}

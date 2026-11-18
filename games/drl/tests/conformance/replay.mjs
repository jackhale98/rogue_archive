// SPDX-License-Identifier: GPL-2.0-only
/**
 * Native vs WebAssembly replay: each scenario's keys go to the native build
 * (with rareplay.pas as the curses host) and to the WebAssembly harness
 * (this file is its host, with the same rule), each in a fresh DRL folder
 * (or a copy of an earlier scenario's: `from`); the screens before every key
 * and at the end must be identical. DRL's save format records word-sized
 * values (Valkyrie writes Lua userdata as raw bytes with their size), so the
 * saved games themselves differ between the 64-bit native build and wasm32;
 * a scenario that continues a saved game checks that each build's own save
 * gives the same game.
 *
 *   node replay.mjs --native <drl binary> --native-data <dir> --wasm <drl-node.cjs> --wasm-data <dir>
 *                   --runs <dir> --scenarios <scenarios.json>
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { scenarioKeys } from './scenario-keys.mjs';

const STILL_POLLS = 40;
const END_POLLS = 400;
const ARGS = ['--console', '--no-sound'];

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || !process.argv[at + 1]) throw new Error(`missing --${name}`);
  return resolve(process.argv[at + 1]);
}

function screenDump(label, screen, cols, rows) {
  const lines = [`== ${label}`];
  for (let y = 0; y < rows; y++) {
    let text = '';
    let colours = '';
    for (let x = 0; x < cols; x++) {
      let c = screen[(y * cols + x) * 2];
      if (c < 32 || c > 126) c = 63;
      text += String.fromCharCode(c);
      colours += screen[(y * cols + x) * 2 + 1].toString(16).toUpperCase().padStart(2, '0');
    }
    lines.push(`${text}|${colours}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Runs the WebAssembly harness with the replay rule; resolves with the dump. */
async function runWasm(harness, data, home, keys) {
  const require = createRequire(import.meta.url);
  const factory = require(harness);
  let dump = '';
  let screen = new Uint8Array(0);
  let cols = 0;
  let rows = 0;
  let polls = 0;
  let next = 0;
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  let over = false;
  const ended = () => {
    if (over) return;
    over = true;
    dump += screenDump('end', screen, cols, rows);
    finish();
  };
  const mod = await factory({
    raArgs: ['drl', ...ARGS, `--config=/drl/config.lua`, '--data-path=/drl/', '--write-path=/home/'],
    raPreopens: ['/home', '/'],
    raPresent(cells, c, r) {
      if (!cells) return;
      if (cells.length !== screen.length || cells.some((b, i) => b !== screen[i])) {
        screen = cells;
        cols = c;
        rows = r;
        polls = 0;
      }
    },
    raKeyTake() {
      polls++;
      if (next < keys.length) {
        if (polls < STILL_POLLS) return -1;
        dump += screenDump(`key ${next}: ${keys[next]}`, screen, cols, rows);
        polls = 0;
        return keys[next++];
      }
      if (polls >= END_POLLS) {
        ended();
        // Stop the game where it is, as the native host's Halt does.
        throw Object.assign(new Error('replay finished'), { name: 'ReplayFinished' });
      }
      return -1;
    },
    raKeyWait: () => new Promise((resolve) => setTimeout(resolve, 1)),
    raSleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    print: () => {},
    printErr: () => {},
    preRun: [
      (M) => {
        M.FS.mkdir('/drl');
        M.FS.mount(M.NODEFS, { root: data }, '/drl');
        if (!M.FS.analyzePath('/home').exists) M.FS.mkdir('/home');
        M.FS.mount(M.NODEFS, { root: home }, '/home');
      },
    ],
  });
  // DRL ending by itself (Exit) resolves, or rejects with its exit status.
  mod.ccall('ra_start', null, [], [], { async: true }).then(ended, ended);
  await done;
  return dump;
}

function runNative(binary, data, home, keysFile, outFile) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      binary,
      [...ARGS, `--config=${data}/config.lua`, `--data-path=${data}/`, `--write-path=${home}/`],
      { cwd: home, env: { ...process.env, RA_KEYS: keysFile, RA_OUT: outFile }, timeout: 600_000 },
      (error) => (error ? reject(error) : resolvePromise(readFileSync(outFile, 'utf8'))),
    );
  });
}

/** The saved game, if any. */
function saved(home) {
  const path = join(home, 'user/drl/save');
  return existsSync(path) ? readFileSync(path) : null;
}

const native = option('native');
const nativeData = option('native-data');
const wasm = option('wasm');
const wasmData = option('wasm-data');
const runs = option('runs');
const scenarios = JSON.parse(readFileSync(option('scenarios'), 'utf8'));
let failed = 0;
for (const scenario of scenarios) {
  const keys = scenarioKeys(scenario.keys);
  const dir = join(runs, scenario.name);
  rmSync(dir, { recursive: true, force: true });
  for (const side of ['native', 'wasm']) {
    mkdirSync(join(dir, side, 'home'), { recursive: true });
    if (scenario.from)
      cpSync(join(runs, scenario.from, side, 'home'), join(dir, side, 'home'), { recursive: true });
  }
  const keysFile = join(dir, 'keys.txt');
  writeFileSync(keysFile, `${keys.join('\n')}\n`);
  const [a, b] = await Promise.all([
    runNative(native, nativeData, join(dir, 'native', 'home'), keysFile, join(dir, 'native', 'screens.txt')),
    runWasm(wasm, wasmData, join(dir, 'wasm', 'home'), keys),
  ]);
  writeFileSync(join(dir, 'wasm', 'screens.txt'), b);
  const problems = [];
  if (a !== b) {
    const la = a.split('\n');
    const lb = b.split('\n');
    const at = la.findIndex((line, i) => line !== lb[i]);
    problems.push(`screens differ from line ${at + 1}:\n  native: ${la[at]}\n  wasm:   ${lb[at]}`);
  }
  const sa = saved(join(dir, 'native', 'home'));
  const sb = saved(join(dir, 'wasm', 'home'));
  if (scenario.expectSave && (!sa || !sb))
    problems.push(`no saved game (native ${Boolean(sa)}, wasm ${Boolean(sb)})`);
  for (const text of scenario.expectText ?? [])
    if (!a.includes(text)) problems.push(`the screens never show "${text}"`);
  const screens = a.split('\n== ').length;
  if (problems.length) {
    failed++;
    console.error(`✗ ${scenario.name}:\n  ${problems.join('\n  ')}`);
  } else {
    console.log(
      `✓ ${scenario.name}: ${keys.length} keys, ${screens} identical screens${sa && sb ? `; saved games written (native ${sa.length} bytes, wasm ${sb.length})` : ''}`,
    );
  }
}
process.exit(failed ? 1 : 0);

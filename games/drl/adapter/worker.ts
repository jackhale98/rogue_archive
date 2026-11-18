// SPDX-License-Identifier: GPL-2.0-only
/**
 * Web Worker hosting DRL's WebAssembly module.
 *
 * DRL runs here in its console mode, on our curses (port/ncurses.pas): it
 * posts the screen at each refresh and polls for keys between frames, as in
 * a terminal. Its waits are Asyncify suspensions: sleeps (WASI poll_oneoff,
 * port/wasi-emscripten.js) and key waits.
 *
 * DRL's console redraws about 90 times a second whether or not anything
 * changes. While the screen is still, the game's sleeps here wait for the
 * next key instead (at most IDLE_POLL_MS), so an idle game costs almost
 * nothing; while it changes (animations, typed text), they keep DRL's
 * cadence.
 *
 * Files: the game data at /drl (preloaded, read-only). The player's DRL
 * folder at /home (DRL's working directory: the first preopened directory).
 * Its user/ directory (the save, player.wad, score.wad, mortems) is an IDBFS
 * mount with autoPersist, so each file DRL closes there is in IndexedDB at
 * once. DRL's two files beside it, settings.lua and drl.prc (its first-run
 * marker), are copied into it when the files are synced and back at start;
 * its log (runtime.log), written all through a game, stays in memory.
 *
 * Exit from DRL's main menu ends the program; a fresh module instance then
 * starts it again at its main menu, as launching the desktop game would.
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { FromWorker, ToWorker, VerifiedFile } from './protocol.ts';
import { importPath } from './saves.ts';

const DATA = '/drl';
const HOME = '/home';
/** The part of the DRL folder kept in IndexedDB. */
const STORE = `${HOME}/user`;
const SAVE = `${STORE}/drl/save`;
/** DRL's files beside user/ that are kept too (copied into STORE/.home when syncing). */
const KEPT = ['settings.lua', 'drl.prc'];
const KEPT_DIR = `${STORE}/.home`;
const ARGS = [
  '--console',
  '--no-sound',
  `--config=${DATA}/config.lua`,
  `--data-path=${DATA}/`,
  `--write-path=${HOME}/`,
];
/** The screen still for this long: sleeps wait for a key instead. */
const IDLE_AFTER_MS = 1000;
/** Longest wait for a key while idle (time still passes for the game). */
const IDLE_POLL_MS = 250;

interface EmscriptenFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: object, mountpoint: string): void;
  syncfs(populate: boolean, callback: (err: unknown) => void): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number; mtime: Date | number };
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array | string): void;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

interface DrlModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  ccall(name: string, ret: null, args: [], values: [], options: { async: true }): Promise<void>;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<DrlModule>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

function post(message: FromWorker, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

/** Files that must not leave the worker: the loader's data and the compiled module. */
const runtime: {
  factory: ModuleFactory | null;
  module: WebAssembly.Module | null;
  data: ArrayBuffer | null;
} = { factory: null, module: null, data: null };
let mod: DrlModule | null = null;
let running = false;
const keys: number[] = [];
let wake: (() => void) | null = null;
let lastChange = -Infinity;
let syncChain: Promise<void> = Promise.resolve();
let lastHasSave: boolean | null = null;
let lastKept = -Infinity;

function wakeGame(): void {
  const resolve = wake;
  wake = null;
  resolve?.();
}

function hasSave(): boolean {
  return Boolean(mod?.FS.analyzePath(SAVE).exists);
}

function postSaves(): void {
  const now = hasSave();
  if (now === lastHasSave) return;
  lastHasSave = now;
  post({ type: 'saves', hasSave: now });
}

/** settings.lua and drl.prc into the stored folder (when changed). */
function keepFiles(): void {
  if (!mod) return;
  const { FS } = mod;
  for (const name of KEPT) {
    const path = `${HOME}/${name}`;
    if (!FS.analyzePath(path).exists) continue;
    const bytes = FS.readFile(path);
    const copy = `${KEPT_DIR}/${name}`;
    if (FS.analyzePath(copy).exists) {
      const old = FS.readFile(copy);
      if (old.length === bytes.length && old.every((b, i) => b === bytes[i])) continue;
    } else if (!FS.analyzePath(KEPT_DIR).exists) FS.mkdir(KEPT_DIR);
    FS.writeFile(copy, bytes);
  }
}

function syncFs(populate = false): Promise<void> {
  const run = () =>
    new Promise<void>((resolve, reject) => {
      if (!mod) return resolve();
      if (!populate) keepFiles();
      mod.FS.syncfs(populate, (err) =>
        err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
      );
    });
  syncChain = syncChain.then(run, run);
  return syncChain;
}

async function fetchVerified(url: string, file: RuntimeFile, onProgress: (n: number) => void) {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw Object.assign(new Error(`Could not download ${file.path}.`), { kind: 'network' });
  }
  if (!response.ok || !response.body) {
    throw Object.assign(new Error(`Could not download ${file.path} (HTTP ${response.status}).`), {
      kind: 'network',
    });
  }
  const bytes = new Uint8Array(file.size);
  const reader = response.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > bytes.length)
      throw Object.assign(new Error(`${file.path} is larger than expected.`), { kind: 'integrity' });
    bytes.set(value, loaded);
    loaded += value.length;
    onProgress(loaded);
  }
  if (loaded !== file.size) throw Object.assign(new Error(`${file.path} is incomplete.`), { kind: 'integrity' });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256)
    throw Object.assign(new Error(`${file.path} failed its integrity check.`), { kind: 'integrity' });
  return bytes;
}

function reportFatal(error: unknown): void {
  const given = (error as { kind?: string } | null)?.kind;
  const text = String(error);
  const kind =
    given === 'network' || given === 'integrity' || given === 'storage'
      ? given
      : /out of memory|RangeError|Cannot enlarge memory|memory access out of bounds/i.test(text)
        ? 'out-of-memory'
        : 'crash';
  const actions: Record<string, string> = {
    network: 'Check your connection and try again.',
    integrity: 'Reload the page to fetch a fresh copy of the game.',
    'out-of-memory': 'Close other tabs or apps and try again.',
    storage: 'Check that site storage is allowed for this page (private browsing can block it).',
    crash:
      'Return to the library and launch the game again. DRL saves with Save & Quit (Escape on the map), and on each new level.',
  };
  post({ type: 'error', error: { kind, message: error instanceof Error ? error.message : text, action: actions[kind] } });
}

/** A screen from port/ncurses.pas: characters (the alternate character set as 128 + its letter) and foreground colours. */
function present(raw: Uint8Array | null, cols: number, rows: number, cx: number, cy: number, cursor: number) {
  if (!raw) return;
  const cells = new Uint8Array(cols * rows * 2);
  for (let i = 0; i < cols * rows; i++) {
    const ch = raw[i * 2]!;
    const attr = raw[i * 2 + 1]!;
    cells[i * 2] = attr & 0x80 ? (ch & 0x7f) | 0x80 : ch;
    cells[i * 2 + 1] = attr & 0x0f;
  }
  lastChange = performance.now();
  // DRL writes settings.lua and drl.prc while it runs: keep them at once.
  if (lastChange - lastKept > 500) {
    lastKept = lastChange;
    keepFiles();
  }
  post({ type: 'frame', cols, rows, cells, cursor: { x: cx, y: cy, visible: cursor !== 0 } }, [cells.buffer]);
  postSaves();
}

/** A fresh DRL process: a new module instance, the player's files restored from IndexedDB. */
async function instantiate(): Promise<void> {
  const { factory, module, data } = runtime;
  if (!factory || !module || !data) return;
  keys.length = 0;
  mod = await factory({
    instantiateWasm(imports: WebAssembly.Imports, success: (instance: WebAssembly.Instance) => void) {
      WebAssembly.instantiate(module, imports).then(success, reportFatal);
      return {};
    },
    locateFile: (path: string) => path,
    getPreloadedPackage: () => data.slice(0),
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`DRL stopped unexpectedly: ${String(what)}`)),
    raArgs: ['drl', ...ARGS],
    raPreopens: [HOME, '/'],
    raPresent: present,
    raKeyTake: () => keys.shift() ?? -1,
    raKeyWait: () =>
      keys.length
        ? undefined
        : new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(wakeGame, IDLE_POLL_MS);
          }),
    raSleep(ms: number): Promise<void> | undefined {
      if (keys.length) return undefined;
      if (performance.now() - lastChange < IDLE_AFTER_MS) return new Promise((resolve) => setTimeout(resolve, ms));
      return new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(wakeGame, IDLE_POLL_MS);
      });
    },
  });
  const { FS, IDBFS } = mod;
  for (const dir of [HOME, STORE]) if (!FS.analyzePath(dir).exists) FS.mkdir(dir);
  FS.mount(IDBFS, { autoPersist: true }, STORE);
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
  for (const name of KEPT) {
    const copy = `${KEPT_DIR}/${name}`;
    if (FS.analyzePath(copy).exists) FS.writeFile(`${HOME}/${name}`, FS.readFile(copy));
  }
}

/** The DRL folder as desktop DRL has it: user/ and the kept files (not the log). */
function exportFiles(): SaveFile[] {
  if (!mod) return [];
  const files = listFiles(STORE, 'user/').filter((file) => !file.path.startsWith('user/.home/'));
  for (const name of KEPT) {
    const path = `${HOME}/${name}`;
    if (!mod.FS.analyzePath(path).exists) continue;
    const stat = mod.FS.stat(path);
    files.push({ path: name, bytes: mod.FS.readFile(path), modifiedAt: Number(stat.mtime instanceof Date ? stat.mtime.getTime() : stat.mtime) });
  }
  return files;
}

async function init(message: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  const parts: VerifiedFile[] = [message.glue, message.wasm, message.data];
  const loaded = parts.map(() => 0);
  const total = parts.reduce((sum, part) => sum + part.file.size, 0);
  const progress = () =>
    post({
      type: 'status',
      status: {
        stage: 'downloading',
        detail: 'Downloading game files',
        progress: { loaded: loaded.reduce((x, y) => x + y, 0), total },
      },
    });
  const files = await Promise.all(
    parts.map((part, i) =>
      fetchVerified(part.url, part.file, (n) => {
        loaded[i] = n;
        progress();
      }),
    ),
  );
  post({ type: 'status', status: { stage: 'initializing', detail: 'Starting the WebAssembly runtime' } });
  const glueUrl = URL.createObjectURL(new Blob([files[0]!], { type: 'text/javascript' }));
  try {
    runtime.factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
  } finally {
    URL.revokeObjectURL(glueUrl);
  }
  // Compiled once, instantiated for each run; the bytes are not kept.
  runtime.module = await WebAssembly.compile(files[1]!);
  runtime.data = files[2]!.buffer as ArrayBuffer;
  files.length = 0;
  post({ type: 'status', status: { stage: 'restoring-saves', detail: 'Restoring saved games' } });
  await instantiate();
  lastHasSave = hasSave();
  post({ type: 'ready', hasSave: lastHasSave });
}

function run(): void {
  if (!mod || running) return;
  running = true;
  post({ type: 'status', status: { stage: 'running' } });
  mod.ccall('ra_start', null, [], [], { async: true }).then(
    () => void exited(0),
    (error: unknown) => {
      const status = (error as { name?: string; status?: number } | null)?.name === 'ExitStatus'
        ? ((error as { status?: number }).status ?? 0)
        : null;
      if (status === null) {
        running = false;
        reportFatal(error);
        return;
      }
      void exited(status);
    },
  );
}

/** DRL ended (Exit at its main menu): back to its main menu, as relaunching it would. */
async function exited(status: number): Promise<void> {
  running = false;
  try {
    await syncFs();
  } catch {
    // autoPersist has already written each file as it closed.
  }
  try {
    await instantiate();
  } catch (error) {
    reportFatal(error);
    return;
  }
  postSaves();
  post({ type: 'exit', status, restarted: true });
  run();
}

function listFiles(dir: string, prefix: string): SaveFile[] {
  if (!mod) return [];
  const { FS } = mod;
  const files: SaveFile[] = [];
  if (!FS.analyzePath(dir).exists) return files;
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const path = `${dir}/${name}`;
    const stat = FS.stat(path);
    if (FS.isDir(stat.mode)) files.push(...listFiles(path, `${prefix}${name}/`));
    else if (FS.isFile(stat.mode)) {
      const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
      files.push({ path: `${prefix}${name}`, bytes: FS.readFile(path), modifiedAt: mtime });
    }
  }
  return files;
}

function mkdirs(path: string): void {
  if (!mod) return;
  let at = '';
  for (const part of path.split('/').filter(Boolean)) {
    at += `/${part}`;
    if (!mod.FS.analyzePath(at).exists) mod.FS.mkdir(at);
  }
}

async function importFiles(id: number, files: SaveFile[]): Promise<void> {
  if (!mod) {
    post({ type: 'imported', id, error: 'The game is not loaded.' });
    return;
  }
  try {
    for (const file of files) {
      const target = importPath(file.path);
      if (!target) throw new Error(`Unsupported file name: ${file.path}`);
      const full = `${HOME}/${target}`;
      mkdirs(full.slice(0, full.lastIndexOf('/')));
      mod.FS.writeFile(full, file.bytes);
    }
    await syncFs();
    lastHasSave = null;
    postSaves();
    post({ type: 'imported', id });
  } catch (error) {
    post({ type: 'imported', id, error: String(error) });
  }
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      init(message).catch(reportFatal);
      break;
    case 'start':
      run();
      break;
    case 'keys':
      keys.push(...message.keys);
      wakeGame();
      break;
    case 'flush':
      syncFs()
        .then(() => post({ type: 'flushed', id: message.id }))
        .catch((error: unknown) => post({ type: 'flushed', id: message.id, error: String(error) }));
      break;
    case 'export':
      syncFs()
        .then(() => post({ type: 'exported', id: message.id, files: exportFiles() }))
        .catch((error: unknown) => post({ type: 'exported', id: message.id, files: [], error: String(error) }));
      break;
    case 'import':
      void importFiles(message.id, message.files);
      break;
  }
};

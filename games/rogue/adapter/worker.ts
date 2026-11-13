// SPDX-License-Identifier: BSD-3-Clause
/**
 * Web Worker hosting the Rogue WebAssembly module.
 *
 * Rogue runs here with a small curses (port/curses-web.c) that posts the
 * screen on every refresh and blocks (Asyncify) when the game reads a key;
 * keys from the page are queued until it reads them.
 *
 * Like the original, each game is one run of the program: it ends when you
 * save (S), die or quit, and a fresh instance is prepared for the next. The
 * character's name and savefile are passed as Rogue's own options
 * (ROGUEOPTS); continuing a game passes the savefile as the argument, as on a
 * terminal ("rogue Name.save"). Rogue deletes a savefile when it restores it.
 *
 * Saves: /rogue (Rogue's home directory: <name>.save files and the
 * scoreboard, rogue54.scr) is an IDBFS mount with autoPersist, so each file
 * the game closes is in IndexedDB at once.
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { FromWorker, SavedGame, ToWorker, VerifiedFile } from './protocol.ts';

const HOME = '/rogue';
const SAVE_SUFFIX = '.save';

interface EmscriptenFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: object, mountpoint: string): void;
  syncfs(populate: boolean, callback: (err: unknown) => void): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number; mtime: Date | number };
  isFile(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
}

interface RogueModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  ENV: Record<string, string>;
  callMain(args: string[]): number;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<RogueModule>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

function post(message: FromWorker, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

let factory: ModuleFactory | null = null;
let wasmBinary: Uint8Array | null = null;
let mod: RogueModule | null = null;
let running = false;
let current = '';
const keys: number[] = [];
let wake: (() => void) | null = null;
let pendingFlushes: number[] = [];
let syncChain: Promise<void> = Promise.resolve();

function wakeGame(): void {
  const resolve = wake;
  wake = null;
  resolve?.();
}

function syncFs(populate = false): Promise<void> {
  const run = () =>
    new Promise<void>((resolve, reject) => {
      if (!mod) return resolve();
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
  if (loaded !== file.size)
    throw Object.assign(new Error(`${file.path} is incomplete.`), { kind: 'integrity' });
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
      : /out of memory|RangeError|Cannot enlarge memory/i.test(text)
        ? 'out-of-memory'
        : 'crash';
  const actions: Record<string, string> = {
    network: 'Check your connection and try again.',
    integrity: 'Reload the page to fetch a fresh copy of the game.',
    'out-of-memory': 'Close other tabs or apps and try again.',
    storage: 'Check that site storage is allowed for this page (private browsing can block it).',
    crash: 'Return to the library and launch the game again. Games you saved with S are kept.',
  };
  post({
    type: 'error',
    error: { kind, message: error instanceof Error ? error.message : text, action: actions[kind] },
  });
}

/** Saved games: <name>.save files in Rogue's home, most recent first. */
function listSaves(): SavedGame[] {
  if (!mod) return [];
  const { FS } = mod;
  const saves: SavedGame[] = [];
  for (const file of FS.readdir(HOME)) {
    if (!file.endsWith(SAVE_SUFFIX) || file.startsWith('.')) continue;
    const stat = FS.stat(`${HOME}/${file}`);
    if (!FS.isFile(stat.mode)) continue;
    const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
    saves.push({ name: file.slice(0, -SAVE_SUFFIX.length), modifiedAt: mtime });
  }
  return saves.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * A fresh Rogue process: new module instance, files restored from IndexedDB.
 * `options` become ROGUEOPTS: the C library reads the environment once, when
 * the module starts, so it is set before that (preRun).
 */
async function instantiate(options = ''): Promise<void> {
  if (!factory || !wasmBinary) return;
  keys.length = 0;
  mod = await factory({
    wasmBinary,
    preRun: [
      (module: RogueModule) => {
        if (options) module.ENV.ROGUEOPTS = options;
      },
    ],
    locateFile: (path: string) => path,
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`Rogue stopped unexpectedly: ${String(what)}`)),
    onExit: (status: number) => void exited(status),
    raPresent(
      cells: Uint8Array,
      cols: number,
      rows: number,
      cx: number,
      cy: number,
      cursor: number,
      state: Int32Array,
    ) {
      post({ type: 'frame', cols, rows, cells, cursor: { x: cx, y: cy, visible: cursor !== 0 }, state }, [
        cells.buffer,
        state.buffer,
      ]);
    },
    raPollKey(): number {
      return keys.shift() ?? 0;
    },
    raWaitForKey(): Promise<void> {
      if (keys.length > 0 || pendingFlushes.length > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        wake = resolve;
      });
    },
    raSleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1000)));
    },
    async raService(): Promise<void> {
      if (pendingFlushes.length === 0) return;
      const ids = pendingFlushes;
      pendingFlushes = [];
      try {
        await syncFs();
        for (const id of ids) post({ type: 'flushed', id });
      } catch (error) {
        for (const id of ids) post({ type: 'flushed', id, error: String(error) });
      }
    },
  });
  const { FS, IDBFS } = mod;
  if (!FS.analyzePath(HOME).exists) FS.mkdir(HOME);
  FS.mount(IDBFS, { autoPersist: true }, HOME);
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
  FS.chdir(HOME);
}

async function init(message: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  const parts: VerifiedFile[] = [message.glue, message.wasm];
  const loaded = parts.map(() => 0);
  const total = parts.reduce((sum, part) => sum + part.file.size, 0);
  const progress = () =>
    post({
      type: 'status',
      status: {
        stage: 'downloading',
        detail: 'Downloading game files',
        progress: { loaded: loaded.reduce((a, b) => a + b, 0), total },
      },
    });
  const [glue, wasm] = await Promise.all(
    parts.map((part, i) =>
      fetchVerified(part.url, part.file, (n) => {
        loaded[i] = n;
        progress();
      }),
    ),
  );
  post({ type: 'status', status: { stage: 'initializing', detail: 'Starting the WebAssembly runtime' } });
  const glueUrl = URL.createObjectURL(new Blob([glue!], { type: 'text/javascript' }));
  try {
    factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
  } finally {
    URL.revokeObjectURL(glueUrl);
  }
  wasmBinary = wasm!;
  post({ type: 'status', status: { stage: 'restoring-saves', detail: 'Restoring saved games' } });
  await instantiate();
  post({ type: 'ready', saves: listSaves() });
}

async function start(name: string, restore: boolean): Promise<void> {
  if (!mod || running) return;
  running = true;
  current = name;
  post({ type: 'status', status: { stage: 'running' } });
  const file = `${HOME}/${name}${SAVE_SUFFIX}`;
  // Rogue's own options: the character's name, and where S saves.
  try {
    await instantiate(`name=${name},file=${file}`);
  } catch (error) {
    reportFatal(error);
    return;
  }
  try {
    mod!.callMain(restore ? [file] : []);
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'ExitStatus') reportFatal(error);
  }
}

async function exited(status: number): Promise<void> {
  running = false;
  try {
    await syncFs();
  } catch {
    // autoPersist has already written each file as it closed.
  }
  const saved = !!mod?.FS.analyzePath(`${HOME}/${current}${SAVE_SUFFIX}`).exists;
  try {
    await instantiate();
  } catch (error) {
    reportFatal(error);
    return;
  }
  post({ type: 'exit', status, saved, saves: listSaves() });
}

function listFiles(): SaveFile[] {
  if (!mod) return [];
  const { FS } = mod;
  const files: SaveFile[] = [];
  for (const name of FS.readdir(HOME)) {
    if (name === '.' || name === '..' || name.endsWith('.lck')) continue;
    const path = `${HOME}/${name}`;
    const stat = FS.stat(path);
    if (!FS.isFile(stat.mode)) continue;
    const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
    files.push({ path: name, bytes: FS.readFile(path), modifiedAt: mtime });
  }
  return files;
}

async function importFiles(id: number, files: SaveFile[]): Promise<void> {
  if (!mod) {
    post({ type: 'imported', id, error: 'The game is not loaded.' });
    return;
  }
  try {
    const { FS } = mod;
    for (const file of files) {
      const name = file.path.split('/').pop() ?? '';
      if (!name || name.startsWith('.')) throw new Error(`Unsupported file name: ${file.path}`);
      let target = `${HOME}/${name}`;
      // Never overwrite: "Name.save" becomes "Name-2.save" if Name has one.
      const dot = name.lastIndexOf('.');
      for (let n = 2; FS.analyzePath(target).exists; n++)
        target = `${HOME}/${dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`}`;
      FS.writeFile(target, file.bytes);
    }
    await syncFs();
    post({ type: 'imported', id });
    post({ type: 'saves', saves: listSaves() });
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
      void start(message.name, message.restore);
      break;
    case 'keys':
      keys.push(...message.keys);
      wakeGame();
      break;
    case 'flush':
      if (running) {
        pendingFlushes.push(message.id);
        wakeGame();
      } else {
        syncFs()
          .then(() => post({ type: 'flushed', id: message.id }))
          .catch((error: unknown) => post({ type: 'flushed', id: message.id, error: String(error) }));
      }
      break;
    case 'export':
      syncFs()
        .then(() => post({ type: 'exported', id: message.id, files: listFiles() }))
        .catch((error: unknown) =>
          post({ type: 'exported', id: message.id, files: [], error: String(error) }),
        );
      break;
    case 'import':
      void importFiles(message.id, message.files);
      break;
  }
};

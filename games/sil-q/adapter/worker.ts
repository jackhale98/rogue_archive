// SPDX-License-Identifier: GPL-2.0-only
/**
 * Web Worker hosting the Sil-Q WebAssembly module.
 *
 * Sil-Q runs here with our display module (port/main-web.c). It posts the
 * screen on every refresh and blocks (Asyncify) when it waits for a key; keys
 * from the page are queued until it reads them.
 *
 * Saves: lib/save (savefiles), lib/apex (high scores) and lib/user (character
 * dumps) are IDBFS mounts with autoPersist, so each file the game closes is in
 * IndexedDB at once. The rest of lib/ is the game data, preloaded read-only.
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { FromWorker, ToWorker, VerifiedFile } from './protocol.ts';

const LIB = '/sil/lib';
/** Writable directories under lib/, kept in IndexedDB. */
const PERSISTENT = ['save', 'apex', 'user'];

interface EmscriptenFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: object, mountpoint: string): void;
  syncfs(populate: boolean, callback: (err: unknown) => void): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number; mtime: Date | number };
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  analyzePath(path: string): { exists: boolean };
}

interface SilModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  callMain(args: string[]): number;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<SilModule>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

function post(message: FromWorker, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

let mod: SilModule | null = null;
let running = false;
const keys: number[] = [];
let wake: (() => void) | null = null;
let pendingFlushes: number[] = [];
let syncChain: Promise<void> = Promise.resolve();

let lastSaves = '';

/** Saved characters: Sil names savefiles "<uid>.<name>" (lib/save). */
function postSaves(): void {
  if (!mod) return;
  const { FS } = mod;
  const dir = `${LIB}/save`;
  if (!FS.analyzePath(dir).exists) return;
  const saves: { name: string; mtime: number }[] = [];
  for (const file of FS.readdir(dir)) {
    const match = /^\d+\.(.+)$/.exec(file);
    if (!match) continue;
    const stat = FS.stat(`${dir}/${file}`);
    if (!FS.isFile(stat.mode)) continue;
    saves.push({
      name: match[1]!,
      mtime: stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime),
    });
  }
  const names = saves.sort((a, b) => b.mtime - a.mtime).map((save) => save.name);
  const signature = names.join('\n');
  if (signature === lastSaves) return;
  lastSaves = signature;
  post({ type: 'saves', names });
}

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
    crash: 'Return to the library and launch the game again. Sil saves when you change level or save.',
  };
  post({
    type: 'error',
    error: { kind, message: error instanceof Error ? error.message : text, action: actions[kind] },
  });
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
        progress: { loaded: loaded.reduce((a, b) => a + b, 0), total },
      },
    });
  const [glue, wasmBinary, data] = await Promise.all(
    parts.map((part, i) =>
      fetchVerified(part.url, part.file, (n) => {
        loaded[i] = n;
        progress();
      }),
    ),
  );

  post({ type: 'status', status: { stage: 'initializing', detail: 'Starting the WebAssembly runtime' } });
  const glueUrl = URL.createObjectURL(new Blob([glue!], { type: 'text/javascript' }));
  let factory: ModuleFactory;
  try {
    factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
  } finally {
    URL.revokeObjectURL(glueUrl);
  }
  const dataBuffer = data!.buffer;
  mod = await factory({
    wasmBinary,
    locateFile: (path: string) => path,
    getPreloadedPackage: () => dataBuffer,
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`Sil-Q stopped unexpectedly: ${String(what)}`)),
    onExit: (status: number) => {
      running = false;
      void syncFs().finally(() => post({ type: 'exit', status }));
    },
    raPresent(
      cells: Uint8Array,
      cols: number,
      rows: number,
      cx: number,
      cy: number,
      cursor: number,
      state: Int32Array,
    ) {
      // At the title screen (not in the dungeon), keep the list of saved characters current.
      if (state[0] === 0) postSaves();
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
    raFlushKeys() {
      keys.length = 0;
    },
    raSleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 250)));
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
    raPalette(table: Uint8Array) {
      post({ type: 'palette', table }, [table.buffer]);
    },
    raMessage(repeat: boolean, text: string, color: number) {
      post({ type: 'message', text, color, repeat });
    },
  });

  post({ type: 'status', status: { stage: 'restoring-saves', detail: 'Restoring saved games' } });
  const { FS, IDBFS } = mod;
  for (const dir of PERSISTENT) {
    const path = `${LIB}/${dir}`;
    if (!FS.analyzePath(path).exists) FS.mkdir(path);
    FS.mount(IDBFS, { autoPersist: true }, path);
  }
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
  post({ type: 'ready' });
}

function start(args: string[]): void {
  if (!mod || running) return;
  running = true;
  post({ type: 'status', status: { stage: 'running' } });
  try {
    mod.callMain(args);
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'ExitStatus') reportFatal(error);
  }
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
    if (FS.isDir(stat.mode)) {
      files.push(...listFiles(path, `${prefix}${name}/`));
    } else if (FS.isFile(stat.mode)) {
      const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
      files.push({ path: `${prefix}${name}`, bytes: FS.readFile(path), modifiedAt: mtime });
    }
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
    for (let file of files) {
      // A savefile on its own (as desktop Sil-Q keeps it in lib/save) goes to save/.
      if (!file.path.includes('/')) file = { ...file, path: `save/${file.path}` };
      const [dir, ...rest] = file.path.split('/');
      if (!dir || !PERSISTENT.includes(dir) || rest.length !== 1 || !rest[0] || rest[0].startsWith('.'))
        throw new Error(`Unsupported file name: ${file.path}`);
      let target = `${LIB}/${file.path}`;
      for (let n = 2; FS.analyzePath(target).exists; n++) target = `${LIB}/${file.path} (imported ${n})`;
      FS.writeFile(target, file.bytes);
    }
    await syncFs();
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
      start(message.args);
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
        .then(() =>
          post({
            type: 'exported',
            id: message.id,
            files: PERSISTENT.flatMap((dir) => listFiles(`${LIB}/${dir}`, `${dir}/`)),
          }),
        )
        .catch((error: unknown) =>
          post({ type: 'exported', id: message.id, files: [], error: String(error) }),
        );
      break;
    case 'import':
      void importFiles(message.id, message.files);
      break;
  }
};

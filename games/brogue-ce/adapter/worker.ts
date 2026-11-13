// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Web Worker hosting the Brogue CE WebAssembly module.
 *
 * The engine runs here, off the UI thread. Asyncify lets Brogue's blocking
 * input loop yield to this worker's event loop, so messages from the page
 * (input, flush requests) are delivered while the game waits.
 *
 * Saves: the game's working directory is an IDBFS mount with autoPersist, so
 * every file Brogue writes is copied to IndexedDB right away. Brogue records
 * the game in progress to LastGame.broguesave as it plays; the host can also
 * ask for the in-memory part of that recording to be flushed (on page hide
 * or exit) so very little progress can be lost.
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { BrogueEventTuple, FromWorker, ToWorker } from './protocol.ts';

const SAVE_DIR = '/brogue';
const MOUSE_ENTERED_CELL = 5;

interface EmscriptenFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: object, mountpoint: string): void;
  syncfs(populate: boolean, callback: (err: unknown) => void): void;
  chdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number; mtime: Date | number };
  isFile(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  analyzePath(path: string): { exists: boolean };
  utime?(path: string, atime: number, mtime: number): void;
}

interface BrogueModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  callMain(args: string[]): void;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<BrogueModule>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

/** Flush acknowledgements awaited inside the worker (by export) instead of by the page. */
const flushWaiters = new Map<number, () => void>();

function post(message: FromWorker, transfer?: Transferable[]): void {
  if (message.type === 'flushed' && flushWaiters.has(message.id)) {
    flushWaiters.get(message.id)?.();
    flushWaiters.delete(message.id);
    return;
  }
  scope.postMessage(message, transfer);
}

let mod: BrogueModule | null = null;
let running = false;
let exited = false;
const queue: BrogueEventTuple[] = [];
let wake: (() => void) | null = null;
let modifiers = { shift: false, ctrl: false };

// Flush requests from the host: queued until the game reaches a safe point.
let pendingFlushIds: number[] = [];
let inFlightFlushIds: number[] = [];
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

async function fetchVerified(
  url: string,
  file: RuntimeFile,
  onProgress: (loaded: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
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
    if (loaded + value.length > bytes.length) {
      throw Object.assign(new Error(`${file.path} is larger than expected.`), { kind: 'integrity' });
    }
    bytes.set(value, loaded);
    loaded += value.length;
    onProgress(loaded);
  }
  if (loaded !== file.size) {
    throw Object.assign(new Error(`${file.path} is incomplete.`), { kind: 'integrity' });
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256) {
    throw Object.assign(new Error(`${file.path} failed its integrity check.`), { kind: 'integrity' });
  }
  return bytes;
}

function errorKind(error: unknown): 'network' | 'integrity' | 'out-of-memory' | 'storage' | 'crash' {
  const kind = (error as { kind?: string } | null)?.kind;
  if (kind === 'network' || kind === 'integrity' || kind === 'storage') return kind;
  const text = String(error);
  if (/out of memory|RangeError|Cannot enlarge memory/i.test(text)) return 'out-of-memory';
  return 'crash';
}

function reportFatal(error: unknown): void {
  const kind = errorKind(error);
  const actions: Record<string, string> = {
    network: 'Check your connection and try again.',
    integrity: 'Reload the page to fetch a fresh copy of the game.',
    'out-of-memory': 'Close other tabs or apps and try again.',
    storage: 'Check that site storage is allowed for this page (private browsing can block it).',
    crash: 'Return to the library and launch the game again. Your last synced progress is kept.',
  };
  post({
    type: 'error',
    error: { kind, message: error instanceof Error ? error.message : String(error), action: actions[kind] },
  });
}

async function init(message: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  const total = message.glue.file.size + message.wasm.file.size;
  let glueLoaded = 0;
  let wasmLoaded = 0;
  const progress = () =>
    post({
      type: 'status',
      status: {
        stage: 'downloading',
        detail: 'Downloading game files',
        progress: { loaded: glueLoaded + wasmLoaded, total },
      },
    });
  progress();
  const [glueBytes, wasmBinary] = await Promise.all([
    fetchVerified(message.glue.url, message.glue.file, (n) => {
      glueLoaded = n;
      progress();
    }),
    fetchVerified(message.wasm.url, message.wasm.file, (n) => {
      wasmLoaded = n;
      progress();
    }),
  ]);

  post({ type: 'status', status: { stage: 'initializing', detail: 'Starting the WebAssembly runtime' } });
  const glueUrl = URL.createObjectURL(new Blob([glueBytes], { type: 'text/javascript' }));
  let factory: ModuleFactory;
  try {
    factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
  } finally {
    URL.revokeObjectURL(glueUrl);
  }

  mod = await factory({
    wasmBinary,
    // The glue runs from a blob: URL, so it must not resolve files relative to itself.
    locateFile: (path: string) => path,
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`Brogue stopped unexpectedly: ${String(what)}`)),
    raPresent(
      cells: Uint8Array,
      playerX: number,
      playerY: number,
      mode: number,
      inGame: number,
      state: Int32Array,
    ) {
      post({ type: 'frame', cells, playerX, playerY, mode, inGame: inGame !== 0, state }, [
        cells.buffer,
        state.buffer,
      ]);
    },
    raPollEvent(): BrogueEventTuple | null {
      return queue.shift() ?? null;
    },
    raWaitForInput(ms: number): Promise<void> {
      if (queue.length > 0 || pendingFlushIds.length > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = ms < 1e9 ? setTimeout(() => wakeGame(), ms) : undefined;
        wake = () => {
          if (timer !== undefined) clearTimeout(timer);
          resolve();
        };
      });
    },
    raModifierHeld(modifier: number): boolean {
      return modifier === 0 ? modifiers.shift : modifier === 1 ? modifiers.ctrl : false;
    },
    raTakeFlushRequest(): boolean {
      if (pendingFlushIds.length === 0) return false;
      inFlightFlushIds.push(...pendingFlushIds);
      pendingFlushIds = [];
      return true;
    },
    async raSyncFs(): Promise<void> {
      const ids = inFlightFlushIds;
      inFlightFlushIds = [];
      try {
        await syncFs();
        for (const id of ids) post({ type: 'flushed', id });
      } catch (error) {
        for (const id of ids) post({ type: 'flushed', id, error: String(error) });
      }
    },
    raNotify(eventId: number, data1: number, data2: number, str1: string, str2: string) {
      post({ type: 'notify', eventId, data1, data2, str1, str2 });
    },
    raGraphicsModeChanged(mode: number) {
      post({ type: 'graphics-mode', mode });
    },
    raGameExit(status: number) {
      running = false;
      exited = true;
      post({ type: 'exit', status });
    },
  });

  post({ type: 'status', status: { stage: 'restoring-saves', detail: 'Restoring saved games' } });
  const { FS, IDBFS } = mod;
  FS.mkdir(SAVE_DIR);
  // autoPersist writes each file to IndexedDB as soon as Brogue closes, renames
  // or deletes it, so a saved game survives an immediate reload or tab kill.
  FS.mount(IDBFS, { autoPersist: true }, SAVE_DIR);
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
  FS.chdir(SAVE_DIR);
  post({ type: 'ready' });
}

function start(args: string[]): void {
  if (!mod || running || exited) return;
  running = true;
  post({ type: 'status', status: { stage: 'running' } });
  try {
    // With Asyncify, callMain returns as soon as the game first waits for input.
    mod.callMain(args);
  } catch (error) {
    // exit() inside the runtime throws ExitStatus; anything else is a crash.
    if ((error as { name?: string } | null)?.name !== 'ExitStatus') reportFatal(error);
  }
}

async function flush(id: number): Promise<void> {
  if (running) {
    // The game services this at its next input wait or pause.
    pendingFlushIds.push(id);
    wakeGame();
    return;
  }
  try {
    await syncFs();
    post({ type: 'flushed', id });
  } catch (error) {
    post({ type: 'flushed', id, error: String(error) });
  }
}

function listSaveFiles(): SaveFile[] {
  if (!mod) return [];
  const { FS } = mod;
  const files: SaveFile[] = [];
  for (const name of FS.readdir(SAVE_DIR)) {
    if (name === '.' || name === '..') continue;
    const path = `${SAVE_DIR}/${name}`;
    const stat = FS.stat(path);
    if (!FS.isFile(stat.mode)) continue;
    const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
    files.push({ path: name, bytes: FS.readFile(path), modifiedAt: mtime });
  }
  return files;
}

let internalFlushId = 0;
function waitForFlush(): Promise<void> {
  return new Promise<void>((resolve) => {
    // Negative ids never collide with the page's (positive) request ids.
    const id = --internalFlushId;
    flushWaiters.set(id, resolve);
    void flush(id);
  });
}

/** Never overwrite: an imported file whose name exists gets " (imported N)" before its suffix. */
function availableName(name: string): string {
  if (!mod) return name;
  const { FS } = mod;
  if (!FS.analyzePath(`${SAVE_DIR}/${name}`).exists) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${base} (imported${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!FS.analyzePath(`${SAVE_DIR}/${candidate}`).exists) return candidate;
  }
}

async function importFiles(id: number, files: SaveFile[]): Promise<void> {
  if (!mod) {
    post({ type: 'imported', id, error: 'The game is not loaded.' });
    return;
  }
  try {
    for (const file of files) {
      if (file.path.includes('/') || file.path.startsWith('.'))
        throw new Error(`Unsupported file name: ${file.path}`);
      mod.FS.writeFile(`${SAVE_DIR}/${availableName(file.path)}`, file.bytes);
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
    case 'event': {
      const last = queue[queue.length - 1];
      // Like SDL, only the latest pointer position matters while the game is busy.
      if (message.event[0] === MOUSE_ENTERED_CELL && last && last[0] === MOUSE_ENTERED_CELL) {
        queue[queue.length - 1] = message.event;
      } else {
        queue.push(message.event);
      }
      wakeGame();
      break;
    }
    case 'modifiers':
      modifiers = { shift: message.shift, ctrl: message.ctrl };
      break;
    case 'flush':
      void flush(message.id);
      break;
    case 'export':
      (running ? waitForFlush() : Promise.resolve())
        .then(() => post({ type: 'exported', id: message.id, files: listSaveFiles() }))
        .catch((error: unknown) =>
          post({ type: 'exported', id: message.id, files: [], error: String(error) }),
        );
      break;
    case 'import':
      void importFiles(message.id, message.files);
      break;
  }
};

// SPDX-License-Identifier: GPL-2.0-only
/**
 * Web Worker hosting the Angband WebAssembly module.
 *
 * Angband runs here with our display module (port/main-web.c). It posts the
 * screen on every refresh and blocks (Asyncify) when it waits for input;
 * events from the page (keys, clicks) are queued until it reads them.
 *
 * Saves: the player's directory (/angband/user, where Angband keeps
 * Angband/save, scores, character dumps and pref files) is an IDBFS mount with
 * autoPersist, so each file the game closes is in IndexedDB at once. The game
 * data (/angband/lib) is preloaded read-only.
 *
 * Angband's "save and quit" ends the program. A fresh module instance then
 * starts it again at its savefile menu, as launching the desktop game again
 * would; quitting from that menu ends the session.
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { FromWorker, ToWorker, VerifiedFile } from './protocol.ts';

const USER = '/angband/user';
/** Angband's user directory (init.c: PRIVATE_USER_PATH/VERSION_NAME). */
const HOME = `${USER}/Angband`;
/** Subdirectories of HOME that saves can be imported into. */
const DIRS = ['save', 'scores', 'panic', 'archive'];

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

interface AngbandModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  callMain(args: string[]): number;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<AngbandModule>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

function post(message: FromWorker, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

let factory: ModuleFactory | null = null;
let wasmBinary: Uint8Array | null = null;
let dataBuffer: ArrayBuffer | null = null;
let mod: AngbandModule | null = null;
let running = false;
let args: string[] = [];
/** A character was loaded or created since Angband last started. */
let played = false;
const events: number[] = [];
let wake: (() => void) | null = null;
let pendingFlushes: number[] = [];
let graphicsRequest = -1;
let syncChain: Promise<void> = Promise.resolve();
let lastSaves = '';

function savesList(): string[] {
  if (!mod) return [];
  const { FS } = mod;
  const dir = `${HOME}/save`;
  if (!FS.analyzePath(dir).exists) return [];
  const saves: { name: string; mtime: number }[] = [];
  for (const file of FS.readdir(dir)) {
    if (file.startsWith('.')) continue;
    const stat = FS.stat(`${dir}/${file}`);
    if (!FS.isFile(stat.mode)) continue;
    saves.push({ name: file, mtime: stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime) });
  }
  return saves.sort((a, b) => b.mtime - a.mtime).map((save) => save.name);
}

function postSaves(): void {
  const names = savesList();
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
    crash:
      'Return to the library and launch the game again. Angband saves when you change level and with Ctrl-S.',
  };
  post({
    type: 'error',
    error: { kind, message: error instanceof Error ? error.message : text, action: actions[kind] },
  });
}

/** A fresh Angband process: a new module instance, the player's files restored from IndexedDB. */
async function instantiate(): Promise<void> {
  if (!factory || !wasmBinary || !dataBuffer) return;
  events.length = 0;
  const buffer = dataBuffer;
  mod = await factory({
    wasmBinary,
    locateFile: (path: string) => path,
    getPreloadedPackage: () => buffer,
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`Angband stopped unexpectedly: ${String(what)}`)),
    onExit: (status: number) => void exited(status),
    raPresent(
      cells: Uint8Array,
      tiles: Uint16Array,
      cols: number,
      rows: number,
      cx: number,
      cy: number,
      cursor: number,
      state: Int32Array,
    ) {
      // ST_GENERATED: a character is loaded or being made; ST_IN_GAME.
      if (state[31] === 1) played = true;
      if (state[0] !== 1) postSaves();
      post(
        { type: 'frame', cols, rows, cells, tiles, cursor: { x: cx, y: cy, visible: cursor !== 0 }, state },
        [cells.buffer, tiles.buffer, state.buffer],
      );
    },
    raPollEvent(): number {
      return events.shift() ?? 0;
    },
    raWaitForEvent(): Promise<void> {
      if (events.length > 0 || pendingFlushes.length > 0 || graphicsRequest >= 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        wake = resolve;
      });
    },
    raFlushEvents() {
      events.length = 0;
    },
    raSleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 250)));
    },
    raGraphicsRequest(): number {
      const mode = graphicsRequest;
      graphicsRequest = -1;
      return mode;
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
  const { FS, IDBFS } = mod;
  if (!FS.analyzePath('/angband').exists) FS.mkdir('/angband');
  if (!FS.analyzePath(USER).exists) FS.mkdir(USER);
  FS.mount(IDBFS, { autoPersist: true }, USER);
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
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
  const [glue, wasm, data] = await Promise.all(
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
  dataBuffer = data!.buffer as ArrayBuffer;
  post({ type: 'status', status: { stage: 'restoring-saves', detail: 'Restoring saved games' } });
  await instantiate();
  postSaves();
  post({ type: 'ready' });
}

function run(): void {
  if (!mod || running) return;
  running = true;
  played = false;
  post({ type: 'status', status: { stage: 'running' } });
  try {
    // A copy: Emscripten's callMain puts the program name in front of the array it is given.
    mod.callMain([...args]);
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'ExitStatus') reportFatal(error);
  }
}

/** Angband quit: back to its savefile menu after a game, or the end of the session. */
async function exited(status: number): Promise<void> {
  running = false;
  try {
    await syncFs();
  } catch {
    // autoPersist has already written each file as it closed.
  }
  const restart = played;
  try {
    await instantiate();
  } catch (error) {
    reportFatal(error);
    return;
  }
  postSaves();
  post({ type: 'exit', status, restarted: restart });
  if (restart) run();
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

/** The player's files: save/, scores/, panic/, archive/, and the rest of the user directory under user/. */
function exportFiles(): SaveFile[] {
  return listFiles(HOME, '').map((file) =>
    DIRS.includes(file.path.split('/')[0]!) ? file : { ...file, path: `user/${file.path}` },
  );
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
    const { FS } = mod;
    for (let file of files) {
      // A savefile on its own (as desktop Angband keeps it in its save folder) goes to save/.
      if (!file.path.includes('/')) file = { ...file, path: `save/${file.path}` };
      const [dir, ...rest] = file.path.split('/');
      if (!dir || !(DIRS.includes(dir) || dir === 'user') || rest.length !== 1 || !rest[0] || rest[0].startsWith('.'))
        throw new Error(`Unsupported file name: ${file.path}`);
      const folder = dir === 'user' ? HOME : `${HOME}/${dir}`;
      mkdirs(folder);
      let target = `${folder}/${rest[0]}`;
      for (let n = 2; FS.analyzePath(target).exists; n++) target = `${folder}/${rest[0]} (imported ${n})`;
      FS.writeFile(target, file.bytes);
    }
    await syncFs();
    lastSaves = '';
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
      args = message.args;
      run();
      break;
    case 'events':
      events.push(...message.events);
      wakeGame();
      break;
    case 'graphics':
      graphicsRequest = message.mode;
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
        .then(() => post({ type: 'exported', id: message.id, files: exportFiles() }))
        .catch((error: unknown) =>
          post({ type: 'exported', id: message.id, files: [], error: String(error) }),
        );
      break;
    case 'import':
      void importFiles(message.id, message.files);
      break;
  }
};

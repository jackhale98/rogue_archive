// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Web Worker hosting the DCSS WebAssembly module.
 *
 * The game runs in headless WebTiles mode. Its socket is replaced by this
 * worker (port/rogue-archive-platform.cc): fragments the game "sends" are
 * joined into newline-terminated JSON messages and passed to the page, where
 * upstream's WebTiles client renders them; control messages from the page are
 * queued here until the game reads them. Asyncify lets the game's blocking
 * reads yield to this worker's event loop.
 *
 * Messages starting with "*" are meant for the WebTiles server, not the
 * client; the few that matter without a server are handled here.
 *
 * Saves: SAVEDIR (/saves) is an IDBFS mount with autoPersist, so every file the
 * game writes reaches IndexedDB right away. When a game ends, the process
 * exits like a real DCSS process; the worker then prepares a fresh one, which
 * starts when the player picks a character (like a WebTiles lobby).
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { FromWorker, SavedCharacter, ToWorker, VerifiedFile } from './protocol.ts';

const SAVE_DIR = '/saves';
/** Regenerable caches DCSS keeps in its save directory; not part of exports. */
const CACHE_DIRS = new Set(['des', 'db']);
/** DCSS keeps its caches beside the saves (SAVEDIR/saves/des, saves/db). */
const CACHE_PARENT = `${SAVE_DIR}/saves`;
/** The caches built with the game (scripts/build.sh), in the read-only data package. */
const SHIPPED_CACHE = '/crawl/cache';
/**
 * The data files' modification time (seconds), as set by scripts/build.sh when
 * it built the caches: DCSS treats a cache as current when it matches.
 */
const DATA_MTIME = 1_000_000_000;
const ATTACH = '{"msg":"attach","primary":true}';

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
  lstat(path: string): { mode: number; mtime: Date | number };
  isLink(mode: number): boolean;
  symlink(target: string, path: string): void;
  unlink(path: string): void;
  rmdir(path: string): void;
  utime(path: string, atime: number, mtime: number): void;
}

interface CrawlModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  callMain(args: string[]): number;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<CrawlModule>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

function post(message: FromWorker): void {
  scope.postMessage(message);
}

let factory: ModuleFactory | null = null;
let wasmBinary: Uint8Array<ArrayBuffer> | null = null;
let dataPackage: ArrayBuffer | null = null;
let mod: CrawlModule | null = null;
let args: string[] = [];
let running = false;
let syncChain: Promise<void> = Promise.resolve();

/** Control messages for the game, oldest first. */
const inbox: Uint8Array[] = [];
let wake: (() => void) | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Outgoing: bytes of the message being assembled, and complete messages not yet posted. */
let partial: Uint8Array[] = [];
let outbox: string[] = [];
let outboxScheduled = false;
let exitReason = { type: 'unknown', message: '' };

function deliver(text: string): void {
  inbox.push(encoder.encode(text));
  const resolve = wake;
  wake = null;
  resolve?.();
}

function postOutbox(): void {
  outboxScheduled = false;
  if (outbox.length === 0) return;
  const lines = outbox;
  outbox = [];
  post({ type: 'messages', lines });
}

/** A complete message from the game. */
function received(text: string): void {
  if (!text.startsWith('*')) {
    outbox.push(text);
    if (!outboxScheduled) {
      outboxScheduled = true;
      // The game produces messages in bursts between reads; post each burst once.
      queueMicrotask(postOutbox);
    }
    return;
  }
  // For the server. "flush_messages" marks the end of a burst; the rest
  // (client_path, milestone, dump) only matter to a multi-user server.
  try {
    const message = JSON.parse(text.slice(1)) as { msg?: string; type?: string; message?: string };
    if (message.msg === 'flush_messages') postOutbox();
    else if (message.msg === 'exit_reason')
      exitReason = { type: message.type ?? 'unknown', message: message.message ?? '' };
  } catch {
    // Not for us.
  }
}

function receiveBytes(bytes: Uint8Array): void {
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 10) continue;
    partial.push(bytes.subarray(start, i));
    const length = partial.reduce((sum, part) => sum + part.length, 0);
    const whole = new Uint8Array(length);
    let at = 0;
    for (const part of partial) {
      whole.set(part, at);
      at += part.length;
    }
    partial = [];
    received(decoder.decode(whole));
    start = i + 1;
  }
  if (start < bytes.length) partial.push(bytes.slice(start));
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

/** Files shipped gzip-compressed (checked as downloaded, then inflated). */
async function inflate(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!path.endsWith('.gzip')) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
    crash: 'Return to the library and launch the game again. DCSS saves when you change level or save.',
  };
  post({
    type: 'error',
    error: { kind, message: error instanceof Error ? error.message : String(error), action: actions[kind] },
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
  progress();
  const [glueBytes, wasm, data] = await Promise.all(
    parts.map(async (part, i) =>
      inflate(
        part.file.path,
        await fetchVerified(part.url, part.file, (n) => {
          loaded[i] = n;
          progress();
        }),
      ),
    ),
  );
  wasmBinary = wasm!;
  dataPackage = data!.buffer;

  post({ type: 'status', status: { stage: 'initializing', detail: 'Starting the WebAssembly runtime' } });
  const glueUrl = URL.createObjectURL(new Blob([glueBytes!], { type: 'text/javascript' }));
  try {
    factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
  } finally {
    URL.revokeObjectURL(glueUrl);
  }
  await instantiate();
  post({ type: 'ready', characters: listCharacters() });
}

/** A fresh game process: new module instance, saves restored from IndexedDB. */
async function instantiate(): Promise<void> {
  if (!factory || !wasmBinary || !dataPackage) return;
  inbox.length = 0;
  partial = [];
  exitReason = { type: 'unknown', message: '' };
  const data = dataPackage;
  mod = await factory({
    wasmBinary,
    // The glue runs from a blob: URL, so it must not resolve files relative to itself.
    locateFile: (path: string) => path,
    // The game data package was downloaded and verified above.
    getPreloadedPackage: () => data,
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`DCSS stopped unexpectedly: ${String(what)}`)),
    onExit: (status: number) => void exited(status),
    raSend(bytes: Uint8Array) {
      receiveBytes(bytes);
    },
    raPending(): boolean {
      return inbox.length > 0;
    },
    raWait(): Promise<void> {
      if (inbox.length > 0) return Promise.resolve();
      postOutbox();
      return new Promise<void>((resolve) => {
        wake = resolve;
      });
    },
    raTake(): Uint8Array {
      return inbox.shift() ?? new Uint8Array();
    },
  });

  post({ type: 'status', status: { stage: 'restoring-saves', detail: 'Restoring saved games' } });
  const { FS, IDBFS } = mod;
  if (!FS.analyzePath(SAVE_DIR).exists) FS.mkdir(SAVE_DIR);
  // autoPersist writes each file to IndexedDB as soon as the game closes,
  // renames or deletes it, so a save survives an immediate reload or tab kill.
  FS.mount(IDBFS, { autoPersist: true }, SAVE_DIR);
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
  if (linkShippedCaches(mod.FS)) await syncFs().catch(() => undefined);
}

/**
 * Points DCSS's cache directories at the caches shipped with the game, so the
 * first launch neither builds them (a minute and too much memory on phones)
 * nor stores 13 MB of them in IndexedDB. Earlier versions built them here and
 * kept them in IndexedDB; those copies are removed. Returns whether anything
 * in the save directory changed.
 */
function linkShippedCaches(FS: EmscriptenFS): boolean {
  if (!FS.analyzePath(SHIPPED_CACHE).exists) return false;
  // The data files carry the time the caches were built against.
  const touch = (path: string) => {
    for (const name of FS.readdir(path)) {
      if (name === '.' || name === '..') continue;
      const child = `${path}/${name}`;
      FS.utime(child, DATA_MTIME * 1000, DATA_MTIME * 1000);
      if (FS.isDir(FS.lstat(child).mode)) touch(child);
    }
  };
  touch('/crawl/data');
  let changed = false;
  if (!FS.analyzePath(CACHE_PARENT).exists) {
    FS.mkdir(CACHE_PARENT);
    changed = true;
  }
  for (const name of CACHE_DIRS) {
    const path = `${CACHE_PARENT}/${name}`;
    const target = `${SHIPPED_CACHE}/${name}`;
    if (FS.analyzePath(path).exists) {
      if (FS.isLink(FS.lstat(path).mode)) continue;
      removeTree(FS, path);
    }
    FS.symlink(target, path);
    changed = true;
  }
  return changed;
}

function removeTree(FS: EmscriptenFS, path: string): void {
  if (FS.isDir(FS.lstat(path).mode)) {
    for (const name of FS.readdir(path)) {
      if (name !== '.' && name !== '..') removeTree(FS, `${path}/${name}`);
    }
    FS.rmdir(path);
  } else {
    FS.unlink(path);
  }
}

function start(): void {
  if (!mod || running) return;
  running = true;
  post({ type: 'status', status: { stage: 'running' } });
  // The client attaches first, like a WebTiles server connecting the player.
  deliver(ATTACH);
  try {
    // With Asyncify, callMain returns as soon as the game first waits for input.
    mod.callMain(args);
  } catch (error) {
    // exit() inside the runtime throws ExitStatus; anything else is a crash.
    if ((error as { name?: string } | null)?.name !== 'ExitStatus') reportFatal(error);
  }
}

async function exited(status: number): Promise<void> {
  running = false;
  postOutbox();
  try {
    await syncFs();
  } catch {
    // autoPersist has already written each file as it closed.
  }
  // The reason is read before the fresh instance resets it.
  const reason = exitReason;
  // A fresh process for the next game, started when the player picks one.
  try {
    await instantiate();
  } catch (error) {
    reportFatal(error);
    return;
  }
  post({
    type: 'exit',
    status,
    reason: reason.type,
    message: reason.message,
    characters: listCharacters(),
  });
}

/**
 * Saved characters: "<name>.cs" files in SAVEDIR/saves (DCSS files.cc
 * get_save_filename; other game types, such as Sprint, use subdirectories).
 */
function listCharacters(): SavedCharacter[] {
  return listSaveFiles(SAVE_DIR, '', false)
    .filter((file) => /^saves\/[^/]+\.cs$/.test(file.path))
    .map((file) => ({
      name: file.path.slice('saves/'.length, -3),
      path: file.path,
      modifiedAt: file.modifiedAt,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function flush(id: number): Promise<void> {
  // The game only yields to this worker while it waits for input, when no
  // file is half-written; syncing now captures a consistent state.
  try {
    await syncFs();
    post({ type: 'flushed', id });
  } catch (error) {
    post({ type: 'flushed', id, error: String(error) });
  }
}

function listSaveFiles(dir = SAVE_DIR, prefix = '', withBytes = true): SaveFile[] {
  if (!mod) return [];
  const { FS } = mod;
  const files: SaveFile[] = [];
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    // Caches are regenerable (and, as links, point into the game data).
    if (CACHE_DIRS.has(name)) continue;
    const path = `${dir}/${name}`;
    const stat = FS.lstat(path);
    if (FS.isLink(stat.mode)) continue;
    if (FS.isDir(stat.mode)) {
      files.push(...listSaveFiles(path, `${prefix}${name}/`, withBytes));
      continue;
    }
    if (!FS.isFile(stat.mode)) continue;
    const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
    files.push({
      path: `${prefix}${name}`,
      bytes: withBytes ? FS.readFile(path) : new Uint8Array(),
      modifiedAt: mtime,
    });
  }
  return files;
}

/** Never overwrite: an imported file whose name exists gets " (imported N)" before its suffix. */
function availableName(path: string): string {
  if (!mod) return path;
  const { FS } = mod;
  if (!FS.analyzePath(`${SAVE_DIR}/${path}`).exists) return path;
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${dir}${base} (imported${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!FS.analyzePath(`${SAVE_DIR}/${candidate}`).exists) return candidate;
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
      // A save downloaded on its own ("Name.cs", as desktop DCSS names it)
      // belongs in the saves directory.
      if (/^[^/]+\.cs$/.test(file.path)) file = { ...file, path: `saves/${file.path}` };
      const segments = file.path.split('/');
      if (segments.some((part) => !part || part.startsWith('.')))
        throw new Error(`Unsupported file name: ${file.path}`);
      let dir = SAVE_DIR;
      for (const part of segments.slice(0, -1)) {
        dir += `/${part}`;
        if (!FS.analyzePath(dir).exists) FS.mkdir(dir);
      }
      FS.writeFile(`${SAVE_DIR}/${availableName(file.path)}`, file.bytes);
    }
    await syncFs();
    post({ type: 'imported', id });
    post({ type: 'characters', characters: listCharacters() });
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
      start();
      break;
    case 'send':
      deliver(message.text);
      break;
    case 'flush':
      void flush(message.id);
      break;
    case 'export':
      syncFs()
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

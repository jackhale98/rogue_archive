// SPDX-License-Identifier: NGPL
/**
 * Web Worker hosting the NetHack WebAssembly module (upstream's web build).
 *
 * NetHack calls the shim window port for every window operation and waits
 * for the answer (Asyncify); adapter/windowport.ts answers, the way tty does,
 * and sends the screen to the page. Each game is one run of the program: it
 * ends when you save (S), die or quit, and a fresh instance is prepared for
 * the next. Starting as a character with a save file continues that game, as
 * on a desktop install.
 *
 * Files: the game data is embedded at the root. /save (NetHack's save files,
 * save/<uid><name>) is an IDBFS mount with autoPersist; the score files
 * (record, logfile, xlogfile, livelog) are kept in /scores (IDBFS) and copied
 * to the root before a game and back after it.
 */
import type { RuntimeFile, SaveFile } from '@rogue-archive/game-api';
import type { FromWorker, SavedGame, ToWorker, VerifiedFile } from './protocol.ts';
import { WindowPort, type NhInput, type NhModule } from './windowport.ts';

const SAVE_DIR = '/save';
const SCORES_DIR = '/scores';
const SCORE_FILES = ['record', 'logfile', 'xlogfile', 'livelog'];
/** NetHack runs as uid 0 here: save files are save/0<name>. */
const SAVE_PREFIX = '0';
/** Options for every game (NETHACKOPTIONS, read after sysconf): no permanent
    inventory window (sysconf turns it on; the shell shows the inventory as a
    menu), and colour. */
/** The player's home directory, where NetHack looks for its .nethackrc. */
const HOME = '/home/nethack';
const OPTIONS = '!perm_invent,color';
const CONFIG = ['BIND=mouse1:mouseaction', 'BIND=mouse2:therecmdmenu', ''].join('\n');

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
  unlink(path: string): void;
}

interface Module extends NhModule {
  FS: EmscriptenFS;
  IDBFS: unknown;
  ENV: Record<string, string>;
  ccall(name: string, ret: string | null, types: string[], args: unknown[], opts?: object): unknown;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<Module>;

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  nhWindowCall?: (name: string, ...args: unknown[]) => Promise<unknown>;
};

function post(message: FromWorker, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

let factory: ModuleFactory | null = null;
let wasmBinary: Uint8Array | null = null;
let mod: Module | null = null;
let running = false;
let current = '';
const inputs: NhInput[] = [];
let wake: ((input: NhInput) => void) | null = null;
let syncChain: Promise<void> = Promise.resolve();

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

/** Saved games: save/<uid><name> files, most recent first. */
function listSaves(): SavedGame[] {
  if (!mod) return [];
  const { FS } = mod;
  const saves: SavedGame[] = [];
  for (const file of FS.readdir(SAVE_DIR)) {
    if (file.startsWith('.')) continue;
    const stat = FS.stat(`${SAVE_DIR}/${file}`);
    if (!FS.isFile(stat.mode)) continue;
    const name = file.replace(/^\d+/, '');
    if (!name) continue;
    const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
    saves.push({ name, modifiedAt: mtime });
  }
  return saves.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function copy(from: string, to: string): void {
  if (!mod?.FS.analyzePath(from).exists) return;
  mod.FS.writeFile(to, mod.FS.readFile(from));
}

/** A fresh NetHack process: a new module instance, files restored from IndexedDB. */
async function instantiate(): Promise<void> {
  if (!factory || !wasmBinary) return;
  inputs.length = 0;
  const binary = wasmBinary;
  mod = await factory({
    // Upstream's build takes the module's own instantiation hook (not
    // wasmBinary): the bytes downloaded and verified above are used.
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) {
      (
        WebAssembly.instantiate(
          binary as BufferSource,
          imports,
        ) as Promise<WebAssembly.WebAssemblyInstantiatedSource>
      ).then(
        (result) => receive(result.instance, result.module),
        (error: unknown) => reportFatal(error),
      );
      return {};
    },
    noInitialRun: true,
    // The C library reads the environment as the module starts: HOME (for
    // ~/.nethackrc) and NETHACKOPTIONS are set before that.
    preRun: [
      (m: { ENV: Record<string, string> }) => {
        m.ENV.HOME = HOME;
        m.ENV.NETHACKOPTIONS = OPTIONS;
      },
    ],
    locateFile: (path: string) => path,
    print: (text: string) => post({ type: 'log', level: 'info', text }),
    printErr: (text: string) => post({ type: 'log', level: 'warn', text }),
    onAbort: (what: unknown) => reportFatal(new Error(`NetHack stopped unexpectedly: ${String(what)}`)),
  });
  const { FS, IDBFS } = mod;
  for (const dir of [SAVE_DIR, SCORES_DIR]) {
    if (!FS.analyzePath(dir).exists) FS.mkdir(dir);
    FS.mount(IDBFS, { autoPersist: true }, dir);
  }
  try {
    await syncFs(true);
  } catch (error) {
    throw Object.assign(new Error(`Saved games could not be read: ${String(error)}`), { kind: 'storage' });
  }
  for (const file of SCORE_FILES) copy(`${SCORES_DIR}/${file}`, `/${file}`);
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

function nextInput(): Promise<NhInput> {
  const queued = inputs.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    wake = resolve;
  });
}

async function start(name: string): Promise<void> {
  if (!mod || running) return;
  running = true;
  current = name;
  post({ type: 'status', status: { stage: 'running' } });
  try {
    await instantiate();
  } catch (error) {
    reportFatal(error);
    return;
  }
  const game = mod!;
  const port = new WindowPort({
    nextInput,
    frame: (frame) => {
      const cells = frame.cells.slice();
      const under = frame.under.slice();
      const tiles = frame.tiles.slice();
      post({ type: 'frame', ...frame, cells, under, tiles }, [
        cells.buffer,
        under.buffer,
        tiles.buffer,
        frame.state.buffer,
      ]);
    },
    message: (text) => post({ type: 'message', text }),
    delay: () => new Promise((resolve) => setTimeout(resolve, 40)),
  });
  port.attach(game);
  scope.nhWindowCall = (name: string, ...args: unknown[]) => port.call(name, ...args);
  // NetHack's configuration file (~/.nethackrc, read before NETHACKOPTIONS):
  // the touch layer's mouse buttons. A tap is mouse1, NetHack's click action
  // (travel, or move, attack, open next to the hero); a long press is
  // mouse2, its menu of what can be done at a place.
  if (!game.FS.analyzePath(HOME).exists) game.FS.mkdir(HOME);
  game.FS.writeFile(`${HOME}/.nethackrc`, new TextEncoder().encode(CONFIG));
  game.ccall('shim_graphics_set_callback', null, ['string'], ['nhWindowCall']);
  // main(argc, argv): "nethack -u <name>".
  const args = ['nethack', '-u', name];
  const argv = game._malloc(4 * (args.length + 1));
  args.forEach((arg, i) => {
    const bytes = new TextEncoder().encode(arg).length + 1;
    const ptr = game._malloc(bytes);
    game.stringToUTF8(arg, ptr, bytes);
    game.setValue(argv + 4 * i, ptr, '*');
  });
  game.setValue(argv + 4 * args.length, 0, '*');
  try {
    await game.ccall('main', 'number', ['number', 'number'], [args.length, argv], { async: true });
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'ExitStatus') {
      running = false;
      reportFatal(error);
      return;
    }
  }
  await exited();
}

async function exited(): Promise<void> {
  running = false;
  for (const file of SCORE_FILES) copy(`/${file}`, `${SCORES_DIR}/${file}`);
  try {
    await syncFs();
  } catch {
    // autoPersist has already written each file as it closed.
  }
  const saved = !!mod?.FS.analyzePath(`${SAVE_DIR}/${SAVE_PREFIX}${current}`).exists;
  try {
    await instantiate();
  } catch (error) {
    reportFatal(error);
    return;
  }
  post({ type: 'exit', saved, saves: listSaves() });
}

function listFiles(): SaveFile[] {
  if (!mod) return [];
  const { FS } = mod;
  const files: SaveFile[] = [];
  for (const dir of [SAVE_DIR, SCORES_DIR])
    for (const name of FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      const stat = FS.stat(path);
      if (!FS.isFile(stat.mode)) continue;
      const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
      files.push({ path: `${dir.slice(1)}/${name}`, bytes: FS.readFile(path), modifiedAt: mtime });
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
      if (SCORE_FILES.includes(name)) {
        FS.writeFile(`${SCORES_DIR}/${name}`, file.bytes);
        continue;
      }
      // A save file from another install (save/<uid><name>): this one runs as uid 0.
      const character = name.replace(/^\d+/, '') || name;
      let target = `${SAVE_DIR}/${SAVE_PREFIX}${character}`;
      for (let n = 2; FS.analyzePath(target).exists; n++)
        target = `${SAVE_DIR}/${SAVE_PREFIX}${character}-${n}`;
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
      void start(message.name);
      break;
    case 'input': {
      const input: NhInput | null =
        message.click !== undefined
          ? { click: message.click }
          : message.key !== undefined
            ? { key: message.key }
            : null;
      if (!input) break;
      const resolve = wake;
      if (resolve) {
        wake = null;
        resolve(input);
      } else inputs.push(input);
      break;
    }
    case 'flush':
      syncFs()
        .then(() => post({ type: 'flushed', id: message.id }))
        .catch((error: unknown) => post({ type: 'flushed', id: message.id, error: String(error) }));
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

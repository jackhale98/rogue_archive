// SPDX-License-Identifier: CC-BY-SA-3.0
/**
 * Rogue Archive adapter for Cataclysm: Dark Days Ahead.
 *
 * Upstream's own web build (make NATIVE=emscripten) runs on the page: SDL 2
 * draws into a canvas with WebGL, and the game's blocking loop yields to the
 * browser through Asyncify. The adapter downloads and verifies the runtime
 * and the game data, gives the game a canvas sized to the area the shell
 * leaves free, feeds it keys (synthetic key events on a private element SDL
 * listens to, so the shell decides what reaches the game), and reads a
 * read-only snapshot (port/rogue-archive-web.cpp): the keybinding context the
 * game waits in, the player's position, the screen as text, the messages.
 *
 * Saves: upstream's web build mounts the game's user directory
 * (/home/web_user/.cataclysm-dda: config, worlds, saves) on IndexedDB itself
 * and writes it back after the game writes files. The adapter also syncs it
 * when the page is hidden or left. A game continues from where it was last
 * saved (Save and quit, S), as on the desktop.
 */
import {
  GAME_API_VERSION,
  type GameAdapter,
  type GameExitPrompt,
  type GameHost,
  type GameInput,
  type GameModule,
  type InitializeOptions,
  type LogEntry,
  type Presentation,
  type RuntimeFile,
  type SaveFile,
} from '@rogue-archive/game-api';
import {
  CDDA_COMMANDS,
  CDDA_TOUCH_LAYOUT,
  controlsFor,
  findCommand,
  strokeFor,
  strokeForInput,
  type CddaContext,
  type KeyStroke,
} from './input.ts';
import { detectContext, parseState, type CddaState } from './state.ts';

const GAME_ID = 'cataclysm-dda';
/** Upstream's user directory on the web (USE_HOME_DIR; main.cpp mount_idbfs). */
const HOME = '/home/web_user/.cataclysm-dda';
/** SDL listens for keys on this element only (SDL_EMSCRIPTEN_KEYBOARD_ELEMENT). */
const KEY_ELEMENT_ID = 'ra-cdda-keys';
const POLL_MS = 200;
const LOG_LINES = 200;
/** The game's smallest terminal (80x24 cells of 8x16 px, game_constants.h): smaller areas show part of it. */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 384;

interface CddaModule {
  FS: {
    readdir(path: string): string[];
    stat(path: string): { mode: number; mtime: Date | number };
    isFile(mode: number): boolean;
    isDir(mode: number): boolean;
    readFile(path: string): Uint8Array;
    writeFile(path: string, data: Uint8Array): void;
    mkdirTree(path: string): void;
    syncfs(populate: boolean, callback: (err: unknown) => void): void;
  };
  ENV: Record<string, string>;
  UTF8ToString(ptr: number): string;
  _ra_state(): number;
  _ra_screen_text(): number;
  _ra_messages(count: number): number;
  _ra_message_count(): number;
  _ra_stop(): void;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<CddaModule>;

export interface CddaDebugState {
  context: CddaContext | null;
  /** The keybinding context the game waits in (keybindings.json category), or "". */
  inputContext: string;
  inGame: boolean;
  mainMenu: boolean;
  waiting: boolean;
  player: CddaState['player'] | null;
  state: CddaState | null;
  /** The screen as text (curses windows, with ImGui windows' text over them). */
  screenText(): string;
  rowText(y: number): string;
  /** Page coordinates of the centre of a terminal cell. */
  cellToClient(x: number, y: number): { x: number; y: number };
  messages(): string[];
  files(): string[];
}

function findFile(files: readonly RuntimeFile[], path: string): RuntimeFile {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Runtime manifest is missing ${path}`);
  return file;
}

async function fetchVerified(
  url: string,
  file: RuntimeFile,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw Object.assign(new Error(`Could not download ${file.path}.`), { kind: 'network' });
  }
  if (!response.ok || !response.body)
    throw Object.assign(new Error(`Could not download ${file.path} (HTTP ${response.status}).`), {
      kind: 'network',
    });
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

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Text without the game's colour tags (<color_red>…</color>). */
export function stripTags(text: string): string {
  return text
    .replace(/<\/?color[^>]*>/g, '')
    .replace(/<\/?(?:good|bad|info|neutral|warning|stat|header)>/g, '');
}

/**
 * Records the listeners the game adds to window and document while it starts
 * (SDL's focus, resize, mouse-up, visibility, unload), so leaving the game
 * can remove them.
 */
class ListenerTracker {
  readonly #added: {
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }[] = [];
  readonly #restore: (() => void)[] = [];

  start(): void {
    for (const target of [window, document] as EventTarget[]) {
      const original = target.addEventListener;
      const added = this.#added;
      target.addEventListener = function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (listener) added.push({ target: this, type, listener, options });
        original.call(this, type, listener, options);
      };
      this.#restore.push(() => {
        target.addEventListener = original;
      });
    }
  }

  stop(): void {
    for (const restore of this.#restore.splice(0)) restore();
  }

  removeAll(): void {
    this.stop();
    for (const { target, type, listener, options } of this.#added.splice(0))
      target.removeEventListener(type, listener, options);
  }
}

/** Globals upstream's web build sets on window (main.cpp, do_turn.cpp, game.cpp). */
interface UpstreamWindow {
  setFsNeedsSync?: () => void;
  game_unsaved?: boolean;
}

class CataclysmAdapter implements GameAdapter {
  readonly apiVersion = GAME_API_VERSION;
  readonly gameId = GAME_ID;
  readonly capabilities = {
    keyboard: true,
    pointer: true,
    touch: true,
    save: true,
    saveExport: true,
    offline: true,
    audio: false,
  };
  readonly commands = CDDA_COMMANDS;
  readonly touchLayout = CDDA_TOUCH_LAYOUT;
  readonly resumeHint =
    'As in Cataclysm itself, a game continues from its last save: save and quit (S, or Save and leave here) before you go. Worlds, characters and options stay in this browser.';
  readonly debug: CddaDebugState;

  #host: GameHost | null = null;
  #module: CddaModule | null = null;
  #root: HTMLDivElement | null = null;
  #canvas: HTMLCanvasElement | null = null;
  /** SDL listens for keys here (not on the page): the shell decides what reaches the game. */
  readonly #keyTarget = document.createElement('div');
  readonly #listeners = new ListenerTracker();
  #presentation: Presentation = { compact: false, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  #resizeObserver: ResizeObserver | null = null;
  #resizeFrame = 0;
  #poll: ReturnType<typeof setInterval> | undefined;
  #context: CddaContext | null = null;
  #layoutSignature = '';
  #messageCount = -1;
  #stopped = false;
  #aborted = false;

  constructor() {
    this.debug = {
      context: null,
      inputContext: '',
      inGame: false,
      mainMenu: false,
      waiting: false,
      player: null,
      state: null,
      screenText: () => this.#screenText(),
      rowText: (y: number) => this.#screenText().split('\n')[y] ?? '',
      cellToClient: (x: number, y: number) => this.#cellToClient(x, y),
      messages: () => this.#readLog().map((entry) => entry.runs.map((run) => run.text).join('')),
      files: () => this.#listFiles().map((file) => file.path),
    };
  }

  async initialize(host: GameHost, options: InitializeOptions): Promise<void> {
    this.#host = host;
    const { runtime, runtimeBaseUrl, signal } = options;
    signal.addEventListener('abort', () => void this.shutdown(), { once: true });

    const files = [
      findFile(runtime.files, 'cataclysm-tiles.mjs'),
      findFile(runtime.files, 'cataclysm-tiles.wasm'),
      findFile(runtime.files, 'cataclysm-data.data.gzip'),
    ];
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const loaded = files.map(() => 0);
    const progress = () =>
      host.emit({
        type: 'status',
        status: {
          stage: 'downloading',
          detail: 'Downloading Cataclysm: DDA and its data',
          progress: { loaded: loaded.reduce((a, b) => a + b, 0), total },
        },
      });
    const [glue, wasm, packed] = await Promise.all(
      files.map((file, i) =>
        fetchVerified(new URL(file.path, runtimeBaseUrl).href, file, signal, (n) => {
          loaded[i] = n;
          progress();
        }),
      ),
    );
    if (signal.aborted) return;
    host.emit({ type: 'status', status: { stage: 'initializing', detail: 'Unpacking the game data' } });
    const data = await gunzip(packed!);
    if (signal.aborted) return;

    const glueUrl = URL.createObjectURL(new Blob([glue!], { type: 'text/javascript' }));
    let factory: ModuleFactory;
    try {
      factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
    } finally {
      URL.revokeObjectURL(glueUrl);
    }

    this.#buildDom(options.mount);
    this.#layout();

    const started = performance.now();
    const elapsed = () => Math.round((performance.now() - started) / 1000);
    let failed!: (error: unknown) => void;
    const failure = new Promise<never>((_, reject) => {
      failed = reject;
    });
    this.#listeners.start();
    try {
      this.#module = await Promise.race([
        factory({
          canvas: this.#canvas,
          wasmBinary: wasm,
          locateFile: (path: string) => path,
          // The verified package (the file packager's loader asks for it instead of fetching).
          getPreloadedPackage: () => data,
          print: (text: string) => host.logger.debug(text),
          printErr: (text: string) => host.logger.debug(text),
          onAbort: (what: unknown) => {
            if (this.#stopped) return;
            const error = Object.assign(new Error(`Cataclysm stopped unexpectedly: ${String(what)}`), {
              kind: /memory/i.test(String(what)) ? 'out-of-memory' : 'crash',
            });
            this.#aborted = true;
            failed(error);
            this.#fatal(error);
          },
          preRun: [
            (mod: CddaModule) => {
              // SDL reads its hints from the environment: keys only from our element.
              mod.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = `#${KEY_ELEMENT_ID}`;
              mod.ENV.LANG = 'en_US.UTF-8';
            },
          ],
        }),
        failure,
      ]);
    } finally {
      this.#listeners.stop();
    }
    if (signal.aborted) return;
    // The game loads its data before showing the main menu (tens of seconds).
    const ticker = setInterval(
      () =>
        host.emit({
          type: 'status',
          status: { stage: 'initializing', detail: `Loading the game data (${elapsed()} s)` },
        }),
      1000,
    );
    this.#scheduleResize();
    this.#poll = setInterval(() => this.#update(), POLL_MS);
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (this.#stopped || this.debug.waiting) {
              clearInterval(check);
              resolve();
            }
          }, POLL_MS);
        }),
        failure,
      ]);
    } finally {
      clearInterval(ticker);
    }
    if (signal.aborted || this.#stopped) return;
    host.logger.info(`Cataclysm: DDA ready after ${elapsed()} s`);
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  async start(): Promise<void> {
    this.#host?.emit({ type: 'status', status: { stage: 'running' } });
    this.#canvas?.focus({ preventScroll: true });
  }

  #buildDom(mount: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'cdda-root';
    root.style.cssText =
      'position:absolute;inset:0;overflow:hidden;background:#000;touch-action:none;user-select:none;-webkit-user-select:none';
    // SDL sets the canvas's size from its CSS size when the window resizes;
    // the page decides the CSS size.
    const style = document.createElement('style');
    style.textContent =
      '.cdda-root>canvas.cdda-canvas{position:absolute;display:block;outline:none;left:0;' +
      'top:var(--cdda-top,0px);width:var(--cdda-width,100%)!important;height:var(--cdda-height,100%)!important;' +
      'image-rendering:pixelated}' +
      `#${KEY_ELEMENT_ID}{position:absolute;width:0;height:0;overflow:hidden}`;
    const canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    canvas.className = 'cdda-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Cataclysm: Dark Days Ahead game screen');
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.#keyTarget.id = KEY_ELEMENT_ID;
    root.append(style, canvas, this.#keyTarget);
    mount.append(root);
    this.#root = root;
    this.#canvas = canvas;
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleResize());
    this.#resizeObserver.observe(root);
  }

  /** Places the canvas in the area the shell leaves free (at least the game's smallest terminal). */
  #layout(): void {
    const root = this.#root;
    if (!root) return;
    const { insets, compact } = this.#presentation;
    const top = compact ? insets.top : 0;
    const bottom = compact ? insets.bottom : 0;
    const width = Math.max(MIN_WIDTH, root.clientWidth);
    const height = Math.max(MIN_HEIGHT, root.clientHeight - top - bottom);
    root.style.setProperty('--cdda-top', `${top}px`);
    root.style.setProperty('--cdda-width', `${width}px`);
    root.style.setProperty('--cdda-height', `${height}px`);
  }

  #scheduleResize(): void {
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = requestAnimationFrame(() => {
      this.#layout();
      // SDL resizes the game's window (and terminal) on the page's resize event.
      if (this.#module && !this.#stopped) window.dispatchEvent(new Event('resize'));
    });
  }

  setPresentation(presentation: Presentation): void {
    this.#presentation = presentation;
    this.#scheduleResize();
  }

  // -- Input ---------------------------------------------------------------

  sendInput(input: GameInput): void {
    if (!this.#module || this.#stopped) return;
    if (input.type === 'key') {
      const stroke = strokeForInput(input);
      if (stroke) this.#press(stroke);
      return;
    }
    if (input.type === 'text') {
      for (const char of input.text) {
        const stroke = strokeFor(char === '\n' ? 'Enter' : char);
        if (stroke) this.#press(stroke);
      }
      return;
    }
    if (input.type !== 'command') return;
    const command = findCommand(input.commandId);
    if (command) for (const stroke of command.keys) this.#press(stroke);
  }

  /** One key press as a browser would send it: keydown, keypress (characters), keyup. */
  #press(stroke: KeyStroke): void {
    const fire = (type: string, keyCode: number, key: string, code: string, charCode = 0) => {
      const event = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        shiftKey: !!stroke.shift,
        ctrlKey: !!stroke.ctrl,
      });
      // keyCode and charCode are read-only on KeyboardEvent, but SDL reads them.
      Object.defineProperty(event, 'keyCode', { value: keyCode });
      Object.defineProperty(event, 'which', { value: keyCode || charCode });
      Object.defineProperty(event, 'charCode', { value: charCode });
      this.#keyTarget.dispatchEvent(event);
    };
    if (stroke.ctrl) fire('keydown', 17, 'Control', 'ControlLeft');
    if (stroke.shift) fire('keydown', 16, 'Shift', 'ShiftLeft');
    if (stroke.keyCode) fire('keydown', stroke.keyCode, stroke.key, stroke.code);
    if (stroke.charCode) fire('keypress', 0, stroke.key, stroke.code, stroke.charCode);
    if (stroke.keyCode) fire('keyup', stroke.keyCode, stroke.key, stroke.code);
    if (stroke.shift) fire('keyup', 16, 'Shift', 'ShiftLeft');
    if (stroke.ctrl) fire('keyup', 17, 'Control', 'ControlLeft');
  }

  // -- State, controls and messages ------------------------------------------

  #readState(): CddaState | null {
    const mod = this.#module;
    if (!mod || this.#stopped || this.#aborted) return null;
    return parseState(mod.UTF8ToString(mod._ra_state()));
  }

  #update(): void {
    const state = this.#readState();
    if (!state) return;
    this.debug.state = state;
    this.debug.inputContext = state.context;
    this.debug.inGame = state.inGame;
    this.debug.mainMenu = state.mainMenu;
    this.debug.waiting = state.waiting;
    this.debug.player = state.player ?? null;
    const context = detectContext(state);
    if (context !== this.#context) {
      this.#context = context;
      this.debug.context = context;
      this.#host?.emit({
        type: 'input-context',
        context: { textEntry: context === 'text', mode: context },
      });
    }
    const layout = controlsFor(context);
    const signature = `${context}|${JSON.stringify(layout.actions)}`;
    if (signature !== this.#layoutSignature) {
      this.#layoutSignature = signature;
      this.#host?.emit({ type: 'touch-layout', layout, context });
    }
    this.#updateLog();
  }

  #screenText(): string {
    const mod = this.#module;
    if (!mod || this.#stopped || this.#aborted) return '';
    return mod.UTF8ToString(mod._ra_screen_text());
  }

  #cellToClient(x: number, y: number): { x: number; y: number } {
    const canvas = this.#canvas;
    const state = this.debug.state;
    if (!canvas || !state) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width ? rect.width / canvas.width : 1;
    const scaleY = canvas.height ? rect.height / canvas.height : 1;
    return {
      x: rect.left + (x + 0.5) * state.cellW * scaleX,
      y: rect.top + (y + 0.5) * state.cellH * scaleY,
    };
  }

  #readLog(): LogEntry[] {
    const mod = this.#module;
    if (!mod || this.#stopped || this.#aborted) return [];
    let recent: [string, string][];
    try {
      recent = JSON.parse(mod.UTF8ToString(mod._ra_messages(LOG_LINES))) as [string, string][];
    } catch {
      return [];
    }
    const base = Math.max(0, mod._ra_message_count() - recent.length);
    return recent.map(([time, text], i) => ({
      id: base + i,
      group: time,
      runs: [{ text: stripTags(text) }],
    }));
  }

  #updateLog(): void {
    const mod = this.#module;
    if (!mod) return;
    const count = mod._ra_message_count();
    if (count === this.#messageCount) return;
    const reset = count < this.#messageCount || this.#messageCount < 0;
    this.#messageCount = count;
    this.#host?.emit({ type: 'message-log', reset, entries: this.#readLog() });
  }

  // -- Saves -------------------------------------------------------------------

  #sync(): Promise<void> {
    const mod = this.#module;
    if (!mod || this.#aborted) return Promise.resolve();
    return new Promise((resolve, reject) =>
      mod.FS.syncfs(false, (err) =>
        err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
      ),
    );
  }

  exitPrompt(): GameExitPrompt | null {
    const state = this.debug.state;
    if (!this.#module || this.#stopped || !state || !state.inGame || state.player?.dead) return null;
    const unsaved = (window as unknown as UpstreamWindow).game_unsaved !== false;
    if (!unsaved) return null;
    return {
      message:
        'Cataclysm keeps a game from its last save. Save and leave saves this one (as Save and quit, S); leaving without saving goes back to the last save.',
      options: [
        { id: 'save', label: 'Save and leave', primary: true },
        { id: 'leave', label: 'Leave without saving', destructive: true },
      ],
    };
  }

  /** Save and leave: the game's own Save and quit (S, then yes), back to its main menu. */
  async exitWith(optionId: string): Promise<void> {
    if (optionId !== 'save') return;
    const until = async (check: () => boolean, ms: number) => {
      const end = performance.now() + ms;
      while (!check()) {
        if (this.#stopped || this.#aborted) throw new Error('Cataclysm is not running.');
        if (performance.now() > end) throw new Error('Cataclysm did not save in time.');
        await new Promise((resolve) => setTimeout(resolve, 100));
        this.#update();
      }
    };
    // Back out of any menu to the map first.
    for (let i = 0; i < 6 && this.debug.inputContext !== 'DEFAULTMODE'; i++) {
      this.#press(strokeFor('Escape')!);
      await new Promise((resolve) => setTimeout(resolve, 300));
      this.#update();
    }
    if (this.debug.inputContext !== 'DEFAULTMODE') throw new Error('Could not reach the map to save.');
    this.#press(strokeFor('S')!);
    await until(() => this.debug.inputContext === 'YESNO', 10_000);
    this.#press(strokeFor('y')!);
    await until(() => this.debug.mainMenu && this.debug.waiting, 120_000);
    await this.#sync();
  }

  async persist(): Promise<void> {
    if (!this.#module || this.#stopped) return;
    await this.#sync();
  }

  setVisible(visible: boolean): void {
    if (!visible)
      void this.persist().catch((error: unknown) => this.#host?.logger.warn('persist failed', error));
  }

  #listFiles(): SaveFile[] {
    const mod = this.#module;
    if (!mod || this.#aborted) return [];
    const files: SaveFile[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const name of mod.FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const path = `${dir}/${name}`;
        const stat = mod.FS.stat(path);
        if (mod.FS.isDir(stat.mode)) walk(path, `${prefix}${name}/`);
        else if (mod.FS.isFile(stat.mode)) {
          const modifiedAt = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
          files.push({ path: `${prefix}${name}`, bytes: mod.FS.readFile(path), modifiedAt });
        }
      }
    };
    try {
      walk(HOME, '');
    } catch {
      // Not mounted yet.
    }
    return files;
  }

  async exportSaves(): Promise<SaveFile[]> {
    await this.persist();
    return this.#listFiles();
  }

  /** Files go back to the user directory as they were exported (config/, save/<world>/...). */
  async importSaves(files: SaveFile[]): Promise<void> {
    const mod = this.#module;
    if (!mod) throw new Error('Cataclysm is not running.');
    for (const file of files) {
      const parts = file.path.split('/');
      if (parts.some((part) => part === '' || part === '.' || part === '..'))
        throw new Error(`Unsupported file name: ${file.path}`);
      if (parts.length > 1) mod.FS.mkdirTree(`${HOME}/${parts.slice(0, -1).join('/')}`);
      mod.FS.writeFile(`${HOME}/${file.path}`, file.bytes);
    }
    await this.#sync();
  }

  #fatal(error: Error & { kind?: string }): void {
    const kind = error.kind === 'out-of-memory' ? 'out-of-memory' : 'crash';
    this.#host?.emit({
      type: 'error',
      error: {
        kind,
        message: error.message,
        action:
          kind === 'out-of-memory'
            ? 'Close other tabs or apps and try again.'
            : 'Return to the library and launch the game again. Your game continues from its last save.',
      },
    });
  }

  #shutdownPromise: Promise<void> | null = null;
  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown();
    return this.#shutdownPromise;
  }

  async #shutdown(): Promise<void> {
    if (this.#stopped) return;
    try {
      await this.#sync();
    } catch {
      // Best effort: the game syncs after each write.
    }
    this.#stopped = true;
    // The game's loop never returns: abort the runtime so its pending
    // wake-up is ignored (port/rogue-archive-web.cpp ra_stop).
    if (this.#module && !this.#aborted)
      try {
        this.#module._ra_stop();
      } catch {
        // abort() throws, as intended.
      }
    clearInterval(this.#poll);
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeObserver?.disconnect();
    this.#listeners.removeAll();
    const gl = this.#canvas?.getContext('webgl2') ?? this.#canvas?.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.#root?.remove();
    const upstream = window as unknown as UpstreamWindow;
    delete upstream.setFsNeedsSync;
    delete upstream.game_unsaved;
    this.#root = this.#canvas = null;
    this.#module = null;
  }
}

export function createAdapter(): GameAdapter & { readonly debug: CddaDebugState } {
  return new CataclysmAdapter();
}

const module: GameModule = { createAdapter };
export default module;

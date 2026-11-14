// SPDX-License-Identifier: NGPL
/**
 * Rogue Archive adapter for NetHack 5.0.0.
 *
 * NetHack runs in a Web Worker (upstream's WebAssembly build with its shim
 * window port); adapter/windowport.ts answers its window calls as tty does,
 * on an 80×24 screen, and the worker sends that screen with each change. The
 * screen is drawn with the shared terminal renderer (@rogue-archive/term-view),
 * in text or with NetHack's own tiles: whole on desktop; on phones the map is
 * zoomed and follows the hero, menus and text windows are lifted into a large
 * sheet, and the status lines become a band.
 *
 * NetHack asks who you are only when it isn't told: as on a desktop install,
 * the start screen gives the character's name (-u), and a character with a
 * save file continues that game.
 */
import {
  GAME_API_VERSION,
  SHELL_COMMAND,
  waitUntil,
  type GameAdapter,
  type GameExitPrompt,
  type GameHost,
  type GameInput,
  type GameModule,
  type GameSettingDescriptor,
  type InitializeOptions,
  type LogEntry,
  type Presentation,
  type RuntimeFile,
  type SaveFile,
} from '@rogue-archive/game-api';
import { StartScreen, relativeTime } from '@rogue-archive/start-screen';
import {
  TermRenderer,
  attachGestures,
  fitCell,
  fittedView,
  followView,
  rowText,
  type Grid,
  type Rect,
  type View,
} from '@rogue-archive/term-view';
import {
  KEY,
  NETHACK_COMMANDS,
  PALETTE,
  PAD,
  controlsFor,
  dynamicKeys,
  findCommand,
  keyToNetHack,
} from './input.ts';
import type { FrameMessage, FromWorker, SavedGame, ToWorker } from './protocol.ts';
import { DIR_KEYS, directionTo, heroCell, parseState, type NetHackState } from './state.ts';
import { COLS, INVERSE, MAP_ROWS, MAP_TOP, ROWS, STATUS_TOP, type NhContext } from './windowport.ts';

export const GAME_ID = 'nethack';
const FLUSH_TIMEOUT_MS = 8000;
/** How long after a touch command its item prompt still opens the list by itself. */
const AUTO_LIST_MS = 3000;
const DEFAULT_MAP_CELL_CSS = 20;
const TILE = 16;
const TILES_PER_ROW = 40;

/** NetHack's 16 colours as tty draws them (CLR_BLACK as dark gray); 16–31: the same, reversed. */
const COLORS = [
  '#555753',
  '#cc0000',
  '#4e9a06',
  '#c4a000',
  '#3465a4',
  '#75507b',
  '#06989a',
  '#d3d7cf',
  '#d3d7cf',
  '#ef8a2c',
  '#8ae234',
  '#fce94f',
  '#729fcf',
  '#ad7fa8',
  '#34e2e2',
  '#eeeeec',
];
const PALETTE_COLORS = [...COLORS, ...COLORS];

type Display = 'text' | 'tiles';

export interface NetHackDebugState {
  context: NhContext | 'start' | null;
  inGame: boolean;
  tiled: boolean;
  state: NetHackState | null;
  prompt: string;
  menu: FrameMessage['menu'];
  saves: string[];
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
}

function findFile(files: readonly RuntimeFile[], path: string): RuntimeFile {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Runtime manifest is missing ${path}`);
  return file;
}

async function verifiedImage(url: string, file: RuntimeFile): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${file.path} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256) throw new Error(`${file.path} failed its integrity check.`);
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

class NetHackAdapter implements GameAdapter {
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
  readonly commands = NETHACK_COMMANDS;
  readonly touchLayout = { directionPad: PAD, actions: [], palette: PALETTE };
  readonly settings: readonly GameSettingDescriptor[] = [
    {
      key: 'display',
      label: 'Display',
      description:
        "Text is NetHack's own screen, as on a terminal. Tiles draws the map with NetHack's own tiles (by Warwick Allison and others, part of NetHack). Messages, status and menus stay text.",
      options: [
        { value: 'text', label: 'Text (original)' },
        { value: 'tiles', label: 'Tiles' },
      ],
      default: 'text',
      appliesOn: 'immediately',
    },
    {
      key: 'more',
      label: '--More-- prompts',
      description:
        'NetHack sometimes stops with --More-- and waits for a key before going on. Continue automatically skips the wait; every message stays in the status band and the message log.',
      options: [
        { value: 'auto', label: 'Continue automatically' },
        { value: 'wait', label: 'Wait for a key (original)' },
      ],
      default: 'auto',
      appliesOn: 'immediately',
    },
  ];
  readonly resumeHint =
    'NetHack saves when you press S (it then ends the session, as on a desktop). Start again as the same character to continue.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #renderer: TermRenderer | null = null;
  #mount: HTMLElement | null = null;
  #start: StartScreen | null = null;
  #grid: Grid | null = null;
  #tiles: Uint16Array | null = null;
  #frame: FrameMessage | null = null;
  #state: NetHackState | null = null;
  #context: NhContext | 'start' | null = null;
  #playing = false;
  #name = '';
  #defaultName = '';
  #display: Display = 'text';
  #runtimeFiles: readonly RuntimeFile[] = [];
  #runtimeBaseUrl = '';
  #sheet: ImageBitmap | null = null;
  #sheetLoading: Promise<void> | null = null;
  readonly #tileImages = new Map<number, CanvasImageSource>();
  #tiledNow = false;
  #saves: SavedGame[] = [];
  #layoutSignature = '';
  #presentation: Presentation | null = null;
  #band: HTMLDivElement | null = null;
  #mapCellCss = DEFAULT_MAP_CELL_CSS;
  #pan = { x: 0, y: 0 };
  #lastHero: { x: number; y: number } | null = null;
  #started = false;
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #logId = 0;
  #cleanup: (() => void)[] = [];
  /** --More--: continue automatically, or wait as the original. */
  #autoMore = true;
  /** A touch command was just given on the map: if it asks for an item, its list opens at once (`?`). */
  #autoList = 0;
  /** "You feel more confident in your … skills": Enhance leads until it is used. */
  #enhance = false;
  /**
   * A short script answering a command's follow-up questions (Elbereth):
   * each step answers one kind of prompt; done once the map is back.
   */
  #script: {
    steps: { context: NhContext; prompt?: RegExp; keys?: number[]; click?: { x: number; y: number } }[];
    started: number;
  } | null = null;
  readonly debug: NetHackDebugState;

  constructor() {
    const row = (y: number) => (this.#grid ? rowText(this.#grid, y) : '');
    this.debug = {
      context: null,
      inGame: false,
      tiled: false,
      state: null,
      prompt: '',
      menu: null,
      saves: [],
      rowText: row,
      screenText: () =>
        this.#grid ? Array.from({ length: this.#grid.rows }, (_, y) => row(y)).join('\n') : '',
      views: () => this.#renderer?.views.map((view) => view.name) ?? [],
      cellToClient: (x, y) => this.#renderer?.cellToClient(x, y) ?? null,
    };
  }

  async initialize(host: GameHost, options: InitializeOptions): Promise<void> {
    this.#host = host;
    this.#mount = options.mount;
    const { runtime, runtimeBaseUrl, signal } = options;
    const verified = (path: string) => {
      const file = findFile(runtime.files, path);
      return { url: new URL(file.path, runtimeBaseUrl).href, file };
    };
    const stored = Number(options.settings.mapCellCss);
    if (Number.isFinite(stored) && stored > 0) this.#mapCellCss = stored;
    this.#defaultName = String(options.settings.lastName ?? '');
    this.#display = options.settings.display === 'tiles' ? 'tiles' : 'text';
    this.#autoMore = options.settings.more !== 'wait';
    this.#runtimeFiles = runtime.files;
    this.#runtimeBaseUrl = runtimeBaseUrl;

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'nethack' });
    this.#worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready') resolve();
        else if (message.type === 'error' && !this.#started)
          reject(
            Object.assign(new Error(message.error.message), {
              kind: message.error.kind,
              action: message.error.action,
            }),
          );
        this.#onWorkerMessage(message);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(
          Object.assign(new Error(event.message || 'The game worker failed to start.'), { kind: 'crash' }),
        );
      };
    });
    signal.addEventListener('abort', () => void this.shutdown(), { once: true });
    this.#post({ type: 'init', glue: verified('nethack.mjs'), wasm: verified('nethack.wasm') });
    await ready;
    if (signal.aborted) return;

    const renderer = new TermRenderer(options.mount, {
      inverse: (color) => color >= INVERSE,
      tile: (_code, x, y, view) => this.#tileAt(x, y, view),
    });
    renderer.canvas.classList.add('nethack-canvas');
    renderer.canvas.setAttribute('role', 'img');
    renderer.canvas.setAttribute('aria-label', 'NetHack game screen');
    renderer.setPalette(PALETTE_COLORS);
    renderer.onResize = () => this.#layout();
    this.#renderer = renderer;
    this.#cleanup.push(
      attachGestures(renderer.canvas, {
        tap: (x, y) => this.#tap(x, y),
        longPress: (x, y) => this.#longPress(x, y),
        pan: (dx, dy) => this.#panBy(dx, dy),
        pinch: (scale) => this.#zoomBy(scale),
      }),
    );
    if (this.#display === 'tiles') await this.#loadTiles();
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  /** NetHack's tile sheet (tiles.png), downloaded once, when tiles are first chosen. */
  #loadTiles(): Promise<void> {
    this.#sheetLoading ??= verifiedImage(
      new URL('tiles.png', this.#runtimeBaseUrl).href,
      findFile(this.#runtimeFiles, 'tiles.png'),
    )
      .then((sheet) => {
        this.#sheet = sheet;
        this.#layout();
      })
      .catch((error: unknown) => {
        this.#sheetLoading = null;
        this.#host?.logger.warn('Could not load the tiles; showing text', error);
      });
    return this.#sheetLoading;
  }

  /** One tile from the sheet, cut out once. */
  #tileImage(index: number): CanvasImageSource | null {
    const sheet = this.#sheet;
    if (!sheet) return null;
    let image = this.#tileImages.get(index);
    if (!image) {
      const canvas = new OffscreenCanvas(TILE, TILE);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(
        sheet,
        (index % TILES_PER_ROW) * TILE,
        Math.floor(index / TILES_PER_ROW) * TILE,
        TILE,
        TILE,
        0,
        0,
        TILE,
        TILE,
      );
      image = canvas;
      this.#tileImages.set(index, image);
    }
    return image;
  }

  #tileAt(x: number, y: number, view: string): readonly CanvasImageSource[] | null {
    if (!this.#tiledNow || view !== 'map' || y < MAP_TOP || y >= MAP_TOP + MAP_ROWS) return null;
    const index = this.#tiles?.[y * COLS + x] ?? 0xffff;
    if (index === 0xffff) return null;
    const image = this.#tileImage(index);
    return image ? [image] : null;
  }

  /** The map is drawn with tiles: chosen, loaded, in a game, and no menu or text over it. */
  #tiled(): boolean {
    // (On phones the map stays behind the sheet, drawn from the screen without it.)
    const covered = !!this.#frame?.overlay && !this.#presentation?.compact;
    return this.#display === 'tiles' && !!this.#sheet && !!this.#state?.inGame && !covered;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#showStart();
  }

  #showStart(notice?: string): void {
    const mount = this.#mount;
    if (!mount) return;
    this.#playing = false;
    this.#start ??= new StartScreen(mount, {
      title: 'NetHack',
      subtitle: 'The NetHack DevTeam · 5.0.0',
      hint: 'NetHack saves when you press S, and continues a character that has a saved game.',
      defaultName: this.#defaultName,
      onNew: (name) => this.#launch(name),
      onContinue: (name) => this.#launch(name),
    });
    this.#start.show(this.#entries(), notice);
    this.#emitContext('start');
  }

  #entries() {
    return this.#saves.map((save) => ({ name: save.name, detail: `saved ${relativeTime(save.modifiedAt)}` }));
  }

  #launch(name: string): void {
    this.#start?.hide();
    this.#playing = true;
    this.#name = name;
    this.#host?.emit({ type: 'setting-changed', key: 'lastName', value: name });
    this.#post({ type: 'start', name });
    this.#renderer?.canvas.focus({ preventScroll: true });
  }

  sendInput(input: GameInput): void {
    if (!this.#playing) return;
    if (input.type === 'key') {
      const keys = keyToNetHack(input);
      if (keys) this.#send(keys);
      return;
    }
    if (input.type === 'text') {
      this.#send(
        [...input.text].map((char) => (char === '\n' ? 13 : char.charCodeAt(0))).filter((code) => code < 128),
      );
      return;
    }
    if (input.type !== 'command') return;
    if (input.commandId.startsWith(KEY)) {
      this.#send([Number(input.commandId.slice(KEY.length))]);
      return;
    }
    const onMap = this.#context === 'map';
    const dynamic = dynamicKeys(input.commandId);
    if (dynamic) {
      this.#send(dynamic);
      return;
    }
    if (input.commandId === 'elbereth') {
      this.#elbereth();
      return;
    }
    const command = findCommand(input.commandId);
    if (!command) return;
    if (command.id === 'enhance') this.#enhance = false;
    // A command from the dock or the command list that asks for an item shows the list at once.
    this.#autoList = onMap && command.category !== 'Keys' ? Date.now() : 0;
    this.#send(command.keys);
  }

  /**
   * Engrave Elbereth in the dust: `E`, then the game's own questions answered
   * as a player would: write with fingers (`-`), don't add to an engraving
   * already there, then the text. The game decides whether it works.
   */
  #elbereth(): void {
    if (this.#context !== 'map') return;
    this.#script = {
      started: Date.now(),
      steps: [
        { context: 'item', prompt: /write with/i, keys: [45] },
        { context: 'yn', prompt: /add to the (current|writing)/i, keys: [110] },
        { context: 'yn', prompt: /Do you want to/i, keys: [110] },
        {
          context: 'getlin',
          prompt: /write|engrave|scribble/i,
          keys: [...'Elbereth'].map((c) => c.charCodeAt(0)).concat(13),
        },
      ],
    };
    this.#send([69]);
  }

  /** The script's answer to the prompt now on screen, if it has one (and whether it is over). */
  #runScript(context: NhContext): boolean {
    const script = this.#script;
    if (!script) return false;
    if (Date.now() - script.started > 15_000 || context === 'map' || context === 'over') {
      this.#script = null;
      return false;
    }
    const prompt = this.#frame?.prompt ?? '';
    const step = script.steps.findIndex((s) => s.context === context && (!s.prompt || s.prompt.test(prompt)));
    if (step < 0) return false;
    const { keys, click } = script.steps.splice(step, 1)[0]!;
    if (keys) this.#send(keys);
    if (click) this.#post({ type: 'input', click: { ...click, button: 1 } });
    return true;
  }

  #send(keys: number[]): void {
    for (const key of keys) this.#post({ type: 'input', key });
  }

  exitPrompt(): GameExitPrompt | null {
    if (!this.#playing || !this.#state?.inGame) return null;
    return {
      message:
        'NetHack keeps no save while you play: leave without saving and this game is lost. Save and leave saves it (S), to continue as the same character.',
      options: [
        { id: 'save', label: 'Save and leave', primary: true },
        { id: 'leave', label: 'Leave without saving', destructive: true },
      ],
    };
  }

  /** Save and leave: NetHack's own save (`S`, then `y`), which ends the session at the start screen. */
  async exitWith(optionId: string): Promise<void> {
    if (optionId !== 'save') return;
    for (let i = 0; i < 12 && this.#context !== 'map'; i++) {
      this.#send([this.#context === 'more' || this.#context === 'text' ? 32 : 27]);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.#context !== 'map') throw new Error('NetHack is not ready for a command.');
    this.#send(['S'.charCodeAt(0)]);
    await waitUntil(() => this.#context === 'yn', 5000, "NetHack's save question");
    this.#send(['y'.charCodeAt(0)]);
    await waitUntil(
      () => {
        // "Be seeing you..." and other closing messages.
        if (this.#context === 'more' || this.#context === 'text') this.#send([32]);
        return !this.#playing;
      },
      20_000,
      'Saving',
      300,
    );
  }

  async persist(): Promise<void> {
    if (!this.#worker) return;
    const reply = await this.#request<'flushed'>((id) => ({ type: 'flush', id }), FLUSH_TIMEOUT_MS);
    if (reply.error) throw new Error(reply.error);
  }

  setVisible(visible: boolean): void {
    if (!visible)
      void this.persist().catch((error: unknown) => this.#host?.logger.warn('persist failed', error));
  }

  setPresentation(presentation: Presentation): void {
    this.#presentation = presentation;
    this.#layout();
  }

  applySetting(key: string, value: unknown): void {
    if (key === 'more') {
      this.#autoMore = value !== 'wait';
      if (this.#autoMore && this.#context === 'more') this.#send([32]);
      return;
    }
    if (key !== 'display') return;
    this.#display = value === 'tiles' ? 'tiles' : 'text';
    if (this.#display === 'tiles') void this.#loadTiles();
    this.#layout();
  }

  async exportSaves(): Promise<SaveFile[]> {
    const reply = await this.#request<'exported'>((id) => ({ type: 'export', id }), FLUSH_TIMEOUT_MS * 2);
    if (reply.error) throw new Error(reply.error);
    return reply.files;
  }

  async importSaves(files: SaveFile[]): Promise<void> {
    const reply = await this.#request<'imported'>(
      (id) => ({ type: 'import', id, files }),
      FLUSH_TIMEOUT_MS * 2,
    );
    if (reply.error) throw new Error(reply.error);
  }

  #shutdownPromise: Promise<void> | null = null;
  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown();
    return this.#shutdownPromise;
  }

  async #shutdown(): Promise<void> {
    const worker = this.#worker;
    if (!worker) return;
    try {
      await this.persist();
    } catch (error) {
      this.#host?.logger.warn('Could not persist before shutdown', error);
    }
    worker.terminate();
    this.#worker = null;
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    this.#band?.remove();
    this.#band = null;
    this.#start?.destroy();
    this.#start = null;
    this.#renderer?.destroy();
    this.#renderer = null;
    for (const resolve of this.#pending.values())
      resolve({ type: 'flushed', id: -1, error: 'Game stopped.' });
    this.#pending.clear();
  }

  #post(message: ToWorker): void {
    this.#worker?.postMessage(message);
  }

  #request<T extends 'flushed' | 'exported' | 'imported'>(
    build: (id: number) => ToWorker,
    timeoutMs: number,
  ): Promise<Extract<FromWorker, { type: T }>> {
    const id = ++this.#requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('The game did not respond in time.'));
      }, timeoutMs);
      this.#pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message as Extract<FromWorker, { type: T }>);
      });
      this.#post(build(id));
    });
  }

  #setSaves(saves: SavedGame[]): void {
    this.#saves = saves;
    this.debug.saves = saves.map((save) => save.name);
    if (this.#start?.visible) this.#start.update(this.#entries());
  }

  #onWorkerMessage(message: FromWorker): void {
    const host = this.#host;
    switch (message.type) {
      case 'ready':
        this.#setSaves(message.saves);
        break;
      case 'frame': {
        if (!this.#playing) break;
        this.#frame = message;
        this.#grid = this.#composeGrid(message);
        this.#tiles = message.tiles;
        this.#state = parseState(message.state);
        this.debug.state = this.#state;
        this.debug.inGame = this.#state.inGame;
        this.debug.prompt = message.prompt;
        this.debug.menu = message.menu;
        const hero = heroCell(this.#state);
        if (hero?.x !== this.#lastHero?.x || hero?.y !== this.#lastHero?.y) this.#pan = { x: 0, y: 0 };
        this.#lastHero = hero;
        this.#renderer?.setGrid(this.#grid);
        this.#emitContext(message.context);
        this.#layout();
        break;
      }
      case 'message': {
        if (/You feel more confident in your /.test(message.text)) this.#enhance = true;
        const entry: LogEntry = { id: ++this.#logId, runs: [{ text: message.text }] };
        host?.emit({ type: 'message-log', reset: false, entries: [entry] });
        break;
      }
      case 'exit': {
        this.#setSaves(message.saves);
        this.#grid = null;
        this.#frame = null;
        this.#state = null;
        this.debug.inGame = false;
        this.#renderer?.setGrid({ cols: COLS, rows: ROWS, cells: new Uint8Array(COLS * ROWS * 2) });
        this.#setBand(null);
        this.#showStart(
          message.saved
            ? `Game saved. Continue ${this.#name} below when you're ready.`
            : `${this.#name}'s game is over.`,
        );
        break;
      }
      case 'saves':
        this.#setSaves(message.saves);
        break;
      case 'status':
        host?.emit({ type: 'status', status: message.status });
        break;
      case 'error':
        if (this.#started) host?.emit({ type: 'error', error: message.error });
        break;
      case 'log':
        if (message.level === 'error') host?.logger.error(message.text);
        else host?.logger.debug(message.text);
        break;
      case 'flushed':
      case 'exported':
      case 'imported': {
        const resolve = this.#pending.get(message.id);
        if (resolve) {
          this.#pending.delete(message.id);
          resolve(message);
        }
        break;
      }
    }
  }

  /**
   * The grid to draw. On phones, with a menu or text window open, the screen
   * without it (rows 0–23: the map and the message line stay clean behind the
   * sheet) followed by the screen with it (rows 24–47, which the sheet shows).
   */
  #composeGrid(frame: FrameMessage): Grid {
    if (!this.#presentation?.compact || !frame.overlay)
      return { cols: COLS, rows: ROWS, cells: frame.cells, cursor: frame.cursor };
    const cells = new Uint8Array(COLS * ROWS * 2 * 2);
    cells.set(frame.under);
    cells.set(frame.cells, COLS * ROWS * 2);
    return { cols: COLS, rows: ROWS * 2, cells, cursor: { ...frame.cursor, visible: false } };
  }

  /** Where the open menu or text window is in the grid (below the screen on phones). */
  #overlayRect(): Rect | null {
    const overlay = this.#frame?.overlay;
    if (!overlay) return null;
    return this.#grid && this.#grid.rows > ROWS ? { ...overlay, y: overlay.y + ROWS } : overlay;
  }

  #emitContext(context: NhContext | 'start'): void {
    this.#context = context;
    this.debug.context = context;
    const frame = this.#frame;
    if (context !== 'start') {
      // A script (Elbereth) answers its prompts.
      if (this.#runScript(context)) return;
      // --More-- continues by itself unless the player wants to wait.
      if (context === 'more' && this.#autoMore) {
        this.#send([32]);
        return;
      }
      // An item prompt from a touch command: its list at once.
      // (The map may be redrawn before the question appears, so the wish lasts a moment.)
      if (this.#autoList && Date.now() - this.#autoList > AUTO_LIST_MS) this.#autoList = 0;
      if (this.#autoList && context !== 'map') {
        this.#autoList = 0;
        if (context === 'item' && /\?\*?\]/.test(frame?.prompt ?? '')) {
          this.#send([63]);
          return;
        }
      }
    }
    const layout = controlsFor(context, {
      state: this.#state,
      prompt: frame?.prompt ?? '',
      menu: frame?.menu ?? null,
      enhance: this.#enhance,
      messages: frame?.messages ?? [],
    });
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({
      type: 'input-context',
      context: {
        textEntry: context === 'getlin' || context === 'extcmd' || context === 'start',
        mode: context,
      },
    });
  }

  /** Views for the current presentation and screen. */
  #layout(): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    if (!renderer || !grid) return;
    this.#tiledNow = this.#tiled();
    this.debug.tiled = this.#tiledNow;
    const { width, height } = renderer.size;
    const dpr = renderer.dpr;
    const whole: Rect = { x: 0, y: 0, width: COLS, height: ROWS };
    const mapRect: Rect = { x: 0, y: MAP_TOP, width: COLS, height: MAP_ROWS };
    const presentation = this.#presentation;
    if (!presentation?.compact) {
      this.#setBand(null);
      if (!this.#tiledNow) {
        renderer.setViews([fittedView('screen', whole, { x: 0, y: 0, width, height })]);
        return;
      }
      // Tiles: the message line and status lines as text, the map between them in square cells.
      const text = fitCell(whole, width, height);
      renderer.setViews([
        fittedView(
          'top',
          { x: 0, y: 0, width: COLS, height: 1 },
          { x: 0, y: 0, width, height: text.cellHeight },
        ),
        fittedView(
          'map',
          mapRect,
          { x: 0, y: text.cellHeight, width, height: height - 3 * text.cellHeight },
          Infinity,
          {},
          1,
        ),
        fittedView(
          'status',
          { x: 0, y: STATUS_TOP, width: COLS, height: 2 },
          { x: 0, y: height - 2 * text.cellHeight, width, height: 2 * text.cellHeight },
        ),
      ]);
      return;
    }
    const state = this.#state;
    const insets = presentation.insets;
    const band = this.#setBand(state?.inGame ? state : null);
    const area: Rect = {
      x: Math.round(insets.left * dpr),
      y: Math.round(band * dpr),
      width: Math.max(1, width - Math.round((insets.left + insets.right) * dpr)),
      height: Math.max(1, height - Math.round((band + insets.bottom) * dpr)),
    };
    if (!state?.inGame) {
      // Character creation, the intro, the end: the whole screen, or its menu as a sheet.
      const overlay = this.#overlayRect();
      renderer.setViews([
        overlay
          ? fittedView('sheet', overlay, area, 28 * dpr, { frame: true })
          : fittedView('screen', whole, area),
      ]);
      return;
    }
    const map = followView(
      'map',
      mapRect,
      area,
      this.#mapCellCss * dpr,
      heroCell(state),
      this.#pan,
      this.#tiledNow ? 1 : undefined,
    );
    const views: View[] = [map];
    const overlay = this.#overlayRect();
    if (overlay) {
      const margin = Math.round(8 * dpr);
      map.dim = 0.62;
      views.push(
        fittedView(
          'sheet',
          overlay,
          {
            x: area.x + margin,
            y: area.y + margin,
            width: area.width - 2 * margin,
            height: area.height - 2 * margin,
          },
          28 * dpr,
          { modal: true, frame: true },
        ),
      );
    }
    renderer.setViews(views);
  }

  /** Phones: the message line and NetHack's two status lines as a band; returns its height in CSS px. */
  #setBand(state: NetHackState | null): number {
    const mount = this.#mount;
    if (!state || !mount) {
      this.#band?.remove();
      this.#band = null;
      return 0;
    }
    if (!this.#band) {
      const band = document.createElement('div');
      band.className = 'nethack-band';
      band.style.cssText =
        "position:absolute;top:0;left:0;right:0;z-index:1;box-sizing:border-box;padding:6px 10px;display:grid;gap:3px;background:rgba(10,9,7,.94);border-bottom:1px solid rgba(236,227,207,.12);color:#ece3cf;font:13px/1.3 'Inter Variable',system-ui,sans-serif;cursor:pointer";
      band.addEventListener('click', () =>
        this.#host?.emit({ type: 'shell-command', command: SHELL_COMMAND.log }),
      );
      mount.append(band);
      this.#band = band;
    }
    const portrait = mount.clientHeight > mount.clientWidth;
    this.#band.style.paddingTop = portrait ? 'max(50px, env(safe-area-inset-top))' : '';
    this.#band.style.paddingRight = portrait
      ? '10px'
      : `${(this.#presentation?.topRightReserve ?? 0) + 10}px`;
    const grid = this.#grid;
    // This turn's messages (the latest three lines' worth), or the message line.
    const turn = this.#frame?.messages ?? [];
    const message = turn.length > 0 ? turn.slice(-3).join('  ') : grid ? rowText(grid, 0).trim() : '';
    const status = grid
      ? [rowText(grid, STATUS_TOP), rowText(grid, STATUS_TOP + 1)].map((line) =>
          line.replace(/\s+/g, ' ').trim(),
        )
      : ['', ''];
    const hpFraction = state.hpMax > 0 ? Math.max(0, Math.min(1, state.hp / state.hpMax)) : 1;
    const signature = `${status.join('|')}|${message}|${hpFraction}`;
    if (this.#band.dataset.signature !== signature) {
      this.#band.dataset.signature = signature;
      this.#band.replaceChildren();
      const top = document.createElement('div');
      top.style.cssText =
        'display:flex;align-items:center;gap:8px;font-weight:600;font-variant-numeric:tabular-nums;min-width:0';
      const bar = document.createElement('span');
      bar.style.cssText = `flex:none;width:48px;height:10px;border-radius:999px;background:linear-gradient(90deg,hsl(${Math.round(hpFraction * 110)} 62% 48%) ${hpFraction * 100}%,rgba(255,255,255,.1) 0)`;
      const text = document.createElement('span');
      text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px';
      text.textContent = status[1]!;
      top.append(bar, text);
      const second = document.createElement('div');
      second.style.cssText =
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#bdb6a6';
      second.textContent = status[0]!;
      const line = document.createElement('div');
      line.style.cssText =
        'font:12px/16px ui-monospace,Menlo,Consolas,monospace;color:#d3d7cf;min-height:16px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden';
      line.textContent = message;
      this.#band.append(top, second, line);
      this.#band.setAttribute('aria-label', `${status.join('. ')}. ${message}. Open the message log`);
    }
    return this.#band.getBoundingClientRect().height;
  }

  /**
   * Taps:
   * - a menu line chooses it (its key, as tty shows "a - item"); a text
   *   window, a menu only to read or --More-- continues;
   * - on the map: the hero shows what can be done here (#herecmdmenu); any
   *   other cell is NetHack's click (mouse1 bound to mouseaction): travel
   *   there, or move, attack, open a door next to the hero;
   * - choosing a position: the tapped cell is chosen (a click);
   * - a direction question: the direction towards the tapped cell.
   */
  #tap(clientX: number, clientY: number): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    if (!renderer || !grid) return;
    const context = this.#context;
    if (context === 'text' || context === 'more' || (context === 'menu' && this.#frame?.menu?.how === 0)) {
      this.#send([32]);
      return;
    }
    const hit = renderer.hitTest(clientX, clientY);
    if (!hit) return;
    if (hit.kind === 'dismiss') {
      this.#send([27]);
      return;
    }
    if (context === 'menu' && (hit.view === 'sheet' || hit.view === 'screen')) {
      const overlay = this.#overlayRect();
      const line = rowText(grid, hit.y).slice(overlay?.x ?? 0);
      const match = /^\s(\S) [-+#] /.exec(line);
      if (match) this.#send([match[1]!.charCodeAt(0)]);
      return;
    }
    const cell = this.#mapCell(hit);
    if (!cell) return;
    const state = this.#state;
    if (context === 'map' && state) {
      const hero = heroCell(state);
      if (hero && hero.x === cell.x && hero.y === cell.y) this.#send(findCommand('here-menu')!.keys);
      else this.#post({ type: 'input', click: { ...cell, button: 1 } });
    } else if (context === 'position') {
      this.#post({ type: 'input', click: { ...cell, button: 1 } });
    } else if (context === 'direction' && state) {
      const dir = directionTo(state, cell);
      this.#send(dir === null ? [46] : [DIR_KEYS.charCodeAt(dir)]);
    }
  }

  /** A hit on a map cell (map rows only), as screen coordinates. */
  #mapCell(hit: ReturnType<TermRenderer['hitTest']>): { x: number; y: number } | null {
    if (hit?.kind !== 'cell' || (hit.view !== 'map' && hit.view !== 'screen')) return null;
    if (hit.y < MAP_TOP || hit.y >= MAP_TOP + MAP_ROWS) return null;
    return { x: hit.x, y: hit.y };
  }

  /**
   * Long press on the map. Next to the hero: what can be done there,
   * NetHack's own #therecmdmenu (mouse2): open, unlock or kick a door, search
   * a wall, talk to, swap with or name a pet, attack... (With nothing to
   * offer, the game walks there.) Farther away, where that menu has nothing
   * but travel (which a tap already does): what is there, NetHack's farlook
   * (`;` and the place). While choosing a place: that place.
   */
  #longPress(clientX: number, clientY: number): void {
    const cell = this.#mapCell(this.#renderer?.hitTest(clientX, clientY) ?? null);
    if (!cell) return;
    if (this.#context === 'position') {
      this.#post({ type: 'input', click: { ...cell, button: 1 } });
      return;
    }
    const hero = this.#state ? heroCell(this.#state) : null;
    if (this.#context !== 'map' || !hero) return;
    if (Math.max(Math.abs(cell.x - hero.x), Math.abs(cell.y - hero.y)) <= 1) {
      this.#post({ type: 'input', click: { ...cell, button: 2 } });
      return;
    }
    this.#script = { started: Date.now(), steps: [{ context: 'position', click: cell }] };
    this.#send([59]);
  }

  #panBy(dx: number, dy: number): void {
    if (!this.#presentation?.compact) return;
    this.#pan = { x: this.#pan.x + dx, y: this.#pan.y + dy };
    this.#layout();
  }

  #zoomBy(scale: number): void {
    if (!this.#presentation?.compact) return;
    this.#mapCellCss = Math.max(12, Math.min(48, this.#mapCellCss * scale));
    this.#host?.emit({ type: 'setting-changed', key: 'mapCellCss', value: Math.round(this.#mapCellCss) });
    this.#layout();
  }
}

export function createAdapter(): GameAdapter & { readonly debug: NetHackDebugState } {
  return new NetHackAdapter();
}

const module: GameModule = { createAdapter };
export default module;

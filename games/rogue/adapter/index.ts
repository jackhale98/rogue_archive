// SPDX-License-Identifier: BSD-3-Clause
/**
 * Rogue Archive adapter for Rogue 5.4.4.
 *
 * Rogue runs in a Web Worker on a small curses (port/curses-web.c) that sends
 * its 80x24 screen on each refresh. The screen is drawn with the shared
 * terminal renderer (@rogue-archive/term-view): whole on desktop; on phones
 * the map is zoomed and follows the hero, lists drawn over the map are
 * lifted into a large sheet, and the status line becomes a band.
 *
 * Rogue never asks who you are: as on a terminal, the name and savefile are
 * its options, and continuing a game restarts it with the savefile. A start
 * screen (@rogue-archive/start-screen) does that, and comes back each time a
 * game ends (saved, died or quit).
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
  fittedView,
  followView,
  rowText,
  fitCell,
  type Grid,
  type Rect,
  type View,
} from '@rogue-archive/term-view';
import {
  CHOOSE,
  USE,
  ROGUE_COMMANDS,
  ROGUE_TOUCH_LAYOUT,
  controlsFor,
  findCommand,
  keyToRogue,
  continueFirst,
  directedKeys,
  isDirectionKey,
  runKeys,
  type RogueContext,
  type RunMode,
} from './input.ts';
import type { FromWorker, SavedGame, ToWorker } from './protocol.ts';
import { loadTiles, type TileSet, type TileStyle } from './tiles.ts';
import {
  MESSAGE_ROW,
  STATUS_ROW,
  detectContext,
  heroCell,
  listBox,
  mapOverlay,
  mapLeads,
  mapRect,
  parseState,
  screenChoices,
  type MapLeads,
  type RogueState,
} from './state.ts';

export const GAME_ID = 'rogue';
const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
/** How long after its last key an item action still answers the item prompt. */
const USE_ANSWER_MS = 5000;
const DEFAULT_MAP_CELL_CSS = 20;
/** Rogue is monochrome: normal text, and standout (reverse video). */
const PALETTE = ['#e6e1d3', '#e6e1d3'];
const STANDOUT = 1;

export interface RogueDebugState {
  context: RogueContext | null;
  inGame: boolean;
  /** The map is drawn with tiles now. */
  tiled: boolean;
  /** The tile style drawn when tiled ('tiles' or 'one-bit'), else null. */
  tileStyle: TileStyle | null;
  state: RogueState | null;
  /** Monsters next to the hero and an aquator in sight, as the map dock reads them. */
  leads: MapLeads | null;
  /** The latched run toggle ('run' or 'run-ctrl'), if any. */
  run: RunMode | false;
  /** The inventory line picked for its actions. */
  picked: { letter: string; text: string } | null;
  saves: string[];
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
}

/** The Display setting's value. */
function displayOf(value: unknown): 'text' | TileStyle {
  return value === 'tiles' || value === 'one-bit' ? value : 'text';
}

function findFile(files: RuntimeFile[], path: string): RuntimeFile {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Runtime manifest is missing ${path}`);
  return file;
}

class RogueAdapter implements GameAdapter {
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
  readonly commands = ROGUE_COMMANDS;
  readonly touchLayout = ROGUE_TOUCH_LAYOUT;
  readonly settings: readonly GameSettingDescriptor[] = [
    {
      key: 'display',
      label: 'Display',
      description:
        "Text is Rogue's own screen. Tiles draws the map with pictures from the public-domain RLTiles (as Dungeon Crawl Stone Soup's tiles); 1-Bit uses Kenney's one-colour 1-Bit Pack. Messages and lists stay text.",
      options: [
        { value: 'text', label: 'Text (original)' },
        { value: 'tiles', label: 'Tiles (RLTiles)' },
        { value: 'one-bit', label: '1-Bit' },
      ],
      default: 'text',
      appliesOn: 'immediately',
    },
    {
      key: 'more',
      label: '--More-- prompts',
      description:
        'Rogue stops with --More-- when a second message comes in the same turn (in a fight, after almost every blow) and waits for Space. Continue automatically skips the wait; every message stays in the status band and the message log.',
      options: [
        { value: 'auto', label: 'Continue automatically' },
        { value: 'wait', label: 'Wait for a key (original)' },
      ],
      default: 'auto',
      appliesOn: 'immediately',
    },
  ];
  readonly resumeHint =
    'Rogue saves only when you press S (and keeps no save while you play, like the original). Continue a saved game from the start screen.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #renderer: TermRenderer | null = null;
  #mount: HTMLElement | null = null;
  #start: StartScreen | null = null;
  #grid: Grid | null = null;
  #state: RogueState | null = null;
  #context: RogueContext | null = null;
  #playing = false;
  #name = '';
  #defaultName = '';
  #display: 'text' | TileStyle = 'text';
  /** Each tile style, once loaded (or loading). */
  readonly #tiles = new Map<TileStyle, TileSet>();
  readonly #tilesLoading = new Map<TileStyle, Promise<void>>();
  #runtimeFiles: readonly RuntimeFile[] = [];
  #runtimeBaseUrl = '';
  /** Whether the map is drawn with tiles for the current screen (worked out in #layout). */
  #tiledNow = false;
  #saves: SavedGame[] = [];
  #layoutSignature = '';
  #busyTimer: ReturnType<typeof setTimeout> | undefined;
  #presentation: Presentation | null = null;
  #band: HTMLDivElement | null = null;
  #mapCellCss = DEFAULT_MAP_CELL_CSS;
  #pan = { x: 0, y: 0 };
  #lastHero: { x: number; y: number } | null = null;
  /** A latched run toggle: the next direction runs (Shift) or runs carefully (Ctrl). */
  #run: RunMode | false = false;
  /** A dock or palette command was just sent from the map: if it asks for an item, show the list at once. */
  #autoList = false;
  #started = false;
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #logId = 0;
  #lastMessage = '';
  /** --More--: continue automatically (the message is logged first), or wait as the original. */
  #autoMore = true;
  /** The list on screen was opened from an item prompt, so its items answer it. */
  #listFromPrompt = false;
  /** The inventory line tapped in a plain list: the dock offers its actions. */
  #picked: { letter: string; text: string } | null = null;
  /**
   * An item action from the inventory: the letter that answers the command's
   * "which object?" prompt when it comes (Throw asks for the direction
   * first). Kept until then, for a few seconds after the last key, or until
   * the player does anything but answer a direction.
   */
  #useLetter: { code: number; at: number } | null = null;
  #cleanup: (() => void)[] = [];
  readonly debug: RogueDebugState;

  constructor() {
    const row = (y: number) => (this.#grid ? rowText(this.#grid, y) : '');
    this.debug = {
      context: null,
      inGame: false,
      tiled: false,
      tileStyle: null,
      state: null,
      leads: null,
      run: false,
      picked: null,
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
    this.#display = displayOf(options.settings.display);
    this.#autoMore = options.settings.more !== 'wait';
    this.#runtimeFiles = runtime.files;
    this.#runtimeBaseUrl = runtimeBaseUrl;

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rogue' });
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
    this.#post({ type: 'init', glue: verified('rogue.mjs'), wasm: verified('rogue.wasm') });
    await ready;
    if (signal.aborted) return;

    const renderer = new TermRenderer(options.mount, {
      inverse: (color) => color === STANDOUT,
      tile: (code, x, y, view) => this.#tileFor(code, x, y, view),
    });
    renderer.canvas.classList.add('rogue-canvas');
    renderer.canvas.setAttribute('role', 'img');
    renderer.canvas.setAttribute('aria-label', 'Rogue game screen');
    renderer.setPalette(PALETTE);
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
    if (this.#display !== 'text') await this.#loadTiles(this.#display);
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  /** Downloads a tile style once (when it is first chosen). */
  #loadTiles(style: TileStyle): Promise<void> {
    let loading = this.#tilesLoading.get(style);
    if (!loading) {
      loading = loadTiles(style, this.#runtimeFiles, this.#runtimeBaseUrl)
        .then((tiles) => {
          this.#tiles.set(style, tiles);
          this.#layout();
        })
        .catch((error: unknown) => {
          this.#tilesLoading.delete(style);
          this.#host?.logger.warn('Could not load the tiles; showing text', error);
        });
      this.#tilesLoading.set(style, loading);
    }
    return loading;
  }

  /** The chosen tile style, if one is chosen and loaded. */
  #tileSet(): TileSet | null {
    return this.#display === 'text' ? null : (this.#tiles.get(this.#display) ?? null);
  }

  /** Whether the map is drawn with tiles now (chosen, loaded, in a game, no list over it). */
  #tiled(): boolean {
    const grid = this.#grid;
    if (!this.#tileSet() || !grid || !this.#state?.inGame) return false;
    return this.#context === 'map' || !(listBox(grid) ?? mapOverlay(grid));
  }

  #tileFor(code: number, _x: number, y: number, view: string): readonly CanvasImageSource[] | null {
    if (view !== 'map' || y < MESSAGE_ROW + 1 || y >= STATUS_ROW || !this.#tiledNow) return null;
    return this.#tileSet()?.images(code) ?? null;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#showStart();
  }

  /** The start screen: continue a saved game or start a new character. */
  #showStart(notice?: string): void {
    const mount = this.#mount;
    if (!mount) return;
    this.#playing = false;
    this.#start ??= new StartScreen(mount, {
      title: 'Rogue',
      subtitle: 'Exploring the Dungeons of Doom · 5.4.4',
      hint: 'Rogue saves only when you press S, and a saved game is removed when you continue it, as in the original.',
      defaultName: this.#defaultName,
      onNew: (name) => this.#launch(name, false),
      onContinue: (name) => this.#launch(name, true),
    });
    this.#start.show(this.#entries(), notice);
    this.#publishContext(true);
  }

  #entries() {
    return this.#saves.map((save) => ({ name: save.name, detail: `saved ${relativeTime(save.modifiedAt)}` }));
  }

  #launch(name: string, restore: boolean): void {
    this.#start?.hide();
    this.#playing = true;
    this.#name = name;
    this.#lastMessage = '';
    this.#run = false;
    this.debug.run = false;
    this.#autoList = false;
    this.#host?.emit({ type: 'setting-changed', key: 'lastName', value: name });
    this.#post({ type: 'start', name, restore });
    this.#renderer?.canvas.focus({ preventScroll: true });
  }

  sendInput(input: GameInput): void {
    if (!this.#playing) return;
    // A pending item answer survives only the direction question's answer.
    if (this.#useLetter) {
      if (this.#context === 'direction') this.#useLetter.at = Date.now();
      else this.#useLetter = null;
    }
    if (input.type === 'key') {
      const keys = keyToRogue(input);
      if (!keys) return;
      const directionKey = isDirectionKey(input);
      if (!directionKey && keys[0] !== 32) this.#unlatchRun();
      this.#send(continueFirst(this.#context, keys, { directionKey }));
      return;
    }
    if (input.type === 'text') {
      this.#send(
        [...input.text].map((char) => (char === '\n' ? 13 : char.charCodeAt(0))).filter((code) => code < 128),
      );
      return;
    }
    if (input.type !== 'command') return;
    if (input.commandId.startsWith(CHOOSE)) {
      this.#choose(input.commandId.charCodeAt(CHOOSE.length));
      return;
    }
    // An item's action from the inventory: close the list (Rogue's lists take
    // only Space), give the command, and answer its item prompt with the letter.
    if (input.commandId.startsWith(USE)) {
      const [id, letter] = input.commandId.slice(USE.length).split(':');
      const command = findCommand(id ?? '');
      if (!command || !letter) return;
      this.#unlatchRun();
      this.#picked = null;
      this.#useLetter = { code: letter.charCodeAt(0), at: Date.now() };
      this.#send([32, ...command.keys]);
      return;
    }
    if (input.commandId === 'run' || input.commandId === 'run-ctrl') {
      this.#setRun(this.#run === input.commandId ? false : input.commandId);
      return;
    }
    // "Fight ↖B": `f` and the direction in one gesture (or `t`, at a floating eye).
    const directed = directedKeys(input.commandId);
    if (directed) {
      this.#unlatchRun();
      this.#autoList = this.#context === 'map';
      this.#send(directed);
      return;
    }
    const command = findCommand(input.commandId);
    if (!command) return;
    // Run: the next direction as a capital letter (Shift) or a control code
    // (Ctrl), on the map or after --More--.
    if (
      this.#run &&
      command.id.startsWith('move-') &&
      (this.#context === 'map' || this.#context === 'more')
    ) {
      const run = runKeys(this.#run, String.fromCharCode(command.keys[0]!));
      this.#setRun(false);
      this.#send(continueFirst(this.#context, run, { commandId: command.id }));
      return;
    }
    if (command.category !== 'Keys' && !command.id.startsWith('move-')) {
      this.#unlatchRun();
      this.#autoList = this.#context === 'map';
    }
    this.#send(continueFirst(this.#context, command.keys, { commandId: command.id }));
  }

  #setRun(run: RunMode | false): void {
    this.#run = run;
    this.debug.run = run;
    this.#publishContext(true);
  }

  /** Any action other than a move lets go of a latched run. */
  #unlatchRun(): void {
    if (this.#run) this.#setRun(false);
  }

  #send(keys: number[]): void {
    if (keys.length) this.#post({ type: 'keys', keys });
  }

  exitPrompt(): GameExitPrompt | null {
    // Nothing to keep at the start screen or on the tombstone and scores.
    if (!this.#playing || !this.#state?.inGame || this.#context === 'enter') return null;
    return {
      message:
        'Rogue keeps no save while you play: leave without saving and this game is over, as in the original. Save and leave keeps it, to continue from the start screen.',
      options: [
        { id: 'save', label: 'Save and leave', primary: true },
        { id: 'leave', label: 'Leave without saving', destructive: true },
      ],
    };
  }

  /** Save and leave: Rogue's own save (`S`, then `y`), which ends the game at the start screen. */
  async exitWith(optionId: string): Promise<void> {
    if (optionId !== 'save') return;
    // Back to the map first: close --More--, lists and questions.
    for (let i = 0; i < 12 && this.#context !== 'map'; i++) {
      if (this.#context !== 'busy')
        this.#send([this.#context === 'more' || this.#context === 'menu' ? 32 : 27]);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.#context !== 'map') throw new Error('Rogue is not ready for a command.');
    this.#send(['S'.charCodeAt(0)]);
    await waitUntil(() => this.#context === 'yesno', 5000, "Rogue's save question");
    this.#send(['y'.charCodeAt(0)]);
    await waitUntil(() => !this.#playing, 15_000, 'Saving');
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
    this.#display = displayOf(value);
    if (this.#display !== 'text') void this.#loadTiles(this.#display);
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
    clearTimeout(this.#busyTimer);
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
        const grid: Grid = {
          cols: message.cols,
          rows: message.rows,
          cells: message.cells,
          cursor: message.cursor,
        };
        this.#grid = grid;
        this.#state = parseState(message.state);
        this.debug.state = this.#state;
        this.debug.inGame = this.#state.inGame;
        const hero = heroCell(this.#state);
        if (hero?.x !== this.#lastHero?.x || hero?.y !== this.#lastHero?.y) this.#pan = { x: 0, y: 0 };
        this.#lastHero = hero;
        this.#renderer?.setGrid(grid);
        this.#logMessage(grid);
        this.#publishContext();
        this.#layout();
        // Each frame is a new screen: at most one Space per --More-- shown.
        if (this.#autoMore && this.#context === 'more' && this.#state.waiting) this.#send([32]);
        break;
      }
      case 'exit': {
        this.#setSaves(message.saves);
        this.#grid = null;
        this.#state = null;
        this.#renderer?.setGrid({ cols: 80, rows: 24, cells: new Uint8Array(80 * 24 * 2) });
        this.#setBand(null);
        const notice = message.saved
          ? `Game saved. Continue ${this.#name} below when you're ready.`
          : `${this.#name}'s game is over.`;
        this.#showStart(notice);
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
   * Rogue keeps no message history (Ctrl+P repeats only the last one): the
   * shell's log collects each new message line as Rogue shows it.
   */
  #logMessage(grid: Grid): void {
    const text = rowText(grid, MESSAGE_ROW)
      .replace(/--More--/g, '')
      .trim();
    if (!text || text === this.#lastMessage || !this.#state?.inGame) {
      if (!text) this.#lastMessage = '';
      return;
    }
    // A line that grew ("You hit the bat.  The bat bites.") replaces the shorter one.
    const grew = this.#lastMessage && text.startsWith(this.#lastMessage);
    const added = grew ? text.slice(this.#lastMessage.length).trim() : text;
    this.#lastMessage = text;
    if (!added) return;
    const entry: LogEntry = { id: ++this.#logId, runs: [{ text: added }] };
    this.#host?.emit({ type: 'message-log', reset: false, entries: [entry] });
  }

  #publishContext(force = false): void {
    if (!this.#playing) {
      this.#emitContext('start');
      return;
    }
    const grid = this.#grid;
    const state = this.#state;
    if (!grid || !state) return;
    const context = detectContext(grid, state);
    clearTimeout(this.#busyTimer);
    if (context === 'busy' && !force) {
      this.#busyTimer = setTimeout(() => this.#emitContext('busy'), BUSY_DELAY_MS);
      return;
    }
    this.#emitContext(context);
  }

  #emitContext(context: RogueContext): void {
    // A list opened from an item prompt can be chosen from; any other list
    // (the inventory, Discoveries) is only read.
    if (context === 'menu') this.#listFromPrompt ||= this.#context === 'item';
    else if (context !== 'busy') this.#listFromPrompt = false;
    if (context !== 'menu') this.#picked = this.debug.picked = null;
    // An item action from the inventory answers its "which object?" prompt.
    const use = this.#useLetter;
    if (use && context === 'item') {
      this.#useLetter = null;
      if (Date.now() - use.at < USE_ANSWER_MS) {
        this.#context = context;
        this.debug.context = context;
        this.#send([use.code]);
        return;
      }
    }
    this.#context = context;
    this.debug.context = context;
    // A touch command that asks for an item ("Eat", "Throw ↖E") shows the
    // list at once (`*`, as the prompt offers); its lines then answer it.
    // (Throw asks for the direction first.)
    if (context !== 'busy' && context !== 'more' && context !== 'direction' && this.#autoList) {
      this.#autoList = false;
      if (context === 'item') {
        this.#send([42]);
        return;
      }
    }
    const state = this.#state;
    const grid = this.#grid;
    const choosable = context === 'item' || (context === 'menu' && this.#listFromPrompt);
    const list = grid && choosable ? listBox(grid) : null;
    const choices = grid && list ? screenChoices(grid, list) : [];
    const leads = grid && state && context === 'map' ? mapLeads(grid, state) : null;
    this.debug.leads = leads;
    const layout = controlsFor(
      context,
      {
        hp: state?.hp ?? 0,
        maxHp: state?.maxHp ?? 0,
        run: this.#run,
        onStairs: state?.onStairs,
        amulet: state?.amulet,
        hunger: state?.hunger,
        under: Boolean(state?.under),
        armor: state?.armor,
        adjacent: leads?.adjacent,
        aquator: leads?.aquator,
        picked: context === 'menu' && !this.#listFromPrompt ? this.#picked : null,
      },
      choices,
    );
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({
      type: 'input-context',
      context: { textEntry: context === 'text' || context === 'start', mode: context },
    });
  }

  /** Views for the current presentation and screen. */
  #layout(): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    if (!renderer || !grid) return;
    this.#tiledNow = this.#tiled();
    this.debug.tiled = this.#tiledNow;
    this.debug.tileStyle = this.#tiledNow && this.#display !== 'text' ? this.#display : null;
    const { width, height } = renderer.size;
    const dpr = renderer.dpr;
    const whole: Rect = { x: 0, y: 0, width: grid.cols, height: grid.rows };
    const presentation = this.#presentation;
    if (!presentation?.compact) {
      this.#setBand(null);
      if (!this.#tiledNow) {
        renderer.setViews([fittedView('screen', whole, { x: 0, y: 0, width, height })]);
        return;
      }
      // Tiles: the message and status lines as text, the map between them in square cells.
      const text = fitCell(whole, width, height);
      const line = (y: number): Rect => ({ x: 0, y, width: grid.cols, height: 1 });
      renderer.setViews([
        fittedView('top', line(MESSAGE_ROW), { x: 0, y: 0, width, height: text.cellHeight }),
        fittedView(
          'map',
          mapRect(grid),
          { x: 0, y: text.cellHeight, width, height: height - 2 * text.cellHeight },
          Infinity,
          {},
          1,
        ),
        fittedView('status', line(STATUS_ROW), {
          x: 0,
          y: height - text.cellHeight,
          width,
          height: text.cellHeight,
        }),
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
      // The tombstone and the scores: the whole screen.
      renderer.setViews([fittedView('screen', whole, area)]);
      return;
    }
    const map = followView(
      'map',
      mapRect(grid),
      area,
      this.#mapCellCss * dpr,
      heroCell(state),
      this.#pan,
      this.#tiledNow ? 1 : undefined,
    );
    const views: View[] = [map];
    // Lists (with their "a) " labels), or other text drawn over the map.
    const overlay = this.#context !== 'map' ? (listBox(grid) ?? mapOverlay(grid)) : null;
    if (overlay) {
      const margin = Math.round(8 * dpr);
      map.dim = 0.62;
      const src = {
        x: Math.max(0, overlay.x - 1),
        y: overlay.y,
        width: Math.min(grid.cols, overlay.width + 2),
        height: overlay.height,
      };
      views.push(
        fittedView(
          'sheet',
          src,
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

  /** Phones: Rogue's status line and message line as a band; returns its height in CSS px. */
  #setBand(state: RogueState | null): number {
    const mount = this.#mount;
    if (!state || !mount) {
      this.#band?.remove();
      this.#band = null;
      return 0;
    }
    if (!this.#band) {
      const band = document.createElement('div');
      band.className = 'rogue-band';
      band.style.cssText =
        "position:absolute;top:0;left:0;right:0;z-index:1;box-sizing:border-box;padding:6px 10px;display:grid;gap:4px;background:rgba(10,9,7,.94);border-bottom:1px solid rgba(236,227,207,.12);color:#ece3cf;font:13px/1.3 'Inter Variable',system-ui,sans-serif;cursor:pointer";
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
    const message = grid ? rowText(grid, MESSAGE_ROW).trim() : '';
    const statusLine = grid ? rowText(grid, STATUS_ROW).replace(/\s+/g, ' ').trim() : '';
    const hpFraction = state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 1;
    const signature = `${statusLine}|${message}|${hpFraction}`;
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
      text.textContent = statusLine;
      top.append(bar, text);
      const line = document.createElement('div');
      line.style.cssText =
        'font:12px/16px ui-monospace,Menlo,Consolas,monospace;color:#babdb6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px';
      line.textContent = message;
      this.#band.append(top, line);
      this.#band.setAttribute('aria-label', `${statusLine}. ${message}. Open the message log`);
    }
    return this.#band.getBoundingClientRect().height;
  }

  /** A tap on a lettered line of a sheet chooses it ("a) ...", as Rogue's lists show). */
  #tap(clientX: number, clientY: number): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    if (!renderer || !grid) return;
    const hit = renderer.hitTest(clientX, clientY);
    if (!hit) return;
    if (hit.kind === 'dismiss') {
      this.#send([this.#context === 'menu' ? 32 : 27]);
      return;
    }
    if (hit.view !== 'sheet' && hit.view !== 'screen') return;
    const line = rowText(grid, hit.y);
    let start = hit.x;
    while (start > 0 && !(line[start - 1] === ' ' && line[start - 2] === ' ')) start--;
    const match = /^\s*([a-z])\)\s+(.*?)(?:\s{2,}|$)/.exec(line.slice(start));
    if (match) this.#choose(match[1]!.charCodeAt(0), match[2]!);
  }

  /**
   * Chooses a lettered item. Rogue's lists wait only for Space, so a list
   * shown from an item prompt ("Quaff what? (* for list)") is closed first
   * and the letter then answers the prompt.
   */
  #choose(letter: number, text = ''): void {
    // In a plain list (the inventory), a line is picked: the dock offers its actions.
    if (this.#context === 'menu' && !this.#listFromPrompt) {
      this.#picked = { letter: String.fromCharCode(letter), text };
      this.debug.picked = this.#picked;
      this.#publishContext(true);
      return;
    }
    this.#send(this.#context === 'menu' && this.#listFromPrompt ? [32, letter] : [letter]);
  }

  /** Long press on the map: identify the symbol there ("/" then the symbol). */
  #longPress(clientX: number, clientY: number): void {
    const hit = this.#renderer?.hitTest(clientX, clientY);
    const grid = this.#grid;
    if (hit?.kind !== 'cell' || hit.view !== 'map' || !grid || this.#context !== 'map') return;
    const symbol = grid.cells[(hit.y * grid.cols + hit.x) * 2]!;
    if (symbol > 32 && symbol < 127) this.#send(['/'.charCodeAt(0), symbol]);
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

export function createAdapter(): GameAdapter & { readonly debug: RogueDebugState } {
  return new RogueAdapter();
}

const module: GameModule = { createAdapter };
export default module;

// SPDX-License-Identifier: GPL-2.0-only
/**
 * Rogue Archive adapter for Angband 4.2.
 *
 * Angband runs in a Web Worker with our display module (port/main-web.c),
 * which sends its 80x24 screen (characters, colours and, in a graphics mode,
 * tiles) on each refresh. The screen is drawn with the shared terminal
 * renderer (@rogue-archive/term-view): whole on desktop; on phones the map is
 * cropped, zoomed and follows the player, text drawn over the map is lifted
 * into a large sheet, and the sidebar and status line become a band.
 *
 * Tiles are Angband's own graphics modes: the game switches to one (its
 * graf-*.prf visuals) and draws the map with tile coordinates, which are drawn
 * here from the mode's tile sheet. Only tilesets whose licences allow
 * redistribution are shipped (games/angband/LICENSES.md).
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
  ANGBAND_COMMANDS,
  ANGBAND_TOUCH_LAYOUT,
  ATTACK,
  CHOOSE,
  DIRECTION_COMMANDS,
  KC,
  MOD,
  SAVE_ROW,
  clickEvent,
  commandKeys,
  controlsFor,
  findCommand,
  keyEvent,
  keyToAngband,
  textToAngband,
  type AngbandContext,
} from './input.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import {
  detectContext,
  itemPrompt,
  mapOverlay,
  mapRect,
  parseState,
  playerCell,
  saveMenu,
  screenChoices,
  statusLine,
  type AngbandState,
  type SaveChoice,
} from './state.ts';

export const GAME_ID = 'angband';
const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
const DEFAULT_MAP_CELL_CSS = 22;
/** The cell the display module sends for a tile (port/main-web.c TILE_CELL). */
const TILE_CELL = 0x7f;

/** The tilesets shipped: Angband's graphics mode id (lib/tiles/list.txt) and sheet. */
const TILESET = { mode: 2, sheet: 'tiles/adam-bolt.png', size: 16, name: "Adam Bolt's tiles" };

type Display = 'text' | 'tiles';

export interface AngbandDebugState {
  context: AngbandContext | null;
  inGame: boolean;
  /** The map is drawn with tiles now. */
  tiled: boolean;
  state: AngbandState | null;
  saves: string[];
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
  /** The game's cursor (look/target mode places it on the cell described), if shown. */
  cursor(): { x: number; y: number } | null;
  /** The tile drawn at a screen cell (0x8000 | row << 7 | col), 0 if none. */
  tileAt(x: number, y: number): number;
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

class AngbandAdapter implements GameAdapter {
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
  readonly commands = ANGBAND_COMMANDS;
  readonly touchLayout = ANGBAND_TOUCH_LAYOUT;
  readonly settings: readonly GameSettingDescriptor[] = [
    {
      key: 'display',
      label: 'Display',
      description: `Text is Angband's own screen, as in a terminal. Tiles draws the map with Angband's own graphics mode for ${TILESET.name} (part of Angband; freely redistributable). Messages, the sidebar and menus stay text.`,
      options: [
        { value: 'text', label: 'Text (original)' },
        { value: 'tiles', label: 'Tiles' },
      ],
      default: 'text',
      appliesOn: 'immediately',
    },
  ];
  readonly resumeHint =
    'Angband saves when you take the stairs, with Ctrl-S, and when you save and quit (Ctrl-X). Saved characters are listed when the game starts.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #renderer: TermRenderer | null = null;
  #mount: HTMLElement | null = null;
  #grid: Grid | null = null;
  #tiles: Uint16Array | null = null;
  #state: AngbandState | null = null;
  #palette: string[] = [];
  #context: AngbandContext | null = null;
  #layoutSignature = '';
  #busyTimer: ReturnType<typeof setTimeout> | undefined;
  #presentation: Presentation | null = null;
  #band: HTMLDivElement | null = null;
  #mapCellCss = DEFAULT_MAP_CELL_CSS;
  #pan = { x: 0, y: 0 };
  #lastPlayer: { x: number; y: number } | null = null;
  #run = false;
  #started = false;
  #exited = false;
  #display: Display = 'text';
  #runtimeFiles: readonly RuntimeFile[] = [];
  #runtimeBaseUrl = '';
  #sheet: ImageBitmap | null = null;
  #sheetLoading: Promise<void> | null = null;
  readonly #tileImages = new Map<number, CanvasImageSource>();
  #tiledNow = false;
  /** The graphics mode last asked of the game (it applies it at its next wait). */
  #requestedMode = 0;
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #logId = 0;
  #log: LogEntry[] = [];
  #saveMenu: SaveChoice[] = [];
  #cleanup: (() => void)[] = [];
  readonly debug: AngbandDebugState;

  constructor() {
    const row = (y: number) => (this.#grid ? rowText(this.#grid, y) : '');
    this.debug = {
      context: null,
      inGame: false,
      tiled: false,
      state: null,
      saves: [],
      rowText: row,
      screenText: () =>
        this.#grid ? Array.from({ length: this.#grid.rows }, (_, y) => row(y)).join('\n') : '',
      views: () => this.#renderer?.views.map((view) => view.name) ?? [],
      cellToClient: (x, y) => this.#renderer?.cellToClient(x, y) ?? null,
      cursor: () => {
        const cursor = this.#grid?.cursor;
        return cursor?.visible ? { x: cursor.x, y: cursor.y } : null;
      },
      tileAt: (x, y) => (this.#grid && this.#tiles ? (this.#tiles[(y * this.#grid.cols + x) * 2] ?? 0) : 0),
    };
  }

  async initialize(host: GameHost, options: InitializeOptions): Promise<void> {
    this.#host = host;
    this.#mount = options.mount;
    const { runtime, runtimeBaseUrl, signal } = options;
    this.#runtimeFiles = runtime.files;
    this.#runtimeBaseUrl = runtimeBaseUrl;
    const verified = (path: string) => {
      const file = findFile(runtime.files, path);
      return { url: new URL(file.path, runtimeBaseUrl).href, file };
    };
    const stored = Number(options.settings.mapCellCss);
    if (Number.isFinite(stored) && stored > 0) this.#mapCellCss = stored;
    this.#display = options.settings.display === 'tiles' ? 'tiles' : 'text';

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'angband' });
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
    this.#post({
      type: 'init',
      glue: verified('angband.mjs'),
      wasm: verified('angband.wasm'),
      data: verified('angband-data.data'),
    });
    await ready;
    if (signal.aborted) return;

    const renderer = new TermRenderer(options.mount, {
      glyph: (code) => (code === TILE_CELL ? '' : String.fromCharCode(code)),
      // Solid walls (the solid_walls option): the cell filled with its colour.
      inverse: (color) => color >= 0x80,
      tile: (code, x, y, view) => this.#tileAt(code, x, y, view),
    });
    renderer.canvas.classList.add('angband-canvas');
    renderer.canvas.setAttribute('role', 'img');
    renderer.canvas.setAttribute('aria-label', 'Angband game screen');
    renderer.onResize = () => this.#layout();
    this.#renderer = renderer;
    if (this.#palette.length) renderer.setPalette(this.#palette);
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      this.#click(event.clientX, event.clientY, 2);
    };
    renderer.canvas.addEventListener('contextmenu', contextMenu);
    this.#cleanup.push(
      () => renderer.canvas.removeEventListener('contextmenu', contextMenu),
      attachGestures(renderer.canvas, {
        tap: (x, y, event) => {
          if (event.button === 2) return;
          this.#tap(x, y);
        },
        longPress: (x, y) => this.#longPress(x, y),
        pan: (dx, dy) => this.#panBy(dx, dy),
        pinch: (scale) => this.#zoomBy(scale),
      }),
    );
    if (this.#display === 'tiles') await this.#loadTiles();
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  /** The tile sheet, downloaded once, when tiles are first chosen. */
  #loadTiles(): Promise<void> {
    this.#sheetLoading ??= verifiedImage(
      new URL(TILESET.sheet, this.#runtimeBaseUrl).href,
      findFile(this.#runtimeFiles, TILESET.sheet),
    )
      .then((sheet) => {
        this.#sheet = sheet;
        this.#syncGraphics();
        this.#layout();
      })
      .catch((error: unknown) => {
        this.#sheetLoading = null;
        this.#host?.logger.warn('Could not load the tiles; showing text', error);
      });
    return this.#sheetLoading;
  }

  /** The graphics mode the game should use: tiles once the sheet is here. */
  #wantedMode(): number {
    return this.#display === 'tiles' && this.#sheet ? TILESET.mode : 0;
  }

  /**
   * Asks the game to switch graphics mode when it waits at a safe point (the
   * map, or before a character is loaded): Angband redraws the map then, as
   * its SDL2 front end does from its menu.
   */
  #syncGraphics(): void {
    const mode = this.#wantedMode();
    if (mode === this.#requestedMode || !this.#started) return;
    const context = this.#context;
    if (context !== 'map' && context !== 'select' && context !== 'birth') return;
    this.#requestedMode = mode;
    this.#post({ type: 'graphics', mode });
  }

  /** One tile from the sheet, cut out once. */
  #tileImage(code: number): CanvasImageSource | null {
    const sheet = this.#sheet;
    if (!sheet || !(code & 0x8000)) return null;
    let image = this.#tileImages.get(code);
    if (!image) {
      const size = TILESET.size;
      const row = (code >> 7) & 0x7f;
      const col = code & 0x7f;
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(sheet, col * size, row * size, size, size, 0, 0, size, size);
      image = canvas;
      this.#tileImages.set(code, image);
    }
    return image;
  }

  /** A tile cell: the terrain, then what stands on it (as upstream's SDL2 front end draws them). */
  #tileAt(code: number, x: number, y: number, view: string): readonly CanvasImageSource[] | null {
    if (code !== TILE_CELL || view === 'sheet' || !this.#grid || !this.#tiles) return null;
    const at = (y * this.#grid.cols + x) * 2;
    const fg = this.#tiles[at] ?? 0;
    const bg = this.#tiles[at + 1] ?? 0;
    const images: CanvasImageSource[] = [];
    const terrain = bg && bg !== fg ? this.#tileImage(bg) : null;
    if (terrain) images.push(terrain);
    const top = this.#tileImage(fg);
    if (top) images.push(top);
    return images;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    // Upstream main.c's "gcu" entry is our display module (see port/main-web.c);
    // -c opens Angband's own savefile menu; -n lets new characters name their savefiles.
    this.#requestedMode = this.#wantedMode();
    this.#post({ type: 'start', args: ['-c', '-mgcu', '--', '-n', `-g${this.#requestedMode}`] });
    this.#renderer?.canvas.focus({ preventScroll: true });
  }

  sendInput(input: GameInput): void {
    if (input.type === 'key') {
      const events = keyToAngband(input);
      if (events) this.#send(events);
      return;
    }
    if (input.type === 'text') {
      this.#send(textToAngband(input.text));
      return;
    }
    if (input.type !== 'command') return;
    const id = input.commandId;
    if (id.startsWith(CHOOSE)) {
      this.#send([keyEvent(id.codePointAt(CHOOSE.length)!)]);
      return;
    }
    if (id.startsWith(SAVE_ROW)) {
      // The savefile menu takes a click to move to a row and a second to choose it.
      const row = Number(id.slice(SAVE_ROW.length));
      this.#send([clickEvent(1, row), clickEvent(1, row)]);
      return;
    }
    if (id.startsWith(ATTACK)) {
      const move = findCommand(DIRECTION_COMMANDS[Number(id.slice(ATTACK.length))] ?? '');
      if (move) this.#send(move.keys.map((code) => keyEvent(code)));
      return;
    }
    if (id === 'run') {
      this.#run = !this.#run;
      this.#publishContext(true);
      return;
    }
    const command = findCommand(id);
    if (!command) return;
    if (this.#run && id.startsWith('move-')) {
      // Shift+direction runs (pref.prf keymaps, both keysets).
      this.#run = false;
      this.#send(command.keys.map((code) => keyEvent(code, MOD.SHIFT)));
      this.#publishContext(true);
      return;
    }
    this.#send(commandKeys(command, this.#state?.roguelike ?? false).map((code) => keyEvent(code)));
  }

  #send(events: number[]): void {
    if (events.length) this.#post({ type: 'events', events });
  }

  exitPrompt(): GameExitPrompt | null {
    if (this.#exited || !this.#state?.inGame) return null;
    return {
      message:
        'Angband saves when you take the stairs. Save and leave keeps everything up to now; leaving without saving goes back to your last save.',
      options: [
        { id: 'save', label: 'Save and leave', primary: true },
        { id: 'leave', label: 'Leave without saving', destructive: true },
      ],
    };
  }

  /** Save and leave: Angband's own save (Ctrl-S), from the map, then wait for "Saving game... done.". */
  async exitWith(optionId: string): Promise<void> {
    if (optionId !== 'save') return;
    for (let i = 0; i < 12 && this.#context !== 'map' && this.#context !== 'store'; i++) {
      if (this.#context !== 'busy') this.#send([keyEvent(this.#context === 'more' ? KC.ENTER : KC.ESCAPE)]);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.#context === 'store') {
      this.#send([keyEvent(KC.ESCAPE)]);
      await waitUntil(() => this.#context === 'map', 5000, 'Leaving the store');
    }
    if (this.#context !== 'map') throw new Error('Angband is not ready for a command.');
    this.#send([keyEvent(19)]);
    await waitUntil(
      () => {
        const line = this.debug.rowText(0);
        if (/Saving game\.\.\. failed/.test(line)) throw new Error('Angband could not save.');
        return /Saving game\.\.\. done/.test(line);
      },
      15_000,
      'Saving',
    );
  }

  async persist(): Promise<void> {
    if (!this.#worker || this.#exited) return;
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

  applySetting(key: string, value: string | number): void {
    if (key !== 'display') return;
    this.#display = value === 'tiles' ? 'tiles' : 'text';
    if (this.#display === 'tiles') void this.#loadTiles();
    this.#syncGraphics();
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
    if (this.#started && !this.#exited) {
      try {
        await this.persist();
      } catch (error) {
        this.#host?.logger.warn('Could not persist before shutdown', error);
      }
    }
    worker.terminate();
    this.#worker = null;
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    clearTimeout(this.#busyTimer);
    this.#band?.remove();
    this.#band = null;
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

  #onWorkerMessage(message: FromWorker): void {
    const host = this.#host;
    switch (message.type) {
      case 'frame': {
        const grid: Grid = {
          cols: message.cols,
          rows: message.rows,
          cells: message.cells,
          cursor: message.cursor,
        };
        this.#grid = grid;
        this.#tiles = message.tiles;
        this.#state = parseState(message.state);
        this.debug.state = this.#state;
        this.debug.inGame = this.#state.inGame;
        const player = playerCell(this.#state);
        if (player?.x !== this.#lastPlayer?.x || player?.y !== this.#lastPlayer?.y)
          this.#pan = { x: 0, y: 0 };
        this.#lastPlayer = player;
        this.#renderer?.setGrid(grid);
        this.#publishContext();
        this.#layout();
        break;
      }
      case 'palette': {
        const colors: string[] = [];
        const count = message.table.length / 4;
        for (let i = 0; i < count; i++) {
          const [r, g, b] = [message.table[i * 4 + 1]!, message.table[i * 4 + 2]!, message.table[i * 4 + 3]!];
          colors.push(`rgb(${r},${g},${b})`);
        }
        // Colours with bit 7 set are solid blocks of the same colour.
        this.#palette = Array.from({ length: 256 }, (_, i) => colors[i & 0x7f] ?? '#fff');
        this.#renderer?.setPalette(this.#palette);
        break;
      }
      case 'message': {
        // Angband's log has blank lines and a "====" rule between characters;
        // the shell's log is per session, so they are left out.
        if (/^\s*$|^=+$/.test(message.text.trim())) break;
        const entry: LogEntry = {
          id: ++this.#logId,
          runs: [{ text: message.text, color: this.#palette[message.color] ?? '#fff' }],
        };
        if (message.repeat && this.#log.length > 0) {
          this.#log[this.#log.length - 1] = entry;
          host?.emit({ type: 'message-log', reset: true, entries: [...this.#log] });
        } else {
          this.#log.push(entry);
          if (this.#log.length > 1000) this.#log.splice(0, this.#log.length - 1000);
          host?.emit({ type: 'message-log', reset: false, entries: [entry] });
        }
        break;
      }
      case 'status':
        host?.emit({ type: 'status', status: message.status });
        break;
      case 'error':
        if (this.#started) host?.emit({ type: 'error', error: message.error });
        break;
      case 'exit':
        // After a save and quit Angband starts again at its savefile menu; quitting there ends the session.
        if (message.restarted) {
          this.#requestedMode = 0;
          break;
        }
        this.#exited = true;
        host?.emit({ type: 'exit', reason: 'user' });
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
      case 'saves':
        this.debug.saves = message.names;
        break;
      case 'ready':
        break;
    }
  }

  #publishContext(force = false): void {
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

  #emitContext(context: AngbandContext): void {
    this.#context = context;
    this.debug.context = context;
    const state = this.#state;
    const grid = this.#grid;
    const top = grid ? rowText(grid, 0) : '';
    const overlay =
      grid && state && (context === 'menu' || context === 'item') ? mapOverlay(grid, state) : null;
    const lettered = context === 'birth' || context === 'menu' || context === 'item' || context === 'store';
    const choices = grid && lettered ? screenChoices(grid, overlay ?? undefined) : [];
    this.#saveMenu = grid && context === 'select' ? (saveMenu(grid) ?? []) : [];
    const layout = controlsFor(
      context,
      {
        ...state,
        hp: state?.hp ?? 0,
        maxHp: state?.maxHp ?? 0,
        run: this.#run,
        prompt: top,
        bottom: grid ? rowText(grid, grid.rows - 1) : '',
      },
      choices,
      context === 'item' ? itemPrompt(top) : null,
      this.#saveMenu,
    );
    this.#syncGraphics();
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({
      type: 'input-context',
      context: { textEntry: context === 'text', mode: context },
    });
  }

  /** The map is drawn with tiles: the game is in a graphics mode and on the map. */
  #tiled(): boolean {
    return !!this.#sheet && (this.#state?.graphics ?? 0) === TILESET.mode && !!this.#state?.inGame;
  }

  /** Views for the current presentation and screen. */
  #layout(): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    const state = this.#state;
    if (!renderer || !grid) return;
    this.#tiledNow = this.#tiled();
    this.debug.tiled = this.#tiledNow;
    const { width, height } = renderer.size;
    const dpr = renderer.dpr;
    const whole: Rect = { x: 0, y: 0, width: grid.cols, height: grid.rows };
    const presentation = this.#presentation;
    const inMap = !!state?.inGame && this.#context !== 'store';
    if (!presentation?.compact) {
      this.#setBand(null);
      const covered = !!state && !!mapOverlay(grid, state);
      if (!this.#tiledNow || !inMap || covered || !state) {
        renderer.setViews([fittedView('screen', whole, { x: 0, y: 0, width, height })]);
        return;
      }
      // Tiles: the message line, sidebar and status line as text, the map in square cells.
      const text = fitCell(whole, width, height);
      const map = mapRect(grid, state);
      const side = map.x * text.cellWidth;
      const top = map.y * text.cellHeight;
      const bottom = height - text.cellHeight;
      renderer.setViews([
        fittedView(
          'top',
          { x: 0, y: 0, width: grid.cols, height: map.y },
          { x: 0, y: 0, width, height: top },
        ),
        fittedView(
          'side',
          { x: 0, y: map.y, width: map.x, height: map.height },
          { x: 0, y: top, width: side, height: bottom - top },
        ),
        fittedView(
          'map',
          map,
          { x: side, y: top, width: width - side, height: bottom - top },
          Infinity,
          {},
          1,
        ),
        fittedView(
          'status',
          { x: 0, y: grid.rows - 1, width: grid.cols, height: 1 },
          { x: 0, y: bottom, width, height: text.cellHeight },
        ),
      ]);
      return;
    }
    const insets = presentation.insets;
    const band = this.#setBand(inMap && state ? state : null);
    const area: Rect = {
      x: Math.round(insets.left * dpr),
      y: Math.round(band * dpr),
      width: Math.max(1, width - Math.round((insets.left + insets.right) * dpr)),
      height: Math.max(1, height - Math.round((band + insets.bottom) * dpr)),
    };
    // Full-screen text (the savefile menu, character creation, stores): the
    // whole screen fitted; its choices are also large buttons in the dock.
    if (!inMap || !state) {
      renderer.setViews([fittedView('screen', whole, area)]);
      return;
    }
    const map = followView(
      'map',
      mapRect(grid, state),
      area,
      this.#mapCellCss * dpr,
      playerCell(state),
      this.#pan,
      this.#tiledNow ? 1 : undefined,
    );
    const views: View[] = [map];
    const overlay = mapOverlay(grid, state);
    if (overlay && this.#context !== 'map') {
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

  /** Phones: the status band (health, mana, depth, Angband's status line and message line); returns its height in CSS px. */
  #setBand(state: AngbandState | null): number {
    const mount = this.#mount;
    if (!state || !mount || !this.#grid) {
      this.#band?.remove();
      this.#band = null;
      return 0;
    }
    if (!this.#band) {
      const band = document.createElement('div');
      band.className = 'angband-band';
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
    const message = rowText(this.#grid, 0).trim();
    const hpFraction = state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 1;
    const depth = state.depth > 0 ? `${state.depth * 50} ft (L${state.depth})` : 'Town';
    const mana = state.maxSp > 0 ? ` · ${state.sp}/${state.maxSp} SP` : '';
    const status = `${state.hp}/${state.maxHp} HP${mana} · Level ${state.level} · ${depth}`;
    // Angband's status line (light, hunger, speed, timed effects; hidden on phones).
    const conditions = statusLine(this.#grid);
    const signature = `${status}|${message}|${conditions}`;
    if (this.#band.dataset.signature !== signature) {
      this.#band.dataset.signature = signature;
      this.#band.replaceChildren();
      const top = document.createElement('div');
      top.style.cssText =
        'display:flex;align-items:center;gap:8px;font-weight:600;font-variant-numeric:tabular-nums';
      const bar = document.createElement('span');
      bar.style.cssText = `flex:none;width:64px;height:10px;border-radius:999px;background:linear-gradient(90deg,hsl(${Math.round(hpFraction * 110)} 62% 48%) ${hpFraction * 100}%,rgba(255,255,255,.1) 0)`;
      const text = document.createElement('span');
      text.textContent = status;
      top.append(bar, text);
      this.#band.append(top);
      if (conditions) {
        const row = document.createElement('div');
        row.className = 'angband-band__status';
        row.style.cssText = 'font-size:12px;font-weight:600;color:#fcaf3e';
        row.textContent = conditions;
        this.#band.append(row);
      }
      const line = document.createElement('div');
      line.style.cssText =
        'font:12px/16px ui-monospace,Menlo,Consolas,monospace;color:#babdb6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px';
      line.textContent = message;
      this.#band.append(line);
      this.#band.setAttribute(
        'aria-label',
        `${status}.${conditions ? ` ${conditions}.` : ''} ${message}. Open the message log`,
      );
    }
    return this.#band.getBoundingClientRect().height;
  }

  /** The screen cell under a point (any view), or null. */
  #cellAt(clientX: number, clientY: number) {
    return this.#renderer?.hitTest(clientX, clientY) ?? null;
  }

  /** A click on a screen cell, as Angband's mouse support takes it (menus, the map: walk or travel there). */
  #click(clientX: number, clientY: number, button: number, mods = 0): void {
    const hit = this.#cellAt(clientX, clientY);
    if (!hit) return;
    if (hit.kind === 'dismiss') {
      this.#send([keyEvent(KC.ESCAPE)]);
      return;
    }
    this.#send([clickEvent(hit.x, hit.y, button, mods)]);
  }

  /** A tap is a click: on the map Angband walks or travels there; in menus it picks the row. */
  #tap(clientX: number, clientY: number): void {
    if (this.#context === 'busy') {
      // Resting or running: a tap stops, as a key does.
      this.#send([keyEvent(KC.ESCAPE)]);
      return;
    }
    this.#click(clientX, clientY, 1);
  }

  /** Long-press on the map looks at that cell (Alt+click: ui-context.c target_set_interactive TARGET_LOOK). */
  #longPress(clientX: number, clientY: number): void {
    const hit = this.#cellAt(clientX, clientY);
    if (hit?.kind !== 'cell' || hit.view !== 'map' || this.#context !== 'map') return;
    this.#send([clickEvent(hit.x, hit.y, 1, MOD.ALT)]);
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

export function createAdapter(): GameAdapter & { readonly debug: AngbandDebugState } {
  return new AngbandAdapter();
}

const module: GameModule = { createAdapter };
export default module;

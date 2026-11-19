// SPDX-License-Identifier: GPL-2.0-only
/**
 * Rogue Archive adapter for DRL.
 *
 * DRL runs in a Web Worker in its console mode, on a small curses
 * (port/ncurses.pas) that sends its 80x25 screen on each refresh. The screen
 * is drawn with the shared terminal renderer (@rogue-archive/term-view):
 * whole on desktop; on phones the map is zoomed and follows the player, a
 * box DRL draws over the map (its menus, the inventory) is lifted into a
 * sheet, full screens fit the screen, and the HUD becomes a status band.
 *
 * DRL has its own launcher: its main menu starts, continues and ends games,
 * and shows the scores. Leaving a game in progress uses its Save & Quit.
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
  type InitializeOptions,
  type LogEntry,
  type Presentation,
  type RuntimeFile,
  type SaveFile,
} from '@rogue-archive/game-api';
import {
  TermRenderer,
  attachGestures,
  fittedView,
  followView,
  rowText,
  type Grid,
  type Rect,
  type View,
} from '@rogue-archive/term-view';
import {
  DRL_COMMANDS,
  DRL_TOUCH_LAYOUT,
  controlsFor,
  findCommand,
  keyToCurses,
  KEY,
  type DrlContext,
} from './input.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import {
  MAP_BOTTOM,
  MAP_TOP,
  boxRect,
  detectContext,
  glyph,
  messageLines,
  parseHud,
  playerCell,
  screenRow,
  screenText,
  type DrlHud,
} from './state.ts';

export const GAME_ID = 'drl';
const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
const DEFAULT_MAP_CELL_CSS = 20;
/**
 * The terminal's colours, by curses number (black, red, green, yellow, blue,
 * magenta, cyan, white), then bold: a VGA text-mode palette, as DRL's
 * console looks on Windows and most terminals.
 */
const PALETTE = [
  '#000000',
  '#aa0000',
  '#00aa00',
  '#aa5500',
  '#2d3fd6',
  '#aa00aa',
  '#00aaaa',
  '#aaaaaa',
  '#555555',
  '#ff5555',
  '#55ff55',
  '#ffff55',
  '#5f6fff',
  '#ff55ff',
  '#55ffff',
  '#ffffff',
];

export interface DrlDebugState {
  context: DrlContext | null;
  /** DRL's HUD is on screen (a game in progress). */
  inGame: boolean;
  state: DrlHud | null;
  /** A saved game exists (user/drl/save). */
  hasSave: boolean;
  /** The WebAssembly module's memory size, in bytes. */
  memoryBytes(): number;
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
}

function findFile(files: RuntimeFile[], path: string): RuntimeFile {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Runtime manifest is missing ${path}`);
  return file;
}

class DrlAdapter implements GameAdapter {
  readonly apiVersion = GAME_API_VERSION;
  readonly gameId = GAME_ID;
  readonly capabilities = {
    keyboard: true,
    pointer: false,
    touch: true,
    save: true,
    saveExport: true,
    offline: true,
    audio: false,
  };
  readonly commands = DRL_COMMANDS;
  readonly touchLayout = DRL_TOUCH_LAYOUT;
  readonly nativeSaveExtensions = [] as const;
  readonly resumeHint =
    'DRL saves with Save & Quit in its game menu (Escape on the map); Continue game in its main menu goes on from there. A saved game is removed when you continue it, as in DRL.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #renderer: TermRenderer | null = null;
  #mount: HTMLElement | null = null;
  #grid: Grid | null = null;
  #hud: DrlHud | null = null;
  #context: DrlContext | null = null;
  #started = false;
  #layoutSignature = '';
  #busyTimer: ReturnType<typeof setTimeout> | undefined;
  #presentation: Presentation | null = null;
  #band: HTMLDivElement | null = null;
  #mapCellCss = DEFAULT_MAP_CELL_CSS;
  #pan = { x: 0, y: 0 };
  #lastPlayer: { x: number; y: number } | null = null;
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #logId = 0;
  #lastMessages: string[] = [];
  #cleanup: (() => void)[] = [];
  #memoryBytes = 0;
  readonly debug: DrlDebugState;

  constructor() {
    this.debug = {
      context: null,
      inGame: false,
      state: null,
      hasSave: false,
      memoryBytes: () => this.#memoryBytes,
      rowText: (y) => (this.#grid ? screenRow(this.#grid, y).trimEnd() : ''),
      screenText: () => (this.#grid ? screenText(this.#grid) : ''),
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

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'drl' });
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
      glue: verified('drl.mjs'),
      wasm: verified('drl.wasm'),
      data: verified('drl-data.data'),
    });
    await ready;
    if (signal.aborted) return;

    const renderer = new TermRenderer(options.mount, { glyph });
    renderer.canvas.classList.add('drl-canvas');
    renderer.canvas.setAttribute('role', 'img');
    renderer.canvas.setAttribute('aria-label', 'DRL game screen');
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
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#post({ type: 'start' });
    this.#renderer?.canvas.focus({ preventScroll: true });
  }

  sendInput(input: GameInput): void {
    if (!this.#started) return;
    if (input.type === 'key') {
      const key = keyToCurses(input);
      if (key !== null) this.#send([key]);
      return;
    }
    if (input.type === 'text') {
      this.#send(
        [...input.text]
          .map((char) => (char === '\n' ? 13 : char === '\b' ? KEY.BACKSPACE : char.charCodeAt(0)))
          .filter((code) => code === 13 || code === KEY.BACKSPACE || (code >= 32 && code < 127)),
      );
      return;
    }
    if (input.type !== 'command') return;
    const command = findCommand(input.commandId);
    if (command) this.#send(command.keys);
  }

  #send(keys: number[]): void {
    if (keys.length) this.#post({ type: 'keys', keys });
  }

  exitPrompt(): GameExitPrompt | null {
    // Nothing to keep outside a game (DRL's main menu, its screens before a game).
    if (!this.#hud) return null;
    return {
      message:
        'DRL saves when you use Save & Quit (its game menu, Escape on the map); leave without it and the game since then is lost. Save and leave keeps it, to continue from the main menu.',
      options: [
        { id: 'save', label: 'Save and leave', primary: true },
        { id: 'leave', label: 'Leave without saving', destructive: true },
      ],
    };
  }

  /** Save and leave: DRL's own Save & Quit (Escape, the game menu's last entry), which ends at its main menu. */
  async exitWith(optionId: string): Promise<void> {
    if (optionId !== 'save') return;
    // Back to the map first: close prompts, screens and menus.
    for (let i = 0; i < 12 && this.#context !== 'map'; i++) {
      this.#send([this.#context === 'pager' ? 13 : 27]);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (this.#context !== 'map') throw new Error('DRL is not ready for a command.');
    this.#send([27]);
    await waitUntil(
      () => this.#context === 'menu' && /Save & Quit/.test(this.debug.screenText()),
      5000,
      "DRL's game menu",
    );
    // The menu opens on Continue; Up wraps to Save & Quit, its last entry.
    this.#send([KEY.UP]);
    await waitUntil(() => this.#selectedLine() === 'Save & Quit', 3000, 'Save & Quit');
    this.#send([13]);
    await waitUntil(() => !this.#hud && this.#context === 'title', 20_000, 'Saving');
    await this.persist();
  }

  /** The highlighted entry of DRL's game menu (drawn in its bold colour). */
  #selectedLine(): string | null {
    const grid = this.#grid;
    if (!grid) return null;
    for (let y = 0; y < grid.rows; y++) {
      const text = rowText(grid, y);
      const match = /(Continue|Help|Settings|Message history|Assemblies|Abandon Run|Save & Quit)\s*$/.exec(
        text,
      );
      if (!match) continue;
      const x = text.indexOf(match[1]!);
      const colour = grid.cells[(y * grid.cols + x) * 2 + 1]!;
      if (colour >= 11) return match[1]!;
    }
    return null;
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
      case 'ready':
      case 'saves':
        this.debug.hasSave = message.hasSave;
        break;
      case 'frame': {
        const grid: Grid = {
          cols: message.cols,
          rows: message.rows,
          cells: message.cells,
          cursor: message.cursor,
        };
        this.#grid = grid;
        this.#memoryBytes = message.memoryBytes;
        const hud = parseHud(grid);
        if (!hud && this.#hud) this.#lastMessages = [];
        this.#hud = hud;
        this.debug.state = hud;
        this.debug.inGame = Boolean(hud);
        const player = hud ? playerCell(grid) : null;
        if (player?.x !== this.#lastPlayer?.x || player?.y !== this.#lastPlayer?.y)
          this.#pan = { x: 0, y: 0 };
        this.#lastPlayer = player;
        this.#renderer?.setGrid(grid);
        this.#logMessages(grid);
        this.#publishContext();
        this.#layout();
        break;
      }
      case 'exit':
        // DRL's Exit: it starts again at its main menu.
        this.#hud = null;
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
   * The shell's log collects each new message line as DRL shows it (rows
   * 0-1; DRL's own history is its Message history screen, `s`). A line that
   * grew replaces the shorter one.
   */
  #logMessages(grid: Grid): void {
    if (!this.#hud) return;
    const lines = messageLines(grid);
    const before = this.#lastMessages;
    this.#lastMessages = lines;
    const entries: LogEntry[] = [];
    for (const line of lines) {
      if (before.includes(line)) continue;
      const grown = before.find((old) => line.startsWith(old));
      const added = grown ? line.slice(grown.length).trim() : line;
      if (added) entries.push({ id: ++this.#logId, runs: [{ text: added }] });
    }
    if (entries.length) this.#host?.emit({ type: 'message-log', reset: false, entries });
  }

  #publishContext(force = false): void {
    const grid = this.#grid;
    if (!grid) return;
    const context = detectContext(grid);
    clearTimeout(this.#busyTimer);
    if (context === 'busy' && !force) {
      this.#busyTimer = setTimeout(() => this.#emitContext('busy'), BUSY_DELAY_MS);
      return;
    }
    this.#emitContext(context);
  }

  #emitContext(context: DrlContext): void {
    this.#context = context;
    this.debug.context = context;
    const layout = controlsFor(context, { health: this.#hud?.health ?? null });
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({ type: 'input-context', context: { textEntry: context === 'text', mode: context } });
  }

  /** Views for the current presentation and screen. */
  #layout(): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    if (!renderer || !grid) return;
    const { width, height } = renderer.size;
    const dpr = renderer.dpr;
    const whole: Rect = { x: 0, y: 0, width: grid.cols, height: grid.rows };
    const presentation = this.#presentation;
    if (!presentation?.compact) {
      this.#setBand(null);
      renderer.setViews([fittedView('screen', whole, { x: 0, y: 0, width, height })]);
      return;
    }
    const hud = this.#hud;
    const insets = presentation.insets;
    const band = this.#setBand(hud);
    const area: Rect = {
      x: Math.round(insets.left * dpr),
      y: Math.round(band * dpr),
      width: Math.max(1, width - Math.round((insets.left + insets.right) * dpr)),
      height: Math.max(1, height - Math.round((band + insets.bottom) * dpr)),
    };
    const box = boxRect(grid);
    if (!hud || (box && box.width >= grid.cols - 2 && box.height >= grid.rows - 2)) {
      // Full screens (the main menu, the inventory...): the whole screen.
      renderer.setViews([fittedView('screen', whole, area)]);
      return;
    }
    const mapRect: Rect = { x: 0, y: MAP_TOP, width: grid.cols, height: MAP_BOTTOM - MAP_TOP + 1 };
    const map = followView('map', mapRect, area, this.#mapCellCss * dpr, playerCell(grid), this.#pan);
    const views: View[] = [map];
    if (box) {
      // A box over the map (the game menu): a sheet.
      const margin = Math.round(8 * dpr);
      map.dim = 0.62;
      views.push(
        fittedView(
          'sheet',
          box,
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

  /** Phones: DRL's HUD and its latest messages as a band; returns its height in CSS px. */
  #setBand(hud: DrlHud | null): number {
    const mount = this.#mount;
    if (!hud || !mount) {
      this.#band?.remove();
      this.#band = null;
      return 0;
    }
    if (!this.#band) {
      const band = document.createElement('div');
      band.className = 'drl-band';
      band.style.cssText =
        "position:absolute;top:0;left:0;right:0;z-index:1;box-sizing:border-box;padding:6px 10px;display:grid;gap:3px;background:rgba(10,9,7,.94);border-bottom:1px solid rgba(236,227,207,.12);color:#ece3cf;font:13px/1.3 'Inter Variable',system-ui,sans-serif;cursor:pointer";
      band.addEventListener('click', () =>
        this.#host?.emit({ type: 'shell-command', command: SHELL_COMMAND.log }),
      );
      mount.append(band);
      this.#band = band;
    }
    // The shell's tools over the top-right corner (none when a phone held
    // sideways has them in a rail): above the band on a narrow screen, else beside it.
    const reserve = this.#presentation?.topRightReserve ?? 0;
    const toolsAbove = reserve > 0 && mount.clientHeight > mount.clientWidth;
    this.#band.style.paddingTop = toolsAbove ? 'max(50px, env(safe-area-inset-top))' : '';
    this.#band.style.paddingRight = toolsAbove ? '10px' : `${reserve + 10}px`;
    const grid = this.#grid;
    const messages = grid ? messageLines(grid) : [];
    const prompt = grid ? rowText(grid, 2).trim() : '';
    const fraction = Math.max(0, Math.min(1, hud.health / 100));
    const signature = JSON.stringify([hud, messages, prompt]);
    if (this.#band.dataset.signature !== signature) {
      this.#band.dataset.signature = signature;
      this.#band.replaceChildren();
      const top = document.createElement('div');
      top.style.cssText =
        'display:flex;align-items:center;gap:8px;font-weight:600;font-variant-numeric:tabular-nums;min-width:0';
      const bar = document.createElement('span');
      bar.style.cssText = `flex:none;width:48px;height:10px;border-radius:999px;background:linear-gradient(90deg,hsl(${Math.round(fraction * 110)} 62% 48%) ${Math.min(100, fraction * 100)}%,rgba(255,255,255,.1) 0)`;
      const text = document.createElement('span');
      text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px';
      text.textContent = `${hud.healthText} · ${hud.weapon} · A: ${hud.armor} · Exp ${hud.exp} · ${hud.level}`;
      top.append(bar, text);
      this.#band.append(top);
      for (const line of [...messages, ...(prompt && !messages.includes(prompt) ? [prompt] : [])].slice(-2)) {
        const row = document.createElement('div');
        row.style.cssText =
          'font:12px/16px ui-monospace,Menlo,Consolas,monospace;color:#babdb6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px';
        row.textContent = line;
        this.#band.append(row);
      }
      this.#band.setAttribute(
        'aria-label',
        `${text.textContent}. ${messages.join(' ')}. Open the message log`,
      );
    }
    return this.#band.getBoundingClientRect().height;
  }

  /** A tap outside a sheet closes it (Escape); DRL's console has no mouse. */
  #tap(clientX: number, clientY: number): void {
    const hit = this.#renderer?.hitTest(clientX, clientY);
    if (hit?.kind === 'dismiss') this.#send([27]);
  }

  /** Long press on the map: DRL's look mode. */
  #longPress(clientX: number, clientY: number): void {
    const hit = this.#renderer?.hitTest(clientX, clientY);
    if (hit?.kind === 'cell' && hit.view === 'map' && this.#context === 'map')
      this.#send(['l'.charCodeAt(0)]);
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

export function createAdapter(): GameAdapter & { readonly debug: DrlDebugState } {
  return new DrlAdapter();
}

const module: GameModule = { createAdapter };
export default module;

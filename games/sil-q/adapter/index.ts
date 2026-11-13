// SPDX-License-Identifier: GPL-2.0-only
/**
 * Rogue Archive adapter for Sil-Q.
 *
 * Sil-Q runs in a Web Worker with our display module (port/main-web.c), which
 * sends its 80x24 character screen on each refresh. The screen is drawn with
 * the shared terminal renderer (@rogue-archive/term-view): whole on desktop;
 * on phones the map is cropped, zoomed and follows the player, text drawn over
 * the map is lifted into a large sheet, and the status line becomes a band.
 */
import {
  GAME_API_VERSION,
  SHELL_COMMAND,
  type GameAdapter,
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
  SIL_COMMANDS,
  SIL_TOUCH_LAYOUT,
  controlsFor,
  CHOOSE,
  findCommand,
  keyToSil,
  type SilContext,
} from './input.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import {
  detectContext,
  mapOverlay,
  mapRect,
  parseState,
  playerCell,
  screenChoices,
  type SilState,
} from './state.ts';

export const GAME_ID = 'sil-q';
const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
const DEFAULT_MAP_CELL_CSS = 20;

export interface SilDebugState {
  context: SilContext | null;
  inDungeon: boolean;
  state: SilState | null;
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

class SilAdapter implements GameAdapter {
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
  readonly commands = SIL_COMMANDS;
  readonly touchLayout = SIL_TOUCH_LAYOUT;
  readonly resumeHint =
    'Sil-Q saves when you change level and with Ctrl-S. Your character loads when you start the game.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #renderer: TermRenderer | null = null;
  #mount: HTMLElement | null = null;
  #grid: Grid | null = null;
  #state: SilState | null = null;
  #palette: string[] = [];
  #context: SilContext | null = null;
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
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #logId = 0;
  #cleanup: (() => void)[] = [];
  readonly debug: SilDebugState;

  constructor() {
    const row = (y: number) => (this.#grid ? rowText(this.#grid, y) : '');
    this.debug = {
      context: null,
      inDungeon: false,
      state: null,
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

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'sil-q' });
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
      glue: verified('sil.mjs'),
      wasm: verified('sil.wasm'),
      data: verified('sil-data.data'),
    });
    await ready;
    if (signal.aborted) return;

    const renderer = new TermRenderer(options.mount);
    renderer.canvas.classList.add('sil-canvas');
    renderer.canvas.setAttribute('role', 'img');
    renderer.canvas.setAttribute('aria-label', 'Sil-Q game screen');
    renderer.onResize = () => this.#layout();
    this.#renderer = renderer;
    if (this.#palette.length) renderer.setPalette(this.#palette);
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
    // Upstream main.c's "gcu" entry is our display module (see port/main-web.c).
    this.#post({ type: 'start', args: ['-mgcu'] });
    this.#renderer?.canvas.focus({ preventScroll: true });
  }

  sendInput(input: GameInput): void {
    if (input.type === 'key') {
      const keys = keyToSil(input);
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
    if (input.commandId.startsWith(CHOOSE)) {
      this.#send([input.commandId.charCodeAt(CHOOSE.length)]);
      return;
    }
    if (input.commandId === 'run') {
      this.#run = !this.#run;
      this.#publishContext(true);
      return;
    }
    const command = findCommand(input.commandId);
    if (!command) return;
    if (this.#run && command.id.startsWith('move-')) {
      this.#run = false;
      this.#send(['.'.charCodeAt(0), ...command.keys]);
      this.#publishContext(true);
      return;
    }
    this.#send(command.keys);
  }

  #send(keys: number[]): void {
    if (keys.length) this.#post({ type: 'keys', keys });
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

  applySetting(): void {}

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
        this.#state = parseState(message.state);
        this.debug.state = this.#state;
        this.debug.inDungeon = this.#state.inDungeon;
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
        for (let i = 0; i < 256; i++) {
          const [r, g, b] = [message.table[i * 4 + 1]!, message.table[i * 4 + 2]!, message.table[i * 4 + 3]!];
          colors.push(`rgb(${r},${g},${b})`);
        }
        this.#palette = colors;
        this.#renderer?.setPalette(colors);
        break;
      }
      case 'message': {
        const entry: LogEntry = {
          id: ++this.#logId,
          runs: [{ text: message.text, color: this.#palette[message.color] ?? '#fff' }],
        };
        host?.emit({ type: 'message-log', reset: false, entries: [entry] });
        break;
      }
      case 'status':
        host?.emit({ type: 'status', status: message.status });
        break;
      case 'error':
        if (this.#started) host?.emit({ type: 'error', error: message.error });
        break;
      case 'exit':
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

  #emitContext(context: SilContext): void {
    this.#context = context;
    this.debug.context = context;
    const state = this.#state;
    const grid = this.#grid;
    // Lettered choices: on title and creation screens anywhere, in menus within the list.
    const overlay = grid && context === 'menu' ? mapOverlay(grid) : null;
    const choices =
      grid && (context === 'title' || context === 'menu') ? screenChoices(grid, overlay ?? undefined) : [];
    const layout = controlsFor(
      context,
      { hp: state?.hp ?? 0, maxHp: state?.maxHp ?? 0, run: this.#run },
      choices,
    );
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({
      type: 'input-context',
      context: { textEntry: context === 'text' || context === 'title', mode: context },
    });
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
    const state = this.#state;
    const insets = presentation.insets;
    const band = this.#setBand(state?.inDungeon ? state : null);
    const area: Rect = {
      x: Math.round(insets.left * dpr),
      y: Math.round(band * dpr),
      width: Math.max(1, width - Math.round((insets.left + insets.right) * dpr)),
      height: Math.max(1, height - Math.round((band + insets.bottom) * dpr)),
    };
    // Full-screen text (title, character creation): the whole screen fitted;
    // its choices are also large buttons in the dock.
    if (!state?.inDungeon || this.#context === 'title') {
      renderer.setViews([fittedView('screen', whole, area)]);
      return;
    }
    const map = followView('map', mapRect(grid), area, this.#mapCellCss * dpr, playerCell(state), this.#pan);
    const views: View[] = [map];
    const overlay = mapOverlay(grid);
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

  /** Phones: the status band (health, voice, depth and Sil's message line); returns its height in CSS px. */
  #setBand(state: SilState | null): number {
    const mount = this.#mount;
    if (!state || !mount) {
      this.#band?.remove();
      this.#band = null;
      return 0;
    }
    if (!this.#band) {
      const band = document.createElement('div');
      band.className = 'sil-band';
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
    const message = this.#grid ? rowText(this.#grid, 0).trim() : '';
    const hpFraction = state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 1;
    const status = `${state.hp}/${state.maxHp} health · ${state.voice}/${state.maxVoice} voice · ${state.depth * 50} ft`;
    const signature = `${status}|${message}`;
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
      const line = document.createElement('div');
      line.style.cssText =
        'font:12px/16px ui-monospace,Menlo,Consolas,monospace;color:#babdb6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px';
      line.textContent = message;
      this.#band.append(top, line);
      this.#band.setAttribute('aria-label', `${status}. ${message}. Open the message log`);
    }
    return this.#band.getBoundingClientRect().height;
  }

  /** A tap on a lettered row of a sheet chooses it ("a) ...", as Sil's lists show). */
  #tap(clientX: number, clientY: number): void {
    const renderer = this.#renderer;
    const grid = this.#grid;
    if (!renderer || !grid) return;
    const hit = renderer.hitTest(clientX, clientY);
    if (!hit) return;
    if (hit.kind === 'dismiss') {
      this.#send([27]);
      return;
    }
    const line = rowText(grid, hit.y);
    const choice = /([a-zA-Z])\)\s/.exec(line.slice(Math.max(0, hit.x - 40), hit.x + 2));
    const anywhere = /^\s*([a-zA-Z])\)\s/.exec(line.slice(COL_SAFE(hit.x, line)));
    const letter = choice?.[1] ?? anywhere?.[1];
    if (letter && (hit.view === 'sheet' || hit.view === 'screen')) this.#send([letter.charCodeAt(0)]);
  }

  #longPress(clientX: number, clientY: number): void {
    const hit = this.#renderer?.hitTest(clientX, clientY);
    if (hit?.kind === 'cell' && hit.view === 'map') this.#send(['l'.charCodeAt(0)]);
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

/** Where to look for a row's "x) " label: from the start of the text block the tap is in. */
function COL_SAFE(x: number, line: string): number {
  let start = x;
  while (start > 0 && !(line[start - 1] === ' ' && line[start - 2] === ' ')) start--;
  return start;
}

export function createAdapter(): GameAdapter & { readonly debug: SilDebugState } {
  return new SilAdapter();
}

const module: GameModule = { createAdapter };
export default module;

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
  SIL_COMMANDS,
  SIL_TOUCH_LAYOUT,
  controlsFor,
  CHOOSE,
  OIL,
  KEYMAP_BYPASS,
  LOAD,
  SONG_NAMES,
  findCommand,
  isMapCommand,
  keyToSil,
  stepsTo,
  type SilContext,
} from './input.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import {
  detectContext,
  itemPrompt,
  mapOverlay,
  mapRect,
  parseState,
  playerCell,
  screenChoices,
  songPrompt,
  statusTags,
  type SilState,
  type StatusTone,
} from './state.ts';

export const GAME_ID = 'sil-q';
const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
/** Where main.c's "Open saved character" name prompt starts (Term_gotoxy(50, 21)). */
const LOAD_PROMPT_X = 50;
const DEFAULT_MAP_CELL_CSS = 20;

export interface SilDebugState {
  context: SilContext | null;
  inDungeon: boolean;
  state: SilState | null;
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
  /** The game's cursor (look/target mode places it on the cell described), if shown. */
  cursor(): { x: number; y: number } | null;
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
  #log: LogEntry[] = [];
  #saves: string[] = [];
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
      cursor: () => {
        const cursor = this.#grid?.cursor;
        return cursor?.visible ? { x: cursor.x, y: cursor.y } : null;
      },
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
    if (input.commandId.startsWith(LOAD)) {
      // From the main menu, choose "Open saved character" first. At its name
      // prompt, clear whatever was typed (the default "<name>" goes on the first key).
      const fromMenu = this.#context === 'title';
      const typed = !fromMenu && this.#grid?.cursor ? Math.max(0, this.#grid.cursor.x - LOAD_PROMPT_X) : 0;
      const name = input.commandId.slice(LOAD.length);
      this.#send([
        ...(fromMenu ? ['c'.charCodeAt(0)] : []),
        ...Array<number>(typed).fill(8),
        ...[...name].map((char) => char.charCodeAt(0)),
        13,
      ]);
      return;
    }
    if (input.commandId.startsWith(CHOOSE)) {
      this.#send([input.commandId.charCodeAt(CHOOSE.length)]);
      return;
    }
    // A flask of oil: throw (`t`) and answer "Throw which item?" with its letter.
    if (input.commandId.startsWith(OIL)) {
      const letter = input.commandId.charCodeAt(OIL.length);
      if (this.#context === 'map' && letter >= 97)
        this.#send([...this.#commandKeys(['t'.charCodeAt(0)]), letter]);
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
    this.#send(isMapCommand(command) ? this.#commandKeys(command.keys) : command.keys);
  }

  /**
   * A command typed at Sil's command prompt. With another keyset than the
   * original (the hjkl_movement or angband_keyset option), the key goes after
   * Sil's keymap bypass, so it means the underlying command the button names.
   */
  #commandKeys(keys: number[]): number[] {
    return this.#context === 'map' && (this.#state?.keyset ?? 0) !== 0 ? [KEYMAP_BYPASS, ...keys] : keys;
  }

  #send(keys: number[]): void {
    if (keys.length) this.#post({ type: 'keys', keys });
  }

  exitPrompt(): GameExitPrompt | null {
    if (this.#exited || !this.#state?.inDungeon || this.#context === 'title' || this.#context === 'load')
      return null;
    return {
      message:
        'Sil-Q saves when you take the stairs. Save and leave keeps everything up to now; leaving without saving goes back to your last save.',
      options: [
        { id: 'save', label: 'Save and leave', primary: true },
        { id: 'leave', label: 'Leave without saving', destructive: true },
      ],
    };
  }

  /** Save and leave: Sil's own save (Ctrl+S), from the map, then wait for "Saving game... done.". */
  async exitWith(optionId: string): Promise<void> {
    if (optionId !== 'save') return;
    for (let i = 0; i < 12 && this.#context !== 'map'; i++) {
      if (this.#context !== 'busy') this.#send([this.#context === 'more' ? 32 : 27]);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.#context !== 'map') throw new Error('Sil-Q is not ready for a command.');
    const top = () => this.debug.rowText(0);
    this.#send(this.#commandKeys([19]));
    await waitUntil(
      () => {
        const line = top();
        if (/cannot save games during the tutorial/.test(line))
          throw new Error('Sil-Q does not save during the tutorial.');
        if (/Saving game\.\.\. failed/.test(line)) throw new Error('Sil-Q could not save.');
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
        // Sil's log has blank lines and a "====" rule between games; the
        // shell's log is per session, so they are left out.
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
        this.#saves = message.names;
        if (this.#context === 'load') this.#publishContext(true);
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

  #emitContext(context: SilContext): void {
    this.#context = context;
    this.debug.context = context;
    const state = this.#state;
    const grid = this.#grid;
    // Lettered choices: on title and creation screens anywhere, in menus within the list.
    const overlay = grid && (context === 'menu' || context === 'item') ? mapOverlay(grid) : null;
    let choices =
      grid && (context === 'title' || context === 'menu' || context === 'item')
        ? screenChoices(grid, overlay ?? undefined)
        : [];
    const top = grid ? rowText(grid, 0) : '';
    const item = grid && context === 'item' ? itemPrompt(top) : null;
    // The song prompt names only letters: the songs' names are Sil's.
    const songs = context === 'song' ? songPrompt(top) : null;
    if (songs)
      choices = [
        ...songs.songs.map((key) => ({ key, label: SONG_NAMES[key.charCodeAt(0) - 97] ?? key })),
        { key: 's', label: 'Stop singing' },
        ...(songs.exchange ? [{ key: 'x', label: 'Exchange themes' }] : []),
      ];
    // Before the list is shown, an item prompt only names its letters.
    if (item) {
      const named = new Map(choices.map((choice) => [choice.key, choice.label]));
      choices = item.letters.map((key) => ({ key, label: named.get(key) ?? '' }));
    }
    const layout = controlsFor(
      context,
      { ...state, hp: state?.hp ?? 0, maxHp: state?.maxHp ?? 0, run: this.#run, prompt: top },
      choices,
      item,
      this.#saves,
    );
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({
      type: 'input-context',
      context: { textEntry: context === 'text' || context === 'title' || context === 'load', mode: context },
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
    // The shell's tools over the top-right corner (none when a phone held
    // sideways has them in a rail): above the band on a narrow screen, else beside it.
    const reserve = this.#presentation?.topRightReserve ?? 0;
    const toolsAbove = reserve > 0 && mount.clientHeight > mount.clientWidth;
    this.#band.style.paddingTop = toolsAbove ? 'max(50px, env(safe-area-inset-top))' : '';
    this.#band.style.paddingRight = toolsAbove ? '10px' : `${reserve + 10}px`;
    const message = this.#grid ? rowText(this.#grid, 0).trim() : '';
    const hpFraction = state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 1;
    const status = `${state.hp}/${state.maxHp} health · ${state.voice}/${state.maxVoice} voice · ${state.depth * 50} ft`;
    // Stealth mode, songs, hunger and conditions (Sil's sidebar and status line, hidden on phones).
    const tags = statusTags(state);
    const signature = `${status}|${message}|${tags.map((tag) => `${tag.tone}:${tag.text}`).join(',')}`;
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
      this.#band.append(top);
      if (tags.length) {
        const row = document.createElement('div');
        row.className = 'sil-band__status';
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;font-weight:600';
        for (const tag of tags) {
          const chip = document.createElement('span');
          chip.textContent = tag.text;
          chip.style.color = TONE_COLORS[tag.tone];
          row.append(chip);
        }
        this.#band.append(row);
      }
      this.#band.append(line);
      const conditions = tags.length ? ` ${tags.map((tag) => tag.text).join(', ')}.` : '';
      this.#band.setAttribute('aria-label', `${status}.${conditions} ${message}. Open the message log`);
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

  /**
   * Long-press on the map looks at that cell: Sil's look command, 'p' (back to
   * the player, in free-cursor mode), then one step per cell to the one pressed.
   * The description shows in the targeting prompt, as when looking by keyboard.
   */
  #longPress(clientX: number, clientY: number): void {
    const hit = this.#renderer?.hitTest(clientX, clientY);
    const player = this.#state ? playerCell(this.#state) : null;
    if (hit?.kind !== 'cell' || hit.view !== 'map' || !player || this.#context !== 'map') return;
    const look = findCommand('look')!;
    this.#send([
      ...this.#commandKeys(look.keys),
      'p'.charCodeAt(0),
      ...stepsTo(hit.x - player.x, hit.y - player.y),
    ]);
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

const TONE_COLORS: Record<StatusTone, string> = {
  good: '#8ae234',
  info: '#8cc8ff',
  warn: '#fcaf3e',
  bad: '#ff6b5e',
};

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

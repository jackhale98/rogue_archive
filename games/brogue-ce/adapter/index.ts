// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rogue Archive adapter for Brogue: Community Edition.
 *
 * Owns everything game-specific: the worker running the WebAssembly build,
 * the cell renderer, key/pointer/touch translation and save file handling.
 * The shared platform only sees the GameAdapter contract.
 */
import {
  GAME_API_VERSION,
  type GameAdapter,
  type GameHost,
  type GameInput,
  type GameModule,
  type GameSettingDescriptor,
  type InitializeOptions,
  type Presentation,
  type RuntimeFile,
  type SaveFile,
} from '@rogue-archive/game-api';
import { decodeSheet } from './atlas.ts';
import {
  COLS,
  DCOLS,
  DROWS,
  EventType,
  GraphicsMode,
  MAP_ORIGIN_X,
  MAP_ORIGIN_Y,
  ROWS,
} from './constants.ts';
import { BROGUE_COMMANDS, BROGUE_TOUCH_LAYOUT, commandToBrogue, keyToBrogue, textToBrogue } from './input.ts';
import type { BrogueEventTuple, FromWorker, ToWorker } from './protocol.ts';
import { BrogueHud } from './hud.ts';
import { BrogueRenderer, DEFAULT_MAP_CELL_CSS, RendererUnsupportedError } from './renderer.ts';
import type { HitResult, OverlayKind } from './views.ts';
import { controlsFor, detectContext, parseState, type BrogueContext, type BrogueState } from './state.ts';

export const GAME_ID = 'brogue-ce';

const ZOOM_STEPS = [
  { zoom: 1, label: 'Fit screen' },
  { zoom: 1.6, label: 'Zoom 1.6×' },
  { zoom: 2.2, label: 'Zoom 2.2×' },
] as const;

const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
const LONG_PRESS_MS = 450;
const TAP_SLOP_PX = 12;

export type TapMode = 'preview' | 'immediate';

/** Exposed for tests and debugging (`?debug`): the latest raw frame. */
export interface BrogueDebugState {
  cells: Uint8Array | null;
  inGame: boolean;
  playerX: number;
  playerY: number;
  graphicsMode: number;
  /** Text of one screen row (glyphs < 128 only; others become '?'). */
  /** What Brogue is waiting for (drives context-aware touch controls). */
  context: string | null;
  rowText(y: number): string;
  screenText(): string;
  /** Names of the views currently drawn (e.g. ["map", "sheet"]), for tests. */
  views(): string[];
  /** Client (CSS pixel) center of a screen cell, for tests. */
  cellToClient(x: number, y: number): { x: number; y: number } | null;
}

function isInMap(cell: { x: number; y: number }): boolean {
  return (
    cell.x >= MAP_ORIGIN_X &&
    cell.x < MAP_ORIGIN_X + DCOLS &&
    cell.y >= MAP_ORIGIN_Y &&
    cell.y < MAP_ORIGIN_Y + DROWS
  );
}

function findFile(files: RuntimeFile[], path: string): RuntimeFile {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Runtime manifest is missing ${path}`);
  return file;
}

async function fetchVerified(url: string, file: RuntimeFile, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw Object.assign(new Error(`Could not download ${file.path} (HTTP ${response.status}).`), {
      kind: 'network',
    });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256)
    throw Object.assign(new Error(`${file.path} failed its integrity check.`), { kind: 'integrity' });
  return new Blob([bytes], { type: 'image/png' });
}

class BrogueAdapter implements GameAdapter {
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
  readonly commands = BROGUE_COMMANDS;
  readonly touchLayout = BROGUE_TOUCH_LAYOUT;
  readonly settings: readonly GameSettingDescriptor[] = [
    {
      key: 'tapMode',
      label: 'Tapping the map',
      description: 'Preview shows the path and what is there first; tap the same spot again to go.',
      options: [
        { value: 'preview', label: 'Preview, then confirm' },
        { value: 'immediate', label: 'Act immediately' },
      ],
      default: 'preview',
      appliesOn: 'immediately',
    },
    {
      key: 'graphicsMode',
      label: 'Starting display',
      description: 'Brogue can also switch at any time with the G key.',
      options: [
        { value: GraphicsMode.TEXT, label: 'Text (classic)' },
        { value: GraphicsMode.TILES, label: 'Tiles' },
        { value: GraphicsMode.HYBRID, label: 'Hybrid' },
      ],
      default: GraphicsMode.TEXT,
      appliesOn: 'next-launch',
    },
  ];
  /** Brogue saves and recordings are plain files that desktop Brogue CE 1.15.1 opens directly. */
  readonly nativeSaveExtensions = ['.broguesave', '.broguerec'] as const;
  readonly resumeHint =
    'Brogue keeps your unfinished game as “LastGame”. Choose Load Saved Game on the title screen to continue it.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #renderer: BrogueRenderer | null = null;
  #settings: Record<string, unknown> = {};
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #started = false;
  #exited = false;
  #zoomIndex = 0;
  #lastHover: { x: number; y: number } | null = null;
  #inGame = false;
  #state: BrogueState | null = null;
  #context: BrogueContext | null = null;
  #layoutSignature = '';
  #busyTimer: ReturnType<typeof setTimeout> | undefined;
  #presentation: Presentation | null = null;
  #mount: HTMLElement | null = null;
  #hud: BrogueHud | null = null;
  #drawer = false;
  #lastCells: Uint8Array | null = null;
  #modifiers = { shift: false, ctrl: false };
  #cleanup: (() => void)[] = [];
  readonly debug: BrogueDebugState;

  constructor() {
    const rowText = (y: number): string => {
      const cells = this.debug.cells;
      if (!cells) return '';
      let text = '';
      for (let x = 0; x < COLS; x++) {
        const offset = (y * COLS + x) * 8;
        const sprite = cells[offset]! | (cells[offset + 1]! << 8);
        text += sprite >= 32 && sprite < 127 ? String.fromCharCode(sprite) : sprite === 0 ? ' ' : '?';
      }
      return text;
    };
    this.debug = {
      cells: null,
      inGame: false,
      playerX: -1,
      playerY: -1,
      graphicsMode: GraphicsMode.TEXT,
      context: null,
      rowText,
      screenText: () => Array.from({ length: ROWS }, (_, y) => rowText(y)).join('\n'),
      cellToClient: (x: number, y: number) => this.#renderer?.cellToClient(x, y) ?? null,
      views: () => this.#renderer?.views.map((view) => view.name) ?? [],
    };
  }

  async initialize(host: GameHost, options: InitializeOptions): Promise<void> {
    this.#host = host;
    this.#settings = options.settings;
    const { runtime, runtimeBaseUrl, signal } = options;

    if (typeof WebAssembly !== 'object') {
      throw Object.assign(new Error('This browser does not support WebAssembly.'), { kind: 'unsupported' });
    }
    const glue = findFile(runtime.files, 'brogue.mjs');
    const wasm = findFile(runtime.files, 'brogue.wasm');
    const tiles = findFile(runtime.files, 'tiles.png');
    const url = (file: RuntimeFile) => new URL(file.path, runtimeBaseUrl).href;

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'brogue-ce' });
    this.#worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready') resolve();
        else if (message.type === 'error' && !this.#started) {
          reject(
            Object.assign(new Error(message.error.message), {
              kind: message.error.kind,
              action: message.error.action,
            }),
          );
        }
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

    this.#post({ type: 'init', glue: { url: url(glue), file: glue }, wasm: { url: url(wasm), file: wasm } });
    const sheetPromise = fetchVerified(url(tiles), tiles, signal).then(decodeSheet);
    const [sheet] = await Promise.all([sheetPromise, ready]);
    if (signal.aborted) return;

    try {
      this.#mount = options.mount;
      this.#renderer = new BrogueRenderer(options.mount, sheet);
    } catch (error) {
      if (error instanceof RendererUnsupportedError) throw Object.assign(error, { kind: 'unsupported' });
      throw error;
    }
    // Without a saved choice, portrait screens start zoomed: the full 100x34
    // screen is unreadably small at phone widths.
    const rect = options.mount.getBoundingClientRect();
    const portraitDefault = rect.height > rect.width ? ZOOM_STEPS.length - 1 : 0;
    const zoom = Number(this.#settings.zoomIndex ?? portraitDefault);
    this.#zoomIndex = Number.isInteger(zoom) && zoom >= 0 && zoom < ZOOM_STEPS.length ? zoom : 0;
    this.#renderer.setZoom(ZOOM_STEPS[this.#zoomIndex]!.zoom);
    this.#attachPointer(this.#renderer.canvas);
    this.#attachModifierTracking();
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const mode = Number(this.#settings.graphicsMode ?? GraphicsMode.TEXT);
    const args =
      mode === GraphicsMode.TILES ? ['--graphics'] : mode === GraphicsMode.HYBRID ? ['--hybrid'] : [];
    this.#post({ type: 'start', args });
    this.#renderer?.canvas.focus({ preventScroll: true });
  }

  sendInput(input: GameInput): void {
    let events: BrogueEventTuple[] = [];
    if (input.type === 'key') {
      this.#setModifiers(input.modifiers.shift, input.modifiers.ctrl);
      const event = keyToBrogue(input);
      if (event) events = [event];
    } else if (input.type === 'text') {
      events = textToBrogue(input.text);
    } else if (input.type === 'command') {
      const event = commandToBrogue(input.commandId);
      if (event) events = [event];
    }
    for (const event of events) this.#post({ type: 'event', event });
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
    this.#applyCompact();
  }

  /** Phone layout on/off, and what it shows, from the presentation and the game's context. */
  #applyCompact(): void {
    const renderer = this.#renderer;
    const mount = this.#mount;
    if (!renderer || !mount) return;
    const presentation = this.#presentation;
    const compact = !!presentation?.compact && this.#inGame;
    if (!compact) {
      this.#hud?.destroy();
      this.#hud = null;
      this.#drawer = false;
      renderer.setCompact(null);
      return;
    }
    if (!this.#hud) {
      this.#hud = new BrogueHud(mount, {
        onStatus: () => this.#setDrawer(!this.#drawer),
        onMessages: () => this.sendInput({ type: 'command', commandId: 'messages' }),
      });
      if (this.#state && this.#lastCells) this.#hud.update(this.#state, this.#lastCells);
    }
    const rect = mount.getBoundingClientRect();
    this.#hud.setReserve(
      presentation!.topRightReserve ?? 0,
      rect.height > rect.width,
      presentation!.insets.bottom,
    );
    // Menus and dialogs are modal sheets; descriptions shown while exploring are peek cards.
    const context = this.#context;
    const overlayKind: OverlayKind =
      context === 'menu' || context === 'yesno' || context === 'more'
        ? 'sheet'
        : context === 'title'
          ? 'none'
          : 'peek';
    const stored = Number(this.#settings.mapCellCss);
    renderer.setCompact({
      band: this.#hud.height,
      insets: presentation!.insets,
      mapCellCss:
        renderer.compact?.mapCellCss ??
        (Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_MAP_CELL_CSS),
      overlayKind,
      drawer: this.#drawer,
    });
  }

  #setDrawer(open: boolean): void {
    this.#drawer = open;
    this.#applyCompact();
  }

  applySetting(key: string, value: string | number): void {
    this.#settings = { ...this.#settings, [key]: value };
  }

  cycleView(): string {
    this.#zoomIndex = (this.#zoomIndex + 1) % ZOOM_STEPS.length;
    const step = ZOOM_STEPS[this.#zoomIndex]!;
    this.#renderer?.setZoom(step.zoom);
    this.#host?.emit({ type: 'setting-changed', key: 'zoomIndex', value: this.#zoomIndex });
    return step.label;
  }

  get viewLabel(): string {
    return ZOOM_STEPS[this.#zoomIndex]!.label;
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
    this.#hud?.destroy();
    this.#hud = null;
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
      case 'frame':
        this.#inGame = message.inGame;
        this.debug.cells = message.cells;
        this.debug.inGame = message.inGame;
        this.debug.playerX = message.playerX;
        this.debug.playerY = message.playerY;
        this.debug.graphicsMode = message.mode;
        this.#renderer?.setFrame(message.cells, message.playerX, message.playerY, message.inGame);
        this.#state = parseState(message.state);
        this.#lastCells = message.cells;
        this.debug.context = this.#updateContext(message.inGame, this.#state, message.cells);
        this.#applyCompact();
        if (this.#hud && message.inGame) this.#hud.update(this.#state, message.cells);
        break;
      case 'status':
        host?.emit({ type: 'status', status: message.status });
        break;
      case 'error':
        if (this.#started) host?.emit({ type: 'error', error: message.error });
        break;
      case 'graphics-mode':
        host?.emit({ type: 'setting-changed', key: 'graphicsMode', value: message.mode });
        break;
      case 'exit':
        this.#exited = true;
        host?.emit({ type: 'exit', reason: 'user' });
        break;
      case 'flushed':
      case 'exported':
      case 'imported': {
        const resolve = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        resolve?.(message);
        break;
      }
      case 'log':
        if (message.level === 'info') host?.logger.debug(message.text);
        else host?.logger.warn(message.text);
        break;
      case 'notify':
      case 'ready':
        break;
    }
  }

  /**
   * Works out what Brogue is waiting for and publishes matching touch controls.
   * "Busy" (engine animating or auto-exploring) only shows after a short delay
   * so brief animations don't make the controls flicker.
   */
  #updateContext(inGame: boolean, state: BrogueState, cells: Uint8Array): BrogueContext {
    const context = detectContext(inGame, state, cells);
    clearTimeout(this.#busyTimer);
    if (context === 'busy') {
      this.#busyTimer = setTimeout(() => this.#publishContext('busy', state), BUSY_DELAY_MS);
      return this.#context ?? context;
    }
    this.#publishContext(context, state);
    return context;
  }

  #publishContext(context: BrogueContext, state: BrogueState): void {
    const layout = controlsFor(context, state, BROGUE_TOUCH_LAYOUT.palette);
    const signature = `${context}:${JSON.stringify(layout.actions)}`;
    const contextChanged = context !== this.#context;
    this.#context = context;
    this.debug.context = context;
    if (signature !== this.#layoutSignature) {
      this.#layoutSignature = signature;
      this.#host?.emit({ type: 'touch-layout', layout, context });
    }
    if (contextChanged) {
      this.#host?.emit({ type: 'input-context', context: { textEntry: context === 'menu', mode: context } });
    }
  }

  #sendPointer(type: number, cell: { x: number; y: number }): void {
    this.#post({
      type: 'event',
      event: [type, cell.x, cell.y, this.#modifiers.ctrl ? 1 : 0, this.#modifiers.shift ? 1 : 0],
    });
  }

  #hover(cell: { x: number; y: number }): void {
    if (this.#lastHover && this.#lastHover.x === cell.x && this.#lastHover.y === cell.y) return;
    this.#lastHover = cell;
    this.#sendPointer(EventType.MOUSE_ENTERED_CELL, cell);
  }

  #click(cell: { x: number; y: number }): void {
    this.#hover(cell);
    this.#sendPointer(EventType.MOUSE_DOWN, cell);
    this.#sendPointer(EventType.MOUSE_UP, cell);
  }

  #attachPointer(canvas: HTMLCanvasElement): void {
    const renderer = () => this.#renderer;
    const touches = new Map<number, { x: number; y: number }>();
    let tap: { x: number; y: number; id: number; hit: HitResult } | null = null;
    let longPressTimer: ReturnType<typeof setTimeout> | undefined;
    let longPressed = false;
    let panning = false;
    let pinch: { distance: number; cellCss: number } | null = null;

    const distance = () => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        const cell = renderer()?.cellAt(event.clientX, event.clientY);
        if (cell) this.#hover(cell);
        return;
      }
      const previous = touches.get(event.pointerId);
      if (!previous) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const compact = renderer()?.compact;
      if (pinch && compact) {
        // Two fingers: pinch to change the map's size.
        const now = distance();
        if (now > 0) renderer()!.setMapCellCss(pinch.cellCss * (now / pinch.distance));
        return;
      }
      if (
        tap &&
        tap.id === event.pointerId &&
        Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP_PX
      ) {
        clearTimeout(longPressTimer);
        // One finger dragged on the map: look around (phones). Elsewhere it just cancels the tap.
        panning = !!compact && tap.hit?.kind === 'cell' && tap.hit.view === 'map';
        tap = null;
      }
      if (panning) renderer()!.panBy(event.clientX - previous.x, event.clientY - previous.y);
    };

    const onPointerDown = (event: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      const hit = renderer()?.hitTest(event.clientX, event.clientY) ?? null;
      if (event.pointerType === 'touch') {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // Not capturable; the gesture still works within the canvas.
        }
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 2) {
          // A second finger turns the gesture into a pinch; no tap will fire.
          clearTimeout(longPressTimer);
          tap = null;
          panning = false;
          const cellCss = renderer()?.compact?.mapCellCss;
          if (cellCss) pinch = { distance: distance(), cellCss };
          return;
        }
        if (touches.size > 2) return;
        tap = { x: event.clientX, y: event.clientY, id: event.pointerId, hit };
        longPressed = false;
        panning = false;
        clearTimeout(longPressTimer);
        if (hit?.kind === 'cell') {
          // Long press inspects a cell (hover) without acting on it.
          longPressTimer = setTimeout(() => {
            longPressed = true;
            this.#lastHover = null;
            this.#hover(hit);
          }, LONG_PRESS_MS);
        }
        return;
      }
      if (hit?.kind !== 'cell') return;
      if (event.button === 0) {
        this.#hover(hit);
        this.#sendPointer(EventType.MOUSE_DOWN, hit);
      } else if (event.button === 2) {
        this.#sendPointer(EventType.RIGHT_MOUSE_DOWN, hit);
      }
    };

    const endTouch = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      if (touches.size < 2 && pinch) {
        pinch = null;
        this.#host?.emit({
          type: 'setting-changed',
          key: 'mapCellCss',
          value: renderer()?.compact?.mapCellCss,
        });
      }
      if (touches.size === 0) panning = false;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        clearTimeout(longPressTimer);
        const start = tap;
        tap = null;
        endTouch(event);
        if (!start || start.id !== event.pointerId || longPressed) return;
        const hit = renderer()?.hitTest(event.clientX, event.clientY) ?? null;
        if (hit?.kind === 'dismiss') {
          // Tapping outside a sheet or the sidebar drawer closes it.
          if (hit.view === 'drawer') this.#setDrawer(false);
          else this.sendInput({ type: 'command', commandId: 'cancel' });
          return;
        }
        if (hit?.kind !== 'cell') return;
        if (hit.view === 'drawer') this.#setDrawer(false);
        const tapMode: TapMode = this.#settings.tapMode === 'immediate' ? 'immediate' : 'preview';
        const alreadyPreviewed = this.#lastHover?.x === hit.x && this.#lastHover?.y === hit.y;
        const onMap = renderer()?.compact ? hit.view === 'map' : isInMap(hit);
        if (tapMode === 'preview' && this.#inGame && onMap && !alreadyPreviewed) {
          // First tap shows the path and description; a second tap on the same cell acts.
          this.#hover(hit);
        } else {
          this.#click(hit);
        }
        return;
      }
      const cell = renderer()?.cellAt(event.clientX, event.clientY);
      if (!cell) return;
      if (event.button === 0) this.#sendPointer(EventType.MOUSE_UP, cell);
      else if (event.button === 2) this.#sendPointer(EventType.RIGHT_MOUSE_UP, cell);
    };

    const onContextMenu = (event: Event) => event.preventDefault();
    const onPointerCancel = (event: PointerEvent) => {
      clearTimeout(longPressTimer);
      tap = null;
      endTouch(event);
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('contextmenu', onContextMenu);
    this.#cleanup.push(() => {
      clearTimeout(longPressTimer);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    });
  }

  #setModifiers(shift: boolean, ctrl: boolean): void {
    if (shift === this.#modifiers.shift && ctrl === this.#modifiers.ctrl) return;
    this.#modifiers = { shift, ctrl };
    this.#post({ type: 'modifiers', shift, ctrl });
  }

  /** Brogue asks whether Shift/Ctrl are held (e.g. for shift-click); track them precisely. */
  #attachModifierTracking(): void {
    const update = (event: KeyboardEvent) => this.#setModifiers(event.shiftKey, event.ctrlKey);
    const reset = () => this.#setModifiers(false, false);
    window.addEventListener('keydown', update, true);
    window.addEventListener('keyup', update, true);
    window.addEventListener('blur', reset);
    this.#cleanup.push(() => {
      window.removeEventListener('keydown', update, true);
      window.removeEventListener('keyup', update, true);
      window.removeEventListener('blur', reset);
    });
  }
}

export function createAdapter(): GameAdapter & {
  readonly debug: BrogueDebugState;
  readonly viewLabel: string;
} {
  return new BrogueAdapter();
}

const module: GameModule = { createAdapter };
export default module;

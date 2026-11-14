// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Rogue Archive adapter for HyperRogue.
 *
 * Unlike the terminal games, HyperRogue runs on the page itself: upstream's
 * web build draws with WebGL into a canvas through Emscripten's SDL 1 and is
 * driven by the browser's animation frames (no blocking loop, so no worker or
 * Asyncify). The adapter downloads and verifies the runtime, gives the game
 * a canvas sized to the area the shell leaves free, feeds it keys and taps,
 * and reads a small state snapshot and the game's message log.
 *
 * Saves: HyperRogue keeps its score file (the record of every game, which is
 * also how a game saved with an Orb of Safety or in casual mode is resumed)
 * and its config in /hyperrogue, an IndexedDB mount. When the page is hidden
 * or left, the adapter makes the emergency save upstream's Android app makes
 * when it goes to the background: the game's score is recorded, as when
 * quitting the desktop game.
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
  HYPER_COMMANDS,
  HYPER_TOUCH_LAYOUT,
  controlsFor,
  findCommand,
  strokeFor,
  strokeForInput,
  type DockState,
  type HyperContext,
  type KeyStroke,
} from './input.ts';
import { STATE_FIELDS, TOUCH_MODE, detectContext, hintFor, parseState, type HyperState } from './state.ts';

const GAME_ID = 'hyperrogue';
const HOME = '/hyperrogue';
/** upstream's hyperweb.cpp (get_canvas_size) reads the game's size from this element. */
const SIZER_ID = 'this_wide';
const POLL_MS = 200;
const LOG_LINES = 200;
const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 12;
/** Rendering resolution cap: legacy GL emulation at 3x on a phone is slow. */
const MAX_PIXEL_RATIO = 2;
/** CSS px the shell's floating tools take at the top of an upright phone (as the other adapters' bands reserve). */
const TOOLS_ROW_HEIGHT = 50;
/** `m`: marks (or unmarks) a mine on the cell under the pointer. */
const MARK_KEY = strokeFor('m')!;
/** The adapter's own touch commands (the tap modes). */
const TAP_MODES = new Set(['aim-mode', 'inspect-mode', 'mark-mode']);

interface HyperModule {
  FS: {
    mkdir(path: string): void;
    chdir(path: string): void;
    mount(type: unknown, opts: object, mountpoint: string): void;
    syncfs(populate: boolean, callback: (err: unknown) => void): void;
    readdir(path: string): string[];
    stat(path: string): { mode: number; mtime: Date | number };
    isFile(mode: number): boolean;
    readFile(path: string): Uint8Array;
    writeFile(path: string, data: Uint8Array): void;
  };
  IDBFS: unknown;
  HEAP32: Int32Array;
  UTF8ToString(ptr: number): string;
  addRunDependency(id: string): void;
  removeRunDependency(id: string): void;
  _ra_save(): void;
  _ra_state(ptr: number, capacity: number): number;
  _ra_land_name(): number;
  _ra_resize(): void;
  _ra_log_size(): number;
  _ra_log_text(i: number): number;
  _ra_log_quantity(i: number): number;
  _ra_log_turn(i: number): number;
  _ra_hover_text(): number;
  _ra_set_touch_mode(mode: number): number;
  _ra_item_name(item: number): number;
  _emscripten_cancel_main_loop(): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
}

type ModuleFactory = (options: Record<string, unknown>) => Promise<HyperModule>;

export interface HyperDebugState {
  context: HyperContext | null;
  state: HyperState | null;
  land: string;
  /** Taps mark mines (the dock's Mark). */
  markMode: boolean;
  /** The hint shown over the game (tap mode, the orb a tap would use, Orb of Safety). */
  hint: string[];
  /** What the game says about the cell under the pointer. */
  hover(): string;
  /** The game's recent messages, oldest first. */
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

/**
 * Records the listeners the game adds to window and document while it starts
 * (SDL's focus/blur/visibility/unload, upstream's resize and fullscreen
 * callbacks), so leaving the game can remove them and let it be collected.
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

class HyperRogueAdapter implements GameAdapter {
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
  readonly commands = HYPER_COMMANDS;
  readonly touchLayout = HYPER_TOUCH_LAYOUT;
  readonly nativeSaveExtensions = ['.log', '.ini'];
  readonly resumeHint =
    "As in HyperRogue itself, leaving ends the game in progress and records its score. To continue a game later, leave while an Orb of Safety is powered, or play in casual mode (from the game's special modes menu).";
  readonly debug: HyperDebugState;

  #host: GameHost | null = null;
  #module: HyperModule | null = null;
  #root: HTMLDivElement | null = null;
  #sizer: HTMLDivElement | null = null;
  #canvas: HTMLCanvasElement | null = null;
  /** SDL listens for keys here (not on the page): the shell decides what reaches the game. */
  readonly #keyTarget = document.createElement('div');
  readonly #listeners = new ListenerTracker();
  #presentation: Presentation = { compact: false, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  #resizeObserver: ResizeObserver | null = null;
  #resizeFrame = 0;
  #poll: ReturnType<typeof setInterval> | undefined;
  #statePtr = 0;
  #context: HyperContext | null = null;
  #layoutSignature = '';
  #logSignature = '';
  #touch: { id: number; x: number; y: number; moved: boolean; long: boolean; timer: number } | null = null;
  #stopped = false;
  #hint: HTMLDivElement | null = null;
  #hintSignature = '';
  /** Taps mark mines (`m` on the tapped cell) instead of moving. */
  #markMode = false;
  /** The turn Aim was switched on: Aim lasts until a turn passes (an orb used). */
  #aimTurn: number | null = null;

  constructor() {
    this.debug = {
      context: null,
      state: null,
      land: '',
      markMode: false,
      hint: [],
      hover: () =>
        this.#module && !this.#stopped ? this.#module.UTF8ToString(this.#module._ra_hover_text()) : '',
      messages: () => this.#readLog().map((entry) => entry.runs.map((run) => run.text).join('')),
      files: () => this.#listFiles().map((file) => file.path),
    };
  }

  async initialize(host: GameHost, options: InitializeOptions): Promise<void> {
    this.#host = host;
    const { runtime, runtimeBaseUrl, signal } = options;
    signal.addEventListener('abort', () => void this.shutdown(), { once: true });

    const glueFile = findFile(runtime.files, 'hyperrogue.mjs');
    const wasmFile = findFile(runtime.files, 'hyperrogue.wasm');
    const total = glueFile.size + wasmFile.size;
    let glueLoaded = 0;
    let wasmLoaded = 0;
    const progress = () =>
      host.emit({
        type: 'status',
        status: {
          stage: 'downloading',
          detail: 'Downloading HyperRogue',
          progress: { loaded: glueLoaded + wasmLoaded, total },
        },
      });
    const [glue, wasm] = await Promise.all([
      fetchVerified(new URL(glueFile.path, runtimeBaseUrl).href, glueFile, signal, (n) => {
        glueLoaded = n;
        progress();
      }),
      fetchVerified(new URL(wasmFile.path, runtimeBaseUrl).href, wasmFile, signal, (n) => {
        wasmLoaded = n;
        progress();
      }),
    ]);
    if (signal.aborted) return;
    host.emit({ type: 'status', status: { stage: 'initializing', detail: 'Starting HyperRogue' } });

    const glueUrl = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
    let factory: ModuleFactory;
    try {
      factory = ((await import(/* @vite-ignore */ glueUrl)) as { default: ModuleFactory }).default;
    } finally {
      URL.revokeObjectURL(glueUrl);
    }

    this.#buildDom(options.mount);
    this.#layout();

    let started!: () => void;
    let failed!: (error: unknown) => void;
    const running = new Promise<void>((resolve, reject) => {
      started = resolve;
      failed = reject;
    });
    this.#listeners.start();
    try {
      this.#module = await factory({
        canvas: this.#canvas,
        keyboardListeningElement: this.#keyTarget,
        wasmBinary: wasm,
        locateFile: (path: string) => path,
        print: (text: string) => host.logger.debug(text),
        printErr: (text: string) => host.logger.debug(text),
        onAbort: (what: unknown) => {
          const error = Object.assign(new Error(`HyperRogue stopped unexpectedly: ${String(what)}`), {
            kind: /memory/i.test(String(what)) ? 'out-of-memory' : 'crash',
          });
          failed(error);
          this.#fatal(error);
        },
        preRun: [
          (mod: HyperModule) => {
            mod.FS.mkdir(HOME);
            mod.FS.mount(mod.IDBFS, { autoPersist: true }, HOME);
            // Upstream's default file names are relative: they land here.
            mod.FS.chdir(HOME);
            mod.addRunDependency('ra-saves');
            mod.FS.syncfs(true, (err) => {
              if (err) host.logger.warn('Could not read saved files', err);
              mod.removeRunDependency('ra-saves');
            });
          },
        ],
        postRun: [() => started()],
      });
      await running;
    } finally {
      this.#listeners.stop();
    }
    if (signal.aborted) return;
    this.#statePtr = this.#module._malloc(STATE_FIELDS * 4);
    this.#scheduleResize();
    this.#poll = setInterval(() => this.#update(), POLL_MS);
    this.#update();
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  async start(): Promise<void> {
    this.#host?.emit({ type: 'status', status: { stage: 'running' } });
    this.#canvas?.focus({ preventScroll: true });
  }

  #buildDom(mount: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'hr-root';
    root.style.cssText =
      'position:absolute;inset:0;overflow:hidden;background:#000;touch-action:none;user-select:none;-webkit-user-select:none';
    const sizer = document.createElement('div');
    sizer.id = SIZER_ID;
    sizer.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
    // Emscripten's SDL sets the canvas's CSS size to its pixel size when the
    // game changes resolution; the page's size wins (the game renders at up
    // to twice the CSS resolution on high-density screens).
    const style = document.createElement('style');
    style.textContent =
      '.hr-root>canvas.hr-canvas{position:absolute;display:block;outline:none;left:0;' +
      'top:var(--hr-top,0px)!important;width:var(--hr-width,100%)!important;height:var(--hr-height,100%)!important}' +
      '.hr-hint{position:absolute;left:50%;bottom:calc(var(--hr-bottom,0px) + 56px);transform:translateX(-50%);' +
      'display:flex;flex-direction:column;align-items:center;gap:4px;max-width:calc(100% - 24px);pointer-events:none;' +
      "font:600 13px/1.25 'Inter Variable',system-ui,sans-serif;color:#ece3cf;text-align:center}" +
      '.hr-hint[hidden]{display:none}' +
      '.hr-hint>span{padding:4px 10px;border-radius:999px;background:rgba(22,19,15,.82);' +
      'border:1px solid rgba(236,227,207,.16)}';
    // What a tap does now (Aim, Inspect, Mark, fire mode), the orb a tap
    // would use, and the Orb of Safety: the game's own HUD is small on phones.
    const hint = document.createElement('div');
    hint.className = 'hr-hint';
    hint.setAttribute('role', 'status');
    hint.hidden = true;
    const canvas = document.createElement('canvas');
    canvas.className = 'hr-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'HyperRogue game screen');
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    // Upstream's mobile version: tap to move, slide to choose, long-press for help.
    root.addEventListener('touchstart', (event) => this.#onTouch(event), { capture: true, passive: false });
    root.addEventListener('touchmove', (event) => this.#onTouch(event), { capture: true, passive: false });
    root.addEventListener('touchend', (event) => this.#onTouch(event), { capture: true, passive: false });
    root.addEventListener('touchcancel', (event) => this.#onTouch(event), { capture: true, passive: false });
    root.append(style, sizer, canvas, hint);
    mount.append(root);
    this.#root = root;
    this.#hint = hint;
    this.#sizer = sizer;
    this.#canvas = canvas;
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleResize());
    this.#resizeObserver.observe(root);
  }

  /** Places the canvas in the area the shell leaves free and sizes the game to it. */
  #layout(): void {
    const root = this.#root;
    const canvas = this.#canvas;
    const sizer = this.#sizer;
    if (!root || !canvas || !sizer) return;
    const { insets, compact } = this.#presentation;
    // On upright phones the shell's dock and tools cover the bottom and the
    // top-right corner, where the game draws its score: the canvas starts
    // below the tools (the disc is as wide as the screen anyway). Held
    // sideways, the controls are in rails beside the game.
    const toolsAbove =
      compact && (this.#presentation.topRightReserve ?? 0) > 0 && root.clientHeight > root.clientWidth;
    const top = compact ? Math.max(insets.top, toolsAbove ? TOOLS_ROW_HEIGHT : 0) : 0;
    const bottom = compact ? insets.bottom : 0;
    const width = root.clientWidth;
    const height = Math.max(1, root.clientHeight - top - bottom);
    root.style.setProperty('--hr-top', `${top}px`);
    root.style.setProperty('--hr-bottom', `${bottom}px`);
    root.style.setProperty('--hr-width', `${width}px`);
    root.style.setProperty('--hr-height', `${height}px`);
    const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    sizer.style.width = `${Math.round(width * ratio)}px`;
    sizer.style.height = `${Math.round(height * ratio)}px`;
  }

  #scheduleResize(): void {
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = requestAnimationFrame(() => {
      this.#layout();
      if (this.#module && !this.#stopped) this.#module._ra_resize();
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
    if (TAP_MODES.has(input.commandId)) {
      this.#switchTapMode(input.commandId);
      return;
    }
    // Turning the crossbow's fire mode on: taps aim the crossbow (upstream
    // checks the touch modes first, so they go back to moving).
    if (input.commandId === 'fire-mode' && this.debug.state?.crossbow && !this.debug.state.fireMode)
      this.#setTapMode(TOUCH_MODE.move, false);
    const command = findCommand(input.commandId);
    if (command) for (const stroke of command.keys) this.#press(stroke);
  }

  /** The dock's Aim, Inspect and Mark: each switches itself on or off (and the others off). */
  #switchTapMode(id: string): void {
    const mode = this.debug.state?.touchMode ?? TOUCH_MODE.move;
    if (id === 'mark-mode') this.#setTapMode(TOUCH_MODE.move, !this.#markMode);
    else {
      const wanted = id === 'aim-mode' ? TOUCH_MODE.ranged : TOUCH_MODE.info;
      this.#setTapMode(mode === wanted ? TOUCH_MODE.move : wanted, false);
    }
    this.#update();
  }

  /** Sets upstream's touch mode (what a click on the map does) and the adapter's Mark mode. */
  #setTapMode(mode: number, markMode: boolean): void {
    const mod = this.#module;
    if (!mod || this.#stopped) return;
    const now = mod._ra_set_touch_mode(mode);
    this.#aimTurn = now === TOUCH_MODE.ranged ? (this.debug.state?.turns ?? 0) : null;
    this.#markMode = markMode;
    this.debug.markMode = markMode;
  }

  /** One key press as a browser would send it: keydown, keypress (characters), keyup. */
  #press(stroke: KeyStroke): void {
    const fire = (type: string, keyCode: number, key: string, code: string, charCode = 0) => {
      const event = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        shiftKey: stroke.shift,
      });
      // keyCode and charCode are read-only on KeyboardEvent, but SDL reads them.
      Object.defineProperty(event, 'keyCode', { value: keyCode });
      Object.defineProperty(event, 'which', { value: keyCode || charCode });
      Object.defineProperty(event, 'charCode', { value: charCode });
      this.#keyTarget.dispatchEvent(event);
    };
    if (stroke.shift) fire('keydown', 16, 'Shift', 'ShiftLeft');
    fire('keydown', stroke.keyCode, stroke.key, stroke.code);
    if (stroke.charCode) fire('keypress', 0, stroke.key, stroke.code, stroke.charCode);
    fire('keyup', stroke.keyCode, stroke.key, stroke.code);
    if (stroke.shift) fire('keyup', 16, 'Shift', 'ShiftLeft');
  }

  /** A mouse event on the game's canvas, as SDL expects from the page. */
  #mouse(type: 'mousedown' | 'mouseup' | 'mousemove', x: number, y: number, button = 0): void {
    this.#canvas?.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        button,
        buttons: type === 'mousedown' ? (button === 2 ? 2 : 1) : 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /**
   * Touch, as upstream's mobile version: the finger shows what is under it
   * (the game's hover), lifting it acts there (move towards the cell, use a
   * ranged orb on it, choose a menu line); holding still asks for help about
   * it (the desktop's right-click). A slide that ends where it started is a tap.
   */
  #onTouch(event: TouchEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.#stopped) return;
    const touch = this.#touch;
    if (event.type === 'touchstart') {
      if (touch || event.changedTouches.length === 0) return;
      const t = event.changedTouches[0]!;
      const timer = window.setTimeout(() => {
        const current = this.#touch;
        if (!current || current.moved) return;
        current.long = true;
        this.#mouse('mousedown', current.x, current.y, 2);
        this.#mouse('mouseup', current.x, current.y, 2);
      }, LONG_PRESS_MS);
      this.#touch = { id: t.identifier, x: t.clientX, y: t.clientY, moved: false, long: false, timer };
      this.#mouse('mousemove', t.clientX, t.clientY);
      return;
    }
    if (!touch) return;
    const t = Array.from(event.changedTouches).find((candidate) => candidate.identifier === touch.id);
    if (!t) return;
    if (event.type === 'touchmove') {
      if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > TAP_SLOP_PX) touch.moved = true;
      touch.x = t.clientX;
      touch.y = t.clientY;
      this.#mouse('mousemove', t.clientX, t.clientY);
      return;
    }
    clearTimeout(touch.timer);
    this.#touch = null;
    this.#updateHint();
    if (event.type === 'touchcancel' || touch.long) return;
    this.#mouse('mousemove', t.clientX, t.clientY);
    if (this.#markMode && this.#context === 'map') {
      // `m` acts on the cell under the pointer, which the game works out when
      // it next draws: press it once a frame has passed.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!this.#stopped && this.#markMode) this.#press(MARK_KEY);
        }),
      );
      return;
    }
    this.#mouse('mousedown', t.clientX, t.clientY);
    this.#mouse('mouseup', t.clientX, t.clientY);
  }

  // -- State, controls and messages ------------------------------------------

  #update(): void {
    const mod = this.#module;
    if (!mod || this.#stopped) return;
    mod._ra_state(this.#statePtr, STATE_FIELDS);
    const state = parseState(mod.HEAP32.subarray(this.#statePtr >> 2, (this.#statePtr >> 2) + STATE_FIELDS));
    this.debug.state = state;
    this.debug.land = mod.UTF8ToString(mod._ra_land_name());
    const context = detectContext(state);
    this.#settleTapModes(state, context);
    if (context !== this.#context) {
      this.#context = context;
      this.debug.context = context;
      this.#host?.emit({ type: 'input-context', context: { textEntry: false, mode: context } });
    }
    const dock: DockState = { ...state, markMode: this.#markMode };
    const layout = controlsFor(context, dock);
    const signature = `${context}|${JSON.stringify(layout.actions)}`;
    if (signature !== this.#layoutSignature) {
      this.#layoutSignature = signature;
      this.#host?.emit({ type: 'touch-layout', layout, context });
    }
    this.#updateHint();
    this.#updateLog();
  }

  /**
   * Tap modes end when they no longer apply: Aim once a turn has passed (the
   * orb was used) or no ranged orb is left; Mark outside the Minefield; all
   * of them when the game is over.
   */
  #settleTapModes(state: HyperState, context: HyperContext): void {
    const over = context === 'over';
    if (state.touchMode === TOUCH_MODE.ranged) {
      if (this.#aimTurn === null) this.#aimTurn = state.turns;
      if (over || !state.ranged || state.turns !== this.#aimTurn) {
        state.touchMode = this.#module!._ra_set_touch_mode(TOUCH_MODE.move);
        this.#aimTurn = null;
      }
    } else if (state.touchMode === TOUCH_MODE.info && over) {
      state.touchMode = this.#module!._ra_set_touch_mode(TOUCH_MODE.move);
    }
    if (this.#markMode && (over || !state.minefield)) {
      this.#markMode = false;
      this.debug.markMode = false;
    }
  }

  #updateHint(): void {
    const mod = this.#module;
    const state = this.debug.state;
    if (!mod || this.#stopped || !this.#hint) return;
    const targetOrbName = state?.targetOrb ? mod.UTF8ToString(mod._ra_item_name(state.targetOrb)) : '';
    const lines = hintFor(state, { markMode: this.#markMode, touching: this.#touch !== null, targetOrbName });
    this.debug.hint = lines;
    const signature = lines.join('\n');
    if (signature === this.#hintSignature) return;
    this.#hintSignature = signature;
    this.#hint.replaceChildren(
      ...lines.map((line) => {
        const span = document.createElement('span');
        span.textContent = line;
        return span;
      }),
    );
    this.#hint.hidden = lines.length === 0;
  }

  #readLog(): LogEntry[] {
    const mod = this.#module;
    if (!mod || this.#stopped) return [];
    const size = mod._ra_log_size();
    const entries: LogEntry[] = [];
    for (let i = Math.max(0, size - LOG_LINES); i < size; i++) {
      const text = mod.UTF8ToString(mod._ra_log_text(i));
      if (!text) continue;
      const quantity = mod._ra_log_quantity(i);
      entries.push({
        id: i,
        group: `Turn ${mod._ra_log_turn(i)}`,
        runs: [{ text: quantity > 1 ? `${text} (x${quantity})` : text }],
      });
    }
    return entries;
  }

  /** The log is capped and rotates in the game, so it is re-sent whenever its end changes. */
  #updateLog(): void {
    const mod = this.#module;
    if (!mod) return;
    const size = mod._ra_log_size();
    const last =
      size > 0
        ? `${mod.UTF8ToString(mod._ra_log_text(size - 1))}|${mod._ra_log_quantity(size - 1)}|${mod._ra_log_turn(size - 1)}`
        : '';
    const signature = `${size}|${last}`;
    if (signature === this.#logSignature) return;
    this.#logSignature = signature;
    this.#host?.emit({ type: 'message-log', reset: true, entries: this.#readLog() });
  }

  // -- Saves -------------------------------------------------------------------

  #sync(): Promise<void> {
    const mod = this.#module;
    if (!mod) return Promise.resolve();
    return new Promise((resolve, reject) =>
      mod.FS.syncfs(false, (err) =>
        err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
      ),
    );
  }

  exitPrompt(): GameExitPrompt | null {
    const state = this.debug.state;
    // Nothing to keep before the game runs, or once it is over (the score is recorded).
    if (!this.#module || this.#stopped || !state || !state.canMove) return null;
    if (state.safety > 0)
      return {
        message: `An Orb of Safety is powered (${state.safety}): leaving now keeps this game, to continue next time.`,
        options: [{ id: 'leave', label: 'Leave and keep this game', primary: true }],
      };
    return {
      message:
        'As in HyperRogue, leaving ends this game and records its score. To keep a game for later, leave while an Orb of Safety is powered, or play in casual mode (special modes menu).',
      options: [{ id: 'leave', label: 'End this game and leave', destructive: true }],
    };
  }

  /** Leaving: HyperRogue's own save on leaving (persist) does it all. */
  async exitWith(): Promise<void> {}

  async persist(): Promise<void> {
    const mod = this.#module;
    if (!mod || this.#stopped) return;
    mod._ra_save();
    await this.#sync();
  }

  setVisible(visible: boolean): void {
    if (!visible)
      void this.persist().catch((error: unknown) => this.#host?.logger.warn('persist failed', error));
  }

  #listFiles(): SaveFile[] {
    const mod = this.#module;
    if (!mod) return [];
    const files: SaveFile[] = [];
    for (const name of mod.FS.readdir(HOME)) {
      if (name === '.' || name === '..') continue;
      const path = `${HOME}/${name}`;
      const stat = mod.FS.stat(path);
      if (!mod.FS.isFile(stat.mode)) continue;
      const modifiedAt = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime);
      files.push({ path: name, bytes: mod.FS.readFile(path), modifiedAt });
    }
    return files;
  }

  async exportSaves(): Promise<SaveFile[]> {
    await this.persist();
    return this.#listFiles();
  }

  async importSaves(files: SaveFile[]): Promise<void> {
    const mod = this.#module;
    if (!mod) throw new Error('HyperRogue is not running.');
    for (const file of files) {
      if (!/^[\w.() -]+$/.test(file.path)) throw new Error(`Unsupported file name: ${file.path}`);
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
            : 'Return to the library and launch the game again. Your game was saved when you last left it.',
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
    this.#stopped = true;
    clearInterval(this.#poll);
    cancelAnimationFrame(this.#resizeFrame);
    if (this.#touch) clearTimeout(this.#touch.timer);
    this.#resizeObserver?.disconnect();
    try {
      this.#module?._emscripten_cancel_main_loop();
    } catch {
      // The main loop may not have started.
    }
    this.#listeners.removeAll();
    const gl = this.#canvas?.getContext('webgl2') ?? this.#canvas?.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.#root?.remove();
    this.#root = this.#sizer = this.#canvas = this.#hint = null;
    this.#module = null;
  }
}

export function createAdapter(): GameAdapter & { readonly debug: HyperDebugState } {
  return new HyperRogueAdapter();
}

const module: GameModule = { createAdapter };
export default module;

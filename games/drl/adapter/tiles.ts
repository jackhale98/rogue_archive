// SPDX-License-Identifier: GPL-2.0-only
/**
 * The page's side of DRL's graphical (tiles) mode: the canvas Emscripten's
 * SDL 3 draws into, the element it reads keys from, and the input the
 * adapter gives the game, as the browser events SDL reads.
 *
 * - The canvas has its own WebGL 2 context, opaque (as a desktop window;
 *   SDL would ask for an alpha channel, which the page would show through).
 *   DRL sizes its window once, when it starts (adapter/tiles-state.ts
 *   windowFor); the canvas is then shown at the size of the area the shell
 *   leaves, with sharp pixels, and fitted inside it if the area changes.
 *   Each run of the program gets a fresh canvas and context.
 * - Keys: SDL listens on a private element (SDL_EMSCRIPTEN_KEYBOARD_ELEMENT),
 *   not the page, so the shell decides what reaches the game. A key is held
 *   for two of DRL's frames: DRL reads keys as pressed and released states
 *   once a frame (vioeventstate.pas), and a press and release between two of
 *   its frames is lost.
 * - Touch: a tap is a left click and a long press a right click, as DRL's
 *   mouse (drlbase.pas HandleMouseEvent: left walks to or travels to a
 *   cell, uses or picks up what the player stands on; right fires at it;
 *   menus take clicks), sent as mouse events; SDL's own touch handling is
 *   kept out (it would make every touch a left click).
 */
import { KEY } from './input.ts';
import { consoleCell, windowFor } from './tiles-state.ts';
import type { TilesPage } from './host.ts';

/** A DOM key for a key code the adapter sends (a character, or a curses KEY_ code, adapter/input.ts). */
export interface DomKey {
  key: string;
  code: string;
  shift?: boolean;
  ctrl?: boolean;
}

const NAMED: Record<number, DomKey> = {
  13: { key: 'Enter', code: 'Enter' },
  27: { key: 'Escape', code: 'Escape' },
  9: { key: 'Tab', code: 'Tab' },
  32: { key: ' ', code: 'Space' },
  [KEY.UP]: { key: 'ArrowUp', code: 'ArrowUp' },
  [KEY.DOWN]: { key: 'ArrowDown', code: 'ArrowDown' },
  [KEY.LEFT]: { key: 'ArrowLeft', code: 'ArrowLeft' },
  [KEY.RIGHT]: { key: 'ArrowRight', code: 'ArrowRight' },
  [KEY.HOME]: { key: 'Home', code: 'Home' },
  [KEY.END]: { key: 'End', code: 'End' },
  [KEY.PPAGE]: { key: 'PageUp', code: 'PageUp' },
  [KEY.NPAGE]: { key: 'PageDown', code: 'PageDown' },
  // The numpad's 5 without NumLock: DRL's "center" (wait in place).
  [KEY.B2]: { key: 'Clear', code: 'Numpad5' },
  [KEY.IC]: { key: 'Insert', code: 'Insert' },
  [KEY.DC]: { key: 'Delete', code: 'Delete' },
  [KEY.BACKSPACE]: { key: 'Backspace', code: 'Backspace' },
  [KEY.BTAB]: { key: 'Tab', code: 'Tab', shift: true },
};

/** The physical key (KeyboardEvent.code) of each printable character on a US layout, and whether it needs Shift. */
const SYMBOLS: Record<string, [string, boolean]> = {
  '`': ['Backquote', false],
  '~': ['Backquote', true],
  '-': ['Minus', false],
  _: ['Minus', true],
  '=': ['Equal', false],
  '+': ['Equal', true],
  '[': ['BracketLeft', false],
  '{': ['BracketLeft', true],
  ']': ['BracketRight', false],
  '}': ['BracketRight', true],
  '\\': ['Backslash', false],
  '|': ['Backslash', true],
  ';': ['Semicolon', false],
  ':': ['Semicolon', true],
  "'": ['Quote', false],
  '"': ['Quote', true],
  ',': ['Comma', false],
  '<': ['Comma', true],
  '.': ['Period', false],
  '>': ['Period', true],
  '/': ['Slash', false],
  '?': ['Slash', true],
  '!': ['Digit1', true],
  '@': ['Digit2', true],
  '#': ['Digit3', true],
  $: ['Digit4', true],
  '%': ['Digit5', true],
  '^': ['Digit6', true],
  '&': ['Digit7', true],
  '*': ['Digit8', true],
  '(': ['Digit9', true],
  ')': ['Digit0', true],
};

/** The browser key for a key code, or null. */
export function domKey(code: number): DomKey | null {
  const named = NAMED[code];
  if (named) return named;
  if (code > KEY.F0 && code <= KEY.F0 + 12) return { key: `F${code - KEY.F0}`, code: `F${code - KEY.F0}` };
  if (code >= 1 && code <= 26 && code !== 9 && code !== 13) {
    const letter = String.fromCharCode(96 + code);
    return { key: letter, code: `Key${letter.toUpperCase()}`, ctrl: true };
  }
  if (code < 33 || code > 126) return null;
  const char = String.fromCharCode(code);
  if (/[a-z]/.test(char)) return { key: char, code: `Key${char.toUpperCase()}` };
  if (/[A-Z]/.test(char)) return { key: char, code: `Key${char}`, shift: true };
  if (/[0-9]/.test(char)) return { key: char, code: `Digit${char}` };
  const symbol = SYMBOLS[char];
  return symbol ? { key: char, code: symbol[0], shift: symbol[1] } : null;
}

const KEY_ELEMENT_ID = 'ra-drl-keys';
const CANVAS_ID = 'ra-drl-canvas';
const LONG_PRESS_MS = 500;
const SLOP_PX = 12;

/** Longest wait for one of DRL's frames (it may not draw: a hidden tab, a long load). */
const FRAME_TIMEOUT_MS = 400;

/** Records listeners added to window and document while a module instance starts, to remove them when it ends. */
class ListenerTracker {
  readonly #added: {
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }[] = [];
  readonly #restore: (() => void)[] = [];

  start(): void {
    this.stop();
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

/** The area (CSS px, relative to the root) the canvas is shown in. */
export interface TilesArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class TilesSurface implements TilesPage {
  readonly root: HTMLDivElement;
  readonly keyboardSelector = `#${KEY_ELEMENT_ID}`;
  readonly canvasSelector = `#${CANVAS_ID}`;
  #canvas: HTMLCanvasElement | null = null;
  #gl: WebGL2RenderingContext | null = null;
  readonly #keys: HTMLDivElement;
  readonly #listeners = new ListenerTracker();
  #area: TilesArea = { left: 0, top: 0, width: 1, height: 1 };
  /** DRL's window (canvas pixels) for the current run. */
  #window = { width: 1, height: 1 };
  #queue: DomKey[] = [];
  #sending = false;
  #touch: { id: number; x: number; y: number; moved: boolean; long: boolean; timer: number } | null = null;
  #observer: MutationObserver | null = null;
  /** DRL's frames drawn (its GL console's uploads, one a frame), and who waits for the next. */
  #drawn = 0;
  #frameWaiters: (() => void)[] = [];
  /** Called when the canvas is replaced (a new run). */
  onCanvas: ((canvas: HTMLCanvasElement) => void) | null = null;

  constructor(mount: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'drl-tiles';
    root.style.cssText =
      'position:absolute;inset:0;overflow:hidden;background:#000;touch-action:none;user-select:none;-webkit-user-select:none';
    const keys = document.createElement('div');
    keys.id = KEY_ELEMENT_ID;
    keys.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    root.append(keys);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const)
      root.addEventListener(type, (event) => this.#onTouch(event), { capture: true, passive: false });
    // SDL 3 reads pointer events, a touch's too (as a left click): those stop
    // here; a mouse's go on to SDL (desktops, and the clicks below).
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const)
      root.addEventListener(
        type,
        (event) => {
          if (event.pointerType !== 'mouse') event.stopPropagation();
        },
        { capture: true },
      );
    mount.append(root);
    this.root = root;
    this.#keys = keys;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.#canvas;
  }

  get window(): { width: number; height: number } {
    return { ...this.#window };
  }

  /** A fresh canvas and opaque WebGL 2 context for a run (the previous one released). */
  surface(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } {
    this.#release();
    const canvas = document.createElement('canvas');
    canvas.className = 'drl-canvas';
    canvas.id = CANVAS_ID;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'DRL game screen');
    // No CSS size until SDL has sized it: SDL takes a canvas sized by CSS as
    // sized by the page, and would not set its pixels.
    canvas.style.cssText = 'position:absolute;display:block;outline:none;image-rendering:pixelated';
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: true,
      stencil: false,
      antialias: false,
      powerPreference: 'default',
    });
    if (!gl)
      throw Object.assign(new Error('This browser has no WebGL 2, which the Tiles display needs.'), {
        kind: 'crash',
        action: 'Choose the Text display in the game settings.',
      });
    this.root.append(canvas);
    this.#canvas = canvas;
    this.#gl = gl;
    this.#observer = new MutationObserver(() => this.fit());
    this.#observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    this.onCanvas?.(canvas);
    return { canvas, gl };
  }

  windowSize(): { width: number; height: number } {
    const { width, height } = windowFor(this.#area);
    this.#window = { width, height };
    return this.#window;
  }

  beginInstance(): void {
    this.#listeners.start();
  }

  frameDrawn(): void {
    this.#drawn++;
    for (const resolve of this.#frameWaiters.splice(0)) resolve();
  }

  /**
   * Waits until DRL has drawn `n` more frames (each at most FRAME_TIMEOUT_MS):
   * a key or button held across DRL's frames, however fast it draws (its
   * event loop draws only when 16 ms have passed, and slowly in software).
   */
  async #frames(n: number): Promise<void> {
    const until = this.#drawn + n;
    while (this.#drawn < until) {
      const before = this.#drawn;
      await new Promise<void>((resolve) => {
        this.#frameWaiters.push(resolve);
        setTimeout(resolve, FRAME_TIMEOUT_MS);
      });
      if (this.#drawn === before) return;
    }
  }

  instanceStarted(): void {
    this.#listeners.stop();
  }

  endInstance(): void {
    this.#listeners.removeAll();
  }

  #release(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.#gl = null;
    this.#canvas?.remove();
    this.#canvas = null;
  }

  destroy(): void {
    this.#listeners.removeAll();
    this.#release();
    if (this.#touch) clearTimeout(this.#touch.timer);
    this.root.remove();
  }

  /** The area for the canvas (CSS px); DRL's window is sized from it when it starts. */
  setArea(area: TilesArea): void {
    this.#area = area;
    this.fit();
  }

  /** Shows the canvas in its area: at the area's size, or fitted inside it if the shapes differ. */
  fit(): void {
    const canvas = this.#canvas;
    if (!canvas || canvas.width <= 1 || canvas.height <= 1) return;
    const area = this.#area;
    const scale = Math.min(area.width / canvas.width, area.height / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    canvas.style.left = `${area.left + (area.width - width) / 2}px`;
    canvas.style.top = `${area.top + (area.height - height) / 2}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  /** Where a cell of DRL's 80x25 text is on the page (its centre), or null. */
  cellToClient(x: number, y: number): { x: number; y: number } | null {
    const canvas = this.#canvas;
    if (!canvas || canvas.width <= 1) return null;
    const rect = canvas.getBoundingClientRect();
    const cell = consoleCell({ width: canvas.width, height: canvas.height }, x, y);
    return {
      x: rect.left + ((cell.x + cell.width / 2) * rect.width) / canvas.width,
      y: rect.top + ((cell.y + cell.height / 2) * rect.height) / canvas.height,
    };
  }

  /** Keys for the game (key codes as adapter/input.ts sends them), in order. */
  sendKeys(codes: number[]): void {
    for (const code of codes) {
      const key = domKey(code);
      if (key) this.#queue.push(key);
    }
    void this.#drain();
  }

  async #drain(): Promise<void> {
    if (this.#sending) return;
    this.#sending = true;
    try {
      while (this.#queue.length) {
        const key = this.#queue.shift()!;
        if (key.shift) this.#dispatchKey('keydown', { key: 'Shift', code: 'ShiftLeft' }, 16);
        if (key.ctrl) this.#dispatchKey('keydown', { key: 'Control', code: 'ControlLeft' }, 17);
        this.#dispatchKey('keydown', key);
        if (key.key.length === 1 && !key.ctrl) this.#dispatchKey('keypress', key);
        await this.#frames(2);
        this.#dispatchKey('keyup', key);
        if (key.ctrl) this.#dispatchKey('keyup', { key: 'Control', code: 'ControlLeft' }, 17);
        if (key.shift) this.#dispatchKey('keyup', { key: 'Shift', code: 'ShiftLeft' }, 16);
        await this.#frames(1);
      }
    } finally {
      this.#sending = false;
    }
  }

  #dispatchKey(type: 'keydown' | 'keypress' | 'keyup', key: DomKey, keyCode?: number): void {
    const char = key.key.length === 1 ? key.key.charCodeAt(0) : 0;
    const code =
      keyCode ?? (char ? (/[a-z]/.test(key.key) ? char - 32 : char) : (LEGACY_KEY_CODES[key.key] ?? 0));
    // Synthetic events do not bubble: the shell's own key handling must not see them again.
    const event = new KeyboardEvent(type, {
      key: key.key,
      code: key.code,
      shiftKey: Boolean(key.shift),
      ctrlKey: Boolean(key.ctrl),
      bubbles: false,
      cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { value: type === 'keypress' ? char : code });
    Object.defineProperty(event, 'which', { value: type === 'keypress' ? char : code });
    Object.defineProperty(event, 'charCode', { value: type === 'keypress' ? char : 0 });
    this.#keys.dispatchEvent(event);
  }

  /** A click on the canvas at a page point (button 0 left, 2 right), as SDL reads mouse events. */
  async click(clientX: number, clientY: number, button = 0): Promise<void> {
    const canvas = this.#canvas;
    if (!canvas) return;
    // SDL 3 reads pointer events (a mouse's: SDL's mouse); held for a few
    // frames, as keys are.
    const init = {
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
    };
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...init, button: -1, buttons: 0 }));
    await this.#frames(1);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...init, button, buttons: button === 2 ? 2 : 1 }));
    await this.#frames(2);
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, button, buttons: 0 }));
  }

  #onTouch(event: TouchEvent): void {
    // SDL would turn every touch into a left click: taps and long presses are ours.
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (event.type === 'touchstart') {
      if (this.#touch) clearTimeout(this.#touch.timer);
      const state = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        moved: false,
        long: false,
        timer: 0,
      };
      state.timer = window.setTimeout(() => {
        if (state.moved || this.#touch !== state) return;
        state.long = true;
        navigator.vibrate?.(15);
        void this.click(state.x, state.y, 2);
      }, LONG_PRESS_MS);
      this.#touch = state;
      return;
    }
    const state = this.#touch;
    if (!state || touch.identifier !== state.id) return;
    if (event.type === 'touchmove') {
      if (Math.hypot(touch.clientX - state.x, touch.clientY - state.y) > SLOP_PX) state.moved = true;
      return;
    }
    clearTimeout(state.timer);
    this.#touch = null;
    if (event.type === 'touchend' && !state.moved && !state.long) void this.click(state.x, state.y, 0);
  }
}

/** keyCode values of the named keys SDL may read (it reads `code` and `key` first). */
const LEGACY_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Insert: 45,
  Delete: 46,
  Clear: 12,
};

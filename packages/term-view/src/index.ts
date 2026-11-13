/**
 * Terminal-style cell grid rendering for game adapters (MIT).
 *
 * Many classic roguelikes draw into a character grid (Angband's "term", curses
 * in Rogue and NetHack). This package draws such a grid on a canvas through
 * "views": a rectangle of the grid shown at a position and scale. Desktop
 * shows one view of the whole screen; phone layouts compose several (the map
 * cropped and zoomed, a menu lifted into a large sheet). Hit-testing maps
 * points back to grid cells, and touch gestures (tap, long press, drag,
 * pinch) are reported to the adapter. Nothing here knows about any game.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface View {
  name: string;
  /** Cells of the grid shown by this view. */
  src: Rect;
  /** Destination rectangle in device pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  /** Device-pixel position of grid cell (0, 0) (may be outside the view). */
  originX: number;
  originY: number;
  /** 0 = normal, up to 1 = darkened (behind a modal sheet). */
  dim?: number;
  /** Taps outside a modal view mean "dismiss". */
  modal?: boolean;
  /** Draw a frame around the view (sheets and cards). */
  frame?: boolean;
}

export interface Grid {
  cols: number;
  rows: number;
  /** Two bytes per cell: character code, colour index. */
  cells: Uint8Array;
  cursor?: { x: number; y: number; visible: boolean };
}

export type HitResult =
  { kind: 'cell'; x: number; y: number; view: string } | { kind: 'dismiss'; view: string } | null;

/** Width of a character cell relative to its height for typical monospace fonts. */
export const CELL_RATIO = 0.6;

/** The largest whole-pixel cell that fits `src` inside a box. */
export function fitCell(src: Rect, width: number, height: number, maxCellHeight = Infinity) {
  let cellHeight = Math.floor(Math.min(height / src.height, width / src.width / CELL_RATIO, maxCellHeight));
  cellHeight = Math.max(4, cellHeight);
  return { cellWidth: Math.max(2, Math.round(cellHeight * CELL_RATIO)), cellHeight };
}

/** `src` scaled to fit inside `box` (device pixels) and centred in it. */
export function fittedView(
  name: string,
  src: Rect,
  box: Rect,
  maxCellHeight = Infinity,
  extra: Partial<View> = {},
): View {
  const { cellWidth, cellHeight } = fitCell(src, box.width, box.height, maxCellHeight);
  const width = src.width * cellWidth;
  const height = src.height * cellHeight;
  const x = Math.round(box.x + (box.width - width) / 2);
  const y = Math.round(box.y + (box.height - height) / 2);
  return {
    name,
    src,
    x,
    y,
    width,
    height,
    cellWidth,
    cellHeight,
    originX: x - src.x * cellWidth,
    originY: y - src.y * cellHeight,
    ...extra,
  };
}

/**
 * A large region (a dungeon map) at a readable cell size, following a focus
 * cell, clamped so it never scrolls past its edges, and filling `area`.
 */
export function followView(
  name: string,
  src: Rect,
  area: Rect,
  cellHeight: number,
  focus: { x: number; y: number } | null,
  pan: { x: number; y: number } = { x: 0, y: 0 },
): View {
  const fit = fitCell(src, area.width, area.height);
  const height = Math.max(fit.cellHeight, Math.round(cellHeight));
  const width = Math.max(fit.cellWidth, Math.round(height * CELL_RATIO));
  const axis = (
    start: number,
    size: number,
    first: number,
    count: number,
    cell: number,
    centre: number,
    offset: number,
  ) => {
    const span = count * cell;
    if (span <= size) return Math.round(start + (size - span) / 2 - first * cell);
    const origin = Math.round(start + size / 2 - (centre + 0.5) * cell + offset);
    return Math.min(start - first * cell, Math.max(start + size - (first + count) * cell, origin));
  };
  const centre = focus ?? { x: src.x + src.width / 2, y: src.y + src.height / 2 };
  return {
    name,
    src,
    ...area,
    cellWidth: width,
    cellHeight: height,
    originX: axis(area.x, area.width, src.x, src.width, width, centre.x, pan.x),
    originY: axis(area.y, area.height, src.y, src.height, height, centre.y, pan.y),
  };
}

/** Which cell (or dismiss area) is under a device-pixel point; topmost view first. */
export function hitTest(views: readonly View[], px: number, py: number): HitResult {
  for (let i = views.length - 1; i >= 0; i--) {
    const view = views[i]!;
    const inside = px >= view.x && py >= view.y && px < view.x + view.width && py < view.y + view.height;
    if (!inside) {
      if (view.modal) return { kind: 'dismiss', view: view.name };
      continue;
    }
    const x = Math.floor((px - view.originX) / view.cellWidth);
    const y = Math.floor((py - view.originY) / view.cellHeight);
    const { src } = view;
    if (x >= src.x && y >= src.y && x < src.x + src.width && y < src.y + src.height)
      return { kind: 'cell', x, y, view: view.name };
    return null;
  }
  return null;
}

export interface RendererOptions {
  /** CSS font family for glyphs. */
  fontFamily?: string;
  /** Maps a cell's character code to the text to draw (e.g. a code page). */
  glyph?: (code: number) => string;
  background?: string;
  /** Frame colour for views with `frame`. */
  frameColor?: string;
  /**
   * Colour indices drawn in reverse video (the cell filled with the colour,
   * the glyph in the background colour), e.g. curses standout.
   */
  inverse?: (color: number) => boolean;
}

const DEFAULT_FONT = "'DejaVu Sans Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** Draws a grid through views on a 2D canvas that fills its container. */
export class TermRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #options: Required<RendererOptions>;
  readonly #observer: ResizeObserver;
  #grid: Grid | null = null;
  #palette: string[] = [];
  #views: View[] = [];
  #frame = 0;
  #onResize: (() => void) | null = null;

  constructor(container: HTMLElement, options: RendererOptions = {}) {
    this.#options = {
      fontFamily: options.fontFamily ?? DEFAULT_FONT,
      glyph: options.glyph ?? ((code) => String.fromCharCode(code)),
      background: options.background ?? '#000',
      frameColor: options.frameColor ?? 'rgba(224,170,74,0.55)',
      inverse: options.inverse ?? (() => false),
    };
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available.');
    this.#ctx = ctx;
    this.#observer = new ResizeObserver(() => {
      this.#syncSize();
      this.#onResize?.();
      this.draw();
    });
    this.#observer.observe(this.canvas);
    this.#syncSize();
  }

  /** Called after the canvas changes size (to recompute views). */
  set onResize(callback: (() => void) | null) {
    this.#onResize = callback;
  }

  get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  /** Canvas size in device pixels. */
  get size(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  get views(): readonly View[] {
    return this.#views;
  }

  get grid(): Grid | null {
    return this.#grid;
  }

  setPalette(colors: string[]): void {
    this.#palette = colors;
    this.draw();
  }

  setGrid(grid: Grid): void {
    this.#grid = grid;
    this.draw();
  }

  setViews(views: View[]): void {
    this.#views = views;
    this.draw();
  }

  hitTest(clientX: number, clientY: number): HitResult {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (this.canvas.width / Math.max(1, rect.width));
    const py = (clientY - rect.top) * (this.canvas.height / Math.max(1, rect.height));
    return hitTest(this.#views, px, py);
  }

  /** Client coordinates of a cell's centre in the topmost view showing it. */
  cellToClient(x: number, y: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / Math.max(1, this.canvas.width);
    for (let i = this.#views.length - 1; i >= 0; i--) {
      const view = this.#views[i]!;
      const { src } = view;
      if (x < src.x || y < src.y || x >= src.x + src.width || y >= src.y + src.height) continue;
      const px = view.originX + (x + 0.5) * view.cellWidth;
      const py = view.originY + (y + 0.5) * view.cellHeight;
      if (px < view.x || py < view.y || px >= view.x + view.width || py >= view.y + view.height) continue;
      return { x: rect.left + px * scale, y: rect.top + py * scale };
    }
    return null;
  }

  /** Redraws on the next animation frame. */
  draw(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#paint();
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.#frame);
    this.#observer.disconnect();
    this.canvas.remove();
  }

  #syncSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * this.dpr));
    const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  #paint(): void {
    const ctx = this.#ctx;
    const grid = this.#grid;
    ctx.fillStyle = this.#options.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!grid) return;
    for (const view of this.#views) this.#paintView(ctx, grid, view);
  }

  #paintView(ctx: CanvasRenderingContext2D, grid: Grid, view: View): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x, view.y, view.width, view.height);
    ctx.clip();
    ctx.fillStyle = this.#options.background;
    ctx.fillRect(view.x, view.y, view.width, view.height);
    const size = Math.max(4, Math.round(view.cellHeight * 0.86));
    ctx.font = `${size}px ${this.#options.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const { src } = view;
    const firstX = Math.max(src.x, Math.floor((view.x - view.originX) / view.cellWidth));
    const lastX = Math.min(
      src.x + src.width,
      Math.ceil((view.x + view.width - view.originX) / view.cellWidth),
    );
    const firstY = Math.max(src.y, Math.floor((view.y - view.originY) / view.cellHeight));
    const lastY = Math.min(
      src.y + src.height,
      Math.ceil((view.y + view.height - view.originY) / view.cellHeight),
    );
    for (let y = firstY; y < lastY && y < grid.rows; y++) {
      const py = view.originY + y * view.cellHeight;
      for (let x = firstX; x < lastX && x < grid.cols; x++) {
        const offset = (y * grid.cols + x) * 2;
        const code = grid.cells[offset]!;
        const color = grid.cells[offset + 1]!;
        if (this.#options.inverse(color)) {
          ctx.fillStyle = this.#palette[color] ?? '#fff';
          ctx.fillRect(view.originX + x * view.cellWidth, py, view.cellWidth, view.cellHeight);
          if (code === 32 || code === 0) continue;
          ctx.fillStyle = this.#options.background;
        } else {
          if (code === 32 || code === 0) continue;
          ctx.fillStyle = this.#palette[color] ?? '#fff';
        }
        ctx.fillText(
          this.#options.glyph(code),
          view.originX + (x + 0.5) * view.cellWidth,
          py + view.cellHeight * 0.54,
        );
      }
    }
    const cursor = grid.cursor;
    if (
      cursor?.visible &&
      cursor.x >= src.x &&
      cursor.y >= src.y &&
      cursor.x < src.x + src.width &&
      cursor.y < src.y + src.height
    ) {
      ctx.strokeStyle = 'rgba(236,227,207,0.85)';
      ctx.lineWidth = Math.max(1, Math.round(this.dpr));
      ctx.strokeRect(
        view.originX + cursor.x * view.cellWidth + 0.5,
        view.originY + cursor.y * view.cellHeight + 0.5,
        view.cellWidth - 1,
        view.cellHeight - 1,
      );
    }
    if (view.dim) {
      ctx.fillStyle = `rgba(0,0,0,${view.dim})`;
      ctx.fillRect(view.x, view.y, view.width, view.height);
    }
    ctx.restore();
    if (view.frame) {
      ctx.save();
      ctx.strokeStyle = this.#options.frameColor;
      ctx.lineWidth = Math.max(1, Math.round(this.dpr));
      ctx.strokeRect(view.x - 3, view.y - 3, view.width + 6, view.height + 6);
      ctx.restore();
    }
  }
}

export interface GestureHandlers {
  tap?(clientX: number, clientY: number, event: PointerEvent): void;
  longPress?(clientX: number, clientY: number): void;
  /** Drag in device pixels since the last call. */
  pan?(dx: number, dy: number): void;
  /** Pinch: scale factor since the last call. */
  pinch?(scale: number): void;
}

const LONG_PRESS_MS = 450;
const TAP_SLOP_PX = 10;

/** Tap, long press, drag and pinch on an element; returns a function that detaches them. */
export function attachGestures(element: HTMLElement, handlers: GestureHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; time: number } | null = null;
  let moved = false;
  let longPressed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastDistance = 0;
  const dpr = () => window.devicePixelRatio || 1;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const down = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events cannot be captured.
    }
    if (pointers.size === 1) {
      start = { x: event.clientX, y: event.clientY, time: performance.now() };
      moved = false;
      longPressed = false;
      clearTimeout(timer);
      if (handlers.longPress && event.pointerType !== 'mouse') {
        timer = setTimeout(() => {
          if (!moved && start) {
            longPressed = true;
            handlers.longPress?.(start.x, start.y);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      clearTimeout(timer);
      moved = true;
      lastDistance = distance();
    }
  };
  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const now = distance();
      if (lastDistance > 0 && now > 0) handlers.pinch?.(now / lastDistance);
      lastDistance = now;
      return;
    }
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) {
      moved = true;
      clearTimeout(timer);
    }
    if (moved) handlers.pan?.((event.clientX - previous.x) * dpr(), (event.clientY - previous.y) * dpr());
  };
  const up = (event: PointerEvent) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(event.pointerId);
    clearTimeout(timer);
    if (wasSingle && start && !moved && !longPressed) handlers.tap?.(event.clientX, event.clientY, event);
    if (pointers.size === 0) start = null;
  };
  const cancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    clearTimeout(timer);
    if (pointers.size === 0) start = null;
  };
  // A touch's compatibility click would land on whatever is now under the finger.
  const touchEnd = (event: TouchEvent) => event.preventDefault();

  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('touchend', touchEnd, { passive: false });
  return () => {
    clearTimeout(timer);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('touchend', touchEnd);
  };
}

/**
 * Bounding box of text (words of 3+ letters) inside `region` of a grid, or
 * null: where a game has drawn a menu or description over its map.
 */
export function findText(grid: Grid, region: Rect, minWords = 2): Rect | null {
  const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  let words = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = region.y; y < region.y + region.height && y < grid.rows; y++) {
    let run = 0;
    for (let x = region.x; x <= region.x + region.width; x++) {
      const code = x < region.x + region.width && x < grid.cols ? grid.cells[(y * grid.cols + x) * 2]! : 32;
      if (isLetter(code)) {
        run++;
        continue;
      }
      if (run >= 3) {
        words++;
        // Grow over the rest of the line's text (punctuation, numbers, single spaces).
        let left = x - run;
        while (left - 1 >= region.x && grid.cells[(y * grid.cols + left - 1) * 2] !== 32) left--;
        let right = x - 1;
        while (right + 1 < region.x + region.width && grid.cells[(y * grid.cols + right + 1) * 2] !== 32)
          right++;
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      run = 0;
    }
  }
  if (words < minWords) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The text of one grid row (characters 32-126; others as spaces). */
export function rowText(grid: Grid, y: number, from = 0, to = grid.cols): string {
  let text = '';
  for (let x = from; x < to; x++) {
    const code = grid.cells[(y * grid.cols + x) * 2]!;
    text += code >= 32 && code < 127 ? String.fromCharCode(code) : ' ';
  }
  return text;
}

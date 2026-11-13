// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WebGL2 renderer for Brogue's 100x34 cell screen.
 *
 * One full-screen fragment shader looks up each pixel's cell, fetches that
 * cell's sprite index and colors, and blends the background and foreground
 * through the sprite's coverage mask, the same way the SDL renderer tints
 * white sprites with SDL_SetTextureColorMod. Cells are always whole device
 * pixels so text stays crisp.
 */
import { buildAtlas, type SourceSheet } from './atlas.ts';
import { cameraFocus, findTextOverlay, messageLines, type Rect } from './camera.ts';
import { CELL_BYTES, COLS, MAP_ORIGIN_X, MAP_ORIGIN_Y, ROWS, SHEET } from './constants.ts';

const VERTEX_SHADER = `#version 300 es
void main() {
  // Full-screen triangle.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCells;
uniform sampler2D uAtlas;
uniform ivec2 uCell;
uniform vec2 uOrigin;
uniform float uHeight;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) - uOrigin;
  if (p.x < 0.0 || p.y < 0.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  ivec2 px = ivec2(p);
  ivec2 cell = px / uCell;
  if (cell.x >= ${COLS} || cell.y >= ${ROWS}) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 fg = texelFetch(uCells, cell, 0);
  vec4 bg = texelFetch(uCells, ivec2(cell.x, cell.y + ${ROWS}), 0);
  int sprite = int(fg.a * 255.0 + 0.5) + int(bg.a * 255.0 + 0.5) * 256;
  ivec2 local = px - cell * uCell;
  ivec2 atlasPx = ivec2((sprite % ${SHEET.cols}) * uCell.x + local.x, (sprite / ${SHEET.cols}) * uCell.y + local.y);
  float coverage = texelFetch(uAtlas, atlasPx, 0).r;
  outColor = vec4(mix(bg.rgb, fg.rgb, coverage), 1.0);
}`;

/** Allowed cell width/height ratios. The sheet's native ratio is 128/232 = 0.55. */
const MIN_CELL_RATIO = 0.42;
const MAX_CELL_RATIO = 0.75;
const MAX_CELL_HEIGHT = 160;
/** CSS pixels: three 16px message lines plus padding. */
const MESSAGE_STRIP_HEIGHT = 54;

export interface Layout {
  /** Zoom actually applied (1 = whole screen fits). */
  zoom: number;
  /** Device pixels at the top covered by the message strip (0 when it is hidden). */
  inset: number;
  cellWidth: number;
  cellHeight: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  dpr: number;
}

/**
 * Pure layout computation, exported for tests.
 *
 * Without zoom (or without a focus rectangle) the whole 100x34 screen fits.
 * With zoom, cells grow by up to `zoom`, but never so much that `focus` (the
 * player's surroundings plus any text Brogue is showing) would not fit below
 * the `topInsetCss` message strip; the view is centered on `focus`.
 */
export function computeLayout(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  zoom: number,
  focus: Rect | null,
  topInsetCss = 0,
): Layout {
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  let fitWidth = Math.max(1, Math.floor(width / COLS));
  let fitHeight = Math.max(1, Math.floor(height / ROWS));
  if (fitWidth / fitHeight > MAX_CELL_RATIO) fitWidth = Math.max(1, Math.floor(fitHeight * MAX_CELL_RATIO));
  if (fitWidth / fitHeight < MIN_CELL_RATIO) fitHeight = Math.max(1, Math.floor(fitWidth / MIN_CELL_RATIO));

  const fit = (): Layout => ({
    zoom: 1,
    inset: 0,
    cellWidth: fitWidth,
    cellHeight: fitHeight,
    originX: Math.floor((width - COLS * fitWidth) / 2),
    originY: Math.floor((height - ROWS * fitHeight) / 2),
    width,
    height,
    dpr,
  });
  if (zoom <= 1 || !focus) return fit();

  const inset = Math.round(topInsetCss * dpr);
  const available = height - inset;
  const maxZoom = Math.min(width / (focus.width * fitWidth), available / (focus.height * fitHeight));
  const applied = Math.min(zoom, maxZoom);
  // Not worth zooming by a few percent: show everything instead.
  if (applied < 1.15) return fit();

  const cellHeight = Math.min(Math.floor(fitHeight * applied), MAX_CELL_HEIGHT);
  const cellWidth = Math.min(Math.floor(fitWidth * applied), Math.floor(MAX_CELL_HEIGHT * MAX_CELL_RATIO));
  const axis = (start: number, size: number, cells: number, cell: number, center: number) => {
    const grid = cells * cell;
    if (grid <= size) return start + Math.floor((size - grid) / 2);
    const centered = Math.round(start + size / 2 - center * cell);
    return Math.min(start, Math.max(start + size - grid, centered));
  };
  return {
    zoom: applied,
    inset,
    cellWidth,
    cellHeight,
    originX: axis(0, width, COLS, cellWidth, focus.x + focus.width / 2),
    originY: axis(inset, available, ROWS, cellHeight, focus.y + focus.height / 2),
    width,
    height,
    dpr,
  };
}

export class RendererUnsupportedError extends Error {
  override name = 'RendererUnsupportedError';
}

export class BrogueRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly #container: HTMLElement;
  readonly #sheet: SourceSheet;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #cellTexture: WebGLTexture | null = null;
  #atlasTexture: WebGLTexture | null = null;
  #uniforms: Record<'cell' | 'origin' | 'height', WebGLUniformLocation | null> = {
    cell: null,
    origin: null,
    height: null,
  };
  readonly #cellData = new Uint8Array(COLS * ROWS * 2 * 4);
  #layout: Layout | null = null;
  #atlasSize = '';
  #zoom = 1;
  #focus: Rect | null = null;
  #messageStrip: HTMLDivElement;
  #messageSignature = '';
  #lastCells: Uint8Array | null = null;
  #player: { x: number; y: number } | null = null;
  #dirty = true;
  #cellsDirty = true;
  #frameRequest = 0;
  #resizeObserver: ResizeObserver;
  #contextLost = false;

  constructor(container: HTMLElement, sheet: SourceSheet) {
    this.#container = container;
    this.#sheet = sheet;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'brogue-canvas';
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Brogue game screen');
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl)
      throw new RendererUnsupportedError(
        'This browser does not support WebGL 2, which Brogue needs to draw the screen.',
      );
    this.#gl = gl;
    container.appendChild(this.canvas);
    // While zoomed, Brogue's message lines may be off-screen; mirror them here.
    this.#messageStrip = document.createElement('div');
    this.#messageStrip.className = 'brogue-messages';
    this.#messageStrip.setAttribute('aria-live', 'polite');
    this.#messageStrip.setAttribute('aria-label', 'Messages');
    this.#messageStrip.hidden = true;
    this.#messageStrip.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'right:0',
      `height:${MESSAGE_STRIP_HEIGHT}px`,
      'box-sizing:border-box',
      'padding:3px 8px',
      'overflow:hidden',
      'white-space:pre',
      'font:12px/16px ui-monospace,Menlo,Consolas,monospace',
      'background:rgba(0,0,0,0.88)',
      'border-bottom:1px solid rgba(255,255,255,0.12)',
    ].join(';');
    container.appendChild(this.#messageStrip);
    this.canvas.addEventListener('webglcontextlost', this.#onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.#onContextRestored);
    this.#initGl();
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleLayout());
    this.#resizeObserver.observe(container);
    this.#scheduleLayout();
  }

  get layout(): Layout | null {
    return this.#layout;
  }

  get zoom(): number {
    return this.#zoom;
  }

  setZoom(zoom: number): void {
    this.#zoom = zoom;
    this.#focus = this.#computeFocus();
    this.#scheduleLayout();
  }

  #computeFocus(): Rect | null {
    // Only zoomed play needs the camera; skip the frame scan otherwise.
    if (this.#zoom <= 1 || !this.#lastCells) return null;
    return cameraFocus(this.#player, findTextOverlay(this.#lastCells));
  }

  /** Updates the screen from a frame posted by the worker. */
  setFrame(cells: Uint8Array, playerX: number, playerY: number, inGame: boolean): void {
    const data = this.#cellData;
    const bgOffset = COLS * ROWS * 4;
    for (let i = 0, src = 0, dst = 0; i < COLS * ROWS; i++, src += CELL_BYTES, dst += 4) {
      data[dst] = cells[src + 2]!;
      data[dst + 1] = cells[src + 3]!;
      data[dst + 2] = cells[src + 4]!;
      data[dst + 3] = cells[src]!;
      data[bgOffset + dst] = cells[src + 5]!;
      data[bgOffset + dst + 1] = cells[src + 6]!;
      data[bgOffset + dst + 2] = cells[src + 7]!;
      data[bgOffset + dst + 3] = cells[src + 1]!;
    }
    this.#lastCells = cells;
    this.#player = inGame && playerX >= 0 ? { x: MAP_ORIGIN_X + playerX, y: MAP_ORIGIN_Y + playerY } : null;
    const focus = this.#computeFocus();
    const focusChanged = JSON.stringify(focus) !== JSON.stringify(this.#focus);
    this.#focus = focus;
    this.#cellsDirty = true;
    if (focusChanged) this.#updateLayout();
    this.#updateMessageStrip();
    this.#requestDraw();
  }

  /** Maps a client (CSS pixel) position to a screen cell, or null when outside the grid. */
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const layout = this.#layout;
    if (!layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * layout.dpr - layout.originX;
    const py = (clientY - rect.top) * layout.dpr - layout.originY;
    if (px < 0 || py < 0) return null;
    const x = Math.floor(px / layout.cellWidth);
    const y = Math.floor(py / layout.cellHeight);
    return x < COLS && y < ROWS ? { x, y } : null;
  }

  destroy(): void {
    cancelAnimationFrame(this.#frameRequest);
    this.#resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.#onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.#onContextRestored);
    const gl = this.#gl;
    gl.deleteTexture(this.#cellTexture);
    gl.deleteTexture(this.#atlasTexture);
    gl.deleteProgram(this.#program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
    this.#messageStrip.remove();
  }

  #onContextLost = (event: Event) => {
    event.preventDefault();
    this.#contextLost = true;
    cancelAnimationFrame(this.#frameRequest);
  };

  #onContextRestored = () => {
    this.#contextLost = false;
    this.#atlasSize = '';
    this.#initGl();
    this.#updateLayout();
  };

  #initGl(): void {
    const gl = this.#gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new RendererUnsupportedError(`Shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new RendererUnsupportedError(`Shader link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    gl.useProgram(program);
    this.#program = program;
    this.#uniforms = {
      cell: gl.getUniformLocation(program, 'uCell'),
      origin: gl.getUniformLocation(program, 'uOrigin'),
      height: gl.getUniformLocation(program, 'uHeight'),
    };
    gl.uniform1i(gl.getUniformLocation(program, 'uCells'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uAtlas'), 1);

    const makeTexture = (unit: number) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    };
    this.#cellTexture = makeTexture(0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, COLS, ROWS * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.#atlasTexture = makeTexture(1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.#cellsDirty = true;
  }

  #layoutTimer: ReturnType<typeof setTimeout> | undefined;
  #scheduleLayout(): void {
    // Apply immediately the first time, then debounce bursts of resize events
    // because rebuilding the atlas is relatively expensive.
    if (!this.#layout) {
      this.#updateLayout();
      return;
    }
    clearTimeout(this.#layoutTimer);
    this.#layoutTimer = setTimeout(() => this.#updateLayout(), 60);
  }

  #updateLayout(): void {
    const rect = this.#container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Zoom follows the player (and any text Brogue shows); the title screen and
    // other screens without a player always fit.
    const stripHeight = MESSAGE_STRIP_HEIGHT;
    const layout = computeLayout(
      rect.width,
      rect.height,
      window.devicePixelRatio || 1,
      this.#zoom,
      this.#focus,
      stripHeight,
    );
    this.#layout = layout;
    const showStrip = layout.zoom > 1;
    if (this.#messageStrip.hidden === showStrip) {
      this.#messageStrip.hidden = !showStrip;
      this.#messageSignature = '';
      this.#updateMessageStrip();
    }
    if (this.canvas.width !== layout.width || this.canvas.height !== layout.height) {
      this.canvas.width = layout.width;
      this.canvas.height = layout.height;
    }
    const size = `${layout.cellWidth}x${layout.cellHeight}`;
    if (size !== this.#atlasSize && !this.#contextLost) {
      const atlas = buildAtlas(this.#sheet, layout.cellWidth, layout.cellHeight);
      const gl = this.#gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.#atlasTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        SHEET.cols * layout.cellWidth,
        SHEET.rows * layout.cellHeight,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        atlas,
      );
      this.#atlasSize = size;
    }
    this.#dirty = true;
    this.#requestDraw();
  }

  #updateMessageStrip(): void {
    const cells = this.#lastCells;
    if (this.#messageStrip.hidden || !cells) return;
    const lines = messageLines(cells);
    const signature = JSON.stringify(lines);
    if (signature === this.#messageSignature) return;
    this.#messageSignature = signature;
    this.#messageStrip.replaceChildren(
      ...lines.map((runs) => {
        const line = document.createElement('div');
        for (const run of runs) {
          const span = document.createElement('span');
          span.textContent = run.text;
          span.style.color = run.color;
          line.appendChild(span);
        }
        return line;
      }),
    );
  }

  #requestDraw(): void {
    if (this.#frameRequest || this.#contextLost) return;
    this.#frameRequest = requestAnimationFrame(() => {
      this.#frameRequest = 0;
      this.#draw();
    });
  }

  #draw(): void {
    const layout = this.#layout;
    if (!layout || this.#contextLost) return;
    const gl = this.#gl;
    if (this.#cellsDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#cellTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COLS, ROWS * 2, gl.RGBA, gl.UNSIGNED_BYTE, this.#cellData);
      this.#cellsDirty = false;
      this.#dirty = true;
    }
    if (!this.#dirty) return;
    this.#dirty = false;
    gl.viewport(0, 0, layout.width, layout.height);
    gl.uniform2i(this.#uniforms.cell, layout.cellWidth, layout.cellHeight);
    gl.uniform2f(this.#uniforms.origin, layout.originX, layout.originY);
    gl.uniform1f(this.#uniforms.height, layout.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

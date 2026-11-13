// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WebGL2 renderer for Brogue's 100x34 cell screen.
 *
 * The screen is drawn as one or more *views* (see views.ts): on desktop a
 * single view of the whole screen; on phones the map, sheets, peek cards and
 * the sidebar drawer are separate views of the same cells. Each view is one
 * scissored pass of a fragment shader that looks up the pixel's cell, fetches
 * its sprite and colors, and blends background and foreground through the
 * sprite's coverage mask (as the SDL renderer tints white sprites with
 * SDL_SetTextureColorMod). Cells are whole device pixels so text stays crisp.
 */
import { buildAtlas, type SourceSheet } from './atlas.ts';
import { cameraFocus, findTextOverlay, messageLines, type Rect } from './camera.ts';
import {
  compactViews,
  hitTest,
  screenView,
  sidebarRect,
  type HitResult,
  type Insets,
  type OverlayKind,
  type View,
} from './views.ts';
import { CELL_BYTES, COLS, MAP_ORIGIN_X, MAP_ORIGIN_Y, ROWS, SHEET } from './constants.ts';

const VERTEX_SHADER = `#version 300 es
void main() {
  // Full-screen triangle; each view is limited with the scissor test.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCells;
uniform sampler2D uAtlas;
uniform vec2 uCell;        // view cell size, device px
uniform vec2 uAtlasCell;   // atlas cell size, px (equal to uCell unless scaling)
uniform vec2 uAtlasSize;   // atlas texture size, px
uniform vec2 uOrigin;      // device-px position of screen cell (0,0)
uniform ivec4 uSrc;        // visible cells: x, y, width, height
uniform float uHeight;
uniform float uDim;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) - uOrigin;
  ivec2 cell = ivec2(floor(p / uCell));
  if (cell.x < uSrc.x || cell.y < uSrc.y || cell.x >= uSrc.x + uSrc.z || cell.y >= uSrc.y + uSrc.w) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 fg = texelFetch(uCells, cell, 0);
  vec4 bg = texelFetch(uCells, ivec2(cell.x, cell.y + ${ROWS}), 0);
  int sprite = int(fg.a * 255.0 + 0.5) + int(bg.a * 255.0 + 0.5) * 256;
  vec2 local = (p - vec2(cell) * uCell) * (uAtlasCell / uCell);
  local = clamp(local, vec2(0.5), uAtlasCell - 0.5);
  vec2 atlasPx = vec2(float(sprite % ${SHEET.cols}), float(sprite / ${SHEET.cols})) * uAtlasCell + local;
  float coverage = texture(uAtlas, atlasPx / uAtlasSize).r;
  vec3 color = mix(bg.rgb, fg.rgb, coverage);
  outColor = vec4(color * (1.0 - uDim), 1.0);
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

interface Atlas {
  texture: WebGLTexture;
  cellWidth: number;
  cellHeight: number;
  lastUsed: number;
}

const ATLAS_CACHE_SIZE = 4;
/** Default readable map row height on phones (CSS px); pinch changes it. */
export const DEFAULT_MAP_CELL_CSS = 18;

export interface CompactState {
  band: number;
  insets: Insets;
  mapCellCss: number;
  overlayKind: OverlayKind;
  drawer: boolean;
}

export class BrogueRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly #container: HTMLElement;
  readonly #sheet: SourceSheet;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram | null = null;
  #cellTexture: WebGLTexture | null = null;
  #uniforms: Record<string, WebGLUniformLocation | null> = {};
  readonly #cellData = new Uint8Array(COLS * ROWS * 2 * 4);
  /**
   * Phones: when Brogue draws a text box over the map and we lift it into a
   * sheet or card, the map view shows the dungeon as it was underneath
   * (remembered from the last frame without a box) instead of the box's text.
   */
  readonly #underlay = new Uint8Array(COLS * ROWS * 2 * 4);
  readonly #mapCellData = new Uint8Array(COLS * ROWS * 2 * 4);
  #mapCellTexture: WebGLTexture | null = null;
  #mapUsesUnderlay = false;
  #mapCellsDirty = false;
  #overlay: Rect | null = null;
  /** Cell the player is looking at (Brogue's cursor), kept visible beside description cards. */
  #look: { x: number; y: number } | null = null;
  /** A description the player tapped away; it stays hidden until a different one appears. */
  #dismissedPeek = '';
  #cardFrame: HTMLDivElement;
  #atlases = new Map<string, Atlas>();
  #atlasBuildQueue = new Set<string>();
  #atlasTimer: ReturnType<typeof setTimeout> | undefined;
  #layout: Layout | null = null;
  #views: View[] = [];
  #zoom = 1;
  #focus: Rect | null = null;
  #messageStrip: HTMLDivElement;
  #messageSignature = '';
  #lastCells: Uint8Array | null = null;
  #player: { x: number; y: number } | null = null;
  #inGame = false;
  #compact: CompactState | null = null;
  #pan = { x: 0, y: 0 };
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
    if (!gl) {
      throw new RendererUnsupportedError(
        'This browser does not support WebGL 2, which Brogue needs to draw the screen.',
      );
    }
    this.#gl = gl;
    container.appendChild(this.canvas);
    // While zoomed on desktop/tablets, Brogue's message lines may be off-screen; mirror them here.
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
    // A quiet outline around cards and sheets, so they read as panels over the map.
    this.#cardFrame = document.createElement('div');
    this.#cardFrame.className = 'brogue-card-frame';
    this.#cardFrame.hidden = true;
    this.#cardFrame.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'border:1px solid rgba(224,170,74,0.35)',
      'border-radius:10px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.55)',
      'z-index:0',
    ].join(';');
    container.appendChild(this.#cardFrame);
    this.canvas.addEventListener('webglcontextlost', this.#onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.#onContextRestored);
    this.#initGl();
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleLayout());
    this.#resizeObserver.observe(container);
    this.#scheduleLayout();
  }

  /** Classic (single-view) layout; null in compact mode. */
  get layout(): Layout | null {
    return this.#compact ? null : this.#layout;
  }

  get views(): readonly View[] {
    return this.#views;
  }

  get zoom(): number {
    return this.#zoom;
  }

  get compact(): CompactState | null {
    return this.#compact;
  }

  /** Classic-mode zoom (toolbar). */
  setZoom(zoom: number): void {
    this.#zoom = zoom;
    this.#focus = this.#computeFocus();
    this.#scheduleLayout();
  }

  /** Switch between the classic screen and the phone layout. */
  setCompact(state: CompactState | null): void {
    const before = JSON.stringify(this.#compact);
    this.#compact = state ? { ...state } : null;
    if (JSON.stringify(this.#compact) === before) return;
    this.#messageStrip.hidden = true;
    this.#updateLayout();
  }

  /** Pinch zoom on phones: map row height in CSS px. */
  setMapCellCss(css: number): void {
    if (!this.#compact) return;
    this.#compact.mapCellCss = Math.max(6, Math.min(56, css));
    this.#updateLayout();
  }

  /** The cell the player is looking at (screen coordinates), or null. */
  setLook(cell: { x: number; y: number } | null): void {
    if (cell?.x === this.#look?.x && cell?.y === this.#look?.y) return;
    this.#look = cell;
    if (this.#compact) this.#updateLayout();
  }

  /** Hide the current description card until a different description appears. */
  dismissPeek(): void {
    this.#dismissedPeek = this.#peekKey();
    this.#updateLayout();
  }

  #peekKey(): string {
    const overlay = this.#overlay;
    const cells = this.#lastCells;
    if (!overlay || !cells) return '';
    // The box's position plus its first row of text identifies the description.
    let key = `${overlay.x},${overlay.y},${overlay.width},${overlay.height}:`;
    for (let x = overlay.x; x < overlay.x + overlay.width; x++)
      key += String.fromCharCode(cells[(overlay.y * COLS + x) * CELL_BYTES]!);
    for (let x = overlay.x; x < overlay.x + overlay.width; x++) {
      key += String.fromCharCode(
        cells[((overlay.y + Math.min(2, overlay.height - 1)) * COLS + x) * CELL_BYTES]!,
      );
    }
    return key;
  }

  /** Drag to look around the map on phones; cleared when the player moves. */
  panBy(dx: number, dy: number): void {
    if (!this.#compact) return;
    const dpr = window.devicePixelRatio || 1;
    this.#pan = { x: this.#pan.x + dx * dpr, y: this.#pan.y + dy * dpr };
    this.#updateLayout();
    // Keep the pan within what the clamped camera actually shows.
    const map = this.#views.find((view) => view.name === 'map');
    if (map) this.#pan = this.#effectivePan(map);
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
    this.#overlay = this.#compact && inGame ? findTextOverlay(cells) : null;
    this.#composeMapCells();
    const player = inGame && playerX >= 0 ? { x: MAP_ORIGIN_X + playerX, y: MAP_ORIGIN_Y + playerY } : null;
    if (player?.x !== this.#player?.x || player?.y !== this.#player?.y) this.#pan = { x: 0, y: 0 };
    this.#player = player;
    this.#inGame = inGame;
    this.#cellsDirty = true;
    if (this.#compact) {
      this.#updateLayout();
    } else {
      const focus = this.#computeFocus();
      const focusChanged = JSON.stringify(focus) !== JSON.stringify(this.#focus);
      this.#focus = focus;
      if (focusChanged) this.#updateLayout();
      this.#updateMessageStrip();
    }
    this.#requestDraw();
  }

  /** What is under a client (CSS pixel) point. */
  hitTest(clientX: number, clientY: number): HitResult {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, rect.width);
    return hitTest(this.#views, (clientX - rect.left) * dpr, (clientY - rect.top) * dpr);
  }

  /** Maps a client (CSS pixel) position to a screen cell, or null. */
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const hit = this.hitTest(clientX, clientY);
    return hit?.kind === 'cell' ? { x: hit.x, y: hit.y } : null;
  }

  /** Client (CSS pixel) center of a screen cell in the topmost view showing it. */
  cellToClient(x: number, y: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, rect.width);
    for (let i = this.#views.length - 1; i >= 0; i--) {
      const view = this.#views[i]!;
      const { src } = view;
      if (x < src.x || y < src.y || x >= src.x + src.width || y >= src.y + src.height) continue;
      const px = view.originX + (x + 0.5) * view.cellWidth;
      const py = view.originY + (y + 0.5) * view.cellHeight;
      if (px < view.x || py < view.y || px >= view.x + view.width || py >= view.y + view.height) continue;
      return { x: rect.left + px / dpr, y: rect.top + py / dpr };
    }
    return null;
  }

  destroy(): void {
    cancelAnimationFrame(this.#frameRequest);
    clearTimeout(this.#atlasTimer);
    clearTimeout(this.#layoutTimer);
    this.#resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.#onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.#onContextRestored);
    const gl = this.#gl;
    for (const atlas of this.#atlases.values()) gl.deleteTexture(atlas.texture);
    this.#atlases.clear();
    gl.deleteTexture(this.#cellTexture);
    gl.deleteTexture(this.#mapCellTexture);
    gl.deleteProgram(this.#program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
    this.#messageStrip.remove();
    this.#cardFrame.remove();
  }

  #effectivePan(map: View): { x: number; y: number } {
    // The pan that reproduces the clamped origin, so dragging past an edge doesn't accumulate.
    const centered = this.#views.length
      ? compactViews({ ...this.#compactInput(), pan: { x: 0, y: 0 } })[0]!
      : map;
    return { x: map.originX - centered.originX, y: map.originY - centered.originY };
  }

  #composeMapCells(): void {
    const overlay = this.#overlay;
    if (!overlay || this.#compact?.overlayKind === 'none') {
      if (this.#compact) this.#underlay.set(this.#cellData);
      this.#mapUsesUnderlay = false;
      return;
    }
    this.#mapCellData.set(this.#cellData);
    const bgOffset = COLS * ROWS * 4;
    for (let y = overlay.y; y < overlay.y + overlay.height; y++) {
      const start = (y * COLS + overlay.x) * 4;
      const end = start + overlay.width * 4;
      this.#mapCellData.set(this.#underlay.subarray(start, end), start);
      this.#mapCellData.set(this.#underlay.subarray(bgOffset + start, bgOffset + end), bgOffset + start);
    }
    this.#mapUsesUnderlay = true;
    this.#mapCellsDirty = true;
  }

  #computeFocus(): Rect | null {
    // Only zoomed classic play needs the camera; skip the frame scan otherwise.
    if (this.#zoom <= 1 || !this.#lastCells) return null;
    return cameraFocus(this.#player, findTextOverlay(this.#lastCells));
  }

  #compactInput() {
    const compact = this.#compact!;
    const dpr = window.devicePixelRatio || 1;
    const cells = this.#lastCells;
    const overlay = this.#overlay ?? (cells ? findTextOverlay(cells) : null);
    let drawer: Rect | null = null;
    if (compact.drawer && cells) {
      let used = 0;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < 20; x++) {
          const offset = (y * COLS + x) * CELL_BYTES;
          if ((cells[offset]! | (cells[offset + 1]! << 8)) > 32) used = y + 1;
        }
      }
      drawer = sidebarRect(used);
    }
    return {
      width: this.canvas.width,
      height: this.canvas.height,
      dpr,
      band: Math.round(compact.band * dpr),
      insets: {
        top: compact.insets.top * dpr,
        right: compact.insets.right * dpr,
        bottom: compact.insets.bottom * dpr,
        left: compact.insets.left * dpr,
      },
      mapCellCss: compact.mapCellCss,
      pan: this.#pan,
      player: this.#player,
      focus: this.#look,
      overlay: compact.overlayKind === 'none' ? null : overlay,
      overlayKind:
        compact.overlayKind === 'peek' &&
        this.#dismissedPeek !== '' &&
        this.#dismissedPeek === this.#peekKey()
          ? ('none' as const)
          : compact.overlayKind,
      drawer,
    };
  }

  #onContextLost = (event: Event) => {
    event.preventDefault();
    this.#contextLost = true;
    cancelAnimationFrame(this.#frameRequest);
  };

  #onContextRestored = () => {
    this.#contextLost = false;
    this.#atlases.clear();
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
    for (const name of ['uCell', 'uAtlasCell', 'uAtlasSize', 'uOrigin', 'uSrc', 'uHeight', 'uDim']) {
      this.#uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(gl.getUniformLocation(program, 'uCells'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uAtlas'), 1);
    this.#cellTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#cellTexture);
    for (const [key, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ] as const) {
      gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, COLS, ROWS * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.#mapCellTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#mapCellTexture);
    for (const [key, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ] as const) {
      gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, COLS, ROWS * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.#mapCellsDirty = this.#mapUsesUnderlay;
    this.#cellsDirty = true;
  }

  /** An atlas for this cell size: exact if cached, else the closest cached one (scaled) while it builds. */
  #atlasFor(cellWidth: number, cellHeight: number): Atlas {
    const key = `${cellWidth}x${cellHeight}`;
    const exact = this.#atlases.get(key);
    if (exact) {
      exact.lastUsed = performance.now();
      return exact;
    }
    if (this.#atlases.size === 0) return this.#buildAtlas(cellWidth, cellHeight);
    this.#atlasBuildQueue.add(key);
    this.#scheduleAtlasBuild();
    let best: Atlas | null = null;
    for (const atlas of this.#atlases.values()) {
      if (!best || Math.abs(atlas.cellHeight - cellHeight) < Math.abs(best.cellHeight - cellHeight))
        best = atlas;
    }
    return best!;
  }

  #scheduleAtlasBuild(): void {
    if (this.#atlasTimer !== undefined) return;
    // Build one atlas per idle moment, newest request first (pinching skips sizes it passed).
    this.#atlasTimer = setTimeout(() => {
      this.#atlasTimer = undefined;
      const keys = [...this.#atlasBuildQueue];
      const key = keys[keys.length - 1];
      this.#atlasBuildQueue.clear();
      if (!key || this.#contextLost) return;
      const wanted = new Set(this.#views.map((view) => `${view.cellWidth}x${view.cellHeight}`));
      if (!wanted.has(key)) return;
      const [w, h] = key.split('x').map(Number) as [number, number];
      this.#buildAtlas(w, h);
      this.#dirty = true;
      this.#requestDraw();
      for (const view of this.#views) {
        if (!this.#atlases.has(`${view.cellWidth}x${view.cellHeight}`))
          this.#atlasFor(view.cellWidth, view.cellHeight);
      }
    }, 90);
  }

  #buildAtlas(cellWidth: number, cellHeight: number): Atlas {
    const gl = this.#gl;
    const pixels = buildAtlas(this.#sheet, cellWidth, cellHeight);
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      SHEET.cols * cellWidth,
      SHEET.rows * cellHeight,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const atlas = { texture, cellWidth, cellHeight, lastUsed: performance.now() };
    this.#atlases.set(`${cellWidth}x${cellHeight}`, atlas);
    // Evict the least recently used atlas beyond the cache size.
    while (this.#atlases.size > ATLAS_CACHE_SIZE) {
      let oldest: [string, Atlas] | null = null;
      for (const entry of this.#atlases)
        if (!oldest || entry[1].lastUsed < oldest[1].lastUsed) oldest = entry;
      gl.deleteTexture(oldest![1].texture);
      this.#atlases.delete(oldest![0]);
    }
    return atlas;
  }

  #layoutTimer: ReturnType<typeof setTimeout> | undefined;
  #scheduleLayout(): void {
    if (this.#views.length === 0) {
      this.#updateLayout();
      return;
    }
    clearTimeout(this.#layoutTimer);
    this.#layoutTimer = setTimeout(() => this.#updateLayout(), 60);
  }

  #updateLayout(): void {
    const rect = this.#container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.#compact && this.#inGame) {
      this.#views = compactViews(this.#compactInput());
      this.#layout = null;
    } else {
      // Zoom follows the player (and any text Brogue shows); screens without a player always fit.
      const layout = computeLayout(
        rect.width,
        rect.height,
        dpr,
        this.#compact ? 1 : this.#zoom,
        this.#focus,
        MESSAGE_STRIP_HEIGHT,
      );
      this.#layout = layout;
      const view = screenView(width, height, layout.cellWidth, layout.cellHeight);
      view.originX = layout.originX;
      view.originY = layout.originY;
      this.#views = [view];
      const showStrip = !this.#compact && layout.zoom > 1;
      if (this.#messageStrip.hidden === showStrip) {
        this.#messageStrip.hidden = !showStrip;
        this.#messageSignature = '';
        this.#updateMessageStrip();
      }
    }
    for (const view of this.#views) this.#atlasFor(view.cellWidth, view.cellHeight);
    const card = this.#views.find(
      (view) => view.name === 'peek' || view.name === 'sheet' || view.name === 'drawer',
    );
    this.#cardFrame.hidden = !card;
    if (card) {
      const pad = 6;
      Object.assign(this.#cardFrame.style, {
        left: `${card.x / dpr - pad}px`,
        top: `${card.y / dpr - pad}px`,
        width: `${card.width / dpr + 2 * pad}px`,
        height: `${card.height / dpr + 2 * pad}px`,
      });
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
    if (this.#views.length === 0 || this.#contextLost) return;
    const gl = this.#gl;
    if (this.#cellsDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#cellTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COLS, ROWS * 2, gl.RGBA, gl.UNSIGNED_BYTE, this.#cellData);
      this.#cellsDirty = false;
      this.#dirty = true;
    }
    if (this.#mapCellsDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.#mapCellTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COLS, ROWS * 2, gl.RGBA, gl.UNSIGNED_BYTE, this.#mapCellData);
      this.#mapCellsDirty = false;
      this.#dirty = true;
    }
    if (!this.#dirty) return;
    this.#dirty = false;
    const { width, height } = this.canvas;
    const u = this.#uniforms;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.uniform1f(u.uHeight!, height);
    for (const view of this.#views) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(
        gl.TEXTURE_2D,
        view.name === 'map' && this.#mapUsesUnderlay ? this.#mapCellTexture : this.#cellTexture,
      );
      const atlas = this.#atlasFor(view.cellWidth, view.cellHeight);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
      gl.scissor(view.x, height - (view.y + view.height), view.width, view.height);
      gl.uniform2f(u.uCell!, view.cellWidth, view.cellHeight);
      gl.uniform2f(u.uAtlasCell!, atlas.cellWidth, atlas.cellHeight);
      gl.uniform2f(u.uAtlasSize!, SHEET.cols * atlas.cellWidth, SHEET.rows * atlas.cellHeight);
      gl.uniform2f(u.uOrigin!, view.originX, view.originY);
      gl.uniform4i(u.uSrc!, view.src.x, view.src.y, view.src.width, view.src.height);
      gl.uniform1f(u.uDim!, view.dim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
}

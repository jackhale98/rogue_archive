// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Views: pieces of Brogue's 100x34 cell screen drawn at a position and scale.
 *
 * On desktop one view shows the whole screen. On phones ("compact") the
 * screen is recomposed: the dungeon map fills the display at a readable,
 * pinch-adjustable size; text Brogue draws over the map (inventory, dialogs,
 * descriptions) is lifted into a large sheet or a peek card; the sidebar
 * slides out as a drawer. Every view shows Brogue's own cells, unmodified, and
 * taps map back to the original cells, so the game sees ordinary mouse input.
 */
import type { Rect } from './camera.ts';
import { COLS, DCOLS, DROWS, MAP_ORIGIN_X, MAP_ORIGIN_Y, ROWS, STAT_BAR_WIDTH } from './constants.ts';

export type ViewName = 'screen' | 'map' | 'sheet' | 'peek' | 'drawer';

export interface View {
  name: ViewName;
  /** Cells of Brogue's screen shown by this view. */
  src: Rect;
  /** Destination rectangle in device pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  /** Device-pixel position of cell (0, 0) of Brogue's screen (may be off-view). */
  originX: number;
  originY: number;
  /** 0 = normal, up to 1 = fully darkened (used behind modal sheets). */
  dim: number;
  /** Taps on this view outside its content mean "dismiss" (send Escape). */
  modal: boolean;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * What to do with text Brogue draws over the map: nothing (title screen), a
 * modal sheet, a peek card, or 'hidden' (the adapter shows it elsewhere, e.g.
 * a reader; the map shows what was underneath).
 */
export type OverlayKind = 'none' | 'peek' | 'sheet' | 'hidden';

export interface CompactInput {
  /** Canvas size in device pixels. */
  width: number;
  height: number;
  dpr: number;
  /** Device pixels at the top covered by the status/message band. */
  band: number;
  /** Device pixels on each edge covered by touch controls. */
  insets: Insets;
  /** Preferred map row height in CSS pixels (pinch zoom). */
  mapCellCss: number;
  /** Manual pan of the map in device pixels (reset when the player moves). */
  pan: { x: number; y: number };
  player: { x: number; y: number } | null;
  /** Where the player is looking (hovered/targeted cell), if anywhere. */
  focus: { x: number; y: number } | null;
  overlay: Rect | null;
  overlayKind: OverlayKind;
  drawer: Rect | null;
}

/** Brogue's sprites are 128x232; text reads better a little wider at small sizes. */
const CELL_RATIO = 0.58;
const MAX_SHEET_CELL_CSS = 30;
/** Descriptions stay compact so the dungeon around them stays visible. */
const MAX_PEEK_CELL_CSS = 18;
const MAX_MAP_CELL_CSS = 56;
const BACKDROP_DIM = 0.62;

export const MAP_RECT: Rect = { x: MAP_ORIGIN_X, y: MAP_ORIGIN_Y, width: DCOLS, height: DROWS };
export const SCREEN_RECT: Rect = { x: 0, y: 0, width: COLS, height: ROWS };

function widthFor(cellHeight: number): number {
  return Math.max(1, Math.round(cellHeight * CELL_RATIO));
}

/** The largest whole-pixel cell that fits `rect` cells inside `w` x `h` device pixels. */
function fitCell(
  rect: Rect,
  w: number,
  h: number,
  maxHeight: number,
): { cellWidth: number; cellHeight: number } {
  let cellHeight = Math.floor(Math.min(h / rect.height, w / rect.width / CELL_RATIO, maxHeight));
  cellHeight = Math.max(4, cellHeight);
  return { cellWidth: widthFor(cellHeight), cellHeight };
}

/** A view of `src` scaled to fit inside the box and centered in it. */
function fitted(
  name: ViewName,
  src: Rect,
  box: { x: number; y: number; width: number; height: number },
  maxCell: number,
  modal: boolean,
): View {
  const { cellWidth, cellHeight } = fitCell(src, box.width, box.height, maxCell);
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
    dim: 0,
    modal,
  };
}

/**
 * Brogue's title art (MainMenu.c: MENU_TITLE_WIDTH x MENU_TITLE_HEIGHT, 68x26,
 * centred and offset by -7, -2), with a little of the flames around it.
 */
export const TITLE_ART_RECT: Rect = { x: 7, y: 1, width: 72, height: 28 };

/**
 * Phones, behind the large title-menu buttons: the whole title screen with
 * its flames, scaled so the title art fills the width and placed at the top
 * of `area` (device pixels). The buttons sit below it, over the lower flames.
 */
export function titleArtView(width: number, height: number, area: Rect, cellRatio: number): View {
  const art = TITLE_ART_RECT;
  let cellWidth = Math.max(2, Math.floor(area.width / art.width));
  let cellHeight = Math.max(4, Math.round(cellWidth / cellRatio));
  // Leave at least half the area for the buttons.
  const maxHeight = Math.floor((area.height * 0.5) / art.height);
  if (cellHeight > maxHeight) {
    cellHeight = Math.max(4, maxHeight);
    cellWidth = Math.max(2, Math.round(cellHeight * cellRatio));
  }
  return {
    name: 'screen',
    src: SCREEN_RECT,
    x: 0,
    y: 0,
    width,
    height,
    cellWidth,
    cellHeight,
    originX: Math.round(area.x + (area.width - art.width * cellWidth) / 2 - art.x * cellWidth),
    originY: Math.round(area.y - art.y * cellHeight),
    dim: 0,
    modal: false,
  };
}

/** Whole screen, fitted: desktop, tablets, and the title screen on phones. */
export function screenView(width: number, height: number, cellWidth: number, cellHeight: number): View {
  const x = Math.floor((width - COLS * cellWidth) / 2);
  const y = Math.floor((height - ROWS * cellHeight) / 2);
  return {
    name: 'screen',
    src: SCREEN_RECT,
    x: 0,
    y: 0,
    width,
    height,
    cellWidth,
    cellHeight,
    originX: x,
    originY: y,
    dim: 0,
    modal: false,
  };
}

/**
 * Large text screens drawn against the top or left edge of the map (help,
 * message history) continue into the message area or sidebar; include those
 * parts so nothing is cut off. Small boxes (inventory, dialogs) stay as found.
 */
export function sheetSource(overlay: Rect): Rect {
  let { x, y, width, height } = overlay;
  if (y <= MAP_ORIGIN_Y && height >= 18) {
    height += y;
    y = 0;
  }
  if (x <= MAP_ORIGIN_X && width >= 60) {
    width += x;
    x = 0;
  }
  return { x, y, width, height };
}

/** The views for a phone-sized screen. */
export function compactViews(input: CompactInput): View[] {
  const { width, height, dpr, band, insets } = input;
  const area = { x: 0, y: band, width, height: Math.max(1, height - band) };
  const views: View[] = [];

  // Space left for the camera, sheets and cards once the touch controls are accounted for.
  const free = {
    x: area.x + insets.left,
    y: area.y,
    width: Math.max(1, area.width - insets.left - insets.right),
    height: Math.max(1, area.height - insets.bottom),
  };

  // Map: readable size, centered on the player (plus manual pan) within the free
  // space, clamped so it never scrolls past its edges. It draws under the controls.
  const fit = fitCell(MAP_RECT, area.width, area.height, Infinity);
  // Behind a sheet (menus, item details) the map is only a backdrop, and Brogue
  // has drawn the menu into it: show it whole (small), not at the play zoom,
  // where that text would loom large around the sheet.
  const backdrop = !!input.overlay && input.overlayKind === 'sheet';
  const wanted = backdrop ? 0 : Math.round(input.mapCellCss * dpr);
  const cellHeight = Math.max(fit.cellHeight, Math.min(wanted, Math.round(MAX_MAP_CELL_CSS * dpr)));
  const cellWidth = Math.max(fit.cellWidth, widthFor(cellHeight));
  const axis = (
    start: number,
    size: number,
    first: number,
    count: number,
    cell: number,
    center: number,
    pan: number,
  ) => {
    const span = count * cell;
    if (span <= size) return Math.round(start + (size - span) / 2 - first * cell);
    const origin = Math.round(start + size / 2 - (center + 0.5) * cell + pan);
    // Keep the map covering the whole area: no empty space beyond its edges.
    return Math.min(start - first * cell, Math.max(start + size - (first + count) * cell, origin));
  };
  const center = input.player ?? { x: MAP_RECT.x + MAP_RECT.width / 2, y: MAP_RECT.y + MAP_RECT.height / 2 };
  const map: View = {
    name: 'map',
    src: MAP_RECT,
    ...area,
    cellWidth,
    cellHeight,
    originX: axis(free.x, free.width, MAP_RECT.x, MAP_RECT.width, cellWidth, center.x, input.pan.x),
    originY: axis(free.y, free.height, MAP_RECT.y, MAP_RECT.height, cellHeight, center.y, input.pan.y),
    dim: 0,
    modal: false,
  };
  views.push(map);

  const margin = Math.round(8 * dpr);

  if (input.overlay && input.overlayKind === 'sheet') {
    map.dim = BACKDROP_DIM;
    views.push(
      fitted(
        'sheet',
        sheetSource(input.overlay),
        {
          x: free.x + margin,
          y: free.y + margin,
          width: free.width - 2 * margin,
          height: free.height - 2 * margin,
        },
        MAX_SHEET_CELL_CSS * dpr,
        true,
      ),
    );
  } else if (input.overlay && input.overlayKind === 'peek') {
    views.push(
      placePeek(input.overlay, map, free, margin, MAX_PEEK_CELL_CSS * dpr, [input.player, input.focus]),
    );
  }

  if (input.drawer) {
    views.push(
      fitted(
        'drawer',
        input.drawer,
        {
          x: margin,
          y: area.y + margin,
          width: Math.min(area.width * 0.7, area.width - 2 * margin),
          height: area.height - 2 * margin,
        },
        MAX_SHEET_CELL_CSS * dpr,
        true,
      ),
    );
    map.dim = Math.max(map.dim, BACKDROP_DIM);
  }
  return views;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * A description card in whichever part of the screen (top, bottom, left or
 * right) keeps the player and what they're looking at visible, preferring the
 * placement that leaves the text largest.
 */
export function placePeek(
  overlay: Rect,
  map: View,
  free: Box,
  margin: number,
  maxCell: number,
  keepVisible: ({ x: number; y: number } | null)[],
): View {
  const inner = {
    x: free.x + margin,
    y: free.y + margin,
    width: free.width - 2 * margin,
    height: free.height - 2 * margin,
  };
  const halfH = Math.floor(inner.height * 0.46);
  const halfW = Math.floor(inner.width * 0.5) - margin;
  const candidates: Box[] = [
    { ...inner, height: halfH },
    { ...inner, y: inner.y + inner.height - halfH, height: halfH },
    { ...inner, width: halfW },
    { ...inner, x: inner.x + inner.width - halfW, width: halfW },
  ];
  // Screen positions (device px) of cells that must stay visible, with a cell of slack.
  const points = keepVisible
    .filter((cell): cell is { x: number; y: number } => cell !== null)
    .map((cell) => ({
      x: map.originX + (cell.x + 0.5) * map.cellWidth,
      y: map.originY + (cell.y + 0.5) * map.cellHeight,
    }));
  const covers = (view: View, point: { x: number; y: number }) =>
    point.x > view.x - map.cellWidth &&
    point.x < view.x + view.width + map.cellWidth &&
    point.y > view.y - map.cellHeight &&
    point.y < view.y + view.height + map.cellHeight;
  let best: { view: View; hidden: number } | null = null;
  for (const box of candidates) {
    const view = fitted('peek', overlay, box, maxCell, false);
    const hidden = points.filter((point) => covers(view, point)).length;
    if (!best || hidden < best.hidden || (hidden === best.hidden && view.cellHeight > best.view.cellHeight)) {
      best = { view, hidden };
    }
  }
  return best!.view;
}

/** Rows of the sidebar actually in use (Brogue fills it from the top). */
export function sidebarRect(usedRows: number): Rect {
  return { x: 0, y: 0, width: STAT_BAR_WIDTH, height: Math.max(8, Math.min(ROWS, usedRows)) };
}

export type HitResult =
  { kind: 'cell'; x: number; y: number; view: ViewName } | { kind: 'dismiss'; view: ViewName } | null;

/** Which cell (or dismiss area) is under a device-pixel point; topmost view first. */
export function hitTest(views: readonly View[], px: number, py: number): HitResult {
  for (let i = views.length - 1; i >= 0; i--) {
    const view = views[i]!;
    const inside = px >= view.x && py >= view.y && px < view.x + view.width && py < view.y + view.height;
    if (!inside) {
      // Anything outside a modal view (sheet or drawer) dismisses it.
      if (view.modal) return { kind: 'dismiss', view: view.name };
      continue;
    }
    const x = Math.floor((px - view.originX) / view.cellWidth);
    const y = Math.floor((py - view.originY) / view.cellHeight);
    const { src } = view;
    if (x >= src.x && y >= src.y && x < src.x + src.width && y < src.y + src.height) {
      return { kind: 'cell', x, y, view: view.name };
    }
    return null;
  }
  return null;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Screen geometry and key codes from upstream src/brogue/Rogue.h (Brogue CE 1.15.1).

export const COLS = 100;
export const ROWS = 34;
export const MESSAGE_LINES = 3;
export const STAT_BAR_WIDTH = 20;
/** Dungeon map size in cells, and its top-left position on screen. */
export const DCOLS = COLS - STAT_BAR_WIDTH - 1;
export const DROWS = ROWS - MESSAGE_LINES - 2;
export const MAP_ORIGIN_X = STAT_BAR_WIDTH + 1;
export const MAP_ORIGIN_Y = MESSAGE_LINES;

export const CELL_BYTES = 8;

/** enum eventTypes */
export const EventType = {
  KEYSTROKE: 0,
  MOUSE_UP: 1,
  MOUSE_DOWN: 2,
  RIGHT_MOUSE_DOWN: 3,
  RIGHT_MOUSE_UP: 4,
  MOUSE_ENTERED_CELL: 5,
} as const;

/** enum graphicsModes */
export const GraphicsMode = { TEXT: 0, TILES: 1, HYBRID: 2 } as const;
export type GraphicsModeValue = (typeof GraphicsMode)[keyof typeof GraphicsMode];

export const Key = {
  UP_ARROW: 63232,
  DOWN_ARROW: 63233,
  LEFT_ARROW: 63234,
  RIGHT_ARROW: 63235,
  ESCAPE: 0o33,
  RETURN: 0o12,
  DELETE: 0o177,
  TAB: 9,
} as const;

/** Source tile sheet (bin/assets/tiles.png) geometry, from upstream src/platform/tiles.c. */
export const SHEET = {
  width: 2048,
  height: 5568,
  tileWidth: 128,
  tileHeight: 232,
  rows: 24,
  cols: 16,
} as const;

/**
 * How each sprite is fitted into a cell, from upstream tiles.c TileProcessing:
 * 's' stretch, 'f' fit (<=20% stretch), 't' text and '#' symbols (<=40% stretch).
 */
export const TILE_PROCESSING = [
  'ffffffffffffffff',
  'ssssssssssssssss',
  '#t##########t#t#',
  'tttttttttttt###t',
  '#ttttttttttttttt',
  'ttttttttttt#####',
  '#ttttttttttttttt',
  'ttttttttttt#####',
  '################',
  '################',
  '################',
  '################',
  'tttttttttttttttt',
  'ttttttt#tttttttt',
  'tttttttttttttttt',
  'ttttttt#tttttttt',
  'ffsfsfsffsssssss',
  'ssfsfsffffffffff',
  'fffffffffffffsff',
  'ffffffffffffffff',
  'fsssfffffffffffs',
  'fsffffffffffffff',
  'ffffssssffssffff',
  'ffffsfffffssssff',
] as const;

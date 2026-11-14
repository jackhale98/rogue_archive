// SPDX-License-Identifier: NGPL
/**
 * NetHack's window interface (doc/window.txt) for upstream's shim window port
 * (win/shim/winshim.c): the shim calls one JavaScript function per window
 * operation and waits (Asyncify) for its answer. This module answers them the
 * way NetHack's own tty port does, on an 80×24 screen: the message line on
 * top, the map below it, two status lines at the bottom; menus and text
 * windows drawn over the map (paged, with tty's keys); prompts on the message
 * line.
 *
 * It has no browser or worker dependencies: the worker (adapter/worker.ts)
 * and the Node conformance harness drive it the same way.
 */

/** The parts of the Emscripten module the window port uses. */
export interface NhModule {
  UTF8ToString(ptr: number, maxBytes?: number): string;
  stringToUTF8(text: string, ptr: number, maxBytes: number): void;
  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: number, type: string): void;
  _malloc(size: number): number;
  _ra_free(ptr: number): void;
  _ra_gi_char(info: number): number;
  _ra_gi_color(info: number): number;
  _ra_gi_tile(info: number): number;
  _ra_gi_flags(info: number): number;
  _ra_gi_glyph(info: number): number;
  _ra_menu_start(window: number): void;
  _ra_menu_keep(window: number, identifier: number): number;
  _ra_menu_selectable(window: number, index: number): number;
  _ra_menu_select(window: number, out: number, indices: number, counts: number, n: number): number;
  _ra_ext_cmd_index(name: number): number;
  _ra_conditions(mask: number, out: number, size: number): void;
  _ra_file_text(name: number): number;
  _ra_set_plname(name: number): void;
  _ra_state(): number;
  _ra_state_fields(): number;
}

export const COLS = 80;
export const ROWS = 24;
/** Screen rows: the message line, the map (21 rows), two status lines. */
export const MAP_TOP = 1;
export const MAP_ROWS = 21;
export const STATUS_TOP = 22;

/** NetHack's window types (include/wintype.h). */
const NHW = { message: 1, status: 2, map: 3, menu: 4, text: 5, perminvent: 6 } as const;

/** Colours: NetHack's 16 (CLR_*); NO_COLOR (8) is drawn as gray. INVERSE is added for reverse video. */
export const NO_COLOR = 8;
export const GRAY = 7;
export const INVERSE = 16;

/** Status fields (include/botl.h `enum statusfields`) and tty's two-line order. */
const BL = {
  flush: -1,
  reset: -2,
  condition: 22,
  gold: 10,
  hp: 18,
  hpmax: 19,
} as const;
/**
 * Each field's format, as src/botl.c's initblstats gives it (the shim never
 * calls status_enablefield, so the window port knows them itself).
 */
const STATUS_FORMATS: readonly string[] = [
  '%s', // title
  ' St:%s',
  ' Dx:%s',
  ' Co:%s',
  ' In:%s',
  ' Wi:%s',
  ' Ch:%s',
  ' %s', // alignment
  ' S:%s', // score
  ' %s', // carrying capacity
  ' %s', // gold
  ' Pw:%s',
  '(%s)', // power max
  ' Xp:%s',
  ' AC:%s',
  ' HD:%s',
  ' T:%s',
  ' %s', // hunger
  ' HP:%s',
  '(%s)', // hit points max
  '%s', // dungeon level
  '/%s', // experience points
  '%s', // condition
  ' %s', // weapon
  ' %s', // armor
  ' %s', // terrain
  ' %s', // version
];
const STATUS_ORDER: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [20, 10, 18, 19, 11, 12, 14, 13, 21, 15, 16, 17, 9, 22, 23, 24, 25, 26],
];

/** The state field that says getpos is running (port/rogue-archive-glue.c RA_GETPOS). */
const GETPOS_FIELD = 24;

/** menu_item flags (include/wintype.h). */
const MENU_ITEMFLAGS_SELECTED = 0x1;
/** select_menu "how". */
const PICK = { none: 0, one: 1, any: 2 } as const;

const ESC = 27;
const ENTER = 13;
const LF = 10;
const BACKSPACE = 8;
const DEL = 127;
const SPACE = 32;

export type NhContext =
  | 'loading'
  | 'map'
  | 'more'
  | 'yn'
  | 'item'
  | 'direction'
  | 'menu'
  | 'text'
  | 'getlin'
  | 'extcmd'
  /** Choosing a map position (getpos: travel, farlook, jump...). */
  | 'position'
  | 'over';

export type NhInput = { key: number } | { click: { x: number; y: number; button: number } };

export interface MenuItemView {
  /** The key that chooses it (tty's accelerator); 0 for headings. */
  key: number;
  text: string;
  selected: boolean;
  heading: boolean;
  /** The tile of the item's glyph, or -1. */
  tile: number;
}

export interface NhFrame {
  /** Two bytes per cell: character, colour (+16: reverse video). */
  cells: Uint8Array;
  /** The same screen without the menu or text window drawn over it. */
  under: Uint8Array;
  /** The tile drawn in each map cell (index into the tile set), 0xffff for none. */
  tiles: Uint16Array;
  cursor: { x: number; y: number; visible: boolean };
  context: NhContext;
  /** The prompt being answered (yn_function, getlin, extended command). */
  prompt: string;
  /** The open menu or text window on screen: its page, for the touch controls. */
  menu: { how: number; items: MenuItemView[]; page: number; pages: number; title: string } | null;
  /** Read-only game state (port/rogue-archive-glue.c ra_state). */
  state: Int32Array;
  /** The messages of this turn (since the player last gave a key on the map). */
  messages: string[];
  /** Where the menu or text window is drawn on the screen, if one is. */
  overlay: { x: number; y: number; width: number; height: number } | null;
}

export interface WindowPortHost {
  /** The next key or click; resolves when the player gives one. */
  nextInput(): Promise<NhInput>;
  /** A new screen (after the game drew and before it waits). */
  frame(frame: NhFrame): void;
  /** A message the game printed (for the shell's log). */
  message(text: string): void;
  /** delay_output(): a short pause for animations. */
  delay(): Promise<void>;
  /** Text the game printed outside its windows (raw_print). */
  raw?(text: string): void;
}

interface Line {
  text: string;
  attr: number;
}

interface MenuItem {
  index: number;
  key: number;
  group: number;
  attr: number;
  color: number;
  text: string;
  selectable: boolean;
  selected: boolean;
  count: number;
  tile: number;
}

interface Window {
  type: number;
  lines: Line[];
  items: MenuItem[];
  prompt: string;
}

/** tty's encoded glyphs in text ("\GXXXXYYYY"): shown as their symbol. */
function decode(text: string): string {
  return text.replace(/\\G[0-9a-fA-F]{8}/g, '$');
}

/**
 * What a yn_function() prompt asks for: an item ("What do you want to eat?
 * [fg or ?*]"), a direction ("In what direction?"), or one of a few answers
 * ("[ynq]", given as `choices` or written in the question).
 */
export function promptContext(query: string, choices: string): NhContext {
  if (/direction/i.test(query) && !choices) return 'direction';
  if (/\?\*\]|\[[^\]]* or [^\]]*\]|^What do you want to /.test(query)) return 'item';
  if (choices || /\[[^\]]+\]/.test(query)) return 'yn';
  return 'item';
}

/** Keys tty gives menu items without their own: a-z then A-Z. */
const MENU_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class WindowPort {
  #mod!: NhModule;
  readonly #host: WindowPortHost;
  readonly cells = new Uint8Array(COLS * ROWS * 2);
  readonly under = new Uint8Array(COLS * ROWS * 2);
  readonly tiles = new Uint16Array(COLS * ROWS).fill(0xffff);
  #windows = new Map<number, Window>();
  #nextWindow = 1;
  #messageWindow = 0;
  #mapWindow = 0;
  /** Messages printed since the player last gave a key (shown on the message line). */
  #turnMessages: string[] = [];
  #history: string[] = [];
  #status = new Map<number, string>();
  #statusFormat = new Map<number, string>();
  #cursor = { x: 0, y: 0 };
  #context: NhContext = 'loading';
  #prompt = '';
  #menuView: NhFrame['menu'] = null;
  /** Map cells (char, colour, tile) as the game drew them; the screen is drawn from these. */
  #map = new Int32Array(COLS * MAP_ROWS * 3);
  #stateFields = 0;

  constructor(host: WindowPortHost) {
    this.#host = host;
    this.#clearMap();
  }

  /** The module, once it has loaded (before the game starts calling). */
  attach(mod: NhModule): void {
    this.#mod = mod;
  }

  get context(): NhContext {
    return this.#context;
  }

  get history(): readonly string[] {
    return this.#history;
  }

  /** The shim's callback: one call per window operation; resolves with its result. */
  async call(name: string, ...args: unknown[]): Promise<unknown> {
    const a = args as number[];
    // Arguments typed 's' arrive as strings; 'p' as pointers (status formats).
    const s = (value: unknown) =>
      typeof value === 'string'
        ? decode(value)
        : value
          ? decode(this.#mod.UTF8ToString(value as number))
          : '';
    switch (name) {
      case 'shim_init_nhwindows':
      case 'shim_get_nh_event':
      case 'shim_suspend_nhwindows':
      case 'shim_resume_nhwindows':
      case 'shim_mark_synch':
      case 'shim_update_positionbar':
      case 'shim_number_pad':
      case 'shim_change_color':
      case 'shim_change_background':
      case 'shim_preference_update':
      case 'shim_putmsghistory':
      case 'shim_status_init':
      case 'shim_player_selection':
      case 'shim_update_inventory':
      case 'shim_nhbell':
        return undefined;
      case 'shim_player_selection_or_tty':
        // True: NetHack's own role selection with menus (genl_player_setup).
        return true;
      case 'shim_askname':
        return this.#askname();
      case 'shim_exit_nhwindows':
        if (args[0]) this.#addMessage(s(args[0]));
        this.#context = 'over';
        this.#emit();
        return undefined;
      case 'shim_create_nhwindow':
        return this.#create(a[0]!);
      case 'shim_clear_nhwindow':
        this.#clear(a[0]!);
        return undefined;
      case 'shim_display_nhwindow':
        return this.#display(a[0]!, Boolean(args[1]));
      case 'shim_destroy_nhwindow':
        this.#windows.delete(a[0]!);
        return undefined;
      case 'shim_curs':
        if (a[0] === this.#mapWindow) this.#cursor = { x: a[1]! - 1, y: a[2]! + MAP_TOP };
        return undefined;
      case 'shim_putstr':
        this.#putstr(a[0]!, a[1]!, s(args[2]));
        return undefined;
      case 'shim_display_file':
        return this.#displayFile(s(args[0]), Boolean(args[1]));
      case 'shim_start_menu':
        this.#startMenu(a[0]!);
        return undefined;
      case 'shim_add_menu':
        this.#addMenu(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!, s(args[7]), a[8]!);
        return undefined;
      case 'shim_end_menu': {
        const w = this.#windows.get(a[0]!);
        if (w) w.prompt = s(args[1]);
        return undefined;
      }
      case 'shim_select_menu':
        return this.#selectMenu(a[0]!, a[1]!, a[2]!);
      case 'shim_message_menu':
        // A one-line menu (e.g. a "You can't" message): shown as a message.
        this.#addMessage(s(args[2]));
        return typeof args[0] === 'string' ? args[0].charCodeAt(0) & 0x7f : 0;
      case 'shim_wait_synch':
        this.#emit();
        return undefined;
      case 'shim_cliparound':
        return undefined;
      case 'shim_print_glyph':
        this.#printGlyph(a[1]!, a[2]!, a[3]!, a[4]!);
        return undefined;
      case 'shim_raw_print':
      case 'shim_raw_print_bold': {
        const text = s(args[0]);
        this.#host.raw?.(text);
        if (text.trim()) this.#addMessage(text.trim());
        return undefined;
      }
      case 'shim_nhgetch':
        return this.#getKey('map');
      case 'shim_nh_poskey':
        return this.#posKey(a[0]!, a[1]!, a[2]!);
      case 'shim_doprev_message':
        return this.#previousMessages();
      case 'shim_yn_function':
        return this.#yn(s(args[0]), s(args[1]), Number(args[2] ?? 0));
      case 'shim_getlin':
        return this.#getlin(s(args[0]), a[1]!);
      case 'shim_get_ext_cmd':
        return this.#extCmd();
      case 'shim_delay_output':
        this.#emit();
        await this.#host.delay();
        return undefined;
      case 'set_shim_font_name':
        return 0;
      case 'shim_get_color_string':
      case 'shim_getmsghistory':
        // An empty string is the only safe string return (the shim writes
        // strings over the return pointer): it reads as NULL.
        return '';
      case 'shim_status_enablefield':
        if (args[3]) this.#statusFormat.set(a[0]!, s(args[2]) || '%s');
        else this.#statusFormat.delete(a[0]!);
        return undefined;
      case 'shim_status_update':
        this.#statusUpdate(a[0]!, a[1]!);
        return undefined;
      case 'shim_ctrl_nhwindow':
        return 0;
      default:
        return 0;
    }
  }

  // --- Windows -------------------------------------------------------------

  #create(type: number): number {
    const id = this.#nextWindow++;
    this.#windows.set(id, { type, lines: [], items: [], prompt: '' });
    if (type === NHW.message && !this.#messageWindow) this.#messageWindow = id;
    if (type === NHW.map && !this.#mapWindow) this.#mapWindow = id;
    return id;
  }

  #clear(id: number): void {
    const w = this.#windows.get(id);
    if (!w) return;
    if (w.type === NHW.map) this.#clearMap();
    else if (w.type === NHW.message) this.#turnMessages = [];
    else {
      w.lines = [];
      w.items = [];
    }
  }

  #clearMap(): void {
    for (let i = 0; i < COLS * MAP_ROWS; i++) {
      this.#map[i * 3] = SPACE;
      this.#map[i * 3 + 1] = NO_COLOR;
      this.#map[i * 3 + 2] = -1;
    }
  }

  #putstr(id: number, attr: number, text: string): void {
    const w = this.#windows.get(id);
    if (!w) return;
    if (w.type === NHW.message) this.#addMessage(text);
    else w.lines.push({ text, attr });
  }

  #addMessage(text: string): void {
    if (!text) return;
    this.#turnMessages.push(text);
    this.#history.push(text);
    if (this.#history.length > 500) this.#history.shift();
    this.#host.message(text);
  }

  async #display(id: number, blocking: boolean): Promise<void> {
    const w = this.#windows.get(id);
    if (!w) return;
    if (w.type === NHW.message) {
      // tty shows --More-- when the message window is displayed blocking.
      if (blocking && this.#turnMessages.length > 0) await this.#more();
      return;
    }
    if (w.type === NHW.text || (w.type === NHW.menu && w.lines.length > 0)) {
      await this.#showText(
        w.lines.map((line) => line.text),
        '',
      );
      return;
    }
    this.#emit();
  }

  async #more(): Promise<void> {
    this.#prompt = '--More--';
    await this.#waitKey('more', (key) => key === SPACE || key === ENTER || key === LF || key === ESC);
    this.#prompt = '';
    this.#turnMessages = [];
  }

  async #displayFile(name: string, complain: boolean): Promise<void> {
    const mod = this.#mod;
    const ptr = this.#cString(name);
    const text = mod._ra_file_text(ptr);
    mod._ra_free(ptr);
    if (!text) {
      if (complain) this.#addMessage(`Cannot open "${name}".`);
      return;
    }
    const lines = mod.UTF8ToString(text).replace(/\n$/, '').split('\n');
    mod._ra_free(text);
    await this.#showText(lines, '');
  }

  /** A text window, paged as tty pages it: Space/Enter next page, Esc closes. */
  async #showText(lines: string[], title: string): Promise<void> {
    const height = ROWS - 1;
    const pages = Math.max(1, Math.ceil(lines.length / height));
    for (let page = 0; page < pages;) {
      const slice = lines.slice(page * height, (page + 1) * height);
      this.#menuView = {
        how: PICK.none,
        items: slice.map((text) => ({ key: 0, text, selected: false, heading: false, tile: -1 })),
        page,
        pages,
        title,
      };
      this.#overlay = { lines: slice, footer: pages > 1 ? `--More-- (${page + 1} of ${pages})` : '--End--' };
      const key = await this.#waitKey('text', () => true);
      if (key === ESC) break;
      if (key === '<'.charCodeAt(0) || key === '^'.charCodeAt(0)) page = Math.max(0, page - 1);
      else page++;
    }
    this.#overlay = null;
    this.#menuView = null;
    this.#emit();
  }

  // --- Menus ---------------------------------------------------------------

  #startMenu(id: number): void {
    const w = this.#windows.get(id);
    if (!w) return;
    w.items = [];
    w.lines = [];
    w.prompt = '';
    this.#mod._ra_menu_start(id);
  }

  #addMenu(
    id: number,
    glyphInfo: number,
    identifier: number,
    key: number,
    group: number,
    attr: number,
    color: number,
    text: string,
    flags: number,
  ): void {
    const w = this.#windows.get(id);
    if (!w) return;
    const index = this.#mod._ra_menu_keep(id, identifier);
    const selectable = index >= 0 && this.#mod._ra_menu_selectable(id, index) === 1;
    const glyph = glyphInfo ? this.#mod._ra_gi_glyph(glyphInfo) : -1;
    w.items.push({
      index,
      key: key & 0xff,
      group: group & 0xff,
      attr,
      color,
      text,
      selectable,
      selected: (flags & MENU_ITEMFLAGS_SELECTED) !== 0,
      count: -1,
      tile: glyph >= 0 && glyphInfo ? this.#mod._ra_gi_tile(glyphInfo) : -1,
    });
  }

  /** select_menu(): tty's menu keys; returns how many were chosen, -1 when cancelled. */
  async #selectMenu(id: number, how: number, out: number): Promise<number> {
    const mod = this.#mod;
    mod.setValue(out, 0, '*');
    const w = this.#windows.get(id);
    if (!w) return -1;
    const items = w.items;
    // Keys for selectable items without one, per page, as tty assigns them.
    const height = ROWS - 2;
    const pages = Math.max(1, Math.ceil(items.length / height));
    const keyed = items.map((item) => ({ ...item }));
    for (let p = 0; p < pages; p++) {
      let letter = 0;
      for (const item of keyed.slice(p * height, (p + 1) * height))
        if (item.selectable && !item.key && letter < MENU_LETTERS.length)
          item.key = MENU_LETTERS.charCodeAt(letter++);
    }
    let page = 0;
    let count = 0;
    let result: number | null = null;
    while (result === null) {
      const shown = keyed.slice(page * height, (page + 1) * height);
      this.#menuView = {
        how,
        items: shown.map((item) => ({
          key: item.selectable ? item.key : 0,
          text: item.text,
          selected: item.selected,
          heading: !item.selectable,
          tile: item.tile,
        })),
        page,
        pages,
        title: w.prompt,
      };
      this.#overlay = {
        lines: [
          ...(w.prompt && page === 0 ? [w.prompt] : []),
          ...shown.map((item) =>
            item.selectable
              ? `${String.fromCharCode(item.key || 32)} ${item.selected ? (item.count > 0 ? '#' : '+') : '-'} ${item.text}`
              : item.text,
          ),
        ],
        footer: pages > 1 ? `(${page + 1} of ${pages})` : '(end)',
      };
      const key = await this.#waitKey('menu', () => true);
      if (key === ESC) {
        result = -1;
        break;
      }
      if (how === PICK.none) {
        if (key === '>'.charCodeAt(0) || ((key === SPACE || key === ENTER) && page < pages - 1)) page++;
        else if (key === '<'.charCodeAt(0)) page = Math.max(0, page - 1);
        else result = 0;
        continue;
      }
      if (key >= 48 && key <= 57) {
        count = count * 10 + (key - 48);
        continue;
      }
      if (key === '>'.charCodeAt(0)) {
        page = Math.min(pages - 1, page + 1);
        continue;
      }
      if (key === '<'.charCodeAt(0)) {
        page = Math.max(0, page - 1);
        continue;
      }
      if (key === '^'.charCodeAt(0)) {
        page = 0;
        continue;
      }
      if (key === '|'.charCodeAt(0)) {
        page = pages - 1;
        continue;
      }
      if (key === SPACE && page < pages - 1) {
        page++;
        continue;
      }
      if (key === ENTER || key === LF || key === SPACE) {
        result = keyed.filter((item) => item.selected).length;
        break;
      }
      if (how === PICK.any && (key === '.'.charCodeAt(0) || key === ','.charCodeAt(0))) {
        const scope = key === '.'.charCodeAt(0) ? keyed : shown;
        for (const item of scope) if (item.selectable) item.selected = true;
        continue;
      }
      if (how === PICK.any && (key === '-'.charCodeAt(0) || key === '\\'.charCodeAt(0))) {
        const scope = key === '-'.charCodeAt(0) ? keyed : shown;
        for (const item of scope) item.selected = false;
        continue;
      }
      // An item's key (on this page first), or a group key (all items of the group).
      const own = shown.find((item) => item.selectable && item.key === key);
      const targets = own ? [own] : keyed.filter((item) => item.selectable && item.group === key);
      if (targets.length === 0) {
        count = 0;
        continue;
      }
      if (how === PICK.one) {
        for (const item of keyed) item.selected = false;
        targets[0]!.selected = true;
        targets[0]!.count = count > 0 ? count : -1;
        result = 1;
        break;
      }
      for (const item of targets) {
        item.selected = count > 0 ? true : !item.selected;
        item.count = count > 0 ? count : -1;
      }
      count = 0;
    }
    this.#overlay = null;
    this.#menuView = null;
    if (result === null || result <= 0) {
      this.#emit();
      return result ?? -1;
    }
    const chosen = keyed.filter((item) => item.selected);
    const indices = mod._malloc(chosen.length * 4);
    const counts = mod._malloc(chosen.length * 4);
    chosen.forEach((item, i) => {
      mod.setValue(indices + i * 4, item.index, 'i32');
      mod.setValue(counts + i * 4, item.count, 'i32');
    });
    const n = mod._ra_menu_select(id, out, indices, counts, chosen.length);
    mod._ra_free(indices);
    mod._ra_free(counts);
    this.#emit();
    return n;
  }

  // --- The map -------------------------------------------------------------

  #printGlyph(x: number, y: number, info: number, _background: number): void {
    const col = x - 1;
    if (col < 0 || col >= COLS || y < 0 || y >= MAP_ROWS) return;
    const mod = this.#mod;
    const i = (y * COLS + col) * 3;
    const flags = mod._ra_gi_flags(info);
    let color = mod._ra_gi_color(info);
    if (color < 0 || color > 15) color = NO_COLOR;
    // Pets and detected monsters are highlighted, as tty's hilite_pet does.
    if (flags & (0x10 | 0x08)) color += INVERSE;
    this.#map[i] = mod._ra_gi_char(info) & 0xff;
    this.#map[i + 1] = color;
    this.#map[i + 2] = mod._ra_gi_tile(info);
  }

  // --- Input ---------------------------------------------------------------

  async #getKey(context: NhContext): Promise<number> {
    return this.#waitKey(context, () => true);
  }

  /** Waits for a key accepted by `accept`; clicks are ignored here. */
  async #waitKey(context: NhContext, accept: (key: number) => boolean): Promise<number> {
    for (;;) {
      this.#context = context;
      this.#emit();
      const input = await this.#host.nextInput();
      if (!('key' in input)) continue;
      if (context === 'map') this.#turnMessages = [];
      if (accept(input.key)) return input.key;
    }
  }

  /** nh_poskey(): a key, or a click on the map (0, with its cell and button). */
  async #posKey(xPtr: number, yPtr: number, modPtr: number): Promise<number> {
    this.#context = 'map';
    this.#emit();
    const input = await this.#host.nextInput();
    this.#turnMessages = [];
    if ('key' in input) return input.key;
    const { x, y, button } = input.click;
    this.#mod.setValue(xPtr, x + 1, 'i16');
    this.#mod.setValue(yPtr, y - MAP_TOP, 'i16');
    this.#mod.setValue(modPtr, button === 2 ? 2 : 1, 'i32');
    return 0;
  }

  async #previousMessages(): Promise<number> {
    await this.#showText(this.#history.slice(-ROWS * 4), 'Messages');
    return 0;
  }

  /** yn_function(): tty's rules for the answer. */
  async #yn(query: string, choices: string, defaultChar: number): Promise<number> {
    const visible = choices.split('\u001b')[0] ?? '';
    const context = promptContext(query, visible);
    this.#prompt = visible
      ? `${query} [${visible}]${defaultChar ? ` (${String.fromCharCode(defaultChar)})` : ''}`
      : query;
    let answer: number;
    for (;;) {
      const key = await this.#waitKey(context, () => true);
      if (!choices) {
        answer = key;
        break;
      }
      if (key === ESC) {
        answer = choices.includes('q') ? 113 : choices.includes('n') ? 110 : defaultChar || ESC;
        break;
      }
      if ((key === ENTER || key === LF || key === SPACE) && defaultChar) {
        answer = defaultChar;
        break;
      }
      const char = String.fromCharCode(key);
      if (choices.includes(char)) {
        answer = key;
        break;
      }
      if (choices.includes(char.toLowerCase())) {
        answer = char.toLowerCase().charCodeAt(0);
        break;
      }
    }
    this.#prompt = '';
    this.#addPromptAnswer(query, answer);
    return answer > 127 ? ESC : answer;
  }

  #addPromptAnswer(query: string, answer: number): void {
    if (answer === ESC || answer < 32) return;
    this.#turnMessages = [`${query} ${String.fromCharCode(answer)}`];
  }

  /** A line of text typed on the message line; Esc gives "\033", as tty's getlin. */
  async #readLine(query: string, context: NhContext): Promise<string | null> {
    let text = '';
    for (;;) {
      this.#prompt = `${query} ${text}`;
      const key = await this.#waitKey(context, () => true);
      if (key === ESC) {
        this.#prompt = '';
        return null;
      }
      if (key === ENTER || key === LF) break;
      if (key === BACKSPACE || key === DEL) text = text.slice(0, -1);
      else if (key >= 32 && key < 127 && text.length < 255) text += String.fromCharCode(key);
    }
    this.#prompt = '';
    return text;
  }

  async #getlin(query: string, buffer: number): Promise<void> {
    const text = await this.#readLine(query, 'getlin');
    this.#mod.stringToUTF8(text === null ? '\u001b' : text, buffer, 256);
  }

  async #extCmd(): Promise<number> {
    const text = await this.#readLine('#', 'extcmd');
    if (text === null || !text.trim()) return -1;
    const ptr = this.#cString(text.trim());
    const index = this.#mod._ra_ext_cmd_index(ptr);
    this.#mod._ra_free(ptr);
    if (index < 0) this.#addMessage(`#${text.trim()}: unknown extended command.`);
    return index;
  }

  async #askname(): Promise<void> {
    const text = (await this.#readLine('Who are you?', 'getlin')) ?? '';
    const ptr = this.#cString(text.trim().slice(0, 30) || 'Adventurer');
    this.#mod._ra_set_plname(ptr);
    this.#mod._ra_free(ptr);
  }

  // --- Status --------------------------------------------------------------

  #statusUpdate(field: number, ptr: number): void {
    const mod = this.#mod;
    if (field === BL.flush || field === BL.reset) {
      this.#emit();
      return;
    }
    let value = '';
    if (field === BL.condition) {
      const mask = ptr ? mod.getValue(ptr, 'i32') >>> 0 : 0;
      const out = mod._malloc(256);
      mod._ra_conditions(mask, out, 256);
      value = mod.UTF8ToString(out);
      mod._ra_free(out);
    } else if (ptr) value = decode(mod.UTF8ToString(ptr));
    this.#status.set(field, value);
  }

  statusLines(): [string, string] {
    const line = (fields: readonly number[]) =>
      fields
        .map((field) => {
          const format = this.#statusFormat.get(field) ?? STATUS_FORMATS[field];
          const value = this.#status.get(field);
          if (format === undefined || value === undefined || value === '') return '';
          if (field === BL.condition) return value;
          return format.replace(/%[-0-9.]*s/, value);
        })
        .join('');
    return [line(STATUS_ORDER[0]!), line(STATUS_ORDER[1]!)];
  }

  // --- The screen ----------------------------------------------------------

  #overlay: { lines: string[]; footer: string } | null = null;
  #overlayRect: NhFrame['overlay'] = null;

  #put(x: number, y: number, text: string, color = GRAY): void {
    for (let i = 0; i < text.length && x + i < COLS; i++) {
      if (x + i < 0) continue;
      const cell = (y * COLS + x + i) * 2;
      const code = text.charCodeAt(i);
      this.cells[cell] = code < 256 ? code : 63;
      this.cells[cell + 1] = color;
    }
  }

  #compose(): void {
    const { cells, tiles } = this;
    for (let i = 0; i < COLS * ROWS; i++) {
      cells[i * 2] = SPACE;
      cells[i * 2 + 1] = GRAY;
    }
    tiles.fill(0xffff);
    for (let y = 0; y < MAP_ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const m = (y * COLS + x) * 3;
        const cell = ((y + MAP_TOP) * COLS + x) * 2;
        cells[cell] = this.#map[m]!;
        const color = this.#map[m + 1]!;
        cells[cell + 1] = color % INVERSE === NO_COLOR ? GRAY + (color >= INVERSE ? INVERSE : 0) : color;
        const tile = this.#map[m + 2]!;
        tiles[(y + MAP_TOP) * COLS + x] = tile >= 0 ? tile : 0xffff;
      }
    // The message line: the prompt, or this turn's messages (the latest that fit).
    let top = this.#prompt;
    if (!top) {
      const shown: string[] = [];
      for (let i = this.#turnMessages.length - 1; i >= 0; i--) {
        const next = [this.#turnMessages[i]!, ...shown].join('  ');
        if (next.length > COLS && shown.length) break;
        shown.unshift(this.#turnMessages[i]!);
      }
      top = shown.join('  ');
    }
    this.#put(0, 0, top.slice(0, COLS));
    const [one, two] = this.statusLines();
    this.#put(0, STATUS_TOP, one.slice(0, COLS));
    this.#put(0, STATUS_TOP + 1, two.slice(0, COLS));
    // A menu or text window over the map, right-aligned as tty draws it
    // (from column 0 when it is wide).
    this.under.set(cells);
    const overlay = this.#overlay;
    this.#overlayRect = null;
    if (overlay) {
      const lines = [...overlay.lines, overlay.footer];
      const width = Math.min(COLS, Math.max(...lines.map((text) => text.length)) + 1);
      const left = width > COLS - 10 ? 0 : COLS - width;
      for (let y = 0; y < Math.min(lines.length, ROWS); y++) {
        for (let x = left; x < COLS; x++) {
          const cell = (y * COLS + x) * 2;
          cells[cell] = SPACE;
          cells[cell + 1] = GRAY;
          tiles[y * COLS + x] = 0xffff;
        }
        this.#put(
          left + 1,
          y,
          lines[y]!.slice(0, COLS - left - 1),
          y === lines.length - 1 ? INVERSE + GRAY : GRAY,
        );
      }
      this.#overlayRect = { x: left, y: 0, width: COLS - left, height: Math.min(lines.length, ROWS) };
    }
  }

  #emit(): void {
    this.#compose();
    const mod = this.#mod;
    if (!this.#stateFields) this.#stateFields = mod._ra_state_fields();
    const ptr = mod._ra_state();
    const state = new Int32Array(this.#stateFields);
    for (let i = 0; i < this.#stateFields; i++) state[i] = mod.getValue(ptr + i * 4, 'i32');
    // Waiting for a key on the map while getpos runs: choosing a position.
    const context = this.#context === 'map' && state[GETPOS_FIELD] === 1 ? 'position' : this.#context;
    this.#host.frame({
      cells: this.cells,
      under: this.under,
      tiles: this.tiles,
      cursor: { ...this.#cursor, visible: this.#context === 'map' && !this.#overlay },
      context,
      prompt: this.#prompt,
      menu: this.#menuView,
      state,
      messages: [...this.#turnMessages],
      overlay: this.#overlayRect,
    });
  }

  #cString(text: string): number {
    const bytes = new TextEncoder().encode(text);
    const ptr = this.#mod._malloc(bytes.length + 1);
    this.#mod.stringToUTF8(text, ptr, bytes.length + 1);
    return ptr;
  }
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the shell needs to know about the game, followed from the same
 * WebTiles messages the client renders (read only; nothing is sent back):
 * the player's status for the phone status band, and what the game is waiting
 * for (moving on the map, a menu, a --more-- prompt, targeting...) so the touch
 * controls can offer the right actions.
 */
import type { DcssContext } from './input.ts';
import { plainText } from './messages.ts';

/** upstream enums.js mouse_mode (input_mode messages). */
export const InputMode = {
  NORMAL: 0,
  COMMAND: 1,
  TARGET: 2,
  TARGET_DIR: 3,
  TARGET_PATH: 4,
  MORE: 5,
  MACRO: 6,
  PROMPT: 7,
  YESNO: 8,
} as const;

/** upstream enums.js ui (ui_state messages). */
export const UiState = { NORMAL: 0, CRT: 1, VIEW_MAP: 2 } as const;

export interface StatusLight {
  light: string;
  text: string;
  col?: number;
}

/** The "player" message fields the shell shows. The game sends only changes. */
export interface PlayerState {
  name: string;
  species: string;
  title: string;
  god: string;
  hp: number;
  hp_max: number;
  mp: number;
  mp_max: number;
  xl: number;
  place: string;
  depth: number;
  turn: number;
  time: number;
  gold: number;
  status: StatusLight[];
  /** The quivered action, as a formatted string ("Throw: 3 darts"). */
  quiver_desc: string;
}

/** upstream menu.h MenuFlag (enums.js menu_flag). */
export const MenuFlag = { MULTISELECT: 0x0004 } as const;

/** An open menu (the "menu" message): its tag, flags and what the dock needs to know. */
export interface MenuInfo {
  tag: string;
  flags: number;
  /** A yes/no menu that offers "Always" (prompt.cc yesno() with ask_always). */
  always: boolean;
  /** The keys the menu's key help lists (item menus: describe, modes). */
  keys?: MenuKeyHelp;
}

/**
 * What an item menu's key help (its "more" line, item-use.cc
 * UseItemMenu::get_keyhelp) offers: "[?] describe selected", "[!] equip|wield|wear"
 * (the current mode in white) and "[tab] equip|unequip".
 */
export interface MenuKeyHelp {
  describe: boolean;
  /** The mode `!` switches to, or null. */
  nextMode: string | null;
  /** The mode Tab switches to (equip or unequip), or null. */
  nextEquip: string | null;
}

/** The modes listed after a key in the key help, and the one after the current (white) one. */
function nextListed(more: string, key: string): string | null {
  const tag = '(?:<[a-z]+>)*';
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\[${tag}${escaped}${tag}\\]\\s*(.*?)(?=\\s{2,}|\\n|$)`, 'i').exec(more);
  if (!match) return null;
  const modes = match[1]!.split('|');
  if (modes.length < 2) return null;
  const current = modes.findIndex((mode) => /<white>/i.test(mode));
  const next = modes[(current + 1) % modes.length]!;
  return plainText(next).trim() || null;
}

export function menuKeyHelp(more: unknown): MenuKeyHelp {
  const text = typeof more === 'string' ? more : '';
  return {
    describe: /\[(?:<[a-z]+>)*\?(?:<[a-z]+>)*\]\s*describe/i.test(text),
    nextMode: nextListed(text, '!'),
    nextEquip: nextListed(text, 'tab'),
  };
}

/** What the player stands on, when it is something to use with `<` or `>`. */
export type Underfoot = 'down' | 'up' | 'branch' | 'portal' | 'exit' | 'altar' | 'shop';

/**
 * What the client host reads from the WebTiles client's own map knowledge
 * (client-host/host.js, the way upstream's monster_list.js reads it).
 */
export interface MapContext {
  /** Hostile monsters in view, counted as upstream's monster list counts them. */
  hostiles: number;
  /** Hostile monsters next to the player. */
  adjacent: number;
  /** Highest threat among them (0 trivial … 3 nasty), -1 for none. */
  maxThreat: number;
  underfoot: Underfoot | null;
}

export const NO_MAP_CONTEXT: MapContext = { hostiles: 0, adjacent: 0, maxThreat: -1, underfoot: null };

/**
 * Inside a portal vault (a Sewer, an Ossuary, a Ziggurat...), the only
 * portal is the way out. The game names one-level portal branches with an
 * article (tileweb.cc); a ziggurat is "Zig".
 */
export function inPortalVault(place: string | undefined): boolean {
  return !!place && (/^an? /.test(place) || place === 'Zig');
}

/** What is underfoot, telling a portal vault's exit (often drawn as its entrance) from a portal. */
export function underfootHere(map: MapContext, place: string | undefined): Underfoot | null {
  return map.underfoot === 'portal' && inPortalVault(place) ? 'exit' : map.underfoot;
}

/** "Increase (S)trength, (I)ntelligence, or (D)exterity?" (player-stats.cc attribute_increase). */
const STAT_PROMPT = /Increase \(S\)trength, \(I\)ntelligence, or \(D\)exterity\?/i;
/** Casting or listing spells with none memorised (MSG_NO_SPELLS). */
const NO_SPELLS = "You don't know any spells.";

export interface WebTilesMessage {
  msg: string;
  [field: string]: unknown;
}

/** Splits the game's output (JSON text lines, often "multi" batches) into messages. */
export function parseLines(lines: readonly string[]): WebTilesMessage[] {
  const out: WebTilesMessage[] = [];
  const add = (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const record = message as { msg?: unknown; msgs?: unknown };
    if (Array.isArray(record.msgs)) record.msgs.forEach(add);
    else if (typeof record.msg === 'string') out.push(record as WebTilesMessage);
  };
  for (const line of lines) {
    try {
      add(JSON.parse(line));
    } catch {
      // The client reports malformed messages itself.
    }
  }
  return out;
}

export class GameTracker {
  player: Partial<PlayerState> = {};
  inputMode: number = InputMode.NORMAL;
  uiState: number = UiState.NORMAL;
  layer = '';
  /** Open popups (ui-push), by type, innermost last. */
  popups: string[] = [];
  /** Open menus (menu / close_menu), innermost last. */
  menuStack: MenuInfo[] = [];
  /** A text field the game asked for (init_input / close_input). */
  textInput = false;
  more = false;
  /** Whether a character exists (the game has drawn the map at least once). */
  inGame = false;
  /** The stat increase question was asked and the game is still in that prompt. */
  #statAsked = false;
  /**
   * Whether the character has spells. DCSS only tells inside its menus: true
   * once the spell menu has opened, false once it said "You don't know any
   * spells."; null until then.
   */
  caster: boolean | null = null;

  /** Tags of the open menus, innermost last. */
  get menus(): string[] {
    return this.menuStack.map((menu) => menu.tag);
  }

  /** The innermost open menu. */
  get menu(): MenuInfo | null {
    return this.menuStack[this.menuStack.length - 1] ?? null;
  }

  /** The stat increase prompt is waiting for S, I or D (the question is a message). */
  get statPrompt(): boolean {
    return this.inputMode === InputMode.PROMPT && this.#statAsked;
  }

  /** Carrying the Orb of Zot: its status light (status.cc STATUS_ORB, light magenta). */
  get orb(): boolean {
    return (this.player.status ?? []).some((status) => status.light === 'Orb' && status.col === 13);
  }

  /** Zot is approaching: "Zot (n)" in any colour but white (status.cc _describe_zot). */
  get zotLow(): boolean {
    return (this.player.status ?? []).some(
      (status) => /^Zot\b/.test(status.light ?? '') && status.col !== undefined && status.col !== 15,
    );
  }

  reset(): void {
    this.player = {};
    this.inputMode = InputMode.NORMAL;
    this.uiState = UiState.NORMAL;
    this.layer = '';
    this.popups = [];
    this.menuStack = [];
    this.textInput = false;
    this.more = false;
    this.inGame = false;
    this.#statAsked = false;
    this.caster = null;
  }

  /** Applies one message; returns true if anything the shell shows may have changed. */
  apply(message: WebTilesMessage): boolean {
    switch (message.msg) {
      case 'player':
        Object.assign(this.player, message);
        return true;
      case 'input_mode': {
        const mode = Number(message.mode);
        // The question is asked before the game enters its prompt; it is
        // answered once the game leaves it.
        if (this.inputMode === InputMode.PROMPT && mode !== InputMode.PROMPT) this.#statAsked = false;
        this.inputMode = mode;
        return true;
      }
      case 'ui_state':
        this.uiState = Number(message.state);
        return true;
      case 'layer':
        this.layer = String(message.layer);
        return true;
      case 'map':
        if (!this.inGame) {
          this.inGame = true;
          return true;
        }
        return false;
      case 'ui-push':
        this.popups.push(String(message.type ?? 'popup'));
        return true;
      case 'ui-pop':
        this.popups.pop();
        return true;
      case 'menu': {
        const menu = menuInfo(message);
        // "replace" swaps the innermost menu (upstream menu.js open_menu).
        if (message.replace) this.menuStack.pop();
        this.menuStack.push(menu);
        if (menu.tag === 'spell') this.caster = true;
        return true;
      }
      case 'update_menu': {
        // A mode switch in an item menu rewrites its key help.
        const top = this.menuStack[this.menuStack.length - 1];
        if (!top || typeof message.more !== 'string') return false;
        this.menuStack[this.menuStack.length - 1] = { ...top, keys: menuKeyHelp(message.more) };
        return true;
      }
      case 'close_menu':
        this.menuStack.pop();
        return true;
      case 'close_all_menus':
        this.menuStack = [];
        return true;
      case 'init_input':
        this.textInput = true;
        return true;
      case 'close_input':
        this.textInput = false;
        return true;
      case 'msgs': {
        let changed = false;
        const messages = Array.isArray(message.messages) ? (message.messages as { text?: unknown }[]) : [];
        for (const entry of messages) {
          if (typeof entry?.text !== 'string') continue;
          const text = plainText(entry.text);
          if (STAT_PROMPT.test(text)) this.#statAsked = changed = true;
          if (text.includes(NO_SPELLS)) {
            this.caster = false;
            changed = true;
          }
        }
        if ('more' in message) {
          this.more = !!message.more;
          changed = true;
        }
        return changed;
      }
      default:
        return false;
    }
  }

  context(): DcssContext {
    const top = this.popups[this.popups.length - 1];
    if (top === 'newgame-choice' || top === 'game-menu' || top === 'seed-selection') return 'start';
    if (top === 'msgwin-get-line') return 'text';
    if (top) return 'popup';
    // Yes/no questions are small menus tagged "prompt" (prompt.cc yesno()).
    if (this.menu?.tag === 'prompt') return 'yesno';
    if (this.menu) return 'menu';
    if (this.textInput) return 'text';
    switch (this.inputMode) {
      case InputMode.MORE:
        return 'more';
      case InputMode.YESNO:
        return 'yesno';
      case InputMode.PROMPT:
        return 'prompt';
      // directn.cc: a path when firing or casting at a target, none when
      // looking (or for spot-targeted effects); target-compass.cc: a direction.
      case InputMode.TARGET_PATH:
        return 'aim';
      case InputMode.TARGET:
        return 'look';
      case InputMode.TARGET_DIR:
        return 'direction';
      default:
        break;
    }
    if (this.more) return 'more';
    if (this.uiState === UiState.VIEW_MAP) return 'level-map';
    if (this.layer === 'crt' || this.uiState === UiState.CRT) return this.inGame ? 'popup' : 'start';
    if (!this.inGame) return 'loading';
    if (this.inputMode === InputMode.COMMAND) return 'map';
    return 'busy';
  }
}

function menuInfo(message: WebTilesMessage): MenuInfo {
  const items = Array.isArray(message.items) ? (message.items as { hotkeys?: unknown }[]) : [];
  return {
    tag: String(message.tag ?? 'menu'),
    flags: Number(message.flags ?? 0),
    // Its first hotkey is the item's key (menu.cc webtiles_write_item).
    always: items.some((item) => Array.isArray(item?.hotkeys) && item.hotkeys[0] === 'A'.charCodeAt(0)),
    keys: menuKeyHelp(message.more),
  };
}

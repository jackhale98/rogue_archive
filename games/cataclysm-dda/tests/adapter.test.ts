// SPDX-License-Identifier: CC-BY-SA-3.0
import { describe, expect, it } from 'vitest';
import { SHELL_COMMAND } from '@rogue-archive/game-api';
import {
  CDDA_COMMANDS,
  MENU_PAD,
  PAD,
  PALETTE,
  controlsFor,
  findCommand,
  strokeFor,
  strokeForBinding,
} from '../adapter/input.ts';
import { detectContext, parseState, type CddaState } from '../adapter/state.ts';
import { stripTags } from '../adapter/index.ts';

const base: CddaState = {
  context: '',
  contexts: [],
  registers: [],
  waiting: false,
  rawWait: false,
  waits: 0,
  inGame: false,
  mainMenu: false,
  termX: 80,
  termY: 24,
  cellW: 8,
  cellH: 16,
  imgui: [],
};
const state = (over: Partial<CddaState>): CddaState => ({ ...base, ...over });

describe('Cataclysm: DDA key strokes', () => {
  it('sends letters with the legacy keyCode and the character', () => {
    expect(strokeFor('a')).toMatchObject({ keyCode: 65, charCode: 97, shift: false });
    expect(strokeFor('E')).toMatchObject({ keyCode: 69, charCode: 69, shift: true });
  });

  it('marks shifted punctuation and digits as shifted', () => {
    expect(strokeFor('&')).toMatchObject({ keyCode: 55, charCode: 38, shift: true });
    expect(strokeFor('>')).toMatchObject({ keyCode: 190, charCode: 62, shift: true });
    expect(strokeFor(';')).toMatchObject({ keyCode: 186, charCode: 59, shift: false });
  });

  it('names keys as keybindings.json does', () => {
    expect(strokeForBinding('RETURN')).toMatchObject({ key: 'Enter', keyCode: 13 });
    expect(strokeForBinding('ESC')).toMatchObject({ key: 'Escape', keyCode: 27, charCode: 0 });
    expect(strokeForBinding('BACKTAB')).toMatchObject({ key: 'Tab', shift: true });
    expect(strokeForBinding('KEYPAD_8')).toMatchObject({ code: 'Numpad8', keyCode: 104 });
    expect(strokeForBinding('KEYPAD_DIVIDE')).toMatchObject({ code: 'NumpadDivide', keyCode: 111 });
    expect(strokeForBinding('F3')).toMatchObject({ keyCode: 114, charCode: 0 });
    expect(strokeForBinding('CTRL+U')).toMatchObject({ key: 'u', ctrl: true, charCode: 0 });
    expect(strokeForBinding('a', ['ctrl'])).toMatchObject({ ctrl: true, charCode: 0 });
    expect(strokeForBinding('NOT_A_KEY')).toBeNull();
  });

  it('types any character as text', () => {
    expect(strokeFor('é')).toMatchObject({ keyCode: 0, charCode: 0xe9 });
  });
});

describe('Cataclysm: DDA commands', () => {
  it('have unique ids and one key each', () => {
    const ids = CDDA_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of CDDA_COMMANDS) expect(command.keys).toHaveLength(1);
  });

  it('show the original key', () => {
    expect(findCommand('inventory')?.shortcut).toBe('i');
    expect(findCommand('action_menu')?.shortcut).toBe('Enter');
    expect(findCommand('craft')?.shortcut).toBe('&');
  });

  it('pad sends the vi keys, waiting in the centre', () => {
    expect(findCommand(PAD.n)?.keys[0]?.key).toBe('k');
    expect(findCommand(PAD.se)?.keys[0]?.key).toBe('n');
    expect(findCommand(PAD.center!)?.keys[0]?.key).toBe('.');
    expect(PALETTE).not.toContain('UP');
    expect(PALETTE).toContain('craft');
  });
});

describe('Cataclysm: DDA contexts', () => {
  it('tells the map from a direction prompt', () => {
    const map = state({
      inGame: true,
      waiting: true,
      context: 'DEFAULTMODE',
      registers: ['inventory', 'look'],
    });
    expect(detectContext(map)).toBe('map');
    expect(detectContext({ ...map, registers: ['QUIT', 'CONFIRM'] })).toBe('direction');
  });

  it('knows the title, menus, typing, loading and busy', () => {
    expect(detectContext(null)).toBe('loading');
    expect(detectContext(base)).toBe('loading');
    expect(detectContext(state({ mainMenu: true, waiting: true, context: 'MAIN_MENU' }))).toBe('title');
    expect(detectContext(state({ inGame: true, waiting: true, context: 'INVENTORY' }))).toBe('menu');
    expect(detectContext(state({ inGame: true, waiting: true, context: 'STRING_INPUT' }))).toBe('text');
    expect(detectContext(state({ inGame: true }))).toBe('busy');
  });

  it('parses the snapshot', () => {
    expect(parseState('{"context":"UILIST"}')?.context).toBe('UILIST');
    expect(parseState('not json')).toBeNull();
  });

  it('placeholder docks: pad on the map, More and the keyboard everywhere', () => {
    const map = controlsFor('map');
    expect(map.directionPad).toEqual(PAD);
    const commands = (layout: ReturnType<typeof controlsFor>) =>
      layout.actions.map((action) => (typeof action === 'string' ? action : action.command));
    expect(commands(map)).toEqual([
      'inventory',
      'look',
      'action_menu',
      SHELL_COMMAND.palette,
      SHELL_COMMAND.keyboard,
    ]);
    expect(controlsFor('direction').directionPad).toEqual(PAD);
    expect(commands(controlsFor('busy'))).toEqual([SHELL_COMMAND.palette, SHELL_COMMAND.keyboard]);
  });

  it('start screens and menus by touch: Play Now!, yes/no, creation tabs, arrows', () => {
    const commands = (layout: ReturnType<typeof controlsFor>) =>
      layout.actions.map((action) => (typeof action === 'string' ? action : action.command));
    const title = controlsFor('title', 'MAIN_MENU');
    expect(title.reading).toBe(true);
    expect(commands(title).at(-1)).toBe('ra:play-now');
    expect(title.directionPad).toEqual(MENU_PAD);
    // Play Now!: New Game, then its sub-menu's default scenario.
    expect(findCommand('ra:play-now')!.keys.map((key) => key.key)).toEqual(['n', 'd']);
    // Menus move with the arrow keys, not the vi letters (entry hotkeys there).
    expect(findCommand(MENU_PAD.n)!.keys[0]!.key).toBe('ArrowUp');
    expect(commands(controlsFor('menu', 'UILIST'))).toEqual([
      'QUIT',
      SHELL_COMMAND.palette,
      SHELL_COMMAND.keyboard,
      'CONFIRM',
    ]);
    // Yes/no: a capital Y (FORCE_CAPITAL_YN is on by default).
    expect(commands(controlsFor('menu', 'YESNO'))).toEqual(['ra:no', 'ra:yes']);
    expect(findCommand('ra:yes')!.keys[0]!.key).toBe('Y');
    expect(commands(controlsFor('menu', 'NEW_CHAR_STATS')).slice(0, 2)).toEqual(['PREV_TAB', 'NEXT_TAB']);
    expect(commands(controlsFor('menu', 'NEW_CHAR_DESCRIPTION')).at(-1)).toBe('ra:finish');
    // The helpers stay out of the command list (held to upstream's bindings).
    expect(CDDA_COMMANDS.some((command) => command.id.startsWith('ra:'))).toBe(false);
  });
});

describe('Cataclysm: DDA messages', () => {
  it('drop colour tags', () => {
    expect(stripTags('You hear a <color_red>loud</color> noise. <good>Yes</good>')).toBe(
      'You hear a loud noise. Yes',
    );
  });
});

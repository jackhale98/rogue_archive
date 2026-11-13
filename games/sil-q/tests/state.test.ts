import { describe, expect, it } from 'vitest';
import type { Grid } from '@rogue-archive/term-view';
import type { TouchAction } from '@rogue-archive/game-api';
import { CHOOSE, controlsFor, keyToSil, LOAD, SIL_COMMANDS } from '../adapter/input.ts';
import {
  detectContext,
  isLoadPrompt,
  itemPrompt,
  mapOverlay,
  parseState,
  playerCell,
  screenChoices,
} from '../adapter/state.ts';

const actions = (layout: { actions: (string | TouchAction)[] }): TouchAction[] =>
  layout.actions.map((action) => (typeof action === 'string' ? { command: action } : action));

function grid(lines: string[], cursor?: Grid['cursor']): Grid {
  const cols = 80;
  const rows = 24;
  const cells = new Uint8Array(cols * rows * 2);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      cells[(y * cols + x) * 2] = (lines[y]?.[x] ?? ' ').charCodeAt(0);
      cells[(y * cols + x) * 2 + 1] = 1;
    }
  return { cols, rows, cells, cursor };
}

const state = (fields: Partial<Record<number, number>>) => {
  const raw = new Int32Array(12);
  for (const [i, v] of Object.entries(fields)) raw[Number(i)] = v!;
  return parseState(raw);
};
const inDungeon = state({ 0: 1, 1: 20, 2: 28, 5: 1, 6: 40, 7: 10, 8: 0, 9: 0, 11: 1 });

// Screens as the game draws them (from the conformance harness's output).
const TITLE = grid([
  '',
  ...Array(18).fill(''),
  '                    a) Tutorial',
  '                    b) New character',
  '                    c) Open saved character',
  '                    d) Quit',
]);
const MAP = [
  '',
  'nameless',
  '',
  'Str        0',
  "Dex        2                                   #+#%%%'#",
  'Con        2                                   #......#',
  'Gra        2                                   #..@...#',
];

describe('Sil-Q state', () => {
  it('parses the snapshot and finds the player on screen', () => {
    expect(inDungeon).toMatchObject({ inDungeon: true, hp: 20, maxHp: 28, depth: 1, waiting: true });
    expect(playerCell(inDungeon)).toEqual({ x: 53, y: 11 });
    expect(playerCell(state({}))).toBeNull();
  });

  it('reads lettered choices', () => {
    expect(screenChoices(TITLE)).toEqual([
      { key: 'a', label: 'Tutorial' },
      { key: 'b', label: 'New character' },
      { key: 'c', label: 'Open saved character' },
      { key: 'd', label: 'Quit' },
    ]);
  });

  it('reads item prompts', () => {
    expect(itemPrompt('(Inven: a-b, * to see, / for Equip, ESC) Drop which item?')).toEqual({
      letters: ['a', 'b'],
      canShow: true,
      switchTo: 'Equip',
      floor: false,
    });
    expect(itemPrompt('You see nothing.')).toBeNull();
  });

  it('tells what the game is waiting for', () => {
    const waitingTitle = state({ 11: 1 });
    expect(detectContext(TITLE, state({}))).toBe('busy');
    expect(detectContext(TITLE, waitingTitle)).toBe('title');
    expect(detectContext(grid(MAP), inDungeon)).toBe('map');
    const top = (text: string, cursor?: Grid['cursor']) =>
      detectContext(grid([text, ...MAP.slice(1)], cursor), inDungeon);
    expect(top('The Orc skirmisher hits you. -more-')).toBe('more');
    expect(top('Are you sure you want to step on the trap? [y/n]')).toBe('yesno');
    expect(top("Direction ('f' for closest, '*' to choose a target, ESC to cancel)? ")).toBe('direction');
    expect(top('You are on an open floor  [(t)arget, (m)anual, <dir>]')).toBe('targeting');
    expect(top('(Inven: a-a, * to see, ESC) Eat which item?')).toBe('item');
    expect(top('Inscription: ', { x: 13, y: 0, visible: true })).toBe('text');
    const list = grid([
      '(Inven: a-b, * to see, ESC) Eat which item?',
      'nameless                       a) 3 Fragments of Lembas',
      '                               b) 2 Wooden Torches (2000 turns)',
    ]);
    // The list, its "a) " labels included.
    expect(mapOverlay(list)).toMatchObject({ x: 30, y: 1, height: 2 });
  });
});

describe('Sil-Q keys and docks', () => {
  const none = { shift: false, ctrl: false, alt: false, meta: false };
  it('maps keys to what Sil reads', () => {
    expect(keyToSil({ type: 'key', key: 'ArrowUp', code: 'ArrowUp', modifiers: none })).toEqual([56]);
    expect(
      keyToSil({ type: 'key', key: 'ArrowUp', code: 'ArrowUp', modifiers: { ...none, shift: true } }),
    ).toEqual([46, 56]);
    expect(keyToSil({ type: 'key', key: '4', code: 'Numpad4', modifiers: none })).toEqual([52]);
    expect(keyToSil({ type: 'key', key: 'Escape', code: 'Escape', modifiers: none })).toEqual([27]);
    expect(keyToSil({ type: 'key', key: 's', code: 'KeyS', modifiers: { ...none, ctrl: true } })).toEqual([
      19,
    ]);
    expect(keyToSil({ type: 'key', key: 'Shift', code: 'ShiftLeft', modifiers: none })).toBeNull();
  });

  it('has unique command ids, and every dock action is a command or a choice', () => {
    const ids = new Set(SIL_COMMANDS.map((command) => command.id));
    expect(ids.size).toBe(SIL_COMMANDS.length);
    const choices = [{ key: 'a', label: 'Tutorial' }];
    for (const context of [
      'title',
      'load',
      'map',
      'more',
      'yesno',
      'direction',
      'targeting',
      'item',
      'menu',
      'text',
      'busy',
    ] as const) {
      const layout = controlsFor(
        context,
        { hp: 10, maxHp: 28, run: false },
        choices,
        {
          canShow: true,
          switchTo: 'Equip',
          floor: true,
        },
        ['Thorin'],
      );
      for (const action of actions(layout)) {
        const known =
          ids.has(action.command) ||
          action.command.startsWith(CHOOSE) ||
          action.command.startsWith(LOAD) ||
          action.command.startsWith('shell:');
        expect(known, `${context}: ${action.command}`).toBe(true);
        for (const alternate of action.alternates ?? []) expect(ids.has(alternate), alternate).toBe(true);
      }
    }
  });

  it('offers item letters before the list is shown, and names once it is', () => {
    const before = controlsFor('item', { hp: 1, maxHp: 1, run: false }, [{ key: 'a', label: '' }], {
      canShow: true,
      switchTo: null,
      floor: false,
    });
    expect(actions(before).map((action) => action.label ?? action.command)).toEqual([
      'a',
      'Show items',
      'Cancel',
    ]);
    const after = controlsFor(
      'item',
      { hp: 1, maxHp: 1, run: false },
      [{ key: 'a', label: '3 Fragments of Lembas' }],
      {
        canShow: true,
        switchTo: null,
        floor: false,
      },
    );
    expect(actions(after).map((action) => action.label ?? action.command)).toEqual([
      'a) 3 Fragments of Lembas',
      'Cancel',
    ]);
  });

  it('offers saved characters at the title menu and at the name prompt', () => {
    const menu = [{ key: 'c', label: 'Open saved character' }];
    const title = controlsFor('title', { hp: 0, maxHp: 0, run: false }, menu, null, ['Thorin']);
    expect(actions(title)[0]).toMatchObject({ command: `${LOAD}Thorin`, label: 'Continue Thorin' });
    // Not during character creation, whose choices are races and houses.
    const creation = controlsFor(
      'title',
      { hp: 0, maxHp: 0, run: false },
      [{ key: 'a', label: 'Noldor' }],
      null,
      ['Thorin'],
    );
    expect(actions(creation).some((action) => action.command.startsWith(LOAD))).toBe(false);
    const prompt = grid([...Array(21).fill(''), '                    c) Open saved character       <name>'], {
      x: 50,
      y: 21,
      visible: true,
    });
    expect(isLoadPrompt(prompt)).toBe(true);
    expect(detectContext(prompt, state({ 11: 1 }))).toBe('load');
  });
});

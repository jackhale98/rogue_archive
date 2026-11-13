import type { TouchAction } from '@rogue-archive/game-api';
import type { Grid } from '@rogue-archive/term-view';
import { describe, expect, it } from 'vitest';
import {
  CHOOSE,
  continueFirst,
  controlsFor,
  isDirectionKey,
  keyToRogue,
  ROGUE_COMMANDS,
} from '../adapter/input.ts';
import { detectContext, heroCell, mapOverlay, parseState, screenChoices } from '../adapter/state.ts';

const actions = (layout: { actions: (string | TouchAction)[] }): TouchAction[] =>
  layout.actions.map((action) => (typeof action === 'string' ? { command: action } : action));

function grid(lines: string[], cursor?: Grid['cursor']): Grid {
  const cols = 80;
  const rows = 24;
  const cells = new Uint8Array(cols * rows * 2);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) cells[(y * cols + x) * 2] = (lines[y]?.[x] ?? ' ').charCodeAt(0);
  return { cols, rows, cells, cursor };
}

const raw = (fields: number[]) => parseState(Int32Array.from(fields));
// in game, hp 7/12, level 3, hero at 40,11, 15 gold, waiting
const playing = raw([1, 7, 12, 3, 40, 11, 15, 1]);
const MAP = [
  '',
  ...Array(9).fill(''),
  '                                  |.......|',
  '                                  |...@...|',
  ...Array(11).fill(''),
  'Level: 3  Gold: 15     Hp: 7(12)  Str: 16(16)  Arm: 4   Exp: 1/0',
];
// Prompts wait with the cursor on the message line, after the question.
const withTop = (top: string, cursor: Grid['cursor'] = { x: top.length, y: 0, visible: true }) =>
  grid([top, ...MAP.slice(1)], cursor);

describe('Rogue state', () => {
  it('parses the snapshot; the hero is at his screen position', () => {
    expect(playing).toMatchObject({ inGame: true, hp: 7, maxHp: 12, level: 3, gold: 15, waiting: true });
    expect(heroCell(playing)).toEqual({ x: 40, y: 11 });
    expect(heroCell(raw([0, 0, 0, 0, 0, 0, 0, 1]))).toBeNull();
  });

  it('tells what the game is waiting for', () => {
    expect(detectContext(grid(MAP), raw([1, 7, 12, 3, 40, 11, 15, 0]))).toBe('busy');
    expect(detectContext(grid(MAP), playing)).toBe('map');
    expect(detectContext(withTop('The bat bites you.  --More--'), playing)).toBe('more');
    expect(detectContext(withTop('Which direction? '), playing)).toBe('direction');
    // The question stays on screen after Escape; the cursor is back on the hero.
    expect(detectContext(withTop('Which direction? ', { x: 40, y: 11, visible: true }), playing)).toBe('map');
    expect(detectContext(withTop('Which object do you want to quaff? (* for list): '), playing)).toBe('item');
    expect(detectContext(withTop('Really quit?'), playing)).toBe('yesno');
    expect(detectContext(withTop('Save file (/rogue/Tester.save)? '), playing)).toBe('yesno');
    expect(
      detectContext(withTop('What do you want to call it? ', { x: 29, y: 0, visible: true }), playing),
    ).toBe('text');
    const scores = grid([...Array(23).fill(''), '[Press return to continue]']);
    expect(detectContext(scores, raw([0, 0, 12, 1, 0, 0, 0, 1]))).toBe('enter');
  });

  it('reads an inventory over the map as a tappable list', () => {
    const inventory = grid([
      '',
      'a) Some food',
      'b) +1 ring mail [protection 4] (being worn)',
      'c) A +1,+1 mace (weapon in hand)',
      '',
      '--Press space to continue--',
    ]);
    expect(detectContext(inventory, playing)).toBe('menu');
    expect(mapOverlay(inventory)).toMatchObject({ x: 0, y: 1 });
    expect(screenChoices(inventory).map((choice) => choice.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('Rogue keys and docks', () => {
  const none = { shift: false, ctrl: false, alt: false, meta: false };
  it('maps keys to what Rogue reads', () => {
    expect(keyToRogue({ type: 'key', key: 'ArrowUp', code: 'ArrowUp', modifiers: none })).toEqual([107]);
    expect(
      keyToRogue({ type: 'key', key: 'ArrowUp', code: 'ArrowUp', modifiers: { ...none, shift: true } }),
    ).toEqual([75]);
    // The keypad moves; the top-row digits are repeat counts.
    expect(keyToRogue({ type: 'key', key: '4', code: 'Numpad4', modifiers: none })).toEqual([104]);
    expect(keyToRogue({ type: 'key', key: '4', code: 'Digit4', modifiers: none })).toEqual([52]);
    expect(keyToRogue({ type: 'key', key: 'p', code: 'KeyP', modifiers: { ...none, ctrl: true } })).toEqual([
      16,
    ]);
    expect(keyToRogue({ type: 'key', key: 'Shift', code: 'ShiftLeft', modifiers: none })).toBeNull();
  });

  it('has unique command ids, and every dock action is a command or a choice', () => {
    const ids = new Set(ROGUE_COMMANDS.map((command) => command.id));
    expect(ids.size).toBe(ROGUE_COMMANDS.length);
    for (const context of [
      'start',
      'map',
      'more',
      'enter',
      'yesno',
      'direction',
      'item',
      'menu',
      'text',
      'busy',
    ] as const) {
      const layout = controlsFor(context, { hp: 3, maxHp: 12, run: false }, [
        { key: 'a', label: 'Some food' },
      ]);
      for (const action of actions(layout)) {
        const known =
          ids.has(action.command) || action.command.startsWith(CHOOSE) || action.command.startsWith('shell:');
        expect(known, `${context}: ${action.command}`).toBe(true);
        for (const alternate of action.alternates ?? []) expect(ids.has(alternate), alternate).toBe(true);
      }
    }
  });

  it('at --More--, the pad stays and a move continues first', () => {
    const more = controlsFor('more', { hp: 10, maxHp: 10, run: false });
    expect(more.directionPad).toBeDefined();
    expect(actions(more)[0]?.command).toBe('continue');
    const h = 'h'.charCodeAt(0);
    expect(continueFirst('more', [h], { commandId: 'move-w' })).toEqual([32, h]);
    expect(continueFirst('more', [115], { commandId: 'search' })).toEqual([32, 115]);
    expect(continueFirst('more', [105], { commandId: 'inventory' })).toEqual([105]);
    expect(continueFirst('map', [h], { commandId: 'move-w' })).toEqual([h]);
    const key = (key: string, code = '') => ({
      type: 'key' as const,
      key,
      code,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    });
    expect(isDirectionKey(key('ArrowLeft', 'ArrowLeft'))).toBe(true);
    expect(isDirectionKey(key('h', 'KeyH'))).toBe(true);
    expect(isDirectionKey(key('i', 'KeyI'))).toBe(false);
    expect(continueFirst('more', [h], { directionKey: true })).toEqual([32, h]);
    expect(continueFirst('more', [32], { directionKey: false })).toEqual([32]);
  });
});

import type { TouchAction } from '@rogue-archive/game-api';
import type { Grid } from '@rogue-archive/term-view';
import { describe, expect, it } from 'vitest';
import {
  CHOOSE,
  continueFirst,
  controlsFor,
  directedKeys,
  isDirectionKey,
  keyToRogue,
  ROGUE_COMMANDS,
  runKeys,
} from '../adapter/input.ts';
import {
  detectContext,
  heroCell,
  mapLeads,
  mapOverlay,
  parseState,
  screenChoices,
} from '../adapter/state.ts';

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
    // On the stairs, with the Amulet, Weak, a potion underfoot, armour worn, hallucinating.
    expect(raw([1, 7, 12, 3, 40, 11, 15, 1, 0, 1, 1, 2, 33, 1, 1])).toMatchObject({
      onStairs: true,
      amulet: true,
      hunger: 2,
      under: '!',
      armor: true,
      hallucinating: true,
    });
    expect(playing).toMatchObject({ onStairs: false, amulet: false, hunger: 0, under: '', armor: false });
  });

  it('reads the monsters next to the hero and an aquator in sight', () => {
    const map = (rows: string[]) => grid(['', ...Array(9).fill(''), ...rows]);
    // The hero at 40,11: a bat above, a floating eye to the right; an aquator further off.
    const screen = map([`${' '.repeat(36)}|A..B..|`, `${' '.repeat(36)}|...@E.|`]);
    expect(mapLeads(screen, playing)).toEqual({
      adjacent: [
        { key: 'k', arrow: '↑', letter: 'B' },
        { key: 'l', arrow: '→', letter: 'E' },
      ],
      aquator: true,
    });
    // Hallucinating, the letters are random: monsters, but not which ones.
    expect(mapLeads(screen, { ...playing, hallucinating: true })).toEqual({
      adjacent: [
        { key: 'k', arrow: '↑', letter: '' },
        { key: 'l', arrow: '→', letter: '' },
      ],
      aquator: false,
    });
    expect(mapLeads(grid(MAP), playing)).toEqual({ adjacent: [], aquator: false });
    // The status line's letters are not monsters.
    expect(mapLeads(grid(MAP), { ...playing, heroY: 22 }).adjacent).toEqual([]);
  });

  it('tells what the game is waiting for', () => {
    expect(detectContext(grid(MAP), raw([1, 7, 12, 3, 40, 11, 15, 0]))).toBe('busy');
    expect(detectContext(grid(MAP), playing)).toBe('map');
    expect(detectContext(withTop('The bat bites you.  --More--'), playing)).toBe('more');
    // --More-- over another window (a detection overlay, help) is read, then closed.
    expect(detectContext(withTop('--More--'), { ...playing, overlay: true })).toBe('menu');
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
      const layout = controlsFor(
        context,
        { hp: 3, maxHp: 12, run: false, adjacent: [{ key: 'y', arrow: '↖', letter: 'E' }], under: true },
        [{ key: 'a', label: 'Some food' }],
      );
      for (const action of actions(layout)) {
        const known =
          ids.has(action.command) ||
          action.command.startsWith(CHOOSE) ||
          action.command.startsWith('shell:') ||
          directedKeys(action.command) !== null;
        expect(known, `${context}: ${action.command}`).toBe(true);
        for (const alternate of action.alternates ?? []) expect(ids.has(alternate), alternate).toBe(true);
      }
    }
  });

  it('leads the map dock with what the situation calls for', () => {
    const map = (state: Partial<Parameters<typeof controlsFor>[1]> = {}) =>
      actions(controlsFor('map', { hp: 10, maxHp: 10, run: false, ...state }));
    const labels = (state: Partial<Parameters<typeof controlsFor>[1]> = {}) =>
      map(state).map((action) => action.label ?? action.command);
    expect(labels()).toEqual(['search', 'fight', 'inventory', 'Stairs', 'Look', 'More']);
    // Search's fan: counts and the careful run; Again sits with Fight and Pack.
    expect(map()[0]?.alternates).toEqual(expect.arrayContaining(['search-10', 'rest-10', 'run-ctrl']));
    expect(map()[0]?.alternates).not.toContain('repeat');
    expect(map()[1]?.alternates).toContain('repeat');
    expect(map()[2]?.alternates).toContain('repeat');

    // A monster next to the hero: one gesture fights it (f + direction).
    const bat = map({ adjacent: [{ key: 'y', arrow: '↖', letter: 'B' }] })[1]!;
    expect(bat).toMatchObject({ command: 'fight-at:y', label: 'Fight ↖B' });
    expect(bat.alternates).toContain('fight');
    expect(directedKeys('fight-at:y')).toEqual([102, 121]);
    expect(directedKeys('throw-at:n')).toEqual([116, 110]);
    expect(directedKeys('fight-at:x')).toBeNull();
    // A floating eye paralyses whoever hits it: throw instead, unless another monster is there.
    expect(map({ adjacent: [{ key: 'l', arrow: '→', letter: 'E' }] })[1]).toMatchObject({
      command: 'throw-at:l',
      label: 'Throw →E',
    });
    expect(
      map({
        adjacent: [
          { key: 'l', arrow: '→', letter: 'E' },
          { key: 'j', arrow: '↓', letter: 'K' },
        ],
      })[1],
    ).toMatchObject({ command: 'fight-at:j', label: 'Fight ↓K' });
    // Hallucinating: the direction, not the letter.
    expect(map({ adjacent: [{ key: 'h', arrow: '←', letter: '' }] })[1]).toMatchObject({
      command: 'fight-at:h',
      label: 'Fight ←',
    });

    // Something underfoot: pick it up (Search stays in the fan and the pad).
    expect(map({ under: true })[0]).toMatchObject({ command: 'pickup', emphasis: 'primary' });
    expect(map({ under: true })[0]?.alternates).toContain('search');
    // Hungry: eat; Weak: eat first. An aquator in sight with armour on: take it off.
    expect(map({ hunger: 1 })[2]).toMatchObject({ command: 'eat' });
    expect(map({ hunger: 1 })[2]?.emphasis).toBeUndefined();
    expect(map({ hunger: 2 })[2]).toMatchObject({ command: 'eat', emphasis: 'primary' });
    expect(map({ hunger: 1, armor: true, aquator: true })[2]).toMatchObject({
      command: 'take-off',
      emphasis: 'primary',
    });
    expect(map({ aquator: true })[2]?.command).toBe('inventory');
    // Stairs: on them, down; with the Amulet, up.
    expect(map({ onStairs: true })[3]).toMatchObject({
      command: 'downstairs',
      label: 'Down >',
      emphasis: 'primary',
    });
    expect(map({ amulet: true })[3]).toMatchObject({ command: 'upstairs', alternates: ['downstairs'] });
    expect(map({ amulet: true })[3]?.emphasis).toBeUndefined();
    expect(map({ amulet: true, onStairs: true })[3]?.emphasis).toBe('primary');

    // A latched run shows as the first button.
    expect(map({ run: 'run' })[0]).toMatchObject({ command: 'run', label: 'Run ⇧', active: true });
    expect(map({ run: 'run-ctrl' })[0]).toMatchObject({ command: 'run-ctrl', label: 'Run ⌃', active: true });
    expect(runKeys('run', 'y')).toEqual([89]);
    expect(runKeys('run-ctrl', 'y')).toEqual([25]);
    // Rogue reads no keys while busy: no Stop.
    expect(actions(controlsFor('busy', { hp: 10, maxHp: 10, run: false }))).toEqual([]);
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

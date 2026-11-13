import { describe, expect, it } from 'vitest';
import { SHELL_COMMAND, type TouchAction } from '@rogue-archive/game-api';
import { COLS, EventType, ROWS } from '../adapter/constants.ts';
import {
  BROGUE_COMMANDS,
  BROGUE_TOUCH_LAYOUT,
  PLAYBACK_PALETTE,
  commandEvents,
  commandToBrogue,
} from '../adapter/input.ts';
import {
  controlsFor,
  detectContext,
  parseState,
  readHints,
  type BrogueState,
  type ScreenHints,
} from '../adapter/state.ts';

/** Snapshot fields in ST_* order (port/rogue-archive-platform.c). */
const ST = {
  hp: 0,
  maxHp: 1,
  nutrition: 2,
  cursorX: 7,
  cursorY: 8,
  cursorMode: 9,
  upX: 10,
  upY: 11,
  downX: 12,
  downY: 13,
  textInput: 14,
  playback: 16,
  waiting: 17,
  enemyAdjacent: 18,
  enemiesVisible: 19,
  canRethrow: 20,
  needsRest: 21,
  searching: 22,
  foodLetter: 23,
  playbackPaused: 24,
  omniscience: 25,
} as const;

function snapshot(fields: Partial<Record<keyof typeof ST, number>> = {}): BrogueState {
  const raw = new Int32Array(26);
  const values = {
    hp: 30,
    maxHp: 30,
    nutrition: 1800,
    cursorX: -1,
    cursorY: -1,
    upX: 10,
    upY: 5,
    downX: 60,
    downY: 20,
    waiting: 1,
    foodLetter: 'a'.charCodeAt(0),
    ...fields,
  };
  for (const [name, value] of Object.entries(values)) raw[ST[name as keyof typeof ST]] = value;
  return parseState(raw);
}

function screen(rows: Record<number, string>): Uint8Array {
  const cells = new Uint8Array(COLS * ROWS * 8);
  for (const [row, text] of Object.entries(rows)) {
    for (let i = 0; i < text.length; i++) cells[(Number(row) * COLS + 21 + i) * 8] = text.charCodeAt(i);
  }
  return cells;
}

const mapActions = (state: BrogueState, hints: ScreenHints = {}, shift = false) =>
  controlsFor('map', state, [], shift, [], hints).actions as TouchAction[];
const commands = (actions: TouchAction[]) => actions.map((action) => action.command);
const primaries = (actions: TouchAction[]) => actions.filter((action) => action.emphasis === 'primary');
const find = (actions: TouchAction[], command: string) =>
  actions.find((action) => action.command === command);

describe('state snapshot', () => {
  it('reads the new read-only fields after the original ones', () => {
    const state = snapshot({
      enemyAdjacent: 1,
      enemiesVisible: 3,
      canRethrow: 1,
      needsRest: 1,
      searching: 2,
      playbackPaused: 1,
      omniscience: 1,
    });
    expect(state).toMatchObject({
      enemyAdjacent: true,
      enemiesVisible: 3,
      canRethrow: true,
      needsRest: true,
      searching: 2,
      foodLetter: 'a',
      playbackPaused: true,
      omniscience: true,
      down: { x: 60, y: 20 },
      up: { x: 10, y: 5 },
    });
    expect(snapshot({ foodLetter: 0 }).foodLetter).toBeNull();
  });

  it('still reads an older, shorter snapshot', () => {
    const state = parseState(new Int32Array([20, 30, 1800, 12, 1, 1, 0, -1, -1, 0, 0, 0, 0, 0, 0, 1, 0, 1]));
    expect(state).toMatchObject({ enemyAdjacent: false, canRethrow: false, foodLetter: null, down: null });
  });
});

describe('screen hints', () => {
  it('tells throwing, zapping and looking apart from the prompt text', () => {
    expect(readHints(screen({ 0: 'Throw your dart where? (<hjklyubn>, mouse, or <tab>)' })).aim).toBe(
      'throw',
    );
    expect(
      readHints(
        screen({
          0: 'Direction? (<hjklyubn>, mouse, or <tab>; <return> to confirm)',
          1: 'Zapping your staff of firebolt [2/2]:',
        }),
      ).aim,
    ).toBe('zap');
    expect(readHints(screen({ 0: 'you see a goblin.' })).aim).toBe('look');
    expect(readHints(screen({ 0: 'Choose a target (<tab>)' })).aim).toBeUndefined();
  });

  it('notices that exploration is done only from the newest message (the lowest line)', () => {
    expect(readHints(screen({ 0: 'Welcome', 1: 'I see no path for further exploration.' })).explored).toBe(
      true,
    );
    expect(
      readHints(screen({ 0: 'I see no path for further exploration.', 1: 'You descend.' })).explored,
    ).toBe(undefined);
  });

  it('ignores the sidebar beside the messages', () => {
    const cells = screen({ 0: 'I see no path for further exploration.' });
    // Sidebar text on a lower row (columns 0-19) is not a newer message.
    for (const [i, char] of [...'Health'].entries()) cells[(1 * COLS + i) * 8] = char.charCodeAt(0);
    expect(readHints(cells).explored).toBe(true);
  });
});

describe('quiet dock', () => {
  it('offers Explore, Search, Pack, Look and More, with nothing pressing', () => {
    const actions = mapActions(snapshot());
    expect(commands(actions)).toEqual(['explore', 'search', 'inventory', 'look', SHELL_COMMAND.palette]);
    expect(primaries(actions)).toEqual([]);
    expect(find(actions, 'explore')?.alternates).toEqual(['descend', 'ascend', 'shift']);
    expect(find(actions, 'inventory')?.alternates).toEqual([
      'apply',
      'throw',
      'equip',
      'unequip',
      'drop',
      'swap',
      'eat',
    ]);
  });

  it('names the long rest by what it will do', () => {
    expect(find(mapActions(snapshot()), 'search')?.alternates).toEqual(['long-search', 'rest', 'rest-100']);
    expect(find(mapActions(snapshot({ needsRest: 1 })), 'search')?.alternates).toEqual([
      'long-search',
      'rest',
      'auto-rest',
    ]);
  });

  it("shows the search's progress towards the fifth, stronger search", () => {
    expect(find(mapActions(snapshot({ searching: 3 })), 'search')?.label).toBe('Search 3/5');
    expect(find(mapActions(snapshot()), 'search')?.label).toBeUndefined();
  });

  it('leads with Rest when badly hurt and nothing is in view', () => {
    const actions = mapActions(snapshot({ hp: 10, needsRest: 1 }));
    expect(primaries(actions)).toEqual([expect.objectContaining({ command: 'auto-rest', label: 'Rest' })]);
  });

  it('leads with Eat when hungry, eating the food by its letter', () => {
    const actions = mapActions(snapshot({ nutrition: 300, foodLetter: 'c'.charCodeAt(0) }));
    expect(actions[0]).toMatchObject({ command: 'eat', emphasis: 'primary' });
    expect(primaries(actions)).toHaveLength(1);
    expect(commandEvents('eat', 'c').map((event) => event[1])).toEqual([
      'a'.charCodeAt(0),
      'c'.charCodeAt(0),
    ]);
    // Without food there is nothing to eat: no button.
    expect(commands(mapActions(snapshot({ nutrition: 300, foodLetter: 0 })))).not.toContain('eat');
  });

  it('makes "Go ↓" the main button once the route to the stairs is shown', () => {
    const actions = mapActions(snapshot({ cursorX: 60, cursorY: 20 }));
    expect(actions[0]).toMatchObject({ command: 'descend', label: 'Go ↓', emphasis: 'primary' });
    expect(actions[0]!.alternates).toContain('explore');
    expect(primaries(actions)).toHaveLength(1);
    expect(mapActions(snapshot({ cursorX: 10, cursorY: 5 }))[0]).toMatchObject({
      command: 'ascend',
      label: 'Go ↑',
    });
    // The cursor elsewhere is just a preview.
    expect(mapActions(snapshot({ cursorX: 61, cursorY: 20 }))[0]).toMatchObject({ command: 'explore' });
  });

  it('promotes the stairs once there is nothing left to explore', () => {
    const actions = mapActions(snapshot(), { explored: true });
    expect(actions[0]).toMatchObject({ command: 'descend', emphasis: 'primary' });
    expect(actions[0]!.alternates).toContain('explore');
  });

  it('keeps Run in place of Explore while Shift is latched', () => {
    expect(mapActions(snapshot(), {}, true)[0]).toMatchObject({
      command: 'shift',
      label: 'Run ⇧',
      active: true,
    });
  });
});

describe('danger dock', () => {
  it('fights an adjacent enemy with x; no Rest or Search as a main button, even when hurt', () => {
    const actions = mapActions(snapshot({ hp: 5, needsRest: 1, enemyAdjacent: 1, enemiesVisible: 1 }));
    expect(commands(actions)).toEqual(['explore', 'throw', 'inventory', 'look', SHELL_COMMAND.palette]);
    expect(actions[0]).toMatchObject({ label: 'Fight', emphasis: 'primary' });
    expect(actions[0]!.alternates).toEqual(['search', 'rest', 'shift']);
    expect(primaries(actions)).toHaveLength(1);
  });

  it('throws again in one tap when the last thrown item is still carried', () => {
    const inView = mapActions(snapshot({ enemiesVisible: 2, canRethrow: 1 }));
    expect(find(inView, 'rethrow')).toMatchObject({ emphasis: 'primary', alternates: ['throw'] });
    expect(find(inView, 'explore')).toMatchObject({ label: 'Explore' });
    expect(find(inView, 'explore')?.emphasis).toBeUndefined();
    const adjacent = mapActions(snapshot({ enemyAdjacent: 1, enemiesVisible: 1, canRethrow: 1 }));
    expect(find(adjacent, 'rethrow')?.emphasis).toBeUndefined();
    expect(commands(mapActions(snapshot({ enemiesVisible: 1 })))).toContain('throw');
  });

  it('still offers the stairs route and food first', () => {
    const route = mapActions(snapshot({ enemiesVisible: 1, cursorX: 60, cursorY: 20 }));
    expect(route[0]).toMatchObject({ command: 'descend', emphasis: 'primary' });
    const hungry = mapActions(snapshot({ enemyAdjacent: 1, enemiesVisible: 1, nutrition: 100 }));
    expect(hungry[0]).toMatchObject({ command: 'eat', emphasis: 'primary' });
    expect(primaries(hungry)).toHaveLength(1);
  });
});

describe('targeting dock', () => {
  const confirm = (hints: ScreenHints) =>
    (controlsFor('targeting', snapshot(), [], false, [], hints).actions[0] as TouchAction).label;
  it('names the confirm button after the pending action', () => {
    expect(confirm({ aim: 'throw' })).toBe('Throw');
    expect(confirm({ aim: 'zap' })).toBe('Zap');
    expect(confirm({ aim: 'look' })).toBe('Go');
    expect(confirm({})).toBe('Confirm');
  });
});

describe('recording playback', () => {
  it('has its own context while playing and while paused', () => {
    const cells = screen({});
    expect(detectContext(true, snapshot({ playback: 1, waiting: 0 }), cells)).toBe('playback');
    expect(detectContext(true, snapshot({ playback: 1 }), cells)).toBe('playback');
    // Menus opened from playback (inventory) are still menus.
    expect(detectContext(true, snapshot({ playback: 1, textInput: 1 }), cells)).toBe('menu');
    expect(detectContext(true, snapshot({ waiting: 0 }), cells)).toBe('busy');
  });

  it('offers pause, speed, seeking and omniscience, with its own palette', () => {
    const layout = controlsFor(
      'playback',
      snapshot({ playback: 1, omniscience: 1 }),
      BROGUE_TOUCH_LAYOUT.palette,
    );
    const actions = layout.actions as TouchAction[];
    expect(commands(actions)).toEqual([
      'playback-pause',
      'playback-slower',
      'playback-faster',
      'playback-next-turn',
      'playback-omniscience',
      SHELL_COMMAND.palette,
    ]);
    expect(actions[0]).toMatchObject({ label: 'Pause' });
    expect(find(actions, 'playback-omniscience')).toMatchObject({ active: true });
    expect(layout.directionPad).toBeUndefined();
    expect(layout.palette).toBe(PLAYBACK_PALETTE);
    const paused = controlsFor('playback', snapshot({ playback: 1, playbackPaused: 1 }), []);
    expect(paused.actions[0]).toMatchObject({ label: 'Play' });
  });
});

describe('commands', () => {
  it('reaches the five-turn search with Ctrl+S', () => {
    expect(commandToBrogue('long-search')).toEqual([EventType.KEYSTROKE, 's'.charCodeAt(0), 0, 1, 0]);
    expect(commandToBrogue('search')).toEqual([EventType.KEYSTROKE, 's'.charCodeAt(0), 0, 0, 0]);
  });

  it('keeps diagonal-moving letters and playback keys out of the palette', () => {
    const palette = BROGUE_TOUCH_LAYOUT.palette;
    expect(palette).not.toContain('yes');
    expect(palette).not.toContain('no');
    expect(palette.filter((id) => id.startsWith('playback-'))).toEqual([]);
    expect(palette).toContain('long-search');
    for (const id of palette) {
      const command = BROGUE_COMMANDS.find((c) => c.id === id)!;
      expect('yubnhjkl'.split('').map((c) => c.charCodeAt(0))).not.toContain(command.keyCode);
    }
  });

  it('labels Continue and the palette button differently', () => {
    expect(BROGUE_COMMANDS.find((c) => c.id === 'acknowledge')?.shortLabel).toBe('Continue');
  });
});

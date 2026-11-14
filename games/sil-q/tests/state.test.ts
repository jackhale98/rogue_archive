import { describe, expect, it } from 'vitest';
import type { Grid } from '@rogue-archive/term-view';
import type { TouchAction } from '@rogue-archive/game-api';
import {
  CHOOSE,
  controlsFor,
  isMapCommand,
  keyToSil,
  LOAD,
  mapLead,
  SIL_COMMANDS,
  stepsTo,
  type DockState,
} from '../adapter/input.ts';
import {
  aimPrompt,
  detectContext,
  isLoadPrompt,
  itemPrompt,
  mapOverlay,
  parseState,
  playerCell,
  screenChoices,
  songPrompt,
  statusTags,
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
  // Defaults as the port sends them for an ordinary character: no song, fed, light that does not burn out.
  const raw = new Int32Array(37);
  raw[14] = raw[15] = 100;
  raw[16] = 3000;
  raw[24] = 2;
  raw[25] = -1;
  raw[30] = -1;
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

  it('parses the read-only context fields', () => {
    const fields = state({
      12: 2,
      13: 1,
      14: 5,
      26: 1,
      27: 2,
      28: 1,
      29: 2000,
      30: 500,
      31: 3,
      32: 1,
      33: 1,
      34: 24,
    });
    expect(fields).toMatchObject({
      keyset: 2,
      stealthMode: true,
      song1: 5,
      song2: 100,
      underFeature: 'down',
      underObject: 'crown',
      onTheRun: true,
      newExp: 2000,
      abilityCost: 500,
      monstersInView: 3,
      monstersAdjacent: 1,
      bow: true,
      quiver1: 24,
    });
  });

  it('shows the sidebar status in tags', () => {
    expect(statusTags(inDungeon)).toEqual([]);
    const texts = (fields: Partial<Record<number, number>>) =>
      statusTags(state(fields)).map((tag) => tag.text);
    expect(texts({ 13: 1, 14: 0, 15: 7 })).toEqual(['Stealth', '♪ Elbereth + the Trees']);
    expect(texts({ 16: 1500 })).toEqual(['Hungry']);
    expect(texts({ 16: 500 })).toEqual(['Weak']);
    expect(texts({ 16: 0 })).toEqual(['Starving']);
    expect(texts({ 16: 6000 })).toEqual(['Full']);
    expect(texts({ 17: 3, 18: 2, 19: 4, 20: 12, 21: 30, 22: 60, 23: 1 })).toEqual([
      'Entranced',
      'Blind',
      'Confused',
      'Afraid',
      'Poisoned 12',
      'Bleeding 30',
      'Heavy stun',
    ]);
    expect(texts({ 24: 1, 25: 80 })).toEqual(['Slow', 'Light 80']);
    expect(texts({ 25: 1500 })).toEqual([]);
  });

  it('reads song and aim prompts', () => {
    expect(songPrompt('(Songs: s,f,h, * to see) Sing which song: ')).toEqual({
      songs: ['f', 'h'],
      exchange: false,
    });
    expect(songPrompt('(Songs: s,a,c,x) Sing which song: ')).toEqual({ songs: ['a', 'c'], exchange: true });
    expect(songPrompt('Drop which item?')).toBeNull();
    expect(aimPrompt("Direction ('f' for closest, '*' to choose a target, ESC to cancel)? ")).toBe('closest');
    expect(aimPrompt("Direction ('f' for target, '*' to re-target, ESC to cancel)? ")).toBe('target');
    expect(aimPrompt('Direction (Escape to cancel)? ')).toBeNull();
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
    expect(top("Direction ('f' for closest, '*' to choose a target, ESC to cancel)? ")).toBe('aim');
    expect(top('Direction (Escape to cancel)? ')).toBe('direction');
    expect(top('(Songs: s,f,h, * to see) Sing which song: ')).toBe('song');
    expect(top('You are on an open floor  [(t)arget, (m)anual, <dir>]')).toBe('targeting');
    // A look prompt with more to show is still look mode (Space shows the rest).
    expect(top('You see an Orc archer -more- [(r)ecall, (t)arget, (m)anual, <dir>]')).toBe('targeting');
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
      'aim',
      'song',
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

describe('Sil-Q situational docks', () => {
  const base: DockState = { hp: 28, maxHp: 28, run: false };
  const labels = (layout: { actions: (string | TouchAction)[] }) =>
    actions(layout).map((action) => action.label ?? action.command);
  const commands = (layout: { actions: (string | TouchAction)[] }) =>
    actions(layout).map((action) => action.command);

  it('offers a target only at aim prompts', () => {
    expect(commands(controlsFor('direction', base))).toEqual(['cancel']);
    const aim = controlsFor('aim', {
      ...base,
      prompt: "Direction ('f' for closest, '*' to choose a target)? ",
    });
    expect(labels(aim)).toEqual(['Nearest', 'Choose target', 'Cancel']);
    expect(commands(aim)).toEqual(['aim-nearest', 'choose-target', 'cancel']);
    const targeted = controlsFor('aim', {
      ...base,
      prompt: "Direction ('f' for target, '*' to re-target)? ",
    });
    expect(labels(targeted)).toEqual(['Target', 'Re-target', 'Cancel']);
  });

  it('offers what the look prompt takes', () => {
    const monster = controlsFor('targeting', {
      ...base,
      prompt: 'You see an Orc archer (unhurt) [(r)ecall, (t)arget, (m)anual, <dir>]',
    });
    expect(commands(monster)).toEqual(['select-target', 'next-target', 'recall', 'cancel']);
    const manual = controlsFor('targeting', { ...base, prompt: 'You see a wall  [(a)uto, <dir>]' });
    expect(commands(manual)).toEqual(['cancel']);
  });

  it('names songs at the song prompt and marks the one being sung', () => {
    const layout = controlsFor('song', { ...base, song1: 7 }, [
      { key: 'f', label: 'Staunching' },
      { key: 'h', label: 'the Trees' },
      { key: 's', label: 'Stop singing' },
    ]);
    expect(actions(layout)).toEqual([
      { command: `${CHOOSE}f`, label: 'Staunching' },
      { command: `${CHOOSE}h`, label: 'the Trees', active: true },
      { command: `${CHOOSE}s`, label: 'Stop singing' },
      { command: 'cancel', label: 'Cancel' },
    ]);
  });

  it('leads with what is underfoot', () => {
    expect(mapLead(base)).toBeNull();
    expect(mapLead({ ...base, underFeature: 'down' })?.command).toBe('downstairs');
    expect(mapLead({ ...base, underFeature: 'up' })?.command).toBe('upstairs');
    expect(mapLead({ ...base, underFeature: 'forge' })).toMatchObject({
      command: 'smithing',
      label: 'Smith',
    });
    expect(mapLead({ ...base, underObject: 'object' })?.command).toBe('pickup');
    expect(mapLead({ ...base, underObject: 'crown' })?.command).toBe('prise');
    // Escaping with a Silmaril: Up, even on a down staircase.
    expect(mapLead({ ...base, onTheRun: true, underFeature: 'down' })?.command).toBe('upstairs');
    expect(mapLead({ ...base, newExp: 400, abilityCost: 500 })).toBeNull();
    expect(mapLead({ ...base, newExp: 600, abilityCost: 500 })?.command).toBe('abilities');
  });

  it('changes the map dock with the situation', () => {
    const exploring = controlsFor('map', { ...base, underObject: 'object', stealthMode: true });
    expect(commands(exploring)).toEqual(['pickup', 'stealth', 'rest', 'inventory', 'look', 'shell:palette']);
    expect(actions(exploring)[1]).toMatchObject({ active: true });
    expect(commands(controlsFor('map', { ...base, doorsAdjacent: 1 }))[1]).toBe('alternate');
    const inView = controlsFor('map', { ...base, monstersInView: 2, song1: 0 });
    expect(labels(inView).slice(0, 3)).toEqual(['throw', 'Sing: Elbereth', 'stealth']);
    const archer = controlsFor('map', { ...base, monstersInView: 1, bow: true, quiver1: 20 });
    expect(commands(archer)[0]).toBe('fire');
    const melee = controlsFor('map', { ...base, monstersInView: 1, monstersAdjacent: 1 });
    expect(commands(melee).slice(0, 4)).toEqual(['hold', 'sing', 'throw', 'exchange']);
    const hurt = controlsFor('map', { ...base, hp: 5, monstersInView: 1, monstersAdjacent: 1 });
    expect(commands(hurt).slice(0, 2)).toEqual(['quaff', 'eat']);
    const escape = controlsFor('map', { ...base, hp: 5, monstersInView: 1, underFeature: 'up' });
    expect(commands(escape).slice(0, 2)).toEqual(['upstairs', 'quaff']);
    // Wounded with no one about: rest.
    expect(actions(controlsFor('map', { ...base, hp: 5 }))[1]).toMatchObject({
      command: 'rest',
      emphasis: 'primary',
    });
    // A latched Run is shown in every situation.
    expect(commands(controlsFor('map', { ...base, run: true, monstersInView: 1 }))).toContain('run');
  });

  it('walks the look cursor to a cell', () => {
    const keys = (dx: number, dy: number) => String.fromCharCode(...stepsTo(dx, dy));
    expect(keys(3, -2)).toBe('996');
    expect(keys(-1, 4)).toBe('1222');
    expect(keys(-2, 0)).toBe('44');
    expect(keys(0, 0)).toBe('');
  });

  it('marks the commands a keyset remaps', () => {
    const map = SIL_COMMANDS.filter(isMapCommand).map((command) => command.id);
    expect(map).toContain('rest');
    expect(map).toContain('look');
    expect(map).not.toContain('move-n');
    expect(map).not.toContain('yes');
    expect(map).not.toContain('run');
  });
});

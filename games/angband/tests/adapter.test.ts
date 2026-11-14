import { describe, expect, it } from 'vitest';
import type { Grid } from '@rogue-archive/term-view';
import type { GameInput, TouchAction } from '@rogue-archive/game-api';
import {
  ANGBAND_COMMANDS,
  ATTACK,
  CHOOSE,
  KC,
  MOD,
  PALETTE,
  SAVE_ROW,
  clickEvent,
  commandKeys,
  controlsFor,
  findCommand,
  keyEvent,
  keyToAngband,
  mapLead,
  textToAngband,
  type DockState,
} from '../adapter/input.ts';
import {
  aimPrompt,
  detectContext,
  isStore,
  isTargeting,
  itemPrompt,
  mapOverlay,
  mapRect,
  parseState,
  playerCell,
  saveMenu,
  screenChoices,
  statusLine,
} from '../adapter/state.ts';
// Event scripts of the conformance replays use the same encoding as the worker.
import { parseEvents } from './conformance/events.mjs';

const actions = (layout: { actions: (string | TouchAction)[] }): TouchAction[] =>
  layout.actions.map((action) => (typeof action === 'string' ? { command: action } : action));
const ids = (layout: { actions: (string | TouchAction)[] }) =>
  actions(layout).map((action) => action.command);

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

const raw = (fields: Partial<Record<number, number>>) => {
  const values = new Int32Array(32);
  values[10] = 13;
  values[11] = 1;
  values[13] = 1;
  values[29] = 1;
  for (const [i, v] of Object.entries(fields)) values[Number(i)] = v!;
  return values;
};
/** A Human Warrior in the town, as the conformance replay prints it (state 1 20 20 0 0 0 32 1 0 0 13 1 5 1 ...). */
const inTown = parseState(
  raw({ 0: 1, 1: 20, 2: 20, 6: 32, 7: 1, 12: 5, 15: 1, 16: 140, 18: 1, 20: 2, 31: 1 }),
);
const notInGame = parseState(raw({ 31: 1 }));

const key = (k: string, extra: Partial<Extract<GameInput, { type: 'key' }>> = {}) =>
  ({
    type: 'key',
    key: k,
    code: extra.code ?? '',
    modifiers: { shift: false, ctrl: false, alt: false, meta: false, ...extra.modifiers },
  }) as Extract<GameInput, { type: 'key' }>;

// Screens as the game draws them (from the conformance harness's output).
const TOWN = [
  '',
  'Human                            ####     ########',
  'Rookie                          ##  ## ####  @   ###   ####',
  'Warrior                         #    ##: #         #   #  #    ###',
  ...Array(18).fill(''),
  'Town                  ########    #####       ######',
  '             Light 1  Fed 89 % Down staircase',
];
const withTop = (top: string, lines = TOWN) => [top, ...lines.slice(1)];

describe('state snapshot', () => {
  it('parses the fields in port/main-web.c order', () => {
    expect(inTown).toMatchObject({
      inGame: true,
      hp: 20,
      maxHp: 20,
      playerX: 32,
      playerY: 1,
      colMap: 13,
      rowMap: 1,
      waiting: true,
      gold: 140,
      underFeature: 'down',
      monstersInView: 2,
      mouseMovement: true,
      generated: true,
    });
  });

  it('places the player and the map on screen', () => {
    expect(playerCell(inTown)).toEqual({ x: 45, y: 2 });
    expect(mapRect(grid(TOWN), inTown)).toEqual({ x: 13, y: 1, width: 67, height: 22 });
    expect(playerCell(notInGame)).toBeNull();
  });

  it("reads Angband's status line for the band", () => {
    expect(statusLine(grid(TOWN))).toBe('Light 1 · Fed 89 % Down staircase');
  });
});

describe('context detection', () => {
  it('the savefile menu, with its rows', () => {
    const screen = grid([
      'Select the save to use (movement keys and enter or mouse) or quit',
      '(escape or second mouse button).',
      '',
      'New game',
      'Use Tester: Tester the Human Warrior, level 1',
    ]);
    expect(detectContext(screen, notInGame)).toBe('select');
    expect(saveMenu(screen)).toEqual([
      { row: 3, name: null, label: 'New game' },
      { row: 4, name: 'Tester', label: 'Tester: Tester the Human Warrior, level 1' },
    ]);
  });

  it('character creation, with its lettered choices', () => {
    const screen = grid([
      '',
      '  Please select your character traits from the menus below:',
      ...Array(7).fill(''),
      '  a) Human         a) Warrior       Str:  +3  Dex:  +2',
      '  b) Half-Elf      b) Mage          Int:  -2  Con:  +2',
    ]);
    expect(detectContext(screen, notInGame)).toBe('birth');
    // Each letter once, in reading order (the first menu's).
    expect(screenChoices(screen)).toEqual([
      { key: 'a', label: 'Human' },
      { key: 'b', label: 'Half-Elf' },
    ]);
  });

  it('the name prompt is a text field', () => {
    const top = 'Enter a name for your character (* for a random name): ';
    expect(detectContext(grid([top], { x: 55, y: 0, visible: true }), notInGame)).toBe('text');
  });

  it('prompts on the top line', () => {
    const cases: [string, string][] = [
      ['Accept character history? [y/n]', 'yesno'],
      ['You have no more Flasks of oil. -more-', 'more'],
      ['Direction or <click> (Escape to cancel)?', 'direction'],
      [`Direction ('*' or <click> to target, "'" for closest, Escape to cancel)?`, 'aim'],
      ["Direction ('5' for target, '*' or <click> to re-target, Escape to cancel)?", 'aim'],
      ['Drop which item? (Inven: a-d, / for Equip, ESC)', 'item'],
      ['You see a squint-eyed rogue (unhurt, asleep), 4 S, 0 E.', 'targeting'],
      ['Buy a Ration of Food? [ESC, any other key to accept]', 'more'],
    ];
    for (const [top, context] of cases) expect(detectContext(grid(withTop(top)), inTown), top).toBe(context);
  });

  it('pages waiting for any key, by their bottom line', () => {
    const scores = [
      ...Array(23).fill(''),
      '         [Press ESC to exit, any other key to page forward till done.]',
    ];
    expect(detectContext(grid(scores), notInGame)).toBe('more');
    const splash = [...Array(23).fill(''), '                          [Press any key to continue]'];
    expect(detectContext(grid(splash), notInGame)).toBe('more');
  });

  it('a list over the map is a menu; the map alone is the map', () => {
    const list = [
      'Select Item: (Inven: a-c, / for Equip, ESC)',
      'Human        a) 3 Rations of Food                 2.4 lb',
      'Rookie       b) a Potion of Berserk Strength      0.4 lb',
      ...TOWN.slice(3),
    ];
    expect(detectContext(grid(list), inTown)).toBe('item');
    expect(mapOverlay(grid(list), inTown)).toMatchObject({ x: 13, y: 1 });
    expect(detectContext(grid(TOWN), inTown)).toBe('map');
    expect(detectContext(grid(TOWN), { ...inTown, waiting: false })).toBe('busy');
  });

  it('a store', () => {
    const store = grid([
      '"Staying on a level too long can cause awake random monsters to spawn."',
      ' Bilbo the Friendly (Hobbit)                              General Store (5000)',
      '',
      ' Store Inventory                                          Weight      Price',
      ' a) a Mushroom of Stoneskin {unseen}                      0.1 lb         60',
      ' c) 40 Rations of Food                                    0.8 lb          3',
      ...Array(17).fill(''),
      " Press '?' for help.                                  Gold Remaining:       140",
    ]);
    expect(isStore(store)).toBe(true);
    expect(detectContext(store, inTown)).toBe('store');
    expect(screenChoices(store)).toEqual([
      { key: 'a', label: 'a Mushroom of Stoneskin {unseen}' },
      { key: 'c', label: '40 Rations of Food' },
    ]);
  });

  it('prompt details', () => {
    expect(itemPrompt('Drop which item? (Inven: a-d, / for Equip, | for Quiver, - for floor, ESC)')).toEqual({
      list: 'Inven',
      equip: true,
      inven: false,
      quiver: true,
      floor: true,
    });
    expect(aimPrompt("Direction ('5' for target, '*' or <click> to re-target, Escape to cancel)?")).toEqual({
      targetSet: true,
    });
    expect(isTargeting('You are on a down staircase, 0 N, 0 E.')).toBe(true);
    expect(isTargeting('You see nothing there.')).toBe(false);
  });
});

describe('keys', () => {
  it("mirror upstream's SDL2 front end", () => {
    expect(keyToAngband(key('Enter'))).toEqual([KC.ENTER]);
    expect(keyToAngband(key('Escape'))).toEqual([KC.ESCAPE]);
    expect(keyToAngband(key('ArrowUp'))).toEqual([KC.ARROW_UP]);
    // Shift+arrow runs through pref.prf's {S}[Up] keymap.
    expect(
      keyToAngband(key('ArrowUp', { modifiers: { shift: true, ctrl: false, alt: false, meta: false } })),
    ).toEqual([keyEvent(KC.ARROW_UP, MOD.SHIFT)]);
    expect(keyToAngband(key('5', { code: 'Numpad5' }))).toEqual([keyEvent(53, MOD.KEYPAD)]);
    expect(
      keyToAngband(
        key('x', { code: 'KeyX', modifiers: { shift: false, ctrl: true, alt: false, meta: false } }),
      ),
    ).toEqual([24]);
    expect(keyToAngband(key('R'))).toEqual([82]);
    expect(keyToAngband(key('é'))).toEqual([0xe9]);
    expect(
      keyToAngband(key('a', { modifiers: { shift: false, ctrl: false, alt: false, meta: true } })),
    ).toBeNull();
    expect(textToAngband('Ab\n')).toEqual([65, 98, KC.ENTER]);
  });

  it('encode events as the conformance scripts do', () => {
    expect(parseEvents('{S+UP}{K+5}{M:46,13,65}')).toEqual([
      String(keyEvent(KC.ARROW_UP, MOD.SHIFT)),
      String(keyEvent(53, MOD.KEYPAD)),
      'm46.13.65',
    ]);
    // A click: -(1 + x + y * 256 + button * 65536), the button with Alt (4) << 4.
    expect(clickEvent(46, 13, 1, MOD.ALT)).toBe(-(1 + 46 + 13 * 256 + 65 * 65536));
  });

  it('commands use the keyset in use', () => {
    const fire = findCommand('fire-nearest')!;
    expect(commandKeys(fire, false)).toEqual(['h'.charCodeAt(0)]);
    expect(commandKeys(fire, true)).toEqual([KC.TAB]);
    expect(commandKeys(findCommand('inventory')!, true)).toEqual(['i'.charCodeAt(0)]);
    expect(new Set(ANGBAND_COMMANDS.map((command) => command.id)).size).toBe(ANGBAND_COMMANDS.length);
    for (const id of PALETTE) expect(findCommand(id), id).toBeDefined();
    expect(findCommand('look')!.shortcut).toBe('l (roguelike x)');
  });
});

describe('docks', () => {
  const base: DockState = { hp: 20, maxHp: 20, run: false };

  it('lead with what is underfoot', () => {
    expect(mapLead({ ...base, underFeature: 'down' })?.command).toBe('downstairs');
    expect(mapLead({ ...base, underFeature: 'shop' })).toMatchObject({
      command: 'hold',
      label: 'Enter shop',
    });
    expect(mapLead({ ...base, underObjects: 2 })?.command).toBe('pickup');
    expect(mapLead(base)).toBeNull();
  });

  it('exploring, monsters in view, adjacent, low health', () => {
    expect(ids(controlsFor('map', base))).toEqual(['rest', 'inventory', 'look', 'shell:palette']);
    expect(ids(controlsFor('map', { ...base, doorsAdjacent: 1 }))[0]).toBe('open');
    const archer = controlsFor('map', { ...base, monstersInView: 1, canFire: true });
    expect(actions(archer)[0]).toMatchObject({ command: 'fire-nearest', emphasis: 'primary' });
    expect(ids(controlsFor('map', { ...base, monstersInView: 1 }))[0]).toBe('throw');
    const melee = controlsFor('map', { ...base, monstersInView: 1, monstersAdjacent: 1, attackDir: 6 });
    expect(actions(melee)[0]).toMatchObject({ command: `${ATTACK}6`, label: 'Attack', emphasis: 'primary' });
    const caster = controlsFor('map', { ...base, caster: true });
    expect(ids(caster)).toContain('cast');
    const hurt = controlsFor('map', { ...base, hp: 5, monstersInView: 1 });
    expect(actions(hurt)[0]).toMatchObject({ command: 'quaff', emphasis: 'primary' });
    const running = controlsFor('map', { ...base, run: true });
    expect(actions(running)[0]).toMatchObject({ command: 'run', active: true });
  });

  it('prompts', () => {
    const saves = controlsFor('select', base, [], null, [
      { row: 3, label: 'New game' },
      { row: 4, label: 'Tester: Tester the Human Warrior, level 1' },
    ]);
    expect(actions(saves).map((action) => [action.command, action.label])).toEqual([
      [`${SAVE_ROW}3`, 'New character'],
      [`${SAVE_ROW}4`, 'Continue Tester: Tester the Human Warrior, level 1'],
    ]);
    const item = controlsFor('item', base, [{ key: 'a', label: '3 Rations of Food' }], {
      equip: true,
      inven: false,
      quiver: false,
      floor: true,
    });
    expect(ids(item)).toEqual([`${CHOOSE}a`, 'show-equip', 'floor-item', 'cancel']);
    expect(ids(controlsFor('aim', { ...base, prompt: "Direction ('*' or <click> to target" }))).toEqual([
      'aim-closest',
      'choose-target',
      'cancel',
    ]);
    expect(ids(controlsFor('aim', { ...base, prompt: "Direction ('5' for target, ..." }))[1]).toBe(
      'aim-target',
    );
    expect(controlsFor('direction', base).directionPad?.center).toBeNull();
    expect(ids(controlsFor('more', { ...base, bottom: '[Press ESC to exit, any other key ...]' }))[0]).toBe(
      'cancel',
    );
    expect(ids(controlsFor('store', base))).toEqual(['buy', 'sell', 'store-examine', 'inventory', 'cancel']);
    expect(ids(controlsFor('text', base))[0]).toBe('shell:keyboard');
  });
});

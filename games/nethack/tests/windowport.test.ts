import { describe, expect, it } from 'vitest';
import type { TouchAction } from '@rogue-archive/game-api';
import {
  DIR,
  FIGHT,
  FIRE,
  KEY,
  NETHACK_COMMANDS,
  TEXT,
  controlsFor,
  dynamicKeys,
  keyToNetHack,
  mapLead,
  promptChoices,
} from '../adapter/input.ts';
import { TROUBLE, directionTo, heroCell, parseState, type NetHackState } from '../adapter/state.ts';
import {
  WindowPort,
  promptContext,
  type NhFrame,
  type NhInput,
  type NhModule,
} from '../adapter/windowport.ts';

/**
 * A stand-in for the WebAssembly module: a byte heap for the pointers the
 * window port reads and writes, and the glue functions it calls.
 */
function fakeModule() {
  const heap = new DataView(new ArrayBuffer(1 << 16));
  let top = 1024;
  const strings = new Map<number, string>();
  const menus = new Map<number, number[]>();
  const selected: { window: number; indices: number[]; counts: number[] }[] = [];
  const malloc = (size: number) => {
    const ptr = top;
    top += Math.max(8, size + ((8 - (size % 8)) % 8));
    return ptr;
  };
  const glyphs = new Map<number, { ch: number; color: number; tile: number; flags: number }>();
  const mod: NhModule = {
    UTF8ToString: (ptr) => strings.get(ptr) ?? '',
    stringToUTF8: (text, ptr) => {
      strings.set(ptr, text);
    },
    getValue: (ptr, type) => (type === 'i16' ? heap.getInt16(ptr, true) : heap.getInt32(ptr, true)),
    setValue: (ptr, value, type) =>
      type === 'i16' ? heap.setInt16(ptr, value, true) : heap.setInt32(ptr, value, true),
    _malloc: malloc,
    _ra_free: () => undefined,
    _ra_gi_char: (info) => glyphs.get(info)?.ch ?? 32,
    _ra_gi_color: (info) => glyphs.get(info)?.color ?? 8,
    _ra_gi_tile: (info) => glyphs.get(info)?.tile ?? -1,
    _ra_gi_flags: (info) => glyphs.get(info)?.flags ?? 0,
    _ra_gi_glyph: (info) => (glyphs.has(info) ? 1 : -1),
    _ra_menu_start: (window) => void menus.set(window, []),
    _ra_menu_keep: (window, value) => {
      const list = menus.get(window) ?? [];
      list.push(value);
      menus.set(window, list);
      return list.length - 1;
    },
    _ra_menu_selectable: (window, index) => ((menus.get(window)?.[index] ?? 0) !== 0 ? 1 : 0),
    _ra_menu_select: (window, out, indices, counts, n) => {
      const read = (base: number) => Array.from({ length: n }, (_, i) => heap.getInt32(base + i * 4, true));
      selected.push({ window, indices: read(indices), counts: read(counts) });
      heap.setInt32(out, 4242, true);
      return n;
    },
    _ra_ext_cmd_index: (ptr) => (strings.get(ptr) === 'pray' ? 7 : -1),
    _ra_conditions: (mask, out) => void strings.set(out, mask & 2 ? ' Blind' : ''),
    _ra_file_text: () => 0,
    _ra_set_plname: () => undefined,
    _ra_state: () => 512,
    _ra_state_fields: () => 10,
  };
  return { mod, heap, strings, selected, glyphs, malloc };
}

/** A window port whose player presses the given keys in turn. */
function setup(keys: (number | string)[] = []) {
  const fake = fakeModule();
  const frames: NhFrame[] = [];
  const messages: string[] = [];
  const queue: NhInput[] = keys.map((key) => ({ key: typeof key === 'string' ? key.charCodeAt(0) : key }));
  const port = new WindowPort({
    nextInput: () => {
      const next = queue.shift();
      return next ? Promise.resolve(next) : new Promise<NhInput>(() => undefined);
    },
    frame: (frame) => frames.push({ ...frame, cells: frame.cells.slice() }),
    message: (text) => messages.push(text),
    delay: () => Promise.resolve(),
  });
  port.attach(fake.mod);
  const row = (y: number) => {
    const frame = frames.at(-1)!;
    let text = '';
    for (let x = 0; x < 80; x++) text += String.fromCharCode(frame.cells[(y * 80 + x) * 2]!);
    return text.trimEnd();
  };
  return { port, fake, frames, messages, row };
}

describe('NetHack window port', () => {
  it('draws the map, the message line and tty’s two status lines', async () => {
    const { port, fake, messages, row } = setup();
    const map = (await port.call('shim_create_nhwindow', 3)) as number;
    const msg = (await port.call('shim_create_nhwindow', 1)) as number;
    fake.glyphs.set(900, { ch: 64, color: 15, tile: 330, flags: 0 });
    fake.glyphs.set(904, { ch: 100, color: 7, tile: 12, flags: 0x10 });
    await port.call('shim_print_glyph', map, 10, 5, 900, 0);
    await port.call('shim_print_glyph', map, 11, 5, 904, 0);
    await port.call('shim_putstr', msg, 0, 'Hello, welcome to NetHack!');
    const text = (field: number, value: string) => {
      const ptr = fake.malloc(32);
      fake.strings.set(ptr, value);
      return port.call('shim_status_update', field, ptr, 0, 0, 8, 0);
    };
    await text(0, 'Tester the Stripling');
    await text(1, '18/02');
    await text(20, 'Dlvl:1');
    await text(10, '$:0');
    await text(18, '12');
    await text(19, '14');
    const mask = fake.malloc(4);
    fake.heap.setInt32(mask, 2, true);
    await port.call('shim_status_update', 22, mask, 0, 0, 8, 0);
    await port.call('shim_status_update', -1, 0, 0, 0, 8, 0);
    expect(row(0)).toBe('Hello, welcome to NetHack!');
    expect(row(6).slice(9, 11)).toBe('@d');
    expect(row(22)).toBe('Tester the Stripling St:18/02');
    expect(row(23)).toBe('Dlvl:1 $:0 HP:12(14) Blind');
    expect(messages).toEqual(['Hello, welcome to NetHack!']);
    expect(port.statusLines()[1]).toContain('HP:12(14)');
  });

  it('answers yn_function as tty: Esc gives q or n, Enter the default, other keys wait', async () => {
    expect(await setup([27]).port.call('shim_yn_function', 'Really quit?', 'ynq', 110)).toBe(113);
    expect(await setup([27]).port.call('shim_yn_function', 'Really save?', 'yn', 110)).toBe(110);
    expect(await setup([13]).port.call('shim_yn_function', 'Really save?', 'yn', 110)).toBe(110);
    expect(await setup(['x', 'Y']).port.call('shim_yn_function', 'Really save?', 'yn', 110)).toBe(121);
    // No choices (an item or a direction prompt): any key is the answer.
    expect(
      await setup(['f']).port.call('shim_yn_function', 'What do you want to eat? [f or ?*]', '', 0),
    ).toBe(102);
  });

  it('runs a menu with tty’s keys and returns the chosen identifiers', async () => {
    const { port, fake, frames } = setup(['b']);
    const w = (await port.call('shim_create_nhwindow', 4)) as number;
    await port.call('shim_start_menu', w, 0);
    await port.call('shim_add_menu', w, 0, 0, 0, 0, 0, 0, 'Weapons', 0);
    await port.call('shim_add_menu', w, 0, 11, 0, 0, 0, 0, 'a spear', 0);
    await port.call('shim_add_menu', w, 0, 22, 0, 0, 0, 0, 'a dagger', 0);
    await port.call('shim_end_menu', w, 'Wield what?');
    const out = fake.malloc(4);
    expect(await port.call('shim_select_menu', w, 1, out)).toBe(1);
    expect(fake.selected).toEqual([{ window: w, indices: [2], counts: [-1] }]);
    expect(fake.heap.getInt32(out, true)).toBe(4242);
    // While waiting, the menu was on screen as tty draws it, with letters assigned.
    const menuFrame = frames.find((frame) => frame.context === 'menu')!;
    expect(menuFrame.menu?.items.map((item) => [String.fromCharCode(item.key || 32), item.text])).toEqual([
      [' ', 'Weapons'],
      ['a', 'a spear'],
      ['b', 'a dagger'],
    ]);
    expect(menuFrame.overlay).toMatchObject({ y: 0 });
  });

  it('selects several items with counts and accepts with Enter; Esc cancels', async () => {
    const { port, fake } = setup(['a', '3', 'b', 13]);
    const w = (await port.call('shim_create_nhwindow', 4)) as number;
    await port.call('shim_start_menu', w, 0);
    await port.call('shim_add_menu', w, 0, 1, 0, 0, 0, 0, 'gold', 0);
    await port.call('shim_add_menu', w, 0, 2, 0, 0, 0, 0, 'arrows', 0);
    const out = fake.malloc(4);
    expect(await port.call('shim_select_menu', w, 2, out)).toBe(2);
    expect(fake.selected[0]).toEqual({ window: w, indices: [0, 1], counts: [-1, 3] });
    const cancel = setup([27]);
    const w2 = (await cancel.port.call('shim_create_nhwindow', 4)) as number;
    await cancel.port.call('shim_start_menu', w2, 0);
    await cancel.port.call('shim_add_menu', w2, 0, 1, 0, 0, 0, 0, 'gold', 0);
    expect(await cancel.port.call('shim_select_menu', w2, 2, cancel.fake.malloc(4))).toBe(-1);
  });

  it('reads lines for getlin and extended commands; Esc gives "\\033"', async () => {
    const { port, fake } = setup(['E', 'l', 'b', 8, 'r', 'e', 'b', 'e', 13]);
    const buffer = fake.malloc(256);
    await port.call('shim_getlin', 'What do you want to name it?', buffer);
    expect(fake.strings.get(buffer)).toBe('Elrebe');
    const esc = setup([27]);
    const b2 = esc.fake.malloc(256);
    await esc.port.call('shim_getlin', 'Name?', b2);
    expect(esc.fake.strings.get(b2)).toBe('\u001b');
    expect(await setup(['p', 'r', 'a', 'y', 13]).port.call('shim_get_ext_cmd')).toBe(7);
    expect(await setup([27]).port.call('shim_get_ext_cmd')).toBe(-1);
  });

  it('returns map clicks from nh_poskey with the cell in NetHack’s coordinates', async () => {
    const fake = fakeModule();
    const port = new WindowPort({
      nextInput: () => Promise.resolve({ click: { x: 12, y: 6, button: 1 } }),
      frame: () => undefined,
      message: () => undefined,
      delay: () => Promise.resolve(),
    });
    port.attach(fake.mod);
    const [x, y, mod] = [fake.malloc(2), fake.malloc(2), fake.malloc(4)];
    expect(await port.call('shim_nh_poskey', x, y, mod)).toBe(0);
    expect([fake.heap.getInt16(x, true), fake.heap.getInt16(y, true), fake.heap.getInt32(mod, true)]).toEqual(
      [13, 5, 1],
    );
  });

  it('chooses NetHack’s own role selection and safe string returns', async () => {
    const { port } = setup();
    expect(await port.call('shim_player_selection_or_tty')).toBe(true);
    expect(await port.call('shim_getmsghistory', true)).toBe('');
  });
});

describe('NetHack prompts, keys and docks', () => {
  it('tells item, direction and answer prompts apart', () => {
    expect(promptContext('What do you want to eat? [fg or ?*]', '')).toBe('item');
    expect(promptContext('In what direction?', '')).toBe('direction');
    expect(
      promptContext("Shall I pick character's race, role, gender and alignment for you? [ynaq]", ''),
    ).toBe('yn');
    expect(promptContext('Really save?', 'yn')).toBe('yn');
    expect(promptChoices('Really save? [yn] (n)')).toEqual(['y', 'n']);
    expect(promptChoices('What do you want to wield? [- a-c or ?*]')).toEqual(['-', 'a', 'b', 'c']);
  });

  it('maps the shell’s keys to NetHack’s (vi keys, Shift runs, Ctrl, Alt as meta)', () => {
    const key = (k: string, mods: Partial<{ shift: boolean; ctrl: boolean; alt: boolean }> = {}, code = '') =>
      keyToNetHack({
        type: 'key',
        key: k,
        code,
        modifiers: { shift: false, ctrl: false, alt: false, meta: false, ...mods },
      });
    expect(key('ArrowUp')).toEqual([107]);
    expect(key('ArrowLeft', { shift: true })).toEqual([72]);
    expect(key('7', {}, 'Numpad7')).toEqual([121]);
    expect(key('d', { ctrl: true })).toEqual([4]);
    expect(key('p', { alt: true })).toEqual([112 | 0x80]);
    expect(key('Escape')).toEqual([27]);
    expect(key('F1')).toBeNull();
  });

  it('offers each prompt’s answers and a dock per context', () => {
    const dock = { state: null, prompt: 'Really save? [yn] (n)', menu: null };
    const yn = controlsFor('yn', dock).actions.map((a) =>
      typeof a === 'string' ? a : (a.label ?? a.command),
    );
    expect(yn).toEqual(['Yes', 'No', 'cancel']);
    expect(controlsFor('yn', dock).actions[0]).toMatchObject({ command: `${KEY}121` });
    expect(controlsFor('direction', dock).directionPad?.center).toBe('self');
    expect(controlsFor('start', dock).actions).toEqual([]);
  });

  it('labels character creation’s questions and menus by what they do', () => {
    const label = (a: TouchAction | string) => (typeof a === 'string' ? a : (a.label ?? a.command));
    const pick = controlsFor('yn', {
      state: null,
      prompt: 'Shall I pick a character for you? [ynaq]',
      menu: null,
    }).actions.map(label);
    expect(pick).toEqual(['Pick for me', 'Let me choose', 'Pick, no questions', 'Quit', 'cancel']);
    const item = (key: string, text: string) => ({ key: key.charCodeAt(0), text });
    // A short menu: a button per choice.
    const ok = controlsFor('menu', {
      state: null,
      prompt: '',
      menu: {
        how: 1,
        page: 0,
        pages: 1,
        items: [
          { key: 0, text: 'Tester, lawful female dwarvish Valkyrie' },
          item('y', 'Yes; start game'),
          item('n', 'No; choose role again'),
          item('q', 'Quit'),
        ],
      },
    }).actions;
    expect(ok.map(label)).toEqual(['Yes; start game', 'No; choose role again', 'Quit', 'cancel']);
    expect(ok[0]).toMatchObject({ command: `${KEY}121`, emphasis: 'primary' });
    // A long one (the roles): its Random line.
    const roles = 'abcdefghijklm'.split('').map((key) => item(key, `role ${key}`));
    const role = controlsFor('menu', {
      state: null,
      prompt: '',
      menu: { how: 1, page: 0, pages: 1, items: [...roles, item('*', 'Random'), item('q', 'Quit')] },
    }).actions.map(label);
    expect(role).toEqual(['Random', 'cancel']);
  });

  it('reads the state snapshot', () => {
    const state = parseState([
      1, 12, 16, 3, 5, 2, 40, 10, 77, 2, 1, 2, 3, 0b10010, 100, 4, 70, 3, 32, 1, 1, 1, 0, 1, 0,
    ]);
    expect(state).toMatchObject({
      underfoot: 'down',
      objects: 2,
      containerHere: true,
      corpseHere: true,
      adjacent: [1, 4],
      adjacentChar: 'd',
      target: { dir: 4, char: 'F', distance: 3 },
      trouble: TROUBLE.hp,
      encumbrance: 1,
      quiverReady: true,
      spellsKnown: true,
      unpaid: false,
      carryingCorpse: true,
      choosingPosition: false,
    });
    expect(state).toMatchObject({
      inGame: true,
      hp: 12,
      hpMax: 16,
      depth: 2,
      x: 40,
      y: 10,
      moves: 77,
      hunger: 2,
    });
    expect(heroCell(state)).toEqual({ x: 39, y: 11 });
  });
});

describe('NetHack touch controls (docs/design/nethack-controls.md)', () => {
  const base: NetHackState = parseState([1, 20, 20, 5, 5, 1, 40, 10, 100, 1]);
  const at = (extra: Partial<NetHackState>): NetHackState => ({ ...base, ...extra });
  const dock = (state: NetHackState, extra: object = {}) => ({ state, prompt: '', menu: null, ...extra });
  const commands = (state: NetHackState, extra: object = {}) =>
    controlsFor('map', dock(state, extra)).actions.map((a) => (typeof a === 'string' ? a : a.command));
  const labels = (state: NetHackState) =>
    controlsFor('map', dock(state)).actions.map((a) => (typeof a === 'string' ? a : (a.label ?? a.command)));

  it('explores with Search, Travel, Pack, Look and More, and a lead for the place', () => {
    expect(commands(base)).toEqual(['search', 'travel', 'inventory', 'farlook', 'shell:palette']);
    expect(labels(at({ underfoot: 'down' }))[0]).toBe('Down >');
    expect(commands(at({ objects: 2 }))[0]).toBe('pickup');
    expect(commands(at({ objects: 1, containerHere: true }))[0]).toBe('loot');
    expect(commands(at({ underfoot: 'altar', carryingCorpse: true }))[0]).toBe('offer');
    expect(labels(at({ underfoot: 'fountain' }))[0]).toBe('Drink');
    expect(commands(at({ underfoot: 'throne' }))[0]).toBe('sit');
    expect(commands(at({ hunger: 2 }))[0]).toBe('eat');
    expect(commands(at({ encumbrance: 2 }))[0]).toBe('drop-many');
    // Priority: a skill to enhance, then paying, then the stairs.
    expect(mapLead(at({ unpaid: true, underfoot: 'down' }), true)?.command).toBe('enhance');
    expect(mapLead(at({ unpaid: true, underfoot: 'down' }))?.command).toBe('pay');
    expect(mapLead(at({ underfoot: 'down', objects: 3 }))?.command).toBe('downstairs');
  });

  it('fights an adjacent monster in one tap, and fires at one lined up with a loaded quiver', () => {
    const adjacent = controlsFor('map', dock(at({ adjacent: [1], adjacentChar: 'd' }))).actions;
    expect(adjacent[0]).toMatchObject({ command: `${FIGHT}1`, label: 'Fight ↖d', emphasis: 'primary' });
    expect(dynamicKeys(`${FIGHT}1`)).toEqual([70, 121]);
    const lined = controlsFor(
      'map',
      dock(at({ target: { dir: 4, char: 'j', distance: 4 }, quiverReady: true })),
    ).actions;
    expect(lined[0]).toMatchObject({ command: `${FIRE}4`, label: 'Fire →j', emphasis: 'primary' });
    expect(dynamicKeys(`${FIRE}4`)).toEqual([102, 108]);
    // No quiver: Throw instead; spells known: Cast, else Zap; Elbereth always there.
    const noQuiver = commands(at({ target: { dir: 4, char: 'j', distance: 4 } }));
    expect(noQuiver[0]).toBe('throw');
    expect(noQuiver).toContain('zap');
    expect(noQuiver).toContain('elbereth');
    expect(commands(at({ adjacent: [0], spellsKnown: true }))).toContain('cast');
  });

  it('prays, heals and holds them off when in trouble the player can see', () => {
    expect(commands(at({ trouble: TROUBLE.hp }))).toEqual([
      'pray',
      'quaff',
      'elbereth',
      'travel-up',
      'inventory',
      'shell:palette',
    ]);
    expect(commands(at({ trouble: TROUBLE.hunger, adjacent: [2], adjacentChar: 'k' }))[3]).toBe(`${FIGHT}2`);
    // Blindness or levitation alone are not a reason to pray.
    expect(commands(at({ trouble: TROUBLE.blind | TROUBLE.levitating }))[0]).toBe('search');
  });

  it('suggests Elbereth only with strategy shortcuts on', () => {
    const off = controlsFor('map', dock(at({ trouble: TROUBLE.hp }), { shortcuts: false }));
    expect(off.actions.map((a) => (typeof a === 'string' ? a : a.command))).not.toContain('elbereth');
    expect(off.palette).not.toContain('elbereth');
    for (const action of off.actions)
      if (typeof action !== 'string') expect(action.alternates ?? []).not.toContain('elbereth');
    const engrave = controlsFor(
      'getlin',
      dock(base, { prompt: 'What do you want to write in the dust here?', shortcuts: false }),
    );
    expect(engrave.actions.map((a) => (typeof a === 'string' ? a : a.command))).not.toContain(
      `${TEXT}Elbereth`,
    );
    expect(controlsFor('map', dock(at({ trouble: TROUBLE.hp }), { shortcuts: true })).palette).toContain(
      'elbereth',
    );
  });

  it('answers directions, positions, item prompts and engravings', () => {
    const direction = controlsFor('direction', dock(at({ adjacent: [6], adjacentChar: 'r' }))).actions;
    expect(direction[0]).toMatchObject({ command: `${DIR}6`, label: 'At ↓r' });
    expect(dynamicKeys(`${DIR}6`)).toEqual([106]);
    expect(
      controlsFor('position', dock(base)).actions.map((a) => (typeof a === 'string' ? a : a.command)),
    ).toEqual(['pos-select', 'pos-monster', 'pos-stairs-down', 'pos-self', 'cancel']);
    const item = controlsFor(
      'item',
      dock(base, { prompt: 'What do you want to write with? [- abc or ?*]' }),
    ).actions;
    expect(item.map((a) => (typeof a === 'string' ? a : a.command))).toContain('hands');
    // A few items: a button each, named from the game's answer to `?`.
    const food = controlsFor(
      'item',
      dock(base, {
        prompt: 'What do you want to eat? [d or ?*]',
        messages: ['What do you want to eat? [d or ?*] ?', 'd - an uncursed food ration.'],
      }),
    ).actions;
    expect(food[0]).toMatchObject({ command: `${KEY}100`, label: 'd food ration', emphasis: 'primary' });
    const two = controlsFor(
      'item',
      dock(base, {
        prompt: 'What do you want to eat? [d or ?*]',
        messages: ['d - 2 uncursed food rations.'],
      }),
    ).actions;
    expect(two[0]).toMatchObject({ label: 'd 2 food rations' });
    const engrave = controlsFor(
      'getlin',
      dock(base, { prompt: 'What do you want to write in the dust here?' }),
    );
    expect(engrave.actions[0]).toMatchObject({ command: `${TEXT}Elbereth` });
    expect(dynamicKeys(`${TEXT}Elbereth`)).toEqual([...[...'Elbereth'].map((c) => c.charCodeAt(0)), 13]);
  });

  it('turns a tap into the direction NetHack reads from a sloppy click', () => {
    const hero = at({ x: 40, y: 10 }); // screen cell (39, 11)
    expect(directionTo(hero, { x: 45, y: 11 })).toBe(4);
    expect(directionTo(hero, { x: 38, y: 10 })).toBe(1);
    expect(directionTo(hero, { x: 39, y: 11 })).toBeNull();
  });

  it('gives every command a key, and every dock command is known', () => {
    for (const command of NETHACK_COMMANDS)
      if (command.id !== 'elbereth') expect(command.keys.length, command.id).toBeGreaterThan(0);
    const ids = new Set(NETHACK_COMMANDS.map((command) => command.id));
    const situations = [
      base,
      at({ underfoot: 'down', objects: 1 }),
      at({ adjacent: [3], adjacentChar: 'x', target: { dir: 3, char: 'x', distance: 1 }, quiverReady: true }),
      at({ trouble: TROUBLE.hp, adjacent: [0] }),
    ];
    for (const state of situations)
      for (const action of controlsFor('map', dock(state, { enhance: true })).actions) {
        const id = typeof action === 'string' ? action : action.command;
        if (id.startsWith('shell:') || dynamicKeys(id)) continue;
        expect(ids.has(id), id).toBe(true);
        for (const alternate of (typeof action === 'string' ? [] : action.alternates) ?? [])
          expect(ids.has(alternate), alternate).toBe(true);
      }
  });
});

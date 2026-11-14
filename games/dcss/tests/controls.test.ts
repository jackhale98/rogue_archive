import type { TouchAction, TouchControlLayout } from '@rogue-archive/game-api';
import { describe, expect, it } from 'vitest';
import { controlsFor, latchedMove, quiverLabel, type ControlState } from '../adapter/input.ts';
import {
  GameTracker,
  InputMode,
  NO_MAP_CONTEXT,
  parseLines,
  underfootHere,
  type MapContext,
} from '../adapter/state.ts';

const apply = (tracker: GameTracker, messages: object[]) => {
  for (const message of parseLines([JSON.stringify({ msg: 'multi', msgs: messages })]))
    tracker.apply(message);
};

const base: ControlState = { hp: 20, hpMax: 20, run: false };
const map = (extra: Partial<MapContext>): MapContext => ({ ...NO_MAP_CONTEXT, ...extra });
const actions = (layout: TouchControlLayout) => layout.actions as TouchAction[];
const commands = (layout: TouchControlLayout) => actions(layout).map((action) => action.command);
const find = (layout: TouchControlLayout, command: string) =>
  actions(layout).find((action) => action.command === command);

describe('DCSS map docks', () => {
  it('explores when nothing is in view, and offers Travel on the stairs button', () => {
    const layout = controlsFor('map', base);
    expect(commands(layout)).toEqual(['explore', 'travel', 'cast', 'inventory', 'look', 'shell:palette']);
    expect(find(layout, 'travel')?.label).toBe('Travel');
  });

  it('rests when badly hurt, but only with no monster in view', () => {
    expect(commands(controlsFor('map', { ...base, hp: 5 }))[0]).toBe('rest');
    const fighting = controlsFor('map', { ...base, hp: 5, map: map({ hostiles: 1, adjacent: 1 }) });
    expect(commands(fighting)).not.toContain('rest');
    expect(commands(fighting)[0]).toBe('autofight');
  });

  it('keeps a latched Run (or Attack) visible when wounded and in a fight', () => {
    const wounded = actions(controlsFor('map', { ...base, hp: 5, run: true }))[0];
    expect(wounded).toMatchObject({ command: 'run', active: true });
    const fight = actions(controlsFor('map', { ...base, attack: true, map: map({ hostiles: 2 }) }));
    expect(fight[0]).toMatchObject({ command: 'attack', active: true });
    expect(fight[1]!.command).toBe('autofight');
  });

  it('turns into a combat dock with monsters in view: no Explore, Fire shows the quiver', () => {
    const layout = controlsFor('map', {
      ...base,
      map: map({ hostiles: 2, adjacent: 0, maxThreat: 2 }),
      quiver: '<lightgrey>Throw: </lightgrey><white>3 darts</white>',
    });
    expect(commands(layout)).toEqual(['autofight', 'autofire', 'cast', 'quaff', 'look', 'shell:palette']);
    expect(find(layout, 'autofire')?.label).toBe('Throw: 3 darts');
    expect(find(layout, 'autofire')?.alternates).toEqual(
      expect.arrayContaining(['fire', 'quiver', 'quiver-next', 'quiver-previous']),
    );
    expect(JSON.stringify(layout.actions)).not.toContain('"explore"');
  });

  it('labels the stairs button from what is underfoot', () => {
    const label = (underfoot: MapContext['underfoot']) => {
      const action = actions(controlsFor('map', { ...base, map: map({ underfoot }) }))[1]!;
      return [action.command, action.label, action.emphasis ?? ''];
    };
    expect(label('down')).toEqual(['downstairs', 'Down >', 'primary']);
    expect(label('branch')).toEqual(['downstairs', 'Down >', 'primary']);
    expect(label('up')).toEqual(['upstairs', 'Up <', '']);
    expect(label('altar')).toEqual(['downstairs', 'Pray', 'primary']);
    expect(label('shop')).toEqual(['downstairs', 'Shop', 'primary']);
    expect(label('portal')).toEqual(['downstairs', 'Enter >', 'primary']);
    expect(label('exit')).toEqual(['upstairs', 'Exit <', '']);
    expect(label(null)).toEqual(['travel', 'Travel', '']);
  });

  it('puts the stairs first with the Orb or with Zot approaching', () => {
    const layout = controlsFor('map', { ...base, escape: true, map: map({ underfoot: 'up' }) });
    expect(actions(layout)[0]).toMatchObject({ command: 'upstairs', label: 'Up <', emphasis: 'primary' });
    expect(commands(layout)[1]).toBe('explore');
  });

  it('leads with abilities once the game said there are no spells', () => {
    expect(commands(controlsFor('map', { ...base, caster: null }))).toContain('cast');
    const layout = controlsFor('map', { ...base, caster: false });
    expect(commands(layout)[2]).toBe('abilities');
    expect(find(layout, 'abilities')?.alternates).toContain('cast');
  });
});

describe('DCSS prompt and menu docks', () => {
  it('splits aiming, looking and directions', () => {
    expect(commands(controlsFor('aim', base))).toEqual(['confirm', 'next-target', 'quiver-next', 'cancel']);
    expect(actions(controlsFor('aim', base))[0]!.label).toBe('Fire');
    expect(commands(controlsFor('look', base))).toEqual([
      'confirm',
      'next-target',
      'describe-target',
      'cancel',
    ]);
    expect(actions(controlsFor('look', base))[0]!.label).toBe('Select');
    const direction = controlsFor('direction', base);
    expect(commands(direction)).toEqual(['cancel']);
    expect(direction.directionPad).toBeDefined();
  });

  it('offers menu keys by tag', () => {
    const menu = (tag: string, flags = 0) =>
      commands(controlsFor('menu', { ...base, menu: { tag, flags, always: false } }));
    expect(menu('travel')).toEqual([
      'downstairs',
      'upstairs',
      'travel-repeat',
      'travel-altars',
      'cancel',
      'shell:keyboard',
    ]);
    expect(menu('pickup')).toContain('select-all');
    expect(menu('inventory', 0x4)).toContain('select-all');
    expect(menu('spell')).toContain('menu-mode');
    expect(menu('ability')).toContain('menu-mode');
    expect(menu('inventory')).toEqual(['cancel', 'page-up', 'page-down', 'confirm', 'shell:keyboard']);
  });

  it('offers Always when the question has it', () => {
    expect(commands(controlsFor('yesno', base))).toEqual(['yes', 'no', 'cancel']);
    const always = controlsFor('yesno', { ...base, menu: { tag: 'prompt', flags: 0, always: true } });
    expect(commands(always)).toEqual(['yes', 'no', 'always', 'cancel']);
  });

  it('answers the stat increase with Str, Int and Dex', () => {
    expect(commands(controlsFor('prompt', { ...base, statPrompt: true }))).toEqual([
      'stat-str',
      'stat-int',
      'stat-dex',
      'shell:keyboard',
    ]);
  });
});

describe('DCSS control helpers', () => {
  it('labels the quivered action', () => {
    expect(quiverLabel('<lightgrey>Fire: </lightgrey>a) +0 shortbow')).toBe('Fire: +0 shortbow');
    expect(quiverLabel('Cast: Magic Dart')).toBe('Cast: Magic Dart');
    expect(quiverLabel('Throw: 12 poisoned darts of the jackal')).toBe('Throw: 12 poisoned…');
    expect(quiverLabel('<darkgrey>Nothing quivered</darkgrey>')).toBeNull();
    expect(quiverLabel(undefined)).toBeNull();
  });

  it('turns a latched pad move into a run or an attack', () => {
    expect(latchedMove('move-w', 'run')).toEqual({ key: 'H', shift: true });
    expect(latchedMove('move-ne', 'attack')).toEqual({ key: 'u', code: 'KeyU', ctrl: true });
    expect(latchedMove('wait', 'attack')).toBeNull();
  });

  it('tells portal vault exits from portals', () => {
    const portal = map({ underfoot: 'portal' });
    expect(underfootHere(portal, 'Dungeon')).toBe('portal');
    expect(underfootHere(portal, 'a Sewer')).toBe('exit');
    expect(underfootHere(portal, 'an Ossuary')).toBe('exit');
    expect(underfootHere(portal, 'Zig')).toBe('exit');
    expect(underfootHere(portal, 'The Abyss')).toBe('portal');
    expect(underfootHere(map({ underfoot: 'down' }), 'a Sewer')).toBe('down');
  });
});

describe('DCSS tracker: menus, prompts and status', () => {
  it('follows menu tags, flags, Always and replaced menus', () => {
    const tracker = new GameTracker();
    apply(tracker, [
      { msg: 'map' },
      { msg: 'input_mode', mode: InputMode.COMMAND },
      { msg: 'menu', tag: 'travel', flags: 2 },
    ]);
    expect(tracker.menu).toMatchObject({ tag: 'travel', flags: 2, always: false });
    apply(tracker, [{ msg: 'menu', tag: 'travel', replace: 1 }]);
    expect(tracker.menus).toEqual(['travel']);
    apply(tracker, [
      {
        msg: 'menu',
        tag: 'prompt',
        items: [
          { text: 'Yes', hotkeys: [89, 121] },
          { text: 'No', hotkeys: [78, 110] },
          { hotkeys: [65, 97] },
        ],
      },
    ]);
    expect(tracker.context()).toBe('yesno');
    expect(tracker.menu?.always).toBe(true);
    apply(tracker, [{ msg: 'close_menu' }, { msg: 'close_menu' }]);
    expect(tracker.context()).toBe('map');
  });

  it('recognises the stat increase prompt until it is answered', () => {
    const tracker = new GameTracker();
    apply(tracker, [
      { msg: 'map' },
      { msg: 'msgs', messages: [{ text: 'Increase (S)trength, (I)ntelligence, or (D)exterity? ' }] },
      { msg: 'input_mode', mode: InputMode.PROMPT },
    ]);
    expect(tracker.statPrompt).toBe(true);
    apply(tracker, [{ msg: 'msgs', messages: [{ text: 'Uppercase letters only, please.' }] }]);
    expect(tracker.statPrompt).toBe(true);
    apply(tracker, [
      { msg: 'input_mode', mode: InputMode.COMMAND },
      { msg: 'input_mode', mode: InputMode.PROMPT },
    ]);
    expect(tracker.statPrompt).toBe(false);
  });

  it('learns whether the character has spells', () => {
    const tracker = new GameTracker();
    expect(tracker.caster).toBeNull();
    apply(tracker, [{ msg: 'msgs', messages: [{ text: "You don't know any spells." }] }]);
    expect(tracker.caster).toBe(false);
    apply(tracker, [{ msg: 'menu', tag: 'spell' }]);
    expect(tracker.caster).toBe(true);
  });

  it('reads the Orb and Zot lights', () => {
    const tracker = new GameTracker();
    apply(tracker, [{ msg: 'player', status: [{ light: 'Zot (2000)', col: 15 }] }]);
    expect(tracker.zotLow).toBe(false);
    apply(tracker, [
      {
        msg: 'player',
        status: [
          { light: 'Zot (500)', col: 14 },
          { light: 'Orb', col: 5 },
        ],
      },
    ]);
    expect(tracker.zotLow).toBe(true);
    expect(tracker.orb).toBe(false);
    apply(tracker, [{ msg: 'player', status: [{ light: 'Orb', col: 13 }] }]);
    expect(tracker.orb).toBe(true);
  });
});

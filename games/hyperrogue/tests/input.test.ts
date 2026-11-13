import { describe, expect, it } from 'vitest';
import type { TouchAction } from '@rogue-archive/game-api';
import {
  HYPER_COMMANDS,
  PAD,
  PALETTE,
  controlsFor,
  findCommand,
  strokeFor,
  type DockState,
} from '../adapter/input.ts';
import { TOUCH_MODE, detectContext, hintFor, parseState, type HyperState } from '../adapter/state.ts';

const QUIET: DockState = {
  ranged: false,
  wind: false,
  crossbow: false,
  fireMode: false,
  reload: 0,
  deadOrbs: 0,
  orbStrategy: false,
  minefield: false,
  touchMode: TOUCH_MODE.move,
  markMode: false,
};

const mapDock = (dock: Partial<DockState> = {}): TouchAction[] =>
  controlsFor('map', { ...QUIET, ...dock }).actions.map((action) =>
    typeof action === 'string' ? { command: action } : action,
  );
const commandsOf = (actions: TouchAction[]) => actions.map((action) => action.command);
const find = (actions: TouchAction[], command: string) =>
  actions.find((action) => action.command === command);

const STATE: HyperState = parseState([1, 12, 3, 40, 1, 4, 5, 2]);

describe('HyperRogue keys', () => {
  it('maps keys to the keyCodes and characters SDL 1 expects', () => {
    expect(strokeFor('l')).toMatchObject({ keyCode: 76, charCode: 108 });
    expect(strokeFor('S', 'KeyS', true)).toMatchObject({ keyCode: 83, charCode: 83, shift: true });
    expect(strokeFor('.')).toMatchObject({ keyCode: 190, charCode: 46 });
    expect(strokeFor('Escape')).toMatchObject({ keyCode: 27, charCode: 0 });
    expect(strokeFor(' ')).toMatchObject({ keyCode: 32, charCode: 32 });
    expect(strokeFor('F1')).toMatchObject({ keyCode: 112, charCode: 0 });
    expect(strokeFor('F5')).toMatchObject({ keyCode: 116 });
    expect(strokeFor('PageUp')).toMatchObject({ keyCode: 33 });
    expect(strokeFor('8', 'Numpad8')).toMatchObject({ keyCode: 104 });
    expect(strokeFor('ArrowUp', 'Numpad8')).toMatchObject({ keyCode: 104 });
    expect(strokeFor('!')).toMatchObject({ keyCode: 49, shift: true });
    expect(strokeFor('é')).toBeNull();
    expect(strokeFor('Meta')).toBeNull();
  });

  it('gives every key command a key, and the pad and palette only known commands', () => {
    for (const command of HYPER_COMMANDS)
      if (command.category === 'Touch') expect(command.keys, command.id).toEqual([]);
      else expect(command.keys.length, command.id).toBeGreaterThan(0);
    for (const id of [...Object.values(PAD), ...PALETTE]) expect(findCommand(id), id).toBeDefined();
    // The tap modes are offered by the dock where they apply, not the palette.
    expect(PALETTE).not.toContain('aim-mode');
    expect(PALETTE).toContain('inventory');
    expect(PALETTE).toContain('mark');
  });

  it('offers a dock for each situation', () => {
    const ids = new Set(HYPER_COMMANDS.map((command) => command.id));
    const everything = mapDock({
      ranged: true,
      wind: true,
      crossbow: true,
      deadOrbs: 1,
      orbStrategy: true,
      minefield: true,
      touchMode: TOUCH_MODE.info,
    });
    for (const action of everything) {
      if (!action.command.startsWith('shell:')) expect(ids.has(action.command), action.command).toBe(true);
      for (const alternate of action.alternates ?? []) expect(ids.has(alternate), alternate).toBe(true);
    }
    expect(controlsFor('map').directionPad).toBeDefined();
    expect(controlsFor('dialog').directionPad).toBeUndefined();
    expect(controlsFor('over').actions.length).toBeGreaterThan(0);
    expect(controlsFor('loading').actions).toEqual([]);
  });

  it('keeps the quiet map dock short: Wait is the pad centre, t only with strong wind', () => {
    const quiet = mapDock();
    expect(commandsOf(quiet)).toEqual(['recenter', 'context', 'mission', 'shell:palette']);
    expect(find(quiet, 'context')?.alternates).toEqual(['inspect-mode']);
    expect(find(quiet, 'mission')?.alternates).toEqual(['help', 'new-game', 'menu']);
    expect(findCommand('context')?.shortLabel).toBe('Overview');
    expect(PAD.center).toBe('wait');
    expect(commandsOf(mapDock({ wind: true }))[0]).toBe('target');
  });

  it('leads with what the situation offers', () => {
    expect(commandsOf(mapDock({ ranged: true }))[0]).toBe('aim-mode');
    expect(find(mapDock({ ranged: true }), 'aim-mode')?.active).toBe(false);
    expect(find(mapDock({ ranged: true, touchMode: TOUCH_MODE.ranged }), 'aim-mode')?.active).toBe(true);
    // Inspect on: a lit button switches it off (and the Overview fan drops it).
    const inspecting = mapDock({ touchMode: TOUCH_MODE.info });
    expect(inspecting[0]).toEqual({ command: 'inspect-mode', active: true });
    expect(find(inspecting, 'context')?.alternates).toBeUndefined();
    expect(commandsOf(mapDock({ deadOrbs: 0 }))).not.toContain('drop');
    expect(commandsOf(mapDock({ deadOrbs: 2 }))[0]).toBe('drop');
    expect(commandsOf(mapDock({ orbStrategy: true }))[0]).toBe('inventory');
    expect(find(mapDock({ minefield: true, markMode: true }), 'mark-mode')?.active).toBe(true);
  });

  it('shows the crossbow fire mode as a toggle and relabels Esc while it is on', () => {
    expect(commandsOf(mapDock())).not.toContain('fire-mode');
    expect(find(mapDock({ crossbow: true }), 'fire-mode')).toMatchObject({ active: false, label: 'Fire' });
    expect(find(mapDock({ crossbow: true, reload: 3 }), 'fire-mode')?.label).toBe('Fire (3)');
    const firing = mapDock({ crossbow: true, fireMode: true });
    expect(find(firing, 'fire-mode')?.active).toBe(true);
    expect(find(firing, 'mission')).toEqual({ command: 'mission', label: 'Cancel fire' });
  });

  it('reads the state snapshot and the situation', () => {
    expect(STATE).toMatchObject({
      inMap: true,
      treasure: 12,
      kills: 3,
      turns: 40,
      canMove: true,
      land: 4,
      landTreasure: 5,
      orbs: 2,
      ranged: false,
      touchMode: TOUCH_MODE.move,
    });
    const full = parseState([1, 0, 0, 9, 1, 3, 0, 4, 1, 52, 1, 1, 1, 2, 3, 1, 1, 30, 4]);
    expect(full).toMatchObject({
      ranged: true,
      targetOrb: 52,
      wind: true,
      crossbow: true,
      fireMode: true,
      reload: 2,
      deadOrbs: 3,
      orbStrategy: true,
      minefield: true,
      safety: 30,
      touchMode: TOUCH_MODE.ranged,
    });
    expect(detectContext(null)).toBe('loading');
    expect(detectContext(STATE)).toBe('map');
    expect(detectContext({ ...STATE, inMap: false })).toBe('dialog');
    expect(detectContext({ ...STATE, canMove: false })).toBe('over');
  });

  it('hints what a tap does, the orb it would use and the Orb of Safety', () => {
    const ui = { markMode: false, touching: false, targetOrbName: '' };
    const teleport = { ...STATE, targetOrb: 7 };
    expect(hintFor(STATE, ui)).toEqual([]);
    expect(hintFor(teleport, { ...ui, touching: true, targetOrbName: 'Orb of Teleport' })).toEqual([
      'Release uses Orb of Teleport',
    ]);
    // Not touching: the pointer is wherever the last tap left it.
    expect(hintFor(teleport, { ...ui, targetOrbName: 'Orb of Teleport' })).toEqual([]);
    expect(hintFor({ ...STATE, touchMode: TOUCH_MODE.ranged }, ui)[0]).toMatch(/^Aim:/);
    expect(hintFor({ ...STATE, touchMode: TOUCH_MODE.info }, ui)[0]).toMatch(/^Inspect:/);
    expect(hintFor(STATE, { ...ui, markMode: true })[0]).toMatch(/^Mark:/);
    expect(hintFor({ ...STATE, fireMode: true, reload: 1 }, ui)).toEqual(['Crossbow reloading: 1 turn']);
    expect(hintFor({ ...STATE, safety: 12 }, ui)).toEqual([
      'Orb of Safety (12): leaving now keeps this game',
    ]);
    expect(hintFor({ ...STATE, safety: 12, inMap: false }, ui)).toEqual([]);
    expect(hintFor(null, ui)).toEqual([]);
  });
});

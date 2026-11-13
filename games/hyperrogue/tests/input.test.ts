import { describe, expect, it } from 'vitest';
import { HYPER_COMMANDS, PAD, PALETTE, controlsFor, findCommand, strokeFor } from '../adapter/input.ts';
import { detectContext, parseState } from '../adapter/state.ts';

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

  it('gives every command a key, and the pad and palette only known commands', () => {
    for (const command of HYPER_COMMANDS) expect(command.keys.length, command.id).toBeGreaterThan(0);
    for (const id of [...Object.values(PAD), ...PALETTE]) expect(findCommand(id), id).toBeDefined();
  });

  it('offers a dock for each situation', () => {
    const map = controlsFor('map');
    expect(map.directionPad).toBeDefined();
    const ids = new Set(HYPER_COMMANDS.map((command) => command.id));
    for (const action of map.actions) {
      const command = typeof action === 'string' ? action : action.command;
      if (!command.startsWith('shell:')) expect(ids.has(command), command).toBe(true);
      if (typeof action !== 'string')
        for (const alternate of action.alternates ?? []) expect(ids.has(alternate), alternate).toBe(true);
    }
    expect(controlsFor('dialog').directionPad).toBeUndefined();
    expect(controlsFor('over').actions.length).toBeGreaterThan(0);
    expect(controlsFor('loading').actions).toEqual([]);
  });

  it('reads the state snapshot and the situation', () => {
    const state = parseState([1, 12, 3, 40, 1, 4, 5, 2]);
    expect(state).toEqual({
      inMap: true,
      treasure: 12,
      kills: 3,
      turns: 40,
      canMove: true,
      land: 4,
      landTreasure: 5,
      orbs: 2,
    });
    expect(detectContext(null)).toBe('loading');
    expect(detectContext(state)).toBe('map');
    expect(detectContext({ ...state, inMap: false })).toBe('dialog');
    expect(detectContext({ ...state, canMove: false })).toBe('over');
  });
});

import { describe, expect, it } from 'vitest';
import { LifecycleMachine, domKeyToInput } from '../src/index.ts';

describe('LifecycleMachine', () => {
  it('follows initialize -> start -> stop', () => {
    const machine = new LifecycleMachine();
    const seen: string[] = [];
    machine.subscribe((state) => seen.push(state));
    machine.transition('initialize');
    machine.transition('initialized');
    machine.transition('start');
    machine.transition('stop');
    machine.transition('stopped');
    expect(seen).toEqual(['initializing', 'ready', 'running', 'stopping', 'stopped']);
  });

  it('rejects starting before initialization', () => {
    const machine = new LifecycleMachine();
    expect(machine.can('start')).toBe(false);
    expect(() => machine.transition('start')).toThrow(/Invalid lifecycle transition/);
  });

  it('allows stopping a failed session', () => {
    const machine = new LifecycleMachine();
    machine.transition('initialize');
    machine.transition('fail');
    expect(machine.state).toBe('failed');
    expect(machine.can('stop')).toBe(true);
  });
});

describe('domKeyToInput', () => {
  const base = {
    key: 'a',
    code: 'KeyA',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
  };

  it('normalizes ordinary keys with modifiers', () => {
    expect(domKeyToInput({ ...base, key: 'A', shiftKey: true })).toEqual({
      type: 'key',
      key: 'A',
      code: 'KeyA',
      modifiers: { shift: true, ctrl: false, alt: false, meta: false },
    });
  });

  it('ignores modifier-only presses, IME composition and browser shortcuts', () => {
    expect(domKeyToInput({ ...base, key: 'Shift', code: 'ShiftLeft' })).toBeNull();
    expect(domKeyToInput({ ...base, isComposing: true })).toBeNull();
    expect(domKeyToInput({ ...base, key: 'r', metaKey: true })).toBeNull();
    expect(domKeyToInput({ ...base, key: 'F5', code: 'F5' })).toBeNull();
  });
});

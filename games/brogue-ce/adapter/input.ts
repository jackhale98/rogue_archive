// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Translates platform input into Brogue events, mirroring how upstream's SDL
 * platform builds `rogueEvent`s (sdl2-platform.c: eventFromKey and the
 * SDL_TEXTINPUT path). Original key bindings are preserved exactly; touch
 * commands are just named shortcuts for those same keys.
 */
import type { GameCommandDescriptor, GameInput, TouchControlLayout } from '@rogue-archive/game-api';
import { EventType, Key } from './constants.ts';
import type { BrogueEventTuple } from './protocol.ts';

const SPECIAL_KEYS: Record<string, number> = {
  Escape: Key.ESCAPE,
  ArrowUp: Key.UP_ARROW,
  ArrowDown: Key.DOWN_ARROW,
  ArrowLeft: Key.LEFT_ARROW,
  ArrowRight: Key.RIGHT_ARROW,
  Enter: Key.RETURN,
  Backspace: Key.DELETE,
  Tab: Key.TAB,
};

function keystroke(code: number, ctrl: boolean, shift: boolean): BrogueEventTuple {
  return [EventType.KEYSTROKE, code, 0, ctrl ? 1 : 0, shift ? 1 : 0];
}

/** Converts a normalized key input to a Brogue keystroke, or null if Brogue has no use for it. */
export function keyToBrogue(input: Extract<GameInput, { type: 'key' }>): BrogueEventTuple | null {
  const { key, code, modifiers } = input;
  if (modifiers.alt || modifiers.meta) return null;
  const special = SPECIAL_KEYS[key];
  if (special !== undefined) return keystroke(special, modifiers.ctrl, modifiers.shift);
  // Numpad digits with a modifier have no text input in SDL; Brogue's NUMPAD_n equal '0'..'9'.
  if (code.startsWith('Numpad') && /^[0-9]$/.test(code.slice(6))) {
    return keystroke(48 + Number(code.slice(6)), modifiers.ctrl, modifiers.shift);
  }
  if (key.length !== 1) return null;
  const charCode = key.charCodeAt(0);
  if (charCode >= 0x80) return null; // upstream ignores non-ASCII text input
  if (modifiers.ctrl) {
    // Ctrl+letter: SDL produces the letter (uppercase with shift) plus the control flag.
    const letter = /^Key([A-Z])$/.exec(code)?.[1];
    if (!letter) return null;
    return keystroke((modifiers.shift ? letter : letter.toLowerCase()).charCodeAt(0), true, modifiers.shift);
  }
  return keystroke(charCode, false, modifiers.shift);
}

/** Text typed through the on-screen keyboard: one keystroke per ASCII character. */
export function textToBrogue(text: string): BrogueEventTuple[] {
  const events: BrogueEventTuple[] = [];
  for (const char of text) {
    const code = char === '\n' ? Key.RETURN : char.charCodeAt(0);
    if (code > 0 && code < 0x80) events.push(keystroke(code, false, false));
  }
  return events;
}

interface BrogueCommand extends GameCommandDescriptor {
  keyCode: number;
}

const k = (char: string) => char.charCodeAt(0);

/** Brogue CE's commands, with their upstream key bindings (Rogue.h). */
export const BROGUE_COMMANDS: readonly BrogueCommand[] = [
  { id: 'move-nw', label: 'Move up-left', shortcut: 'y', keyCode: k('y'), category: 'Movement' },
  { id: 'move-n', label: 'Move up', shortcut: 'k', keyCode: k('k'), category: 'Movement' },
  { id: 'move-ne', label: 'Move up-right', shortcut: 'u', keyCode: k('u'), category: 'Movement' },
  { id: 'move-w', label: 'Move left', shortcut: 'h', keyCode: k('h'), category: 'Movement' },
  { id: 'move-e', label: 'Move right', shortcut: 'l', keyCode: k('l'), category: 'Movement' },
  { id: 'move-sw', label: 'Move down-left', shortcut: 'b', keyCode: k('b'), category: 'Movement' },
  { id: 'move-s', label: 'Move down', shortcut: 'j', keyCode: k('j'), category: 'Movement' },
  { id: 'move-se', label: 'Move down-right', shortcut: 'n', keyCode: k('n'), category: 'Movement' },
  {
    id: 'rest',
    label: 'Rest',
    shortcut: 'z',
    keyCode: k('z'),
    category: 'Actions',
    description: 'Wait one turn.',
  },
  {
    id: 'search',
    label: 'Search',
    shortcut: 's',
    keyCode: k('s'),
    category: 'Actions',
    description: 'Search for secrets; hold for five turns.',
  },
  {
    id: 'auto-rest',
    label: 'Rest until better',
    shortLabel: 'Long rest',
    shortcut: 'Z',
    keyCode: k('Z'),
    category: 'Actions',
  },
  { id: 'explore', label: 'Explore', shortcut: 'x', keyCode: k('x'), category: 'Travel' },
  {
    id: 'descend',
    label: 'Travel to stairs down',
    shortLabel: 'Stairs ↓',
    shortcut: '>',
    keyCode: k('>'),
    category: 'Travel',
  },
  {
    id: 'ascend',
    label: 'Travel to stairs up',
    shortLabel: 'Stairs ↑',
    shortcut: '<',
    keyCode: k('<'),
    category: 'Travel',
  },
  { id: 'inventory', label: 'Inventory', shortcut: 'i', keyCode: k('i'), category: 'Items' },
  { id: 'apply', label: 'Apply / use', shortcut: 'a', keyCode: k('a'), category: 'Items' },
  { id: 'equip', label: 'Equip', shortcut: 'e', keyCode: k('e'), category: 'Items' },
  { id: 'unequip', label: 'Remove', shortcut: 'r', keyCode: k('r'), category: 'Items' },
  { id: 'drop', label: 'Drop', shortcut: 'd', keyCode: k('d'), category: 'Items' },
  { id: 'throw', label: 'Throw', shortcut: 't', keyCode: k('t'), category: 'Items' },
  { id: 'rethrow', label: 'Throw again', shortcut: 'T', keyCode: k('T'), category: 'Items' },
  { id: 'swap', label: 'Swap weapons', shortcut: 'w', keyCode: k('w'), category: 'Items' },
  { id: 'relabel', label: 'Relabel item', shortcut: 'R', keyCode: k('R'), category: 'Items' },
  { id: 'call', label: 'Call (name) item', shortcut: 'c', keyCode: k('c'), category: 'Items' },
  { id: 'messages', label: 'Message log', shortcut: 'M', keyCode: k('M'), category: 'Information' },
  { id: 'discoveries', label: 'Discoveries', shortcut: 'D', keyCode: k('D'), category: 'Information' },
  { id: 'feats', label: 'Feats', shortcut: 'F', keyCode: k('F'), category: 'Information' },
  { id: 'seed', label: 'Show seed', shortcut: '~', keyCode: k('~'), category: 'Information' },
  { id: 'help', label: 'Help', shortcut: '?', keyCode: k('?'), category: 'Information' },
  { id: 'stealth-range', label: 'Toggle stealth range', shortcut: ']', keyCode: k(']'), category: 'Display' },
  { id: 'true-colors', label: 'Toggle color effects', shortcut: '\\', keyCode: k('\\'), category: 'Display' },
  {
    id: 'graphics',
    label: 'Cycle text / tiles / hybrid',
    shortcut: 'G',
    keyCode: k('G'),
    category: 'Display',
  },
  { id: 'save', label: 'Save and quit to menu', shortcut: 'S', keyCode: k('S'), category: 'Game' },
  { id: 'quit', label: 'Abandon game', shortcut: 'Q', keyCode: k('Q'), category: 'Game' },
  { id: 'confirm', label: 'Confirm', shortcut: 'Enter', keyCode: Key.RETURN, category: 'Prompts' },
  {
    id: 'cancel',
    label: 'Cancel / back',
    shortLabel: 'Back',
    shortcut: 'Esc',
    keyCode: Key.ESCAPE,
    category: 'Prompts',
  },
  {
    id: 'acknowledge',
    label: 'Next message',
    shortLabel: 'More',
    shortcut: 'Space',
    keyCode: k(' '),
    category: 'Prompts',
  },
  { id: 'next-target', label: 'Next target', shortcut: 'Tab', keyCode: Key.TAB, category: 'Prompts' },
  { id: 'yes', label: 'Yes', shortcut: 'y', keyCode: k('y'), category: 'Prompts' },
  { id: 'no', label: 'No', shortcut: 'n', keyCode: k('n'), category: 'Prompts' },
];

const COMMANDS_BY_ID = new Map(BROGUE_COMMANDS.map((command) => [command.id, command]));

export function commandToBrogue(commandId: string): BrogueEventTuple | null {
  const command = COMMANDS_BY_ID.get(commandId);
  return command ? keystroke(command.keyCode, false, false) : null;
}

export const BROGUE_TOUCH_LAYOUT: TouchControlLayout = {
  directionPad: {
    nw: 'move-nw',
    n: 'move-n',
    ne: 'move-ne',
    w: 'move-w',
    center: 'rest',
    e: 'move-e',
    sw: 'move-sw',
    s: 'move-s',
    se: 'move-se',
  },
  actions: ['explore', 'search', 'inventory', 'descend', 'auto-rest', 'acknowledge', 'cancel', 'confirm'],
  palette: BROGUE_COMMANDS.filter((command) => command.category !== 'Movement').map((command) => command.id),
};

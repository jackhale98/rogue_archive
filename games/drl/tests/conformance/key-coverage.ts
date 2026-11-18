// SPDX-License-Identifier: GPL-2.0-only
// Source-driven key check: every command the dock and the command palette
// send must reach, through the console's input path, the binding DRL gives
// that action by default; and every default binding must be reachable or
// listed below as unreachable in a terminal (as in upstream's Linux console).
//
// The path, read from the sources: the key we send is what a terminal sends
// curses; FPC Valkyrie's vcursesio.pas (CursesToKeyCode, PollEvent) makes
// DRL's key code of it: printable characters through PrintableToIOEvent
// (Unshift; Shift for those outside VKEY_SCANSET), the others through
// CursesToKeyCode's table, with no modifiers. DRL's defaults are its
// drlkeybindings.pas table; key values are vioevent.inc's.
//
// Usage: node --experimental-strip-types key-coverage.ts <drl checkout> <fpcvalkyrie checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRL_COMMANDS, KEY } from '../../adapter/input.ts';

const [drlRoot, valkyrieRoot] = process.argv.slice(2);
if (!drlRoot || !valkyrieRoot) throw new Error('usage: key-coverage.ts <drl> <fpcvalkyrie>');
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

// vioevent.inc: VKEY_X = n;
const vkey = new Map<string, number>();
for (const match of read(valkyrieRoot, 'src/vioevent.inc').matchAll(/\b(VKEY_\w+)\s*=\s*(\d+)\s*;/g))
  vkey.set(match[1]!, Number(match[2]));
const vioevent = read(valkyrieRoot, 'src/vioevent.pas');
const masks: Record<string, number> = {};
for (const match of vioevent.matchAll(/\b(IOKeyCode\w+Mask)\s*=\s*%([01]+)\s*;/g)) masks[match[1]!] = parseInt(match[2]!, 2);
const scanSetText = /VKEY_SCANSET\s*=\s*\[([^\]]*)\]/s.exec(vioevent)?.[1] ?? '';
const scanSet = new Set<number>();
for (const part of scanSetText.split(',').map((s) => s.trim())) {
  const range = /^(VKEY_\w+)\.\.(VKEY_\w+)$/.exec(part);
  if (range) for (let n = vkey.get(range[1]!)!; n <= vkey.get(range[2]!)!; n++) scanSet.add(n);
  else if (vkey.has(part)) scanSet.add(vkey.get(part)!);
}
// Keys32_126 (Unshift's table): Pascal string pieces, #39 for a quote.
let unshiftTable = '';
{
  let at = vioevent.indexOf('=', vioevent.indexOf('const Keys32_126')) + 1;
  for (;;) {
    const char = vioevent[at]!;
    if (char === ';') break;
    if (char === "'") {
      let end = at + 1;
      for (;;) {
        if (vioevent[end] === "'" && vioevent[end + 1] === "'") end += 2;
        else if (vioevent[end] === "'") break;
        else end++;
      }
      unshiftTable += vioevent.slice(at + 1, end).replace(/''/g, "'");
      at = end + 1;
    } else if (char === '#') {
      const digits = /^#(\d+)/.exec(vioevent.slice(at))!;
      unshiftTable += String.fromCharCode(Number(digits[1]));
      at += digits[0].length;
    } else at++;
  }
}
if (unshiftTable.length !== 126 - 31) throw new Error(`Keys32_126 parsed to ${unshiftTable.length} characters`);

// vcursesio.pas CursesToKeyCode: "nCurses.KEY_X : Result := VKEY_Y;" and "13 : Result := VKEY_Y;".
const cursesIo = read(valkyrieRoot, 'src/vcursesio.pas');
const cursesBody = cursesIo.slice(cursesIo.indexOf('function CursesToKeyCode'), cursesIo.indexOf('function TCursesIODriver.PollEvent'));
const cursesMap = new Map<number, number>();
const cursesKey = KEY as Record<string, number>;
for (const match of cursesBody.matchAll(/^\s*(?:nCurses\.KEY_(\w+)|(\d+))\s*:\s*Result\s*:=\s*(VKEY_\w+)/gm)) {
  const code = match[1] ? (match[1].startsWith('F') && /^F\d+$/.test(match[1]) ? KEY.F0 + Number(match[1].slice(1)) : cursesKey[match[1]]) : Number(match[2]);
  if (code !== undefined) cursesMap.set(code, vkey.get(match[3]!)!);
}
if (!cursesMap.size) throw new Error('could not read CursesToKeyCode from vcursesio.pas');

/** DRL's key code (key and modifier masks) for a key the console's curses returns. */
function drlKeyCode(key: number): number | null {
  if (key >= 32 && key < 127) {
    const unshifted = unshiftTable[key - 32]!.charCodeAt(0);
    return unshifted + (scanSet.has(key) ? 0 : masks.IOKeyCodeShiftMask!);
  }
  const mapped = cursesMap.get(key);
  if (mapped !== undefined) return mapped;
  return key < 256 && scanSet.has(key) ? key : null;
}

// drlkeybindings.pas: ( Action: Ord(INPUT_X) ; ID: 'input_x' ; ... ; Default: VKEY_Y [+ IOKeyCodeZMask] ; ...
const bindings = new Map<string, number>();
for (const match of read(drlRoot, 'src/drlkeybindings.pas').matchAll(
  /ID:\s*'(input_\w+)'\s*;[^;]*;\s*Default:\s*([^;]+?)\s*;/g,
)) {
  let value = 0;
  for (const term of match[2]!.split('+').map((s) => s.trim())) {
    if (/^\d+$/.test(term)) value += Number(term);
    else if (vkey.has(term)) value += vkey.get(term)!;
    else if (term in masks) value += masks[term]!;
    else throw new Error(`unknown term ${term} in ${match[1]}'s default`);
  }
  bindings.set(match[1]!, value);
}
if (bindings.size < 50) throw new Error(`read only ${bindings.size} bindings from drlkeybindings.pas`);

/** The binding each command claims. */
const ACTION: Record<string, string> = {
  'move-nw': 'input_walkupleft',
  'move-n': 'input_walkup',
  'move-ne': 'input_walkupright',
  'move-w': 'input_walkleft',
  'move-e': 'input_walkright',
  'move-sw': 'input_walkdownleft',
  'move-s': 'input_walkdown',
  'move-se': 'input_walkdownright',
  wait: 'input_wait',
  'multi-wait': 'input_runwait',
  run: 'input_run',
  action: 'input_action',
  fire: 'input_fire',
  'alt-fire': 'input_altfire',
  target: 'input_target',
  'alt-target': 'input_alttarget',
  'next-target': 'input_targetnext',
  reload: 'input_reload',
  'alt-reload': 'input_altreload',
  pickup: 'input_pickup',
  'alt-pickup': 'input_altpickup',
  unload: 'input_unload',
  swap: 'input_swapweapon',
  active: 'input_active',
  look: 'input_lookmode',
  more: 'input_more',
  'more-self': 'input_selfmore',
  inventory: 'input_inventory',
  equipment: 'input_equipment',
  traits: 'input_trait',
  player: 'input_playerinfo',
  messages: 'input_messages',
  assemblies: 'input_assemblies',
  help: 'input_help',
  menu: 'input_escape',
  ok: 'input_ok',
  escape: 'input_escape',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`quick-${i + 1}`, `input_quickkey_${i + 1}`])),
};

/**
 * Bindings a terminal cannot reach: upstream's curses driver reads no
 * modifiers, so Shift and Ctrl with the arrow keys arrive as the plain key.
 */
const UNREACHABLE = new Set([
  'input_runleft',
  'input_runright',
  'input_runup',
  'input_rundown',
  'input_runupleft',
  'input_runupright',
  'input_rundownleft',
  'input_rundownright',
  'input_targetleft',
  'input_targetright',
  'input_targetup',
  'input_targetdown',
  'input_targetupleft',
  'input_targetupright',
  'input_targetdownleft',
  'input_targetdownright',
]);

const problems: string[] = [];
const covered = new Set<string>();
for (const command of DRL_COMMANDS) {
  const id = ACTION[command.id];
  if (!id) {
    if (command.category !== 'Keys') problems.push(`${command.id}: no binding claimed`);
    continue;
  }
  const binding = bindings.get(id);
  if (binding === undefined) {
    problems.push(`${command.id}: ${id} is not in drlkeybindings.pas`);
    continue;
  }
  const sent = drlKeyCode(command.keys[0]!);
  if (sent !== binding)
    problems.push(`${command.id}: key ${command.keys[0]} reaches DRL as ${sent}, but ${id} is bound to ${binding}`);
  covered.add(id);
}
for (const [id, value] of bindings) {
  if (!value || covered.has(id)) continue;
  if (UNREACHABLE.has(id)) {
    // Check it really is unreachable: no key the console can send gives that code.
    for (let key = 0; key < 400; key++)
      if (drlKeyCode(key) === value) problems.push(`${id} is listed unreachable but key ${key} reaches it`);
    continue;
  }
  problems.push(`${id} (default ${value}) has no command`);
}
for (const id of UNREACHABLE) if (!bindings.has(id)) problems.push(`${id} is no longer in drlkeybindings.pas`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `Key coverage: ${covered.size} default bindings reached by ${DRL_COMMANDS.length} commands; ${UNREACHABLE.size} need modifiers a terminal does not send (as in upstream's Linux console).`,
);

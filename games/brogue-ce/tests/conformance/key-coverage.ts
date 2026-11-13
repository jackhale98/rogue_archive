// Source-driven input checks:
//  1. Every key code that upstream Brogue defines in Rogue.h must be producible
//     by our keyboard mapping. Printable ASCII comes straight from the key;
//     everything else must have an explicit mapping.
//  2. Every named command (touch dock, fans and palette) must send the key
//     upstream binds to that action: its Rogue.h key name, and, for commands
//     on the map or in recording playback, a call or statement in that key's
//     case of executeKeystroke (IO.c) or executePlaybackInput (Recordings.c).
// Usage: node --experimental-strip-types key-coverage.ts <upstream-src-dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTER_COMMANDS, BROGUE_COMMANDS, commandToBrogue, keyToBrogue } from '../../adapter/input.ts';

const root = process.argv[2]!;
const rogueH = readFileSync(join(root, 'src/brogue/Rogue.h'), 'utf8');
const start = rogueH.indexOf('// Keyboard commands:');
const end = rogueH.indexOf('#define min(');
const block = rogueH.slice(start, end);

// Upstream codes that no desktop platform sends, with the reason.
const NOT_SENT: Record<string, string> = {
  SHIFT_TAB_KEY:
    'Cocoa-only alias; Brogue treats it exactly like TAB_KEY, which we send with the shift flag (as SDL does).',
  UNKNOWN_KEY: 'Internal placeholder used by the recording format.',
};

const DOM_CANDIDATES = [
  'Escape',
  'Enter',
  'Backspace',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
];
const none = { shift: false, ctrl: false, alt: false, meta: false };
const producible = new Set<number>();
for (const key of DOM_CANDIDATES) {
  const event = keyToBrogue({ type: 'key', key, code: key, modifiers: none });
  if (event) producible.add(event[1]);
}
for (let c = 32; c < 127; c++) {
  const event = keyToBrogue({ type: 'key', key: String.fromCharCode(c), code: '', modifiers: none });
  if (event) producible.add(event[1]);
}

/** Parses a C character literal ('k', ' ', '\\', '\t', '\033'), a number, or (a + b). */
function parseValue(raw: string): number | null {
  const literal = /^'(.*)'$/.exec(raw);
  if (literal) {
    const body = literal[1]!;
    if (body.length === 1) return body.charCodeAt(0);
    if (/^\\[0-7]{1,3}$/.test(body)) return parseInt(body.slice(1), 8);
    const escapes: Record<string, number> = { '\\t': 9, '\\n': 10, '\\\\': 92, "\\'": 39 };
    return escapes[body] ?? null;
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  const sum = /^\((\d+)\s*\+\s*(\d+)\)$/.exec(raw);
  return sum ? Number(sum[1]) + Number(sum[2]) : null;
}

let checked = 0;
const problems: string[] = [];
const keyValues = new Map<string, number>();
for (const match of block.matchAll(/^#define\s+(\w+)\s+('(?:\\.|[^'\\])*'|\S+)/gm)) {
  const [, name, raw] = match as unknown as [string, string, string];
  if (!/_KEY$|_ARROW$|^NUMPAD_\d$/.test(name)) continue;
  const value = parseValue(raw);
  if (value === null) {
    problems.push(`${name}: could not parse value ${raw}`);
    continue;
  }
  keyValues.set(name, value);
  checked++;
  if (NOT_SENT[name]) continue;
  if (!producible.has(value)) problems.push(`${name} (${value}) cannot be produced by keyToBrogue`);
}

if (checked < 50) problems.push(`only parsed ${checked} key definitions; did Rogue.h change shape?`);

// ---------------------------------------------------------------------------
// 2. Commands: the Rogue.h key each one must send, and (where the game acts on
// it in a switch) what that key's case must do.

/** The body of a C function, from its signature to the closing brace at column 0. */
function functionBody(file: string, signature: string): string {
  const source = readFileSync(join(root, file), 'utf8');
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`${signature} not found in ${file}`);
  return source.slice(start, source.indexOf('\n}\n', start));
}

/** Each key name's case block: from its label to the next label after some code (fallthrough labels share it). */
function caseBlocks(body: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let labels: string[] = [];
  let code: string[] = [];
  const flush = () => {
    for (const label of labels) blocks.set(label, (blocks.get(label) ?? '') + code.join('\n'));
  };
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const label = /^case (\w+):$/.exec(line);
    if (label) {
      if (code.length > 0) {
        flush();
        labels = [];
        code = [];
      }
      labels.push(label[1]!);
    } else if (/^default:/.test(line)) {
      flush();
      labels = [];
      code = [];
    } else if (line) {
      code.push(line);
    }
  }
  flush();
  return blocks;
}

const mapCases = caseBlocks(functionBody('src/brogue/IO.c', 'void executeKeystroke('));
const playbackCases = caseBlocks(functionBody('src/brogue/Recordings.c', 'boolean executePlaybackInput('));

type Expectation = [key: string, cases?: Map<string, string>, does?: string];
const onMap = (key: string, does: string): Expectation => [key, mapCases, does];
const inPlayback = (key: string, does: string): Expectation => [key, playbackCases, does];

/** Command id → the Rogue.h key it must send, and what that key does. */
const EXPECTED: Record<string, Expectation> = {
  'move-nw': onMap('UPLEFT_KEY', 'direction = UPLEFT'),
  'move-n': onMap('UP_KEY', 'direction = UP'),
  'move-ne': onMap('UPRIGHT_KEY', 'direction = UPRIGHT'),
  'move-w': onMap('LEFT_KEY', 'direction = LEFT'),
  'move-e': onMap('RIGHT_KEY', 'direction = RIGHT'),
  'move-sw': onMap('DOWNLEFT_KEY', 'direction = DOWNLEFT'),
  'move-s': onMap('DOWN_KEY', 'direction = DOWN'),
  'move-se': onMap('DOWNRIGHT_KEY', 'direction = DOWNRIGHT'),
  rest: onMap('REST_KEY', 'playerTurnEnded()'),
  search: onMap('SEARCH_KEY', 'manualSearch()'),
  // Ctrl+S: searches until the fifth (strong) search, unless disturbed.
  'long-search': onMap('SEARCH_KEY', 'while (player.status[STATUS_SEARCHING] < 5'),
  'auto-rest': onMap('AUTO_REST_KEY', 'autoRest()'),
  'rest-100': onMap('AUTO_REST_KEY', 'autoRest()'),
  explore: onMap('EXPLORE_KEY', 'exploreKey('),
  descend: onMap('DESCEND_KEY', 'travel(rogue.downLoc'),
  ascend: onMap('ASCEND_KEY', 'travel(rogue.upLoc'),
  inventory: onMap('INVENTORY_KEY', 'displayInventory('),
  apply: onMap('APPLY_KEY', 'apply(NULL)'),
  // Eat: Apply, then the food's letter (adapter; see commandEvents).
  eat: onMap('APPLY_KEY', 'apply(NULL)'),
  equip: onMap('EQUIP_KEY', 'equip(NULL)'),
  unequip: onMap('UNEQUIP_KEY', 'unequip(NULL)'),
  drop: onMap('DROP_KEY', 'drop(NULL)'),
  throw: onMap('THROW_KEY', 'throwCommand(NULL'),
  rethrow: onMap('RETHROW_KEY', 'throwCommand(rogue.lastItemThrown'),
  swap: onMap('SWAP_KEY', 'swapLastEquipment()'),
  relabel: onMap('RELABEL_KEY', 'relabel(NULL)'),
  call: onMap('CALL_KEY', 'call(NULL)'),
  messages: onMap('MESSAGE_ARCHIVE_KEY', 'displayMessageArchive()'),
  discoveries: onMap('DISCOVERIES_KEY', 'printDiscoveriesScreen()'),
  feats: onMap('FEATS_KEY', 'displayFeatsScreen()'),
  seed: onMap('SEED_KEY', 'printSeed()'),
  help: onMap('BROGUE_HELP_KEY', 'printHelpScreen()'),
  'stealth-range': onMap('STEALTH_RANGE_KEY', 'displayStealthRangeMode = !'),
  'true-colors': onMap('TRUE_COLORS_KEY', 'trueColorMode = !'),
  graphics: onMap('GRAPHICS_KEY', 'setGraphicsMode('),
  save: onMap('SAVE_GAME_KEY', 'saveGame()'),
  quit: onMap('QUIT_KEY', 'gameOver("Quit"'),
  // On the map Enter shows the keyboard cursor; in prompts it confirms.
  confirm: onMap('RETURN_KEY', 'showCursor()'),
  // Prompt keys, read by Brogue's dialogs and cursor (not executeKeystroke).
  cancel: ['ESCAPE_KEY'],
  acknowledge: ['ACKNOWLEDGE_KEY'],
  'next-target': ['TAB_KEY'],
  look: ['TAB_KEY'],
  'previous-item': ['UP_ARROW'],
  'next-item': ['DOWN_ARROW'],
  'playback-pause': inPlayback('ACKNOWLEDGE_KEY', 'playbackPaused = !rogue.playbackPaused'),
  'playback-slower': inPlayback('DOWN_KEY', '" Slower "'),
  'playback-faster': inPlayback('UP_KEY', '" Faster "'),
  'playback-next-turn': inPlayback('RIGHT_KEY', 'frameCount = 1'),
  'playback-previous-turn': inPlayback('LEFT_KEY', 'frameCount = -1'),
  'playback-next-level': inPlayback('DESCEND_KEY', 'seek(rogue.depthLevel + 1'),
  'playback-previous-level': inPlayback('ASCEND_KEY', 'seek(max(rogue.depthLevel - 1'),
  'playback-omniscience': inPlayback('TAB_KEY', 'playbackOmniscience = !'),
  'playback-quit': inPlayback('QUIT_KEY', 'GAMEOVER_RECORDING'),
  'playback-examine': ['RETURN_KEY'],
};

let commandsChecked = 0;
for (const command of BROGUE_COMMANDS) {
  if (command.id === 'shift') continue; // a modifier, not a key
  const expected = EXPECTED[command.id];
  if (!expected) {
    problems.push(`${command.id}: no expected upstream key; add it to EXPECTED`);
    continue;
  }
  const [keyName, cases, does] = expected;
  const value = keyValues.get(keyName);
  const event = commandToBrogue(command.id);
  commandsChecked++;
  if (value === undefined) problems.push(`${command.id}: ${keyName} is not defined in Rogue.h`);
  else if (event?.[1] !== value)
    problems.push(`${command.id} sends ${event?.[1]}, but ${keyName} is ${value}`);
  const ctrl = command.id === 'long-search';
  if ((event?.[3] === 1) !== ctrl) problems.push(`${command.id}: control flag should be ${ctrl}`);
  if (cases && does) {
    const block = cases.get(keyName);
    if (block === undefined) problems.push(`${command.id}: no case ${keyName} in upstream's switch`);
    else if (!block.includes(does))
      problems.push(`${command.id}: case ${keyName} no longer contains "${does}"`);
  }
}
for (const id of ADAPTER_COMMANDS) {
  if (!BROGUE_COMMANDS.some((command) => command.id === id))
    problems.push(`adapter command ${id} is not listed`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(
  `✓ key coverage: all ${checked} upstream key codes are reachable (${Object.keys(NOT_SENT).length} documented exceptions)`,
);
console.log(`✓ commands: all ${commandsChecked} named commands send the key upstream binds to their action`);

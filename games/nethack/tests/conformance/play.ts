// SPDX-License-Identifier: NGPL
// Plays the built WebAssembly module (dist/nethack.mjs) under Node with the
// port's own window port (adapter/windowport.ts): character creation with
// NetHack's own menus, the map and tty's status lines, moving, the
// inventory, saving with S, and continuing the saved game in a new run at the
// same place.
// Usage: node --experimental-strip-types play.ts <dist-dir>
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { WindowPort, type NhFrame, type NhInput, type NhModule } from '../../adapter/windowport.ts';

interface Module extends NhModule {
  FS: {
    mkdir(path: string): void;
    readFile(path: string): Uint8Array;
    writeFile(path: string, data: Uint8Array): void;
    analyzePath(path: string): { exists: boolean };
  };
  ENV: Record<string, string>;
  ccall(name: string, ret: string | null, types: string[], args: unknown[], opts?: object): unknown;
}

const dist = process.argv[2]!;
const { default: factory } = (await import(pathToFileURL(join(dist, 'nethack.mjs')).href)) as {
  default: (options: object) => Promise<Module>;
};

const rows = (frame: NhFrame) =>
  Array.from({ length: 24 }, (_, y) => {
    let text = '';
    for (let x = 0; x < 80; x++) text += String.fromCharCode(frame.cells[(y * 80 + x) * 2]!);
    return text.trimEnd();
  });

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

/**
 * One run of NetHack as `name`: `answer` is asked for a key each time the
 * game waits, given the current screen; it returns a key, or null to stop
 * answering (the run is then left waiting).
 */
async function run(
  name: string,
  saveFile: Uint8Array | null,
  answer: (frame: NhFrame, screen: string[]) => number | null,
) {
  let last: NhFrame | null = null;
  let resolveStop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => (resolveStop = resolve));
  const port = new WindowPort({
    nextInput: () =>
      new Promise<NhInput>((resolve) => {
        const key = last ? answer(last, rows(last)) : null;
        if (key === null) resolveStop();
        else resolve({ key });
      }),
    frame: (frame) => (last = { ...frame, cells: frame.cells.slice(), state: frame.state.slice() }),
    message: () => undefined,
    delay: () => Promise.resolve(),
  });
  const mod = await factory({ noInitialRun: true, print: () => undefined, printErr: () => undefined });
  port.attach(mod);
  (globalThis as Record<string, unknown>).nhWindowCall = (n: string, ...args: unknown[]) =>
    port.call(n, ...args);
  mod.FS.mkdir('/save');
  if (saveFile) mod.FS.writeFile(`/save/0${name}`, saveFile);
  mod.ENV.NETHACKOPTIONS = '!perm_invent,color';
  mod.ccall('shim_graphics_set_callback', null, ['string'], ['nhWindowCall']);
  const args = ['nethack', '-u', name];
  const argv = mod._malloc(4 * (args.length + 1));
  args.forEach((arg, i) => {
    const ptr = mod._malloc(arg.length + 1);
    mod.stringToUTF8(arg, ptr, arg.length + 1);
    mod.setValue(argv + 4 * i, ptr, '*');
  });
  mod.setValue(argv + 4 * args.length, 0, '*');
  const ended = (async () => {
    try {
      await mod.ccall('main', 'number', ['number', 'number'], [args.length, argv], { async: true });
    } catch (error) {
      if ((error as { name?: string }).name !== 'ExitStatus') throw error;
    }
  })();
  await Promise.race([ended, stopped]);
  return { mod, last: () => last, ended };
}

/** Answers character creation as a Valkyrie (dwarf), and the start-up screens. */
function creation(frame: NhFrame, screen: string[]): number | null {
  const title = frame.menu?.title ?? '';
  if (frame.context === 'yn' && /Shall I pick/.test(frame.prompt)) return 'n'.charCodeAt(0);
  if (frame.context === 'menu' && /Pick a role/.test(title)) return 'v'.charCodeAt(0);
  if (frame.context === 'menu' && /Pick a race/.test(title)) return 'd'.charCodeAt(0);
  if (frame.context === 'menu' && /Is this ok/.test(title)) return 'y'.charCodeAt(0);
  if (frame.context === 'menu' && /tutorial/.test(title)) return 'n'.charCodeAt(0);
  if (
    frame.context === 'text' ||
    frame.context === 'more' ||
    (frame.context === 'menu' && frame.menu?.how === 0)
  )
    return 32;
  void screen;
  return null;
}

// 1. A new game, as far as the map.
let step = 0;
let before = { x: 0, y: 0, moves: 0 };
const first = await run('Tester', null, (frame, screen) => {
  if (step === 0) {
    const key = creation(frame, screen);
    if (key !== null) return key;
    if (frame.context !== 'map') return 27;
    step = 1;
    check(
      screen.slice(1, 22).some((line) => line.includes('@')),
      'the map shows the hero (@)',
    );
    check(
      screen[22]!.startsWith('Tester the Stripling') && /St:\d/.test(screen[22]!),
      'status line 1 (name, St:...)',
    );
    check(
      /^Dlvl:1 .*HP:\d+\(\d+\) Pw:\d+\(\d+\) AC:-?\d+ Xp:1/.test(screen[23]!),
      'status line 2 (Dlvl, HP, Pw, AC, Xp)',
    );
    check(frame.state[0] === 1 && frame.state[5] === 1, 'state: in the game, depth 1');
    return 's'.charCodeAt(0); // search one turn
  }
  if (step === 1) {
    step = 2;
    check((frame.state[8] ?? 0) > 1, 'a turn passes (search)');
    return 'i'.charCodeAt(0);
  }
  if (step === 2) {
    step = 3;
    check(
      frame.context === 'menu' &&
        !!frame.menu?.items.some((item) => /spear|long sword|dagger/.test(item.text)),
      'the inventory menu lists the weapons',
    );
    return 27;
  }
  if (step === 3 && frame.context === 'map') {
    step = 4;
    before = { x: frame.state[6]!, y: frame.state[7]!, moves: frame.state[8]! };
    return 'S'.charCodeAt(0);
  }
  if (step === 4) {
    step = 5;
    check(frame.context === 'yn' && /Really save\?/.test(frame.prompt), 'S asks "Really save?"');
    return 'y'.charCodeAt(0);
  }
  // Closing messages.
  return frame.context === 'map' ? null : 32;
});
await first.ended;
const saved = first.mod.FS.analyzePath('/save/0Tester').exists;
check(saved, 'saving writes save/0Tester');

// 2. The same character again: the saved game continues where it was.
if (saved) {
  const file = first.mod.FS.readFile('/save/0Tester');
  let restored = null as { x: number; y: number; moves: number } | null;
  await run('Tester', file, (frame) => {
    if (frame.context === 'map' && frame.state[0] === 1) {
      restored = { x: frame.state[6]!, y: frame.state[7]!, moves: frame.state[8]! };
      return null;
    }
    return frame.context === 'yn' ? 'y'.charCodeAt(0) : 32;
  });
  check(
    !!restored && restored!.x === before.x && restored!.y === before.y && restored!.moves === before.moves,
    `the saved game continues at the same place and turn (${JSON.stringify(before)} → ${JSON.stringify(restored)})`,
  );
}

if (failures) {
  console.error(`NetHack play check: ${failures} failure(s)`);
  process.exit(1);
}
console.log('NetHack play check: passed');
process.exit(0);

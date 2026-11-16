// SPDX-License-Identifier: CC-BY-SA-3.0
// Upstream drift check: the port reuses upstream's web build and observes the
// game through a few functions it wraps at link time. If upstream changes any
// of the pieces below, this names what to re-review before the fingerprints
// are updated (run with --print to see the new ones).
// Usage: node --experimental-strip-types upstream-drift.ts <upstream-checkout> [--print]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2]!;
const print = process.argv.includes('--print');

/** The text from the first line matching `start` to the first line after it matching `end` (inclusive). */
function between(file: string, start: RegExp, end: RegExp): string | null {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const from = lines.findIndex((line) => start.test(line));
  if (from < 0) return null;
  for (let i = from + 1; i < lines.length; i++)
    if (end.test(lines[i]!)) return lines.slice(from, i + 1).join('\n');
  return null;
}

/** Every line matching `pattern`, in order. */
function lines(file: string, pattern: RegExp): string | null {
  const found = readFileSync(join(root, file), 'utf8')
    .split('\n')
    .filter((line) => pattern.test(line));
  return found.length ? found.join('\n') : null;
}

interface Watched {
  name: string;
  text: () => string | null;
  why: string;
  sha256: string;
}

const WATCHED: Watched[] = [
  {
    name: 'Makefile: the emscripten block',
    text: () => between('Makefile', /^# Emscripten$/, /^endif$/),
    why: "compile and link flags the port keeps (scripts/build.sh's link additions override some -s settings; LZ4 must stay for the data package)",
    sha256: 'd17a267692d063e4087402cc9ca5f0bff6575f3d0c320dffd56ba3acf8243a1c',
  },
  {
    name: 'build-scripts/build-emscripten.sh: the make command',
    text: () => lines('build-scripts/build-emscripten.sh', /^make /),
    why: 'scripts/build.sh MAKE_VARS repeats these variables',
    sha256: '514ff890eddbb36c7c716c3526fee8ecc7f1b482b7a685031434d97cc5c4b1c2',
  },
  {
    name: 'build-scripts/prepare-web.sh',
    text: () => readFileSync(join(root, 'build-scripts/prepare-web.sh'), 'utf8'),
    why: 'scripts/build.sh assembles the data package the same way (directories, obsolete mods, MA)',
    sha256: 'de0e8f7fabd55a44ceaf35b82d55aa8b4f0457521d1b02c91d59708ea5d49356',
  },
  {
    name: 'main.cpp: mount_idbfs',
    text: () => between('src/main.cpp', /EM_ASYNC_JS\( void, mount_idbfs/, /^\} \);$/),
    why: 'the user directory the adapter syncs, exports and imports (adapter/index.ts HOME), window.setFsNeedsSync',
    sha256: '45be43446a50ed96f3e40155a3a8a0426c969d4999c98d710cad705a65af1dfb',
  },
  {
    name: 'window.game_unsaved',
    text: () => [lines('src/do_turn.cpp', /game_unsaved/), lines('src/game.cpp', /game_unsaved/)].join('\n'),
    why: 'adapter/index.ts exitPrompt offers Save and leave while it is true',
    sha256: '7dd205efbd3c5b12927193f9ae3e749e8a549c844160afed1ab13b429050d138',
  },
  {
    name: 'input_context: handle_input and category',
    text: () =>
      [
        lines('src/input_context.h', /const std::string &handle_input\(/),
        lines('src/input_context.h', /std::string category; \/\/ The input category/),
      ].join('\n'),
    why: 'wrapped at link time (scripts/build.sh WRAPPED, port/rogue-archive-web.cpp); the category is read for the context',
    sha256: '63a2a19e10efaba53878371d2395d24efd48ba4d4cf754a58680380e41940704',
  },
  {
    name: 'input_manager::get_input_event',
    text: () => lines('src/input.h', /input_event get_input_event\(/),
    why: 'wrapped at link time (raw waits)',
    sha256: '3aecb44f4e638a03f06f67c86d7f5dd2f3de5bd19d88dadb00d1802d9ea479da',
  },
  {
    name: 'cata_cursesport: WINDOW and curses_drawwindow',
    text: () => between('src/cursesport.h', /^struct WINDOW \{/, /^void curses_drawwindow/),
    why: 'wrapped at link time; the window cells are copied into the screen text',
    sha256: '3234084a151696ffee4b757d90f469e839ddd98b3ce3f921ef875387cc9f7e70',
  },
  {
    name: 'do_turn and main_menu::opening_screen',
    text: () =>
      [
        lines('src/do_turn.h', /^bool do_turn\(\);/),
        lines('src/main_menu.h', /bool opening_screen\(\);/),
      ].join('\n'),
    why: 'wrapped at link time (in a game / at the main menu)',
    sha256: '84857e72e528966ff2403668025384bd5aa29f0eeb5c1df81589496c589c7d22',
  },
  {
    name: 'Dear ImGui: ImDrawList::AddText and NewFrame',
    text: () =>
      [
        lines('src/third-party/imgui/imgui.h', /IMGUI_API void {2}AddText\((const ImVec2|ImFont)/),
        lines('src/third-party/imgui/imgui.h', /IMGUI_API void {10}NewFrame\(\);/),
      ].join('\n'),
    why: 'wrapped at link time (the text of ImGui windows); the mangled names in scripts/build.sh follow these signatures',
    sha256: '2e23eaa1f678836de8c05f9806bf0234b7f1ff671776e194f52239eeee9fe933',
  },
  {
    name: 'keybindings.json',
    text: () => readFileSync(join(root, 'data/raw/keybindings.json'), 'utf8'),
    why: 'adapter/input.ts commands and their keys; UI-INVENTORY.md',
    sha256: '5b55b23960b42f52249398254a7557303a0987ce6a7f5a23f0f39ef1e00be3b3',
  },
];

const problems: string[] = [];
for (const watched of WATCHED) {
  const text = watched.text();
  if (!text) {
    problems.push(`${watched.name}: not found — ${watched.why}`);
    continue;
  }
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (print) console.log(`${watched.name}: ${sha256}`);
  else if (sha256 !== watched.sha256) problems.push(`${watched.name} changed — re-review: ${watched.why}`);
}

if (print) process.exit(0);
if (problems.length > 0) {
  console.error(`Cataclysm: DDA upstream drift: ${problems.length} change(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Cataclysm: DDA upstream drift: ${WATCHED.length} watched pieces unchanged`);

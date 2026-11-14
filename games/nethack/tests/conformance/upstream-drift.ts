// SPDX-License-Identifier: NGPL
// Upstream drift: the shim window port's calls (win/shim/winshim.c), with the
// argument formats adapter/windowport.ts reads, and the game structures the
// glue (port/rogue-archive-glue.c) reads, are as the port expects.
// Usage: node --experimental-strip-types upstream-drift.ts <upstream-checkout>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2]!;
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const shim = read('win/shim/winshim.c');
const port = readFileSync(new URL('../../adapter/windowport.ts', import.meta.url), 'utf8');
const problems: string[] = [];

// Every window call the shim makes, with its format string.
const calls = new Map<string, string>();
for (const match of shim.matchAll(/V?DECLCB\(\s*(?:[^,]+,\s*)?(\w+)\s*,[\s\S]*?"([a-z0-9]+)"/g))
  if (match[1] !== 'name') calls.set(match[1]!, match[2]!);
if (calls.size < 40) problems.push(`only ${calls.size} shim calls found in winshim.c`);

// The formats the window port's argument handling assumes.
const FORMATS: Record<string, string> = {
  shim_create_nhwindow: 'ii',
  shim_display_nhwindow: 'vib',
  shim_curs: 'viii',
  shim_putstr: 'viis',
  shim_start_menu: 'vii',
  shim_add_menu: 'vipi00iisi',
  shim_end_menu: 'vis',
  shim_select_menu: 'iiip',
  shim_print_glyph: 'vi11pp',
  shim_nh_poskey: 'ippp',
  shim_yn_function: 'css0',
  shim_getlin: 'vsp',
  shim_status_update: 'vipiiip',
  shim_player_selection_or_tty: 'b',
};
for (const [name, format] of Object.entries(FORMATS)) {
  if (!calls.has(name)) problems.push(`${name}: no longer in winshim.c`);
  else if (calls.get(name) !== format)
    problems.push(`${name}: format is now "${calls.get(name)}", the port reads "${format}"`);
}
// Every call is answered (the window port's switch names it).
for (const name of calls.keys())
  if (!port.includes(`'${name}'`)) problems.push(`${name}: not answered by adapter/windowport.ts`);

// What the glue reads.
const EXPECT: [string, RegExp][] = [
  [
    'include/wintype.h',
    /typedef struct glyphinfo \{\s*int glyph;[^;]*?int ttychar;[^;]*?uint32 framecolor;[^;]*?glyph_map gm;/,
  ],
  ['include/wintype.h', /typedef struct mi \{\s*anything item;[^;]*?long count;[^;]*?unsigned itemflags;/],
  ['include/func_tab.h', /struct ext_func_tab \{\s*uchar key;\s*const char \*ef_txt, \*ef_desc;/],
  ['include/botl.h', /extern const struct conditions_t conditions\[CONDITION_COUNT\];/],
  ['include/botl.h', /BL_LEVELDESC, BL_EXP, BL_CONDITION,\s*\/\* 20\.\.22 \*\//],
  // The status formats windowport.ts knows (STATUS_FORMATS).
  ['src/botl.c', /INIT_BLSTAT\("strength", " St:%s"/],
  ['src/botl.c', /INIT_BLSTATP\("hitpoints", " HP:%s"/],
  ['src/botl.c', /INIT_BLSTAT\("hitpoints-max", "\(%s\)"/],
  ['src/botl.c', /INIT_BLSTAT\("dungeon-level", "%s"/],
  // The tty two-line status order windowport.ts follows.
  [
    'win/tty/wintty.c',
    /\{ BL_LEVELDESC, BL_GOLD, BL_HP, BL_HPMAX, BL_ENE, BL_ENEMAX,\s*BL_AC, BL_XP, BL_EXP, BL_HD, BL_TIME, BL_HUNGER, BL_CAP,\s*BL_CONDITION, BL_WEAPON, BL_ARMOR, BL_TERRAIN, BL_VERS, BL_FLUSH \}/,
  ],
  // Save files: save/<uid><name>.
  ['sys/unix/unixmain.c', /getuid\(\)/],
];
for (const [file, pattern] of EXPECT)
  if (!pattern.test(read(file))) problems.push(`${file} no longer matches ${pattern}`);

if (problems.length > 0) {
  console.error(`NetHack upstream drift: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`NetHack upstream drift: ${calls.size} shim calls answered, formats and structures as expected`);

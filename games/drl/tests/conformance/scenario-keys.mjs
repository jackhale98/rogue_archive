// SPDX-License-Identifier: GPL-2.0-only
// Scenario keys (scenarios.json) as the codes a terminal sends curses
// (adapter/input.ts's mapping): key names, "text:..." for typed text,
// "Name*n" for a repeated key, or single characters.
const NAMED = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Space: 32,
  Up: 259,
  Down: 258,
  Left: 260,
  Right: 261,
  Home: 262,
  End: 360,
  PageUp: 339,
  PageDown: 338,
  Backspace: 263,
};

export function scenarioKeys(script) {
  const keys = [];
  for (const entry of script) {
    if (entry.startsWith('text:')) {
      for (const char of entry.slice(5)) keys.push(char.charCodeAt(0));
      continue;
    }
    const [name, count] = entry.split('*');
    const code = NAMED[name] ?? (name.length === 1 ? name.charCodeAt(0) : undefined);
    if (code === undefined) throw new Error(`unknown key ${entry}`);
    for (let i = 0; i < Number(count ?? 1); i++) keys.push(code);
  }
  return keys;
}

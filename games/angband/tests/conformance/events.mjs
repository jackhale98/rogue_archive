// SPDX-License-Identifier: GPL-2.0-only
// Event scripts for the conformance replays (replay.mjs, scenarios.json).

/** Angband keycodes (ui-event.h). */
const NAMED = {
  CR: 0x9c,
  ESC: 0xe000,
  TAB: 0x9d,
  BS: 0x9f,
  SPACE: 32,
  DOWN: 0x80,
  LEFT: 0x81,
  RIGHT: 0x82,
  UP: 0x83,
};

/** "a{CR}{ESC}{^X}{M:40,12,1}" → events (key codes, or "m<x>.<y>.<button>" clicks). */
export function parseEvents(spec) {
  const events = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] === '{') {
      const end = spec.indexOf('}', i);
      const token = spec.slice(i + 1, end);
      const mouse = /^M:(\d+),(\d+),(\d+)$/.exec(token);
      if (mouse) events.push(`m${mouse[1]}.${mouse[2]}.${mouse[3]}`);
      else if (token.startsWith('^')) events.push(String(token.charCodeAt(1) & 31));
      else if (token in NAMED) events.push(String(NAMED[token]));
      else throw new Error(`Unknown key token {${token}}`);
      i = end;
    } else {
      events.push(String(spec.charCodeAt(i)));
    }
  }
  return events;
}

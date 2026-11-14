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
  HOME: 0x94,
  PGUP: 0x95,
  END: 0x96,
  PGDOWN: 0x97,
};

/** Modifier prefixes ({S+UP}: Shift; {K+5}: a keypad key), as the worker encodes them (mods << 21). */
const MODS = { S: 0x02, C: 0x01, A: 0x04, K: 0x10 };

/**
 * "a{CR}{ESC}{^X}{S+UP}{M:40,12,1}" → events (key codes with modifiers, or
 * "m<x>.<y>.<button>" clicks; the button carries modifiers << 4).
 */
export function parseEvents(spec) {
  const events = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] === '{') {
      const end = spec.indexOf('}', i);
      const token = spec.slice(i + 1, end);
      const mouse = /^M:(\d+),(\d+),(\d+)$/.exec(token);
      const modified = /^([SCAK])\+(.+)$/.exec(token);
      if (mouse) events.push(`m${mouse[1]}.${mouse[2]}.${mouse[3]}`);
      else if (modified) {
        const [, mod, key] = modified;
        const code = key in NAMED ? NAMED[key] : key.length === 1 ? key.charCodeAt(0) : NaN;
        if (Number.isNaN(code)) throw new Error(`Unknown key token {${token}}`);
        events.push(String(code | (MODS[mod] << 21)));
      } else if (token.startsWith('^')) events.push(String(token.charCodeAt(1) & 31));
      else if (token in NAMED) events.push(String(NAMED[token]));
      else throw new Error(`Unknown key token {${token}}`);
      i = end;
    } else {
      events.push(String(spec.charCodeAt(i)));
    }
  }
  return events;
}

import type { GameInput } from './index.ts';

/** Keys the browser should keep (reload, devtools, zoom...) rather than send to a game. */
const BROWSER_RESERVED = new Set(['F5', 'F11', 'F12']);

/**
 * Normalizes a DOM keyboard event into platform input. It does not decide what
 * the key means: that is the adapter's job. Returns null for events that are
 * only modifier presses, IME composition, or reserved browser shortcuts.
 */
export function domKeyToInput(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>,
): GameInput | null {
  if (event.isComposing) return null;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified'].includes(event.key))
    return null;
  if (BROWSER_RESERVED.has(event.key)) return null;
  // Leave platform shortcuts such as Cmd+R / Cmd+Q to the browser.
  if (event.metaKey) return null;
  return {
    type: 'key',
    key: event.key,
    code: event.code,
    modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey },
  };
}

import type { GameAdapter } from '@rogue-archive/game-api';
import { forwardRef, useImperativeHandle, useRef } from 'react';

/**
 * Opens the device's own keyboard and forwards what is typed to the game.
 * A sentinel character stays in the field so Backspace always produces an
 * event, even on mobile keyboards that do not send key codes.
 */
const SENTINEL = '​';

export interface VirtualKeyboardHandle {
  open(): void;
}

export const VirtualKeyboard = forwardRef<VirtualKeyboardHandle, { adapter: GameAdapter }>(
  function VirtualKeyboard({ adapter }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      open() {
        const input = inputRef.current;
        if (!input) return;
        input.value = SENTINEL;
        input.focus({ preventScroll: true });
      },
    }));

    const key = (key: string) =>
      adapter.sendInput({
        type: 'key',
        key,
        code: key,
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      });

    return (
      <input
        ref={inputRef}
        data-shell-keyboard
        className="virtual-keyboard"
        aria-label="Type to the game"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        defaultValue={SENTINEL}
        onKeyDown={(event) => {
          // Physical keyboards still go through the normal key path.
          if (
            ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
          ) {
            event.preventDefault();
            key(event.key);
          }
        }}
        onInput={(event) => {
          const input = event.currentTarget;
          const value = input.value;
          if (!value.startsWith(SENTINEL)) {
            key('Backspace');
          } else if (value.length > SENTINEL.length) {
            adapter.sendInput({ type: 'text', text: value.slice(SENTINEL.length) });
          }
          input.value = SENTINEL;
        }}
      />
    );
  },
);

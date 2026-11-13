import type { GameAdapter, TouchControlLayout } from '@rogue-archive/game-api';
import { useCallback, useRef, type ReactNode } from 'react';

const PAD_ORDER = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se'] as const;
const PAD_ARROWS: Record<(typeof PAD_ORDER)[number], string> = {
  nw: '↖',
  n: '↑',
  ne: '↗',
  w: '←',
  center: '•',
  e: '→',
  sw: '↙',
  s: '↓',
  se: '↘',
};

const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 140;

interface Props {
  adapter: GameAdapter;
  layout: TouchControlLayout;
  part: 'pad' | 'actions';
}

function useCommandButton(adapter: GameAdapter) {
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>(
    {},
  );
  const stop = useCallback(() => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  }, []);
  // A press sends exactly one command; holding a movement button repeats it,
  // like holding a key. Pointer events only, so touch and mouse never double-fire.
  const start = useCallback(
    (commandId: string, repeat: boolean) => {
      stop();
      adapter.sendInput({ type: 'command', commandId });
      if (!repeat) return;
      timers.current.delay = setTimeout(() => {
        timers.current.repeat = setInterval(
          () => adapter.sendInput({ type: 'command', commandId }),
          REPEAT_INTERVAL_MS,
        );
      }, REPEAT_DELAY_MS);
    },
    [adapter, stop],
  );
  return { start, stop };
}

export function TouchControls({ adapter, layout, part }: Props) {
  const { start, stop } = useCommandButton(adapter);
  const labelFor = (id: string) => adapter.commands.find((command) => command.id === id);

  const button = (commandId: string, content: ReactNode, className: string, repeat: boolean) => {
    const command = labelFor(commandId);
    return (
      <button
        key={commandId}
        type="button"
        className={className}
        aria-label={
          command ? `${command.label}${command.shortcut ? ` (${command.shortcut})` : ''}` : commandId
        }
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          start(commandId, repeat);
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            adapter.sendInput({ type: 'command', commandId });
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {content}
      </button>
    );
  };

  if (part === 'pad') {
    const pad = layout.directionPad;
    if (!pad) return null;
    return (
      <div className="touch-pad" role="group" aria-label="Movement">
        {PAD_ORDER.map((slot) => {
          const commandId = pad[slot];
          if (!commandId) return <span key={slot} />;
          return button(
            commandId,
            <span aria-hidden="true">{PAD_ARROWS[slot]}</span>,
            `touch-pad__button touch-pad__button--${slot}`,
            slot !== 'center',
          );
        })}
      </div>
    );
  }

  return (
    <div className="touch-actions" role="group" aria-label="Actions">
      {layout.actions.map((commandId) => {
        const command = labelFor(commandId);
        return button(
          commandId,
          <>
            <span className="touch-actions__label">{command?.shortLabel ?? command?.label ?? commandId}</span>
            {command?.shortcut ? <kbd className="touch-actions__key">{command.shortcut}</kbd> : null}
          </>,
          'touch-actions__button',
          false,
        );
      })}
    </div>
  );
}

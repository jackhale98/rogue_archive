import type {
  GameAdapter,
  GameCommandDescriptor,
  TouchAction,
  TouchControlLayout,
} from '@rogue-archive/game-api';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Game-agnostic touch controls. The adapter supplies command ids and labels
 * (and changes them with the game's context); these components only decide
 * how fingers pick them. Every control is also a real, labelled button so it
 * works with screen readers and keyboards.
 */

const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 150;
const LONG_PRESS_MS = 340;

type Slot = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';
/** Clockwise from east, matching Math.atan2 sectors (screen y grows downwards). */
const SECTORS: Slot[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
const ARROWS: Record<Slot, string> = { nw: '↖', n: '↑', ne: '↗', w: '←', e: '→', sw: '↙', s: '↓', se: '↘' };

/** Capture a pointer if the browser allows it (it refuses for pointers it doesn't know). */
function capture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Not capturable (e.g. already released); input still works without capture.
  }
}

export function haptic(enabled: boolean, pattern: number | number[] = 8): void {
  if (enabled && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

function describe(commands: readonly GameCommandDescriptor[], id: string) {
  return commands.find((command) => command.id === id);
}

export function normalizeAction(action: string | TouchAction): TouchAction {
  return typeof action === 'string' ? { command: action } : action;
}

/** Direction from a point relative to the pad center, or 'center' inside the dead zone. */
export function padSector(dx: number, dy: number, radius: number): Slot | 'center' {
  if (Math.hypot(dx, dy) < radius * 0.28) return 'center';
  const angle = Math.atan2(dy, dx);
  const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return SECTORS[index]!;
}

// ---------------------------------------------------------------------------

interface PadProps {
  adapter: GameAdapter;
  pad: NonNullable<TouchControlLayout['directionPad']>;
  hapticsEnabled: boolean;
}

/** Circular thumb pad: press and slide toward a direction; hold to keep moving. */
export function ThumbPad({ adapter, pad, hapticsEnabled }: PadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Slot | 'center' | null>(null);
  const gesture = useRef<{
    pointer: number;
    slot: Slot | 'center';
    moved: boolean;
    delay?: ReturnType<typeof setTimeout>;
    repeat?: ReturnType<typeof setInterval>;
  } | null>(null);

  const send = useCallback(
    (slot: Slot | 'center') => {
      const command = slot === 'center' ? pad.center : pad[slot];
      if (!command) return;
      adapter.sendInput({ type: 'command', commandId: command });
      haptic(hapticsEnabled);
    },
    [adapter, pad, hapticsEnabled],
  );

  const stopRepeat = () => {
    const g = gesture.current;
    if (!g) return;
    clearTimeout(g.delay);
    clearInterval(g.repeat);
    g.delay = undefined;
    g.repeat = undefined;
  };

  const startDirection = (slot: Slot) => {
    const g = gesture.current!;
    stopRepeat();
    g.slot = slot;
    g.moved = true;
    setActive(slot);
    send(slot);
    g.delay = setTimeout(() => {
      g.repeat = setInterval(() => send(slot), REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  };

  const sectorAt = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return padSector(
      clientX - (rect.left + rect.width / 2),
      clientY - (rect.top + rect.height / 2),
      rect.width / 2,
    );
  };

  useEffect(() => () => stopRepeat(), []);

  return (
    <div
      ref={ref}
      className="thumb-pad"
      role="group"
      aria-label="Movement"
      data-active={active ?? undefined}
      onPointerDown={(event) => {
        event.preventDefault();
        capture(ref.current!, event.pointerId);
        const slot = sectorAt(event.clientX, event.clientY);
        gesture.current = { pointer: event.pointerId, slot, moved: false };
        if (slot === 'center') setActive('center');
        else startDirection(slot);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || g.pointer !== event.pointerId) return;
        const slot = sectorAt(event.clientX, event.clientY);
        if (slot === g.slot) return;
        if (slot === 'center') {
          // Sliding back to the middle stops walking without sending anything.
          stopRepeat();
          g.slot = 'center';
          setActive('center');
        } else {
          startDirection(slot);
        }
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        if (!g || g.pointer !== event.pointerId) return;
        stopRepeat();
        if (g.slot === 'center' && !g.moved) send('center');
        gesture.current = null;
        setActive(null);
      }}
      onPointerCancel={() => {
        stopRepeat();
        gesture.current = null;
        setActive(null);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="thumb-pad__ring" aria-hidden="true" />
      {SECTORS.map((slot) => {
        const command = describe(adapter.commands, pad[slot]);
        return (
          <button
            key={slot}
            type="button"
            tabIndex={0}
            className={`thumb-pad__dir thumb-pad__dir--${slot}`}
            aria-label={
              command ? `${command.label}${command.shortcut ? ` (${command.shortcut})` : ''}` : slot
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                send(slot);
              }
            }}
          >
            <span aria-hidden="true">{ARROWS[slot]}</span>
          </button>
        );
      })}
      {pad.center ? (
        <button
          type="button"
          className="thumb-pad__center"
          aria-label={(() => {
            const command = describe(adapter.commands, pad.center);
            return command ? `${command.label}${command.shortcut ? ` (${command.shortcut})` : ''}` : 'Center';
          })()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              send('center');
            }
          }}
        >
          <span aria-hidden="true">{describe(adapter.commands, pad.center)?.shortcut ?? '•'}</span>
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DockProps {
  adapter: GameAdapter;
  actions: (string | TouchAction)[];
  context: string;
  hapticsEnabled: boolean;
  /** Commands the shell handles itself (command list, keyboard). */
  onShellCommand(command: string): boolean;
  orientation: 'vertical' | 'horizontal';
}

interface FanState {
  owner: string;
  options: string[];
  highlighted: string | null;
}

/** Context-aware action buttons; long-press a button with alternates to fan them out. */
export function ActionDock({
  adapter,
  actions,
  context,
  hapticsEnabled,
  onShellCommand,
  orientation,
}: DockProps) {
  const [fan, setFan] = useState<FanState | null>(null);
  const press = useRef<{
    command: string;
    pointer: number;
    timer?: ReturnType<typeof setTimeout>;
    opened: boolean;
  } | null>(null);

  const run = (command: string) => {
    haptic(hapticsEnabled);
    if (onShellCommand(command)) return;
    adapter.sendInput({ type: 'command', commandId: command });
  };

  const optionAt = (x: number, y: number): string | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-fan-option]');
    return element?.dataset.fanOption ?? null;
  };

  useEffect(() => {
    if (!fan) return;
    // Tapping anywhere outside an open fan closes it.
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('.action-fan, .dock-button--open')) setFan(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [fan]);

  // The shell remounts the dock (key = context) when the game's context changes,
  // which also closes any open fan; clear a pending long-press timer on unmount.
  useEffect(() => () => clearTimeout(press.current?.timer), []);

  const labelFor = (action: TouchAction) => {
    const command = describe(adapter.commands, action.command);
    return action.label ?? command?.shortLabel ?? command?.label ?? action.command;
  };

  return (
    <div
      className={`action-dock action-dock--${orientation}`}
      role="group"
      aria-label="Actions"
      data-context={context}
    >
      {actions.map(normalizeAction).map((action, index) => {
        const command = describe(adapter.commands, action.command);
        const label = labelFor(action);
        const alternates = action.alternates ?? [];
        const isOpen = fan?.owner === action.command;
        return (
          <div
            key={`${action.command}-${index}`}
            className={`action-dock__slot${action.wide ? ' action-dock__slot--wide' : ''}`}
          >
            <button
              type="button"
              className={`dock-button${action.emphasis === 'primary' ? ' dock-button--primary' : ''}${isOpen ? ' dock-button--open' : ''}${action.active ? ' dock-button--active' : ''}`}
              aria-pressed={action.active === undefined ? undefined : action.active}
              aria-label={`${label}${command?.shortcut ? ` (${command.shortcut})` : ''}`}
              aria-haspopup={alternates.length > 0 ? 'menu' : undefined}
              aria-expanded={alternates.length > 0 ? isOpen : undefined}
              onPointerDown={(event) => {
                event.preventDefault();
                capture(event.currentTarget, event.pointerId);
                const state = {
                  command: action.command,
                  pointer: event.pointerId,
                  opened: false,
                } as NonNullable<typeof press.current>;
                press.current = state;
                if (alternates.length > 0) {
                  state.timer = setTimeout(() => {
                    state.opened = true;
                    setFan({ owner: action.command, options: alternates, highlighted: null });
                    haptic(hapticsEnabled, 12);
                  }, LONG_PRESS_MS);
                }
              }}
              onPointerMove={(event) => {
                const state = press.current;
                if (!state?.opened || state.pointer !== event.pointerId) return;
                const option = optionAt(event.clientX, event.clientY);
                setFan((current) => {
                  if (!current || current.highlighted === option) return current;
                  if (option) haptic(hapticsEnabled, 4);
                  return { ...current, highlighted: option };
                });
              }}
              onPointerUp={(event) => {
                const state = press.current;
                press.current = null;
                if (!state || state.pointer !== event.pointerId) return;
                clearTimeout(state.timer);
                if (!state.opened) {
                  run(action.command);
                  return;
                }
                // Released over an option: choose it. Released on the button itself:
                // keep the fan open so an option can be tapped. Anywhere else: cancel.
                const option = optionAt(event.clientX, event.clientY);
                if (option) {
                  setFan(null);
                  run(option);
                } else if (
                  event.currentTarget.contains(document.elementFromPoint(event.clientX, event.clientY))
                ) {
                  setFan((current) => (current ? { ...current, highlighted: null } : current));
                } else {
                  setFan(null);
                }
              }}
              onPointerCancel={() => {
                if (press.current?.timer) clearTimeout(press.current.timer);
                press.current = null;
                setFan(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  run(action.command);
                }
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <span className="dock-button__label">{label}</span>
              {command?.shortcut ? <kbd className="dock-button__key">{command.shortcut}</kbd> : null}
              {alternates.length > 0 ? <span className="dock-button__more" aria-hidden="true" /> : null}
            </button>
            {isOpen ? (
              <ul className="action-fan" role="menu" aria-label={`${label} options`}>
                {fan.options.map((option, i) => {
                  const optionCommand = describe(adapter.commands, option);
                  return (
                    <li key={option} role="none" style={{ '--i': i } as CSSProperties}>
                      <button
                        type="button"
                        role="menuitem"
                        data-fan-option={option}
                        className={`fan-option${fan.highlighted === option ? ' fan-option--hot' : ''}`}
                        onClick={() => {
                          setFan(null);
                          run(option);
                        }}
                      >
                        <span>{optionCommand?.label ?? option}</span>
                        {optionCommand?.shortcut ? <kbd>{optionCommand.shortcut}</kbd> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

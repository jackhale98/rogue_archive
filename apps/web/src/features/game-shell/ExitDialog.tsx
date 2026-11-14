import type { GameExitPrompt } from '@rogue-archive/game-api';
import { useEffect, useRef } from 'react';

interface ExitDialogProps {
  title: string;
  prompt: GameExitPrompt;
  /** The option being carried out (saving...), if any. */
  busy: string | null;
  error: string | null;
  onChoose(optionId: string): void;
  onCancel(): void;
}

/** Asked before leaving a game in progress: how saving works, and the ways to leave. */
export function ExitDialog({ title, prompt, busy, error, onChoose, onCancel }: ExitDialogProps) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);
  const busyLabel = prompt.options.find((option) => option.id === busy)?.label;
  return (
    <div className="shell-overlay shell-overlay--top">
      <div className="shell-panel" role="dialog" aria-modal="true" aria-labelledby="exit-title">
        <h1 id="exit-title" className="shell-panel__title">
          Leave {title}?
        </h1>
        <p>{prompt.message}</p>
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="muted">
            {busyLabel ? `${busyLabel}…` : 'Saving…'}
          </p>
        ) : null}
        <div className="shell-panel__actions shell-panel__actions--stack">
          {prompt.options.map((option, index) => (
            <button
              key={option.id}
              ref={index === 0 ? first : undefined}
              type="button"
              disabled={busy !== null}
              className={`button ${option.primary ? 'button--primary' : option.destructive ? 'button--danger' : 'button--quiet'}`}
              onClick={() => onChoose(option.id)}
            >
              {option.label}
            </button>
          ))}
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={onCancel}>
            Keep playing
          </button>
        </div>
      </div>
    </div>
  );
}

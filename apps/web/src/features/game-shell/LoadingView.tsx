import type { RuntimeStage, RuntimeStatus } from '@rogue-archive/game-api';
import { formatBytes } from './runtime.ts';

const STAGES: { stage: RuntimeStage; label: string }[] = [
  { stage: 'downloading', label: 'Downloading game files' },
  { stage: 'initializing', label: 'Starting the runtime' },
  { stage: 'restoring-saves', label: 'Restoring saved games' },
  { stage: 'ready', label: 'Ready' },
];

export function LoadingView({
  title,
  status,
  onCancel,
}: {
  title: string;
  status: RuntimeStatus;
  onCancel(): void;
}) {
  const currentIndex = STAGES.findIndex((entry) => entry.stage === status.stage);
  const progress = status.progress;
  return (
    <div className="shell-overlay" role="status" aria-live="polite">
      <div className="shell-panel">
        <p className="eyebrow">Loading</p>
        <h1 className="shell-panel__title">{title}</h1>
        <ol className="stage-list">
          {STAGES.map((entry, index) => {
            const state =
              currentIndex === -1
                ? 'pending'
                : index < currentIndex
                  ? 'done'
                  : index === currentIndex
                    ? 'active'
                    : 'pending';
            return (
              <li key={entry.stage} className={`stage-list__item stage-list__item--${state}`}>
                <span aria-hidden="true">{state === 'done' ? '✓' : state === 'active' ? '›' : '·'}</span>{' '}
                {entry.label}
                {state === 'done' ? <span className="visually-hidden"> (done)</span> : null}
              </li>
            );
          })}
        </ol>
        {progress && progress.total > 0 ? (
          <div className="progress">
            <progress max={progress.total} value={progress.loaded} aria-label="Download progress" />
            <span className="muted">
              {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
            </span>
          </div>
        ) : null}
        <button type="button" className="button button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

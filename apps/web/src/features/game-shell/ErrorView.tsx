import type { GameError } from '@rogue-archive/game-api';

const TITLES: Record<GameError['kind'], string> = {
  network: 'The game could not be downloaded',
  integrity: 'The game files did not verify',
  unsupported: 'This browser cannot run the game',
  'out-of-memory': 'Not enough memory',
  storage: 'Saved games are unavailable',
  crash: 'The game stopped unexpectedly',
};

export function ErrorView({ error, onRetry, onExit }: { error: GameError; onRetry(): void; onExit(): void }) {
  return (
    <div className="shell-overlay" role="alert">
      <div className="shell-panel">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="shell-panel__title">{TITLES[error.kind]}</h1>
        <p>{error.message}</p>
        {error.action ? <p className="muted">{error.action}</p> : null}
        <div className="shell-panel__actions">
          <button type="button" className="button button--primary" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="button button--quiet" onClick={onExit}>
            Back to the library
          </button>
        </div>
      </div>
    </div>
  );
}

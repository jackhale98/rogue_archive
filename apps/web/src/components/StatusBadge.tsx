import { STATUS_LABELS, type GameStatus } from '@rogue-archive/catalog';

const SYMBOLS: Record<GameStatus, string> = {
  planned: '○',
  researching: '◐',
  blocked: '⊘',
  prototype: '◑',
  experimental: '◕',
  playable: '●',
  deprecated: '◌',
};

/** Status is conveyed by text and symbol, never by color alone. */
export function StatusBadge({ status }: { status: GameStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span aria-hidden="true">{SYMBOLS[status]}</span> {STATUS_LABELS[status]}
    </span>
  );
}

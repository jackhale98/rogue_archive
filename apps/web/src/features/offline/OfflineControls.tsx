import { isLaunchable, type CatalogGame } from '@rogue-archive/catalog';
import { formatBytes } from '../game-shell/runtime.ts';
import {
  downloadAllOffline,
  downloadOffline,
  useOfflineStatus,
  useOfflineStatuses,
  type OfflineStatus,
} from './offline-store.ts';

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="m6.5 12.5 3.5 3.5 7.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A ring that fills with the download's progress. */
function ProgressRing({ fraction }: { fraction: number }) {
  const r = 9;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${length * Math.max(0.04, fraction)} ${length}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

function percent(status: Extract<OfflineStatus, { kind: 'downloading' }>): number {
  return status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
}

/** The small download button on a library card: download, progress, or done. */
export function OfflineButton({ game }: { game: CatalogGame }) {
  const status = useOfflineStatus(game);
  switch (status.kind) {
    case 'checking':
    case 'unsupported':
      return null;
    case 'downloaded':
      return (
        <span
          className="offline-button offline-button--done"
          role="img"
          aria-label={`${game.title} is available offline (${formatBytes(status.bytes)})`}
          title={`Available offline (${formatBytes(status.bytes)})`}
        >
          <DoneIcon />
        </span>
      );
    case 'queued':
    case 'downloading': {
      const fraction = status.kind === 'downloading' ? status.done / Math.max(1, status.total) : 0;
      const label =
        status.kind === 'downloading'
          ? `Downloading ${game.title}: ${percent(status)}%`
          : `${game.title} is waiting to download`;
      return (
        <span className="offline-button offline-button--busy" role="img" aria-label={label} title={label}>
          <ProgressRing fraction={fraction} />
        </span>
      );
    }
    default: {
      const label =
        status.kind === 'error'
          ? `Download ${game.title} again for offline play (the last try failed: ${status.message})`
          : `Download ${game.title} for offline play`;
      return (
        <button
          type="button"
          className={`offline-button${status.kind === 'error' ? ' offline-button--error' : ''}`}
          aria-label={label}
          title={label}
          onClick={() => void downloadOffline(game)}
        >
          <DownloadIcon />
        </button>
      );
    }
  }
}

/** "Download all for offline", with progress while it runs and a note when everything is there. */
export function DownloadAll({ games }: { games: readonly CatalogGame[] }) {
  const launchable = games.filter(isLaunchable);
  const statuses = useOfflineStatuses(launchable);
  const list = launchable.map((game) => ({ game, status: statuses.get(game.id) }));
  if (list.length === 0 || list.some(({ status }) => !status || status.kind === 'checking')) return null;
  if (list.some(({ status }) => status?.kind === 'unsupported')) return null;

  const active = list.find(({ status }) => status?.kind === 'downloading' || status?.kind === 'queued');
  const done = list.filter(({ status }) => status?.kind === 'downloaded');
  if (active) {
    const current = list.find(({ status }) => status?.kind === 'downloading');
    return (
      <p className="download-all download-all--busy" role="status">
        <ProgressRing
          fraction={
            current?.status?.kind === 'downloading'
              ? current.status.done / Math.max(1, current.status.total)
              : 0
          }
        />
        Downloading {current?.game.title ?? 'games'}… ({Math.min(done.length + 1, list.length)} of{' '}
        {list.length})
      </p>
    );
  }
  if (done.length === list.length) {
    const bytes = done.reduce(
      (sum, { status }) => sum + (status?.kind === 'downloaded' ? status.bytes : 0),
      0,
    );
    return (
      <p className="download-all download-all--done" role="status">
        <DoneIcon /> All games available offline ({formatBytes(bytes)})
      </p>
    );
  }
  return (
    <button
      type="button"
      className="button button--quiet button--small download-all"
      onClick={() => void downloadAllOffline(launchable)}
    >
      <DownloadIcon />
      {done.length > 0
        ? `Download the other ${list.length - done.length} for offline`
        : 'Download all for offline'}
    </button>
  );
}

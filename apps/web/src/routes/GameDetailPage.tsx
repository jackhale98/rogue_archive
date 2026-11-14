import { isLaunchable, type CatalogGame } from '@rogue-archive/catalog';
import type { GameSettingDescriptor } from '@rogue-archive/game-api';
import { useEffect, useState } from 'react';
import { loadAdapterModule } from '../app/adapters.ts';
import { gamesById } from '../app/catalog.ts';
import { repositoryFileUrl } from '../app/config.ts';
import { href } from '../app/router.ts';
import { gameSettingsScope } from '../app/settings.tsx';
import { getStore } from '../app/store.ts';
import { GameCover } from '../components/GameCover.tsx';
import { downloadOffline, removeOffline, useOfflineStatus } from '../features/offline/offline-store.ts';
import {
  formatBytes,
  loadRuntime,
  runtimeDownloadSize,
  type LoadedRuntime,
} from '../features/game-shell/runtime.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import { leadAuthor } from '../lib/authors.ts';

const INTERFACE_LABELS = { ascii: 'Text (ASCII)', tiles: 'Tiles', graphical: 'Graphical' } as const;
const RESULT_LABELS = {
  pass: 'Works',
  partial: 'Partly verified',
  fail: 'Does not work',
  untested: 'Not yet tested',
} as const;

function yesNo(value: boolean | undefined): string {
  return value ? 'Yes' : 'No';
}

function OfflineControl({ game, runtime }: { game: CatalogGame; runtime: LoadedRuntime }) {
  const status = useOfflineStatus(game);
  const size = formatBytes(runtimeDownloadSize(runtime.manifest));

  if (status.kind === 'checking') return null;
  if (status.kind === 'unsupported') {
    return (
      <p className="muted">
        Offline play becomes available after the site has finished installing in this browser.
      </p>
    );
  }

  return (
    <div className="offline-control">
      {status.kind === 'downloaded' ? (
        <>
          <p>
            <span aria-hidden="true">✓ </span>Available offline ({size}).
          </p>
          <button type="button" className="button button--quiet" onClick={() => void removeOffline(game)}>
            Remove offline copy
          </button>
        </>
      ) : (
        <>
          <p>
            {status.kind === 'partial' ? 'Partly downloaded. ' : ''}Download {size} to play without a
            connection. Saved games are unaffected.
          </p>
          <button
            type="button"
            className="button"
            disabled={status.kind === 'queued' || status.kind === 'downloading'}
            onClick={() => void downloadOffline(game)}
          >
            {status.kind === 'downloading'
              ? `Downloading… ${status.done} of ${status.total} files`
              : status.kind === 'queued'
                ? 'Waiting to download…'
                : 'Download for offline play'}
          </button>
        </>
      )}
      {status.kind === 'error' ? (
        <p role="alert" className="error-text">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

function GameSettings({ game }: { game: CatalogGame }) {
  const [descriptors, setDescriptors] = useState<readonly GameSettingDescriptor[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!game.adapter) return;
    let cancelled = false;
    void Promise.all([loadAdapterModule(game.adapter), getStore()]).then(async ([module, store]) => {
      const adapter = module.createAdapter();
      const saved = (await store?.getSettings(gameSettingsScope(game.id))) ?? {};
      if (cancelled) return;
      setDescriptors(adapter.settings ?? []);
      setValues(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [game]);

  if (descriptors.length === 0) return null;

  const change = (descriptor: GameSettingDescriptor, raw: string) => {
    const option = descriptor.options.find((candidate) => String(candidate.value) === raw);
    if (!option) return;
    setValues((current) => ({ ...current, [descriptor.key]: option.value }));
    void getStore().then((store) =>
      store?.setSetting(gameSettingsScope(game.id), descriptor.key, option.value),
    );
  };

  return (
    <section className="detail-section" aria-labelledby="game-settings-title">
      <h2 id="game-settings-title" className="section-title">
        Preferences
      </h2>
      <div className="settings-list">
        {descriptors.map((descriptor) => (
          <label key={descriptor.key} className="setting">
            <span className="setting__label">{descriptor.label}</span>
            {descriptor.description ? (
              <span className="setting__description">{descriptor.description}</span>
            ) : null}
            <select
              value={String(values[descriptor.key] ?? descriptor.default)}
              onChange={(event) => change(descriptor, event.target.value)}
            >
              {descriptor.options.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

export function GameDetailPage({ gameId }: { gameId: string }) {
  const game = gamesById.get(gameId);
  const [runtime, setRuntime] = useState<LoadedRuntime | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const launchable = game ? isLaunchable(game) : false;

  useEffect(() => {
    if (game) document.title = `${game.title} · Rogue Archive`;
    if (!game || !launchable) return;
    const controller = new AbortController();
    loadRuntime(game, controller.signal).then(setRuntime, (error: unknown) => {
      if (!controller.signal.aborted) setRuntimeError(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [game, launchable]);

  if (!game) return <NotFoundPage />;

  return (
    <article className="page detail">
      <p className="breadcrumb">
        <a href={href('/')}>Library</a> <span aria-hidden="true">/</span> {game.title}
      </p>
      <header className="detail__header">
        <div className="detail__intro">
          <p className="detail__eyebrow">
            {game.firstReleased ? <span>{game.firstReleased}</span> : null}
            <span>{leadAuthor(game.authors)}</span>
          </p>
          <h1 className="detail__title">{game.title}</h1>
          <p className="detail__subtitle">{game.subtitle}</p>
          <p className="detail__description">{game.description}</p>
          {launchable ? (
            <div className="detail__actions">
              <a className="button button--primary button--large" href={href(`/play/${game.id}`)}>
                Play {game.title}
              </a>
              {runtime ? (
                <span className="muted">{formatBytes(runtimeDownloadSize(runtime.manifest))} download</span>
              ) : null}
            </div>
          ) : (
            <p className="notice">
              {game.status === 'blocked'
                ? 'This game is on the watchlist and cannot be distributed yet.'
                : 'This game is on the roadmap and is not playable yet.'}
            </p>
          )}
          {runtimeError ? (
            <p role="alert" className="error-text">
              {runtimeError}
            </p>
          ) : null}
        </div>
        <div className="detail__art">
          <GameCover game={game} eager />
        </div>
      </header>

      {/* Settings first: the display (text or tiles) is what players look for. */}
      {launchable ? <GameSettings game={game} /> : null}

      {game.about.length > 0 ? (
        <section className="detail-section prose">
          {game.about.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </section>
      ) : null}

      {game.blockers.length > 0 ? (
        <section className="detail-section" aria-labelledby="blockers-title">
          <h2 id="blockers-title" className="section-title">
            Blockers
          </h2>
          <ul className="bullet-list">
            {game.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {game.controlsSummary.length > 0 ? (
        <section className="detail-section" aria-labelledby="controls-title">
          <h2 id="controls-title" className="section-title">
            Controls
          </h2>
          <p className="muted">
            The original keyboard commands are unchanged. On touch screens an on-screen pad, action buttons, a
            command list and a keyboard button provide the same commands.
          </p>
          <table className="facts-table">
            <tbody>
              {game.controlsSummary.map((row) => (
                <tr key={row.keys}>
                  <th scope="row">
                    <kbd>{row.keys}</kbd>
                  </th>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {launchable && runtime ? (
        <section className="detail-section" aria-labelledby="offline-title">
          <h2 id="offline-title" className="section-title">
            Offline & saves
          </h2>
          <p>
            Saved games are stored in this browser only. Use <strong>Export saves</strong> from the in-game
            menu to back them up or move them to another device.
          </p>
          <OfflineControl game={game} runtime={runtime} />
        </section>
      ) : null}

      <section className="detail-section" aria-labelledby="facts-title">
        <h2 id="facts-title" className="section-title">
          About this {launchable ? 'port' : 'game'}
        </h2>
        <table className="facts-table">
          <tbody>
            <tr>
              <th scope="row">Created by</th>
              <td>{game.authors}</td>
            </tr>
            {game.firstReleased ? (
              <tr>
                <th scope="row">First released</th>
                <td>{game.firstReleased}</td>
              </tr>
            ) : null}
            <tr>
              <th scope="row">Upstream</th>
              <td>
                {game.upstream.repository || game.upstream.website ? (
                  <a href={game.upstream.repository ?? game.upstream.website}>{game.upstream.name}</a>
                ) : (
                  game.upstream.name
                )}
              </td>
            </tr>
            {game.version ? (
              <tr>
                <th scope="row">Version</th>
                <td>
                  {game.version}
                  {game.sourceRevision ? (
                    <>
                      {' '}
                      · source <code title={game.sourceRevision}>{game.sourceRevision.slice(0, 10)}</code>
                    </>
                  ) : null}
                </td>
              </tr>
            ) : null}
            {runtime ? (
              <tr>
                <th scope="row">Build</th>
                <td>
                  <code>{runtime.manifest.buildId}</code> · {runtime.manifest.toolchain}
                </td>
              </tr>
            ) : null}
            <tr>
              <th scope="row">Interface</th>
              <td>{game.interface.map((style) => INTERFACE_LABELS[style]).join(', ')}</td>
            </tr>
            {launchable ? (
              <>
                <tr>
                  <th scope="row">Input</th>
                  <td>
                    Keyboard: {yesNo(game.input.keyboard)} · Mouse: {yesNo(game.input.mouse)} · Touch:{' '}
                    {yesNo(game.input.touch)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Saves</th>
                  <td>
                    Local: {yesNo(game.saves?.local)} · Export/import: {yesNo(game.saves?.export)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Offline</th>
                  <td>{yesNo(game.offline)}</td>
                </tr>
              </>
            ) : null}
            <tr>
              <th scope="row">Code license</th>
              <td>{game.license.code}</td>
            </tr>
            <tr>
              <th scope="row">Assets</th>
              <td>{game.license.assets}</td>
            </tr>
            {game.license.report ? (
              <tr>
                <th scope="row">Provenance</th>
                <td>
                  <a href={repositoryFileUrl(game.license.report)}>License and provenance report</a>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {game.compatibility.length > 0 ? (
        <section className="detail-section" aria-labelledby="compat-title">
          <h2 id="compat-title" className="section-title">
            Compatibility
          </h2>
          <table className="facts-table compat-table">
            <thead>
              <tr>
                <th scope="col">Browser / device</th>
                <th scope="col">Result</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {game.compatibility.map((row) => (
                <tr key={row.environment}>
                  <th scope="row">{row.environment}</th>
                  <td>
                    <span className={`compat compat--${row.result}`}>{RESULT_LABELS[row.result]}</span>
                  </td>
                  <td>{row.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {game.knownLimitations.length > 0 ? (
        <section className="detail-section" aria-labelledby="limits-title">
          <h2 id="limits-title" className="section-title">
            Known limitations
          </h2>
          <ul className="bullet-list">
            {game.knownLimitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

import { isLaunchable } from '@rogue-archive/catalog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gamesById } from '../app/catalog.ts';
import { setFlash } from '../app/flash.ts';
import { href, navigate } from '../app/router.ts';
import { useSettings } from '../app/settings.tsx';
import { ErrorView } from '../features/game-shell/ErrorView.tsx';
import { LoadingView } from '../features/game-shell/LoadingView.tsx';
import { ShellMenu } from '../features/game-shell/ShellMenu.tsx';
import { TouchControls } from '../features/game-shell/TouchControls.tsx';
import { useGameSession } from '../features/game-shell/useGameSession.ts';
import { VirtualKeyboard, type VirtualKeyboardHandle } from '../features/game-shell/VirtualKeyboard.tsx';
import '../styles/shell.css';
import { NotFoundPage } from './NotFoundPage.tsx';

function useCoarsePointer(): boolean {
  const query = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setCoarse(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

function canFullscreen(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function';
}

export function PlayPage({ gameId }: { gameId: string }) {
  const game = gamesById.get(gameId);
  if (!game || !isLaunchable(game) || !game.adapter) return <NotFoundPage />;
  return <GameShell gameId={gameId} />;
}

function GameShell({ gameId }: { gameId: string }) {
  const game = gamesById.get(gameId)!;
  const mountRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<VirtualKeyboardHandle>(null);
  const [attempt, setAttempt] = useState(0);
  const session = useGameSession(game, mountRef, attempt);
  const { settings } = useSettings();
  const coarse = useCoarsePointer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewLabel, setViewLabel] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const showTouch = settings.touchControls === 'always' || (settings.touchControls === 'auto' && coarse);
  const { adapter, phase, runtime } = session;
  const running = phase === 'running' && adapter !== null;

  useEffect(() => {
    document.title = `${game.title} · Rogue Archive`;
  }, [game]);

  const leave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    setMenuOpen(false);
    try {
      await adapter?.persist();
    } catch {
      // The session cleanup retries on shutdown; never trap the player here.
    }
    if (adapter?.resumeHint && phase === 'running') setFlash(adapter.resumeHint);
    navigate(`/games/${game.id}`);
  }, [adapter, game.id, leaving, phase]);

  useEffect(() => {
    if (phase === 'exited') navigate(`/games/${game.id}`);
  }, [phase, game.id]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="play" data-touch={showTouch ? 'on' : 'off'} data-hand={settings.handedness}>
      <header className="play__bar">
        <a
          className="play__back"
          href={href(`/games/${game.id}`)}
          onClick={(event) => {
            event.preventDefault();
            void leave();
          }}
        >
          <span aria-hidden="true">←</span> <span className="play__back-label">Library</span>
        </a>
        <h1 className="play__title">{game.title}</h1>
        <div className="play__tools">
          {running && adapter.cycleView ? (
            <button
              type="button"
              className="tool-button"
              onClick={() => setViewLabel(adapter.cycleView!())}
              aria-label="Change zoom"
            >
              <span aria-hidden="true">⤢</span>
              <span className="tool-button__label">{viewLabel ?? 'Zoom'}</span>
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              className="tool-button"
              onClick={() => keyboardRef.current?.open()}
              aria-label="Open keyboard"
            >
              <span aria-hidden="true">⌨</span>
              <span className="tool-button__label">Keyboard</span>
            </button>
          ) : null}
          {canFullscreen() ? (
            <button
              type="button"
              className="tool-button"
              onClick={toggleFullscreen}
              aria-label="Toggle full screen"
            >
              <span aria-hidden="true">⛶</span>
              <span className="tool-button__label">Full screen</span>
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              className="tool-button tool-button--primary"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-label="Menu"
            >
              <span aria-hidden="true">☰</span>
              <span className="tool-button__label">Menu</span>
            </button>
          ) : null}
        </div>
      </header>

      {running && session.inputContext.textEntry ? (
        <div className="text-entry-banner" role="status">
          <span>The game is asking you to type.</span>
          <button type="button" className="button button--small" onClick={() => keyboardRef.current?.open()}>
            Open keyboard
          </button>
        </div>
      ) : null}

      <div className="play__stage">
        {showTouch && running && adapter.touchLayout ? (
          <div className="play__rail play__rail--actions">
            <TouchControls adapter={adapter} layout={adapter.touchLayout} part="actions" />
          </div>
        ) : null}
        <div className="play__screen" ref={mountRef} />
        {showTouch && running && adapter.touchLayout ? (
          <div className="play__rail play__rail--pad">
            <TouchControls adapter={adapter} layout={adapter.touchLayout} part="pad" />
          </div>
        ) : null}

        {phase === 'loading' ? (
          <LoadingView
            title={game.title}
            status={session.status}
            onCancel={() => navigate(`/games/${game.id}`)}
          />
        ) : null}
        {phase === 'error' && session.error ? (
          <ErrorView
            error={session.error}
            onRetry={() => setAttempt((n) => n + 1)}
            onExit={() => navigate('/')}
          />
        ) : null}
        {leaving ? (
          <div className="shell-overlay" role="status">
            <div className="shell-panel">Saving your progress…</div>
          </div>
        ) : null}
      </div>

      {running ? <VirtualKeyboard ref={keyboardRef} adapter={adapter} /> : null}
      {running && runtime ? (
        <ShellMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onExit={() => void leave()}
          game={game}
          adapter={adapter}
          runtime={runtime}
          settings={session.settings}
        />
      ) : null}
    </div>
  );
}

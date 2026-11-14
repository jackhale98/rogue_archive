import { isLaunchable } from '@rogue-archive/catalog';
import { SHELL_COMMAND, type GameExitPrompt } from '@rogue-archive/game-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gamesById } from '../app/catalog.ts';
import { requestDurableStorage } from '../app/durable-storage.ts';
import { href, navigate } from '../app/router.ts';
import { useSettings } from '../app/settings.tsx';
import { ErrorView } from '../features/game-shell/ErrorView.tsx';
import { ExitDialog } from '../features/game-shell/ExitDialog.tsx';
import { LoadingView } from '../features/game-shell/LoadingView.tsx';
import { MessageLog } from '../features/game-shell/MessageLog.tsx';
import { ShellMenu } from '../features/game-shell/ShellMenu.tsx';
import { ActionDock, ThumbPad } from '../features/game-shell/TouchControls.tsx';
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

/** Phones: small screens where the shell places its controls over or beside the game and the game may use a compact layout. */
function useCompactViewport(enabled: boolean): boolean {
  const check = () => enabled && Math.min(window.innerWidth, window.innerHeight) < 600;
  const [compact, setCompact] = useState(check);
  useEffect(() => {
    const onResize = () => setCompact(check());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return compact;
}

function usePortrait(): boolean {
  const query = '(orientation: portrait)';
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setPortrait(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return portrait;
}

/** How long a game's own save and quit may take before the shell gives up waiting. */
const EXIT_TIMEOUT_MS = 30_000;

/** Space (CSS px) the floating tools take in the top-right corner of the compact layout. */
const COMPACT_TOOLS_WIDTH = 210;

function GameShell({ gameId }: { gameId: string }) {
  const game = gamesById.get(gameId)!;
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<VirtualKeyboardHandle>(null);
  const [attempt, setAttempt] = useState(0);
  const session = useGameSession(game, mountRef, attempt);
  const { settings } = useSettings();
  const coarse = useCoarsePointer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [viewLabel, setViewLabel] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** Asked before leaving a game in progress. */
  const [exitPrompt, setExitPrompt] = useState<GameExitPrompt | null>(null);
  const [exitBusy, setExitBusy] = useState<string | null>(null);
  const [exitError, setExitError] = useState<string | null>(null);
  const showTouch = settings.touchControls === 'always' || (settings.touchControls === 'auto' && coarse);
  const compact = useCompactViewport(showTouch);
  const portrait = usePortrait();
  const { adapter, phase, runtime } = session;
  const running = phase === 'running' && adapter !== null;
  const layout = session.touchLayout;
  const hapticsEnabled = settings.haptics === 'on';
  /** Phones held sideways: the dock, and the pad under the tools, in rails beside the game. */
  const rails = compact && !portrait;

  useEffect(() => {
    document.title = `${game.title} · Rogue Archive`;
  }, [game]);

  // Saves live in this browser: once a game runs, ask it not to clear them to free space.
  useEffect(() => {
    if (running) void requestDurableStorage();
  }, [running]);

  // Tell the adapter how it is presented, and which edges our controls cover.
  // Phones held sideways put the controls in rails beside the game, so there
  // is nothing to avoid; upright, they float over the bottom of the game and
  // the tools over its top-right corner.
  useEffect(() => {
    if (!running || !adapter.setPresentation) return;
    const stage = stageRef.current;
    const measure = () => {
      if (!compact || !stage) {
        adapter.setPresentation!({ compact: false, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
        return;
      }
      if (rails) {
        adapter.setPresentation!({ compact: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
        return;
      }
      // From the stage's bottom edge to the highest control: the controls'
      // margin and the safe area below them are covered too.
      const bottom = stage.getBoundingClientRect().bottom;
      const tops = ['.play__dock', '.play__pad']
        .map((selector) => stage.querySelector(selector)?.getBoundingClientRect())
        .filter((rect): rect is DOMRect => !!rect && rect.height > 0)
        .map((rect) => rect.top);
      adapter.setPresentation!({
        compact: true,
        insets: {
          top: 0,
          right: 0,
          bottom: tops.length > 0 ? Math.max(0, Math.ceil(bottom - Math.min(...tops))) : 0,
          left: 0,
        },
        topRightReserve: COMPACT_TOOLS_WIDTH,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (stage) observer.observe(stage);
    return () => observer.disconnect();
  }, [running, adapter, compact, rails, layout]);

  const leave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    setMenuOpen(false);
    try {
      await adapter?.persist();
    } catch {
      // The session cleanup retries on shutdown; never trap the player here.
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    navigate(`/games/${game.id}`);
  }, [adapter, game.id, leaving]);

  /** Leaving: with a game in progress, first ask how (save and quit, or not). */
  const requestLeave = useCallback(() => {
    setMenuOpen(false);
    const prompt = phase === 'running' ? (adapter?.exitPrompt?.() ?? null) : null;
    if (!prompt || prompt.options.length === 0) {
      void leave();
      return;
    }
    setExitError(null);
    setExitPrompt(prompt);
  }, [adapter, phase, leave]);

  const chooseExit = useCallback(
    async (optionId: string) => {
      if (!adapter || exitBusy) return;
      setExitBusy(optionId);
      setExitError(null);
      try {
        await Promise.race([
          adapter.exitWith?.(optionId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('The game did not finish in time.')), EXIT_TIMEOUT_MS),
          ),
        ]);
      } catch (error) {
        setExitBusy(null);
        setExitError(
          `${error instanceof Error ? error.message : String(error)} Your game is still running: try again, or keep playing.`,
        );
        return;
      }
      setExitPrompt(null);
      setExitBusy(null);
      await leave();
    },
    [adapter, exitBusy, leave],
  );

  useEffect(() => {
    if (phase === 'exited') navigate(`/games/${game.id}`);
  }, [phase, game.id]);

  // Give keyboard focus back to the game after shell UI (menu, toolbar) is used,
  // so the next keystroke goes to the game rather than the last button pressed.
  const focusGame = () => {
    mountRef.current?.querySelector<HTMLElement>('canvas, [tabindex]')?.focus({ preventScroll: true });
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  };

  // The game can ask for the log (e.g. tapping its message area).
  const [handledLogRequests, setHandledLogRequests] = useState(0);
  if (session.logRequests !== handledLogRequests) {
    setHandledLogRequests(session.logRequests);
    if (session.logRequests > 0) setLogOpen(true);
  }

  const onShellCommand = (command: string): boolean => {
    if (command === SHELL_COMMAND.log) {
      setLogOpen(true);
      return true;
    }
    if (command === SHELL_COMMAND.palette) {
      setMenuOpen(true);
      return true;
    }
    if (command === SHELL_COMMAND.keyboard) {
      keyboardRef.current?.open();
      return true;
    }
    return false;
  };

  const tools = (
    <>
      {running && adapter.cycleView && !compact ? (
        <button
          type="button"
          className="tool-button"
          onClick={() => {
            setViewLabel(adapter.cycleView!());
            focusGame();
          }}
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
          // Highlighted (without moving the layout) while the game accepts typed text.
          data-attention={session.inputContext.textEntry ? 'true' : undefined}
        >
          <span aria-hidden="true">⌨</span>
          <span className="tool-button__label">Keyboard</span>
        </button>
      ) : null}
      {canFullscreen() ? (
        <button
          type="button"
          className="tool-button"
          onClick={() => {
            toggleFullscreen();
            focusGame();
          }}
          aria-label="Toggle full screen"
        >
          <span aria-hidden="true">⛶</span>
          <span className="tool-button__label">Full screen</span>
        </button>
      ) : null}
      {running ? (
        <button
          type="button"
          className="tool-button"
          onClick={() => setLogOpen(true)}
          aria-label="Message log"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3 4.5h12M3 9h9M3 13.5h11" />
          </svg>
          <span className="tool-button__label">Log</span>
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
          {/* A gear, so it reads as settings and is distinct from the log's lines. */}
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="tool-button__label">Menu</span>
        </button>
      ) : null}
    </>
  );

  const backLink = (
    <a
      className="play__back"
      href={href(`/games/${game.id}`)}
      aria-label="Back to library"
      onClick={(event) => {
        event.preventDefault();
        requestLeave();
      }}
    >
      <span aria-hidden="true">←</span> <span className="play__back-label">Library</span>
    </a>
  );

  const pad =
    showTouch && running && layout?.directionPad ? (
      <ThumbPad adapter={adapter} pad={layout.directionPad} hapticsEnabled={hapticsEnabled} />
    ) : null;
  const dock =
    showTouch && running && layout && layout.actions.length > 0 ? (
      <ActionDock
        key={session.touchContext}
        adapter={adapter}
        actions={layout.actions}
        context={session.touchContext}
        hapticsEnabled={hapticsEnabled}
        onShellCommand={onShellCommand}
        orientation={compact && portrait ? 'horizontal' : 'vertical'}
      />
    ) : null;

  return (
    <div
      className={`play${compact ? ' play--compact' : ''}${rails ? ' play--rails' : ''}`}
      data-touch={showTouch ? 'on' : 'off'}
      data-hand={settings.handedness}
      data-context={session.touchContext}
    >
      {compact ? null : (
        <header className="play__bar">
          {backLink}
          <h1 className="play__title">{game.title}</h1>
          <div className="play__tools">{tools}</div>
        </header>
      )}

      <div className="play__stage" ref={stageRef}>
        {(!compact && showTouch && running) || rails ? (
          <div className="play__rail play__rail--actions">{dock}</div>
        ) : null}
        <div className="play__screen" ref={mountRef} />
        {(!compact && showTouch && running) || rails ? (
          <div className="play__rail play__rail--pad">
            {rails ? (
              <div className="play__rail-tools">
                {backLink}
                {tools}
              </div>
            ) : null}
            {pad}
          </div>
        ) : null}

        {compact ? <h1 className="visually-hidden">{game.title}</h1> : null}
        {compact && !rails ? (
          <>
            <div className="play__float play__float--tools">
              {backLink}
              {tools}
            </div>
            {dock ? <div className="play__dock">{dock}</div> : null}
            {pad ? <div className="play__pad">{pad}</div> : null}
          </>
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
        {exitPrompt && !leaving ? (
          <ExitDialog
            title={game.title}
            prompt={exitPrompt}
            busy={exitBusy}
            error={exitError}
            onChoose={(id) => void chooseExit(id)}
            onCancel={() => {
              setExitPrompt(null);
              focusGame();
            }}
          />
        ) : null}
        {leaving ? (
          <div className="shell-overlay shell-overlay--top" role="status">
            <div className="shell-panel">Saving your progress…</div>
          </div>
        ) : null}
      </div>

      {running ? <VirtualKeyboard ref={keyboardRef} adapter={adapter} /> : null}
      {running ? (
        <MessageLog
          open={logOpen}
          entries={session.log}
          onClose={() => {
            setLogOpen(false);
            focusGame();
          }}
        />
      ) : null}
      {running && runtime ? (
        <ShellMenu
          open={menuOpen}
          onClose={() => {
            setMenuOpen(false);
            focusGame();
          }}
          onExit={requestLeave}
          game={game}
          adapter={adapter}
          runtime={runtime}
          settings={session.settings}
        />
      ) : null}
    </div>
  );
}

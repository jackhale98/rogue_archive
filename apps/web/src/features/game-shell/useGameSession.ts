import type { CatalogGame } from '@rogue-archive/catalog';
import {
  GAME_API_VERSION,
  LifecycleMachine,
  domKeyToInput,
  type GameAdapter,
  type GameError,
  type GameEvent,
  type GameHost,
  type InputContext,
  type RuntimeStatus,
  type TouchControlLayout,
} from '@rogue-archive/game-api';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { loadAdapterModule } from '../../app/adapters.ts';
import { gameSettingsScope } from '../../app/settings.tsx';
import { getStore } from '../../app/store.ts';
import { loadRuntime, RuntimeUnavailableError, type LoadedRuntime } from './runtime.ts';

export type SessionPhase = 'loading' | 'running' | 'error' | 'exited';

export interface GameSession {
  phase: SessionPhase;
  status: RuntimeStatus;
  error: GameError | null;
  inputContext: InputContext;
  adapter: GameAdapter | null;
  runtime: LoadedRuntime | null;
  settings: Record<string, unknown>;
  /** Current touch controls, updated by the adapter as the game's context changes. */
  touchLayout: TouchControlLayout | null;
  touchContext: string;
}

const INITIAL: GameSession = {
  phase: 'loading',
  status: { stage: 'idle', detail: 'Preparing' },
  error: null,
  inputContext: { textEntry: false },
  adapter: null,
  runtime: null,
  settings: {},
  touchLayout: null,
  touchContext: 'title',
};

function toGameError(error: unknown): GameError {
  if (error instanceof RuntimeUnavailableError) {
    return { kind: 'network', message: error.message, action: 'Try again later, or return to the library.' };
  }
  const e = error as { kind?: GameError['kind']; message?: string; action?: string } | null;
  const kind = e?.kind ?? 'crash';
  const defaults: Record<GameError['kind'], string> = {
    network: 'Check your connection and try again.',
    integrity: 'Reload the page to fetch a fresh copy of the game.',
    unsupported: 'Try a current version of Chrome, Edge, Firefox or Safari.',
    'out-of-memory': 'Close other tabs or apps and try again.',
    storage: 'Allow site storage for this page; private browsing can block it.',
    crash: 'Return to the library and try again.',
  };
  return { kind, message: e?.message ?? String(error), action: e?.action ?? defaults[kind] };
}

/** Elements whose keystrokes belong to the shell (menus, the on-screen keyboard), not the game. */
function isShellControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // The on-screen keyboard field forwards its own input; don't send keys twice.
  if (target.closest('[data-shell-keyboard]')) return true;
  return (
    target.matches('input, textarea, select, button, [contenteditable="true"]') ||
    target.closest('dialog[open]') !== null
  );
}

/**
 * Runs one game session: fetch the runtime manifest, load the adapter,
 * initialize, start, route input, persist on hide, and shut down cleanly.
 */
export function useGameSession(
  game: CatalogGame,
  mountRef: RefObject<HTMLDivElement | null>,
  attempt: number,
): GameSession {
  const [session, setSession] = useState<GameSession>(INITIAL);
  const adapterRef = useRef<GameAdapter | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !game.adapter) return;
    const controller = new AbortController();
    const lifecycle = new LifecycleMachine();
    let adapter: GameAdapter | null = null;
    const update = (patch: Partial<GameSession>) => {
      if (!controller.signal.aborted) setSession((current) => ({ ...current, ...patch }));
    };
    setSession(INITIAL);

    const fail = (error: unknown) => {
      if (controller.signal.aborted) return;
      console.error(error);
      if (lifecycle.can('fail')) lifecycle.transition('fail');
      update({ phase: 'error', error: toGameError(error), status: { stage: 'error' } });
    };

    const host: GameHost = {
      emit(event: GameEvent) {
        switch (event.type) {
          case 'status':
            if (lifecycle.state !== 'running') update({ status: event.status });
            break;
          case 'error':
            fail(event.error);
            break;
          case 'touch-layout':
            update({ touchLayout: event.layout, touchContext: event.context });
            break;
          case 'input-context':
            update({ inputContext: event.context });
            break;
          case 'setting-changed':
            void getStore().then((store) =>
              store?.setSetting(gameSettingsScope(game.id), event.key, event.value),
            );
            break;
          case 'exit':
            if (lifecycle.can('stop')) lifecycle.transition('stop');
            update({ phase: 'exited' });
            break;
          case 'message':
          case 'save-state':
            break;
        }
      },
      logger: {
        debug: (...args) => import.meta.env.DEV && console.debug(`[${game.id}]`, ...args),
        info: (...args) => console.info(`[${game.id}]`, ...args),
        warn: (...args) => console.warn(`[${game.id}]`, ...args),
        error: (...args) => console.error(`[${game.id}]`, ...args),
      },
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!adapter || lifecycle.state !== 'running' || isShellControl(event.target)) return;
      const input = domKeyToInput(event);
      if (!input) return;
      event.preventDefault();
      adapter.sendInput(input);
    };
    const onVisibility = () => adapter?.setVisible?.(document.visibilityState === 'visible');
    const onPageHide = () => void adapter?.persist().catch(() => undefined);

    void (async () => {
      try {
        update({ status: { stage: 'downloading', detail: 'Fetching game manifest' } });
        const [runtime, module, store] = await Promise.all([
          loadRuntime(game, controller.signal),
          loadAdapterModule(game.adapter!),
          getStore(),
        ]);
        if (controller.signal.aborted) return;
        adapter = module.createAdapter();
        if (adapter.apiVersion !== GAME_API_VERSION)
          throw new Error(`Adapter API ${adapter.apiVersion} is not supported.`);
        adapterRef.current = adapter;
        const settings = (await store?.getSettings(gameSettingsScope(game.id))) ?? {};
        update({ adapter, runtime, settings, touchLayout: adapter.touchLayout ?? null });

        lifecycle.transition('initialize');
        await adapter.initialize(host, {
          mount,
          runtimeBaseUrl: runtime.baseUrl,
          runtime: runtime.manifest,
          settings,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        lifecycle.transition('initialized');
        lifecycle.transition('start');
        await adapter.start();
        update({ phase: 'running', status: { stage: 'running' } });
        void store?.recordRecentGame(game.id);
        if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) {
          (window as unknown as { __rogueArchive?: unknown }).__rogueArchive = { adapter, runtime };
        }
      } catch (error) {
        fail(error);
      }
    })();

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      controller.abort();
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (lifecycle.can('stop')) lifecycle.transition('stop');
      // Shutdown persists progress first; it continues after unmount.
      void adapter?.shutdown().finally(() => lifecycle.can('stopped') && lifecycle.transition('stopped'));
      adapterRef.current = null;
    };
  }, [game, mountRef, attempt]);

  return session;
}

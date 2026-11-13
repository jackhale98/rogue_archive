/**
 * Which games are downloaded for offline play, shared by the library, the
 * game pages and Settings.
 *
 * Status comes from Cache Storage only (the cached runtime manifest and the
 * files it lists), so showing it never downloads anything. Downloads fetch
 * every runtime file through the service worker, which keeps them; they run
 * one at a time, so "Download all" is a queue.
 */
import { isLaunchable, type CatalogGame } from '@rogue-archive/catalog';
import type { RuntimeManifest } from '@rogue-archive/game-api';
import { useEffect, useSyncExternalStore } from 'react';
import { assetUrl } from '../../app/catalog.ts';
import {
  downloadForOffline,
  offlineSupported,
  removeOfflineCopy,
  RUNTIME_CACHE,
} from '../game-details/offline.ts';
import { loadRuntime, runtimeDownloadSize, type LoadedRuntime } from '../game-shell/runtime.ts';

export type OfflineStatus =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'none' }
  | { kind: 'partial' }
  | { kind: 'queued' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'downloaded'; bytes: number }
  | { kind: 'error'; message: string };

const CHECKING: OfflineStatus = { kind: 'checking' };
let statuses = new Map<string, OfflineStatus>();
const listeners = new Set<() => void>();
const checked = new Set<string>();
let queue: Promise<void> = Promise.resolve();

function setStatus(gameId: string, status: OfflineStatus): void {
  statuses = new Map(statuses).set(gameId, status);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function manifestUrl(game: CatalogGame): string | null {
  return game.runtimeManifest ? new URL(assetUrl(game.runtimeManifest), window.location.href).href : null;
}

/** The runtime as last cached by the service worker, if any (no network). */
async function cachedRuntime(game: CatalogGame): Promise<LoadedRuntime | null> {
  const url = manifestUrl(game);
  if (!url || !('caches' in window)) return null;
  const cache = await caches.open(RUNTIME_CACHE);
  const response = await cache.match(url, { ignoreVary: true });
  if (!response) return null;
  try {
    const manifest = (await response.json()) as RuntimeManifest;
    if (manifest.gameId !== game.id || !Array.isArray(manifest.files)) return null;
    return { manifest, baseUrl: new URL(manifest.baseUrl, url).href };
  } catch {
    return null;
  }
}

async function cachedStatus(game: CatalogGame): Promise<OfflineStatus> {
  if (!offlineSupported()) return { kind: 'unsupported' };
  const runtime = await cachedRuntime(game);
  if (!runtime) return { kind: 'none' };
  const cache = await caches.open(RUNTIME_CACHE);
  const urls = runtime.manifest.files.map((file) => new URL(file.path, runtime.baseUrl).href);
  const hits = (await Promise.all(urls.map((url) => cache.match(url, { ignoreVary: true })))).filter(
    Boolean,
  ).length;
  if (hits === urls.length) return { kind: 'downloaded', bytes: runtimeDownloadSize(runtime.manifest) };
  return hits === 0 ? { kind: 'none' } : { kind: 'partial' };
}

/** Re-reads a game's status from the cache (unless it is downloading). */
export async function refreshOffline(game: CatalogGame): Promise<void> {
  const current = statuses.get(game.id)?.kind;
  if (current === 'queued' || current === 'downloading') return;
  setStatus(game.id, await cachedStatus(game).catch(() => ({ kind: 'none' }) as const));
}

/** Downloads a game for offline play (after any download already running). */
export function downloadOffline(game: CatalogGame): Promise<void> {
  const current = statuses.get(game.id)?.kind;
  if (current === 'queued' || current === 'downloading') return queue;
  setStatus(game.id, { kind: 'queued' });
  queue = queue.then(async () => {
    try {
      const runtime = await loadRuntime(game);
      await downloadForOffline(runtime, (done, total) =>
        setStatus(game.id, { kind: 'downloading', done, total }),
      );
      setStatus(game.id, await cachedStatus(game));
    } catch (error) {
      setStatus(game.id, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });
  return queue;
}

/** Downloads every launchable game that is not downloaded yet. */
export function downloadAllOffline(games: readonly CatalogGame[]): Promise<void> {
  for (const game of games.filter(isLaunchable)) {
    if (statuses.get(game.id)?.kind !== 'downloaded') void downloadOffline(game);
  }
  return queue;
}

export async function removeOffline(game: CatalogGame): Promise<void> {
  const runtime = await cachedRuntime(game);
  if (runtime) await removeOfflineCopy(runtime);
  setStatus(game.id, await cachedStatus(game));
}

/** The offline status of each game, checked from the cache on first use. */
export function useOfflineStatuses(games: readonly CatalogGame[]): ReadonlyMap<string, OfflineStatus> {
  const snapshot = useSyncExternalStore(subscribe, () => statuses);
  useEffect(() => {
    const check = () => {
      for (const game of games) {
        if (!isLaunchable(game) || checked.has(game.id)) continue;
        checked.add(game.id);
        void refreshOffline(game);
      }
    };
    check();
    // On a first visit the service worker takes control a moment after load.
    const recheck = () => {
      for (const game of games) checked.delete(game.id);
      check();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', recheck);
    return () => navigator.serviceWorker?.removeEventListener('controllerchange', recheck);
  }, [games]);
  return snapshot;
}

export function useOfflineStatus(game: CatalogGame): OfflineStatus {
  const games = stableList(game);
  return useOfflineStatuses(games).get(game.id) ?? CHECKING;
}

const lists = new WeakMap<CatalogGame, readonly CatalogGame[]>();
function stableList(game: CatalogGame): readonly CatalogGame[] {
  let list = lists.get(game);
  if (!list) {
    list = [game];
    lists.set(game, list);
  }
  return list;
}

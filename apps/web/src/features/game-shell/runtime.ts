import type { CatalogGame } from '@rogue-archive/catalog';
import type { RuntimeManifest } from '@rogue-archive/game-api';
import { assetUrl } from '../../app/catalog.ts';

export interface LoadedRuntime {
  manifest: RuntimeManifest;
  /** Absolute URL of the immutable directory holding this build's files. */
  baseUrl: string;
}

function isRuntimeManifest(value: unknown, gameId: string): value is RuntimeManifest {
  const m = value as Partial<RuntimeManifest> | null;
  return (
    !!m &&
    m.schemaVersion === 1 &&
    m.gameId === gameId &&
    typeof m.buildId === 'string' &&
    typeof m.baseUrl === 'string' &&
    /^[0-9a-f]{16}\/$/.test(m.baseUrl) &&
    Array.isArray(m.files) &&
    m.files.every(
      (f) => typeof f.path === 'string' && typeof f.size === 'number' && /^[0-9a-f]{64}$/.test(f.sha256),
    )
  );
}

export class RuntimeUnavailableError extends Error {
  override name = 'RuntimeUnavailableError';
}

/** Fetches a game's runtime manifest (always revalidated) and resolves its file directory. */
export async function loadRuntime(game: CatalogGame, signal?: AbortSignal): Promise<LoadedRuntime> {
  if (!game.runtimeManifest) throw new RuntimeUnavailableError(`${game.title} has no runtime build.`);
  const manifestUrl = new URL(assetUrl(game.runtimeManifest), window.location.href);
  let response: Response;
  try {
    response = await fetch(manifestUrl, { cache: 'no-cache', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RuntimeUnavailableError(
      'The game files could not be reached. Check your connection, or download the game for offline play next time.',
    );
  }
  if (response.status === 404) {
    throw new RuntimeUnavailableError(`${game.title} has not been built for this deployment yet.`);
  }
  if (!response.ok)
    throw new RuntimeUnavailableError(`The game manifest could not be loaded (HTTP ${response.status}).`);
  const manifest: unknown = await response.json();
  if (!isRuntimeManifest(manifest, game.id))
    throw new RuntimeUnavailableError('The game manifest is invalid.');
  return { manifest, baseUrl: new URL(manifest.baseUrl, manifestUrl).href };
}

export function runtimeDownloadSize(manifest: RuntimeManifest): number {
  return manifest.files
    .filter((file) => !file.path.startsWith('licenses/'))
    .reduce((sum, file) => sum + file.size, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

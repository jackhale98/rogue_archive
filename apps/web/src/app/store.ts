import { openArchiveStore, type ArchiveStore } from '@rogue-archive/game-storage';

let storePromise: Promise<ArchiveStore | null> | null = null;

/**
 * Opens the platform's IndexedDB store once. Resolves to null when storage is
 * unavailable (some private browsing modes); the site still works, it just
 * cannot remember settings or recently played games.
 */
export function getStore(): Promise<ArchiveStore | null> {
  storePromise ??= openArchiveStore().catch((error: unknown) => {
    console.warn('Local storage is unavailable', error);
    return null;
  });
  return storePromise;
}

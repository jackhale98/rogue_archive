/**
 * Keeping saves: browsers keep a site's data until the device runs short of
 * space (then they clear whole sites, least recently used first) unless the
 * site's storage is "persistent". Safari also deletes script-written data
 * after 7 days of Safari use without a visit to the site; a web app added to
 * the Home Screen keeps its own storage and day count.
 */

export interface StorageStatus {
  /** The browser has the Storage API (persist/persisted/estimate). */
  supported: boolean;
  /** This site's storage is persistent (not cleared to free space). */
  persisted: boolean;
  usage?: number;
  quota?: number;
}

function storageManager(): StorageManager | null {
  return typeof navigator !== 'undefined' && navigator.storage && 'persist' in navigator.storage
    ? navigator.storage
    : null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  if (!storage) return { supported: false, persisted: false };
  const [persisted, estimate] = await Promise.all([
    storage.persisted().catch(() => false),
    storage.estimate().catch(() => ({}) as StorageEstimate),
  ]);
  return { supported: true, persisted, usage: estimate.usage, quota: estimate.quota };
}

let requested: Promise<boolean> | null = null;

/**
 * Asks the browser to keep this site's data (once per page load unless
 * `again`). Chromium browsers decide silently (more likely once the site is
 * installed or used often); Firefox may ask the player; Safari decides itself.
 */
export function requestDurableStorage(again = false): Promise<boolean> {
  const storage = storageManager();
  if (!storage) return Promise.resolve(false);
  if (!requested || again) {
    requested = storage
      .persisted()
      .then((persisted) => persisted || storage.persist())
      .catch(() => false);
  }
  return requested;
}

/** Running as an installed web app (Home Screen / "Install app"), not in a browser tab. */
export function isInstalledApp(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** Safari (or another browser on iOS/iPadOS, which all use WebKit with Safari's storage rules). */
export function isAppleWebKit(): boolean {
  return navigator.vendor === 'Apple Computer, Inc.';
}

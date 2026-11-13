import type { LoadedRuntime } from '../game-shell/runtime.ts';

/** Must match RUNTIME_CACHE in public/sw.js. */
export const RUNTIME_CACHE = 'ra-runtime-v1';

function runtimeUrls(runtime: LoadedRuntime): string[] {
  return runtime.manifest.files.map((file) => new URL(file.path, runtime.baseUrl).href);
}

export function offlineSupported(): boolean {
  return 'caches' in window && 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
}

/** Fetches every runtime file through the service worker, which stores them in the runtime cache. */
export async function downloadForOffline(
  runtime: LoadedRuntime,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const urls = runtimeUrls(runtime);
  let done = 0;
  onProgress(0, urls.length);
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
    await response.arrayBuffer();
    onProgress(++done, urls.length);
  }
}

export async function removeOfflineCopy(runtime: LoadedRuntime): Promise<void> {
  if (!('caches' in window)) return;
  const cache = await caches.open(RUNTIME_CACHE);
  await Promise.all(runtimeUrls(runtime).map((url) => cache.delete(url)));
}

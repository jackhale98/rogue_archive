/**
 * Resolves once `check()` is true (checked every `intervalMs`), or rejects
 * after `timeoutMs` with "<what> did not happen in time". `check` may throw to
 * fail early (e.g. the game said it could not save).
 */
export function waitUntil(
  check: () => boolean,
  timeoutMs: number,
  what: string,
  intervalMs = 100,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      try {
        if (check()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (Date.now() - started > timeoutMs) reject(new Error(`${what} did not happen in time.`));
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

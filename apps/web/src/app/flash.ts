/** One-shot message carried across a navigation (e.g. "how to resume" after leaving a game). */
let pending: string | null = null;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function setFlash(message: string): void {
  pending = message;
}

/**
 * Returns the pending message and clears it shortly after, so repeated reads
 * during one render (React StrictMode calls initializers twice) agree.
 */
export function consumeFlash(): string | null {
  const message = pending;
  if (message !== null && clearTimer === undefined) {
    clearTimer = setTimeout(() => {
      pending = null;
      clearTimer = undefined;
    }, 0);
  }
  return message;
}

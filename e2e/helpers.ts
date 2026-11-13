import { expect, type Page } from '@playwright/test';

interface DebugWindow {
  __rogueArchive?: {
    adapter: {
      debug: {
        screenText(): string;
        inGame: boolean;
        playerX: number;
        playerY: number;
        rowText(y: number): string;
        cellToClient(x: number, y: number): { x: number; y: number } | null;
        context: string | null;
        views(): string[];
      };
    };
  };
}

export async function openBrogue(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/brogue-ce');
  await waitForScreenText(page, 'New Game');
}

export function screenText(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as DebugWindow).__rogueArchive?.adapter.debug.screenText() ?? '',
  );
}

/**
 * Waits for text on the game screen. Brogue draws dialogs over the map, and
 * where a dialog's text has a space the map can show through in the screen
 * dump ("Save this#game?and?exit"), so each space matches any one character.
 */
export async function waitForScreenText(page: Page, text: string, timeout = 45_000): Promise<void> {
  const pattern = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '.'));
  await expect
    .poll(() => screenText(page), { timeout, message: `waiting for "${text}" on the game screen` })
    .toMatch(pattern);
}

export async function player(page: Page): Promise<{ inGame: boolean; x: number; y: number }> {
  return page.evaluate(() => {
    const d = (window as unknown as DebugWindow).__rogueArchive!.adapter.debug;
    return { inGame: d.inGame, x: d.playerX, y: d.playerY };
  });
}

/**
 * Waits until a game is in progress and Brogue is waiting for a command. Keys
 * pressed during the level's opening fade-in only skip the fade (as in the
 * desktop game), so tests must not type before this.
 */
export async function waitInGame(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const debug = (window as unknown as DebugWindow).__rogueArchive?.adapter.debug;
          return !!debug?.inGame && debug.context === 'map';
        }),
      { timeout: 45_000 },
    )
    .toBe(true);
}

/** Screen cell containing the given text, or null. */
export async function findCell(page: Page, text: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((needle) => {
    const d = (window as unknown as DebugWindow).__rogueArchive!.adapter.debug;
    for (let y = 0; y < 34; y++) {
      const x = d.rowText(y).indexOf(needle);
      if (x >= 0) return { x, y };
    }
    return null;
  }, text);
}

/** Client coordinates of the center of a screen cell. */
export async function cellCenter(
  page: Page,
  cell: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ({ x, y }) => (window as unknown as DebugWindow).__rogueArchive!.adapter.debug.cellToClient(x, y),
    cell,
  );
  if (!point) throw new Error('Renderer has no layout yet');
  return point;
}

export function gameContext(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as unknown as DebugWindow).__rogueArchive?.adapter.debug.context ?? null,
  );
}

export function gameViews(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as DebugWindow).__rogueArchive?.adapter.debug.views() ?? []);
}

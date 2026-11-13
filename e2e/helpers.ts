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

export async function waitForScreenText(page: Page, text: string, timeout = 45_000): Promise<void> {
  await expect
    .poll(() => screenText(page), { timeout, message: `waiting for "${text}" on the game screen` })
    .toContain(text);
}

export async function player(page: Page): Promise<{ inGame: boolean; x: number; y: number }> {
  return page.evaluate(() => {
    const d = (window as unknown as DebugWindow).__rogueArchive!.adapter.debug;
    return { inGame: d.inGame, x: d.playerX, y: d.playerY };
  });
}

export async function waitInGame(page: Page): Promise<void> {
  await expect.poll(async () => (await player(page)).inGame, { timeout: 45_000 }).toBe(true);
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

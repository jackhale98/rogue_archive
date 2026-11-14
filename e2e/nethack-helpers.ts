import { expect, type Page } from '@playwright/test';

export interface NetHackDebug {
  context: string | null;
  inGame: boolean;
  tiled: boolean;
  prompt: string;
  menu: { how: number; title: string; items: { key: number; text: string }[] } | null;
  state: {
    x: number;
    y: number;
    moves: number;
    hp: number;
    depth: number;
    inGame: boolean;
    adjacent: number[];
    target: { dir: number } | null;
  } | null;
  saves: string[];
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
}

export function nethack(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __rogueArchive?: { adapter: { debug: NetHackDebug } } }).__rogueArchive
      ?.adapter.debug;
    return d
      ? {
          context: d.context,
          inGame: d.inGame,
          tiled: d.tiled,
          prompt: d.prompt,
          menu: d.menu,
          state: d.state,
          saves: d.saves,
          text: d.screenText(),
          views: d.views(),
        }
      : null;
  });
}

export async function context(page: Page): Promise<string | null> {
  return (await nethack(page))?.context ?? null;
}

export async function waitForContext(page: Page, wanted: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => context(page), { timeout, message: `waiting for the ${wanted} context` })
    .toBe(wanted);
}

/** Opens NetHack and starts a character from the start screen (a new one, or its saved game). */
export async function startNetHack(page: Page, name: string): Promise<void> {
  await page.goto('?debug=1#/play/nethack');
  const start = page.locator('.ra-start');
  await expect(start).toBeVisible({ timeout: 120_000 });
  await start.getByLabel('New character').fill(name);
  await start.getByRole('button', { name: 'Start' }).click();
}

/** Where on screen a line of text is (the first row containing it), to tap it. */
export async function lineAt(page: Page, pattern: RegExp): Promise<{ x: number; y: number } | null> {
  return page.evaluate((source) => {
    const d = (window as unknown as { __rogueArchive: { adapter: { debug: NetHackDebug } } }).__rogueArchive
      .adapter.debug;
    const re = new RegExp(source);
    for (let y = 0; y < 48; y++) {
      const i = d.rowText(y).search(re);
      if (i >= 0) return d.cellToClient(i, y);
    }
    return null;
  }, pattern.source);
}

/**
 * From the end of character creation to the map: the introduction and the
 * starting inventory are read (`read`), NetHack 5.0's tutorial question is
 * declined (`decline`).
 */
export async function toMap(
  page: Page,
  read: () => Promise<void>,
  decline: () => Promise<void>,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const d = await nethack(page);
    if (d?.context === 'map') return;
    if (d?.context === 'menu' && /tutorial/.test(d.menu?.title ?? '')) await decline();
    else if (d?.context === 'text' || d?.context === 'more' || (d?.context === 'menu' && d.menu?.how === 0))
      await read();
    await page.waitForTimeout(300);
  }
  await waitForContext(page, 'map', 5_000);
}

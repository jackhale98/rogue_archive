import { expect, type Page } from '@playwright/test';

interface RogueDebug {
  context: string | null;
  inGame: boolean;
  saves: string[];
  screenText(): string;
}

function debug(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __rogueArchive?: { adapter: { debug: RogueDebug } } }).__rogueArchive
      ?.adapter.debug;
    return d ? { context: d.context, inGame: d.inGame, text: d.screenText() } : null;
  });
}

export async function rogueContext(page: Page): Promise<string | null> {
  return (await debug(page))?.context ?? null;
}

export async function screenText(page: Page): Promise<string> {
  return (await debug(page))?.text ?? '';
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => rogueContext(page), { timeout, message: `waiting for the ${context} context` })
    .toBe(context);
}

/** Opens Rogue and starts a new character from the start screen. */
export async function startRogue(page: Page, name: string): Promise<void> {
  await page.goto('?debug=1#/play/rogue');
  const start = page.locator('.ra-start');
  await expect(start).toBeVisible({ timeout: 120_000 });
  await start.getByLabel('New character').fill(name);
  await start.getByRole('button', { name: 'Start' }).click();
  await waitForContext(page, 'map');
}

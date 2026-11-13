import { expect, type Page } from '@playwright/test';

interface SilDebug {
  context: string | null;
  inDungeon: boolean;
  screenText(): string;
}

function debug(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __rogueArchive?: { adapter: { debug: SilDebug } } }).__rogueArchive
      ?.adapter.debug;
    return d ? { context: d.context, inDungeon: d.inDungeon, text: d.screenText() } : null;
  });
}

export async function silContext(page: Page): Promise<string | null> {
  return (await debug(page))?.context ?? null;
}

export async function screenText(page: Page): Promise<string> {
  return (await debug(page))?.text ?? '';
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => silContext(page), { timeout, message: `waiting for the ${context} context` })
    .toBe(context);
}

export async function openSil(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/sil-q');
  await waitForContext(page, 'title', 120_000);
  await expect.poll(() => screenText(page)).toContain('b) New character');
}

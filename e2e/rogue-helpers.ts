import { expect, test, type Page } from '@playwright/test';

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

/**
 * The dungeon is random, and these tests never fight back: now and then a
 * monster kills the hero before a test is done (the tombstone). That says
 * nothing about the port, so the test is skipped, with the reason.
 */
export async function skipIfKilled(page: Page, context: string | null): Promise<void> {
  if (context !== 'enter') return;
  const text = await screenText(page);
  test.skip(/REST\s+IN\s+PEACE|killed by/.test(text), 'A monster killed the hero (random dungeon).');
}

/**
 * Back to the map before the next step. The dungeon is random: a monster can
 * interrupt with --More-- (Space), and a trap or item can leave a question or
 * list on screen (Escape). Rogue ignores other keys at --More--. The context
 * lags a key press by a moment (the game has not answered yet), so the map
 * must be seen twice in a row, 150 ms apart.
 */
export async function settle(page: Page): Promise<void> {
  let maps = 0;
  for (let i = 0; i < 40 && maps < 2; i++) {
    await page.waitForTimeout(150);
    const context = await rogueContext(page);
    if (context === 'map') {
      maps++;
      continue;
    }
    maps = 0;
    await skipIfKilled(page, context);
    if (context === 'more') await page.keyboard.press(' ');
    else if (context !== 'busy') await page.keyboard.press('Escape');
  }
  await waitForContext(page, 'map', 5_000);
}

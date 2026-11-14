import { expect, type Locator, type Page } from '@playwright/test';

export interface DcssMapContext {
  hostiles: number;
  adjacent: number;
  maxThreat: number;
  underfoot: string | null;
}

interface DcssDebug {
  context: string | null;
  inGame: boolean;
  player: Record<string, unknown>;
  popups: string[];
  menus: string[];
  map: DcssMapContext;
  latch: string | null;
  text(): string;
}

function debug(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __rogueArchive?: { adapter: { debug: DcssDebug } } }).__rogueArchive
      ?.adapter.debug;
    return d
      ? {
          context: d.context,
          inGame: d.inGame,
          player: d.player,
          popups: d.popups,
          menus: d.menus,
          map: d.map,
          latch: d.latch,
        }
      : null;
  });
}

/** Monsters in view and what is underfoot, as the client host read them from the client's map. */
export async function dcssMap(page: Page): Promise<DcssMapContext | null> {
  return (await debug(page))?.map ?? null;
}

export async function dcssMenus(page: Page): Promise<string[]> {
  return (await debug(page))?.menus ?? [];
}

export async function dcssLatch(page: Page): Promise<string | null> {
  return (await debug(page))?.latch ?? null;
}

export async function dcssContext(page: Page): Promise<string | null> {
  return (await debug(page))?.context ?? null;
}

export async function dcssPlayer(page: Page): Promise<Record<string, unknown>> {
  return (await debug(page))?.player ?? {};
}

/** Visible text of upstream's client (stats, messages, menus). */
export function clientText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __rogueArchive?: { adapter: { debug: DcssDebug } } }
      ).__rogueArchive?.adapter.debug.text() ?? '',
  );
}

export async function waitForContext(page: Page, context: string, timeout = 120_000): Promise<void> {
  await expect
    .poll(() => dcssContext(page), { timeout, message: `waiting for the ${context} context` })
    .toBe(context);
}

/** Opens DCSS and starts a new character from the start screen. */
export async function startCharacter(page: Page, name: string): Promise<void> {
  await page.goto('?debug=1#/play/dcss');
  const launcher = page.locator('.dcss-launcher');
  await expect(launcher).toBeVisible({ timeout: 120_000 });
  await launcher.getByLabel('New character').fill(name);
  await launcher.getByRole('button', { name: 'Start' }).click();
  // The first launch also builds DCSS's level and description caches.
  await waitForContext(page, 'start', 180_000);
}

/**
 * Phones: choose an option in character creation. A first tap shows what it
 * is (its description), a second chooses it (client-host/host.js).
 */
export async function chooseInCreation(page: Page, option: Locator): Promise<void> {
  await option.tap();
  await page.waitForTimeout(250);
  await option.tap();
}

/** Phones: through character creation by taking the first option of each step, to the map. */
export async function createByTaps(page: Page): Promise<void> {
  const frame = page.frameLocator('iframe.dcss-client');
  const option = frame.locator('.ui-popup .newgame-choice .button').first();
  for (let i = 0; i < 12 && (await dcssContext(page)) !== 'map'; i++) {
    // (The context can still read "start" for a moment after the last choice.)
    if ((await dcssContext(page)) === 'start' && (await option.isVisible()))
      await chooseInCreation(page, option);
    await page.waitForTimeout(1000);
  }
  await waitForContext(page, 'map');
}

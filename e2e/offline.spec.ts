import { expect, test, type Page } from '@playwright/test';
import { startRogue } from './rogue-helpers.ts';

test.describe.configure({ timeout: 240_000 });

async function waitForServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 })
    .toBe(true);
}

// As on a phone with the site added to the Home Screen: visit once online,
// download a game for offline play, then lose the network and play it.
test('a game downloaded from its library card starts with no network', async ({ page, context }) => {
  await page.goto('./');
  await waitForServiceWorker(page);
  await page.reload();

  await page.getByRole('button', { name: 'Download Rogue for offline play' }).click();
  await expect(page.getByRole('img', { name: /Rogue is available offline/ })).toBeVisible({
    timeout: 60_000,
  });
  // The game's page agrees.
  await page.goto('#/games/rogue');
  await expect(page.getByText('Available offline')).toBeVisible();

  await context.setOffline(true);
  // The network really is gone for the page and its service worker.
  expect(
    await page.evaluate(() =>
      fetch(`not-cached-${Date.now()}.txt`).then(
        () => 'online',
        () => 'offline',
      ),
    ),
  ).toBe('offline');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await startRogue(page, 'Offline');
  await expect(page.locator('canvas').first()).toBeVisible();
  await context.setOffline(false);
});

test('Download all makes every game available offline', async ({ page }) => {
  await page.goto('./');
  await waitForServiceWorker(page);
  await page.reload();

  await page.getByRole('button', { name: 'Download all for offline' }).click();
  await expect(page.getByText(/All games available offline/)).toBeVisible({ timeout: 180_000 });
  for (const title of ['Brogue', 'Dungeon Crawl Stone Soup', 'Sil-Q', 'Rogue'])
    await expect(page.getByRole('img', { name: new RegExp(`^${title} is available offline`) })).toBeVisible();
  // Settings shows the same.
  await page.goto('#/settings');
  await expect(page.getByText(/All games available offline/)).toBeVisible();
});

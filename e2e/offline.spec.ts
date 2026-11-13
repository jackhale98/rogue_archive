import { expect, test } from '@playwright/test';
import { startRogue } from './rogue-helpers.ts';

test.describe.configure({ timeout: 180_000 });

// As on a phone with the site added to the Home Screen: visit once online,
// download a game for offline play, then lose the network and play it.
test('a game downloaded for offline play starts with no network', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The service worker controls the page (it claims clients on activation).
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 })
    .toBe(true);

  await page.goto('#/games/rogue');
  await page.getByRole('button', { name: 'Download for offline play' }).click();
  await expect(page.getByText('Available offline')).toBeVisible({ timeout: 60_000 });

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

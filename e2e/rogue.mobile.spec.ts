import { expect, test } from '@playwright/test';
import { rogueContext, screenText, startRogue, waitForContext } from './rogue-helpers.ts';

test.describe.configure({ timeout: 180_000 });

test('Rogue phone: status band, thumb pad, dock, inventory sheet and direction prompt', async ({ page }) => {
  await startRogue(page, 'Thumbs');
  await expect(page.locator('.rogue-band')).toContainText('Hp:');
  const dock = page.getByRole('group', { name: 'Actions' });
  for (const name of [/^Search/, /^Fight/, /^Pack/, /^Stairs/, /^Look/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // The pad moves the hero.
  const pad = page.getByRole('group', { name: 'Movement' });
  for (const name of [/Move left/, /Move right/, /Move up \(/, /Move down \(/]) {
    await pad.getByRole('button', { name }).tap();
    if ((await rogueContext(page)) === 'more') await dock.getByRole('button', { name: /Continue/ }).tap();
  }
  await expect.poll(() => screenText(page)).toContain('Level: 1');

  // Pack: the inventory as a sheet, closed from the dock.
  await dock.getByRole('button', { name: /^Pack/ }).tap();
  await waitForContext(page, 'menu');
  await expect(dock.getByRole('button', { name: /Some food/ })).toBeVisible();
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await waitForContext(page, 'map');

  // Fight asks for a direction: the pad answers it, Cancel backs out.
  await expect(dock.getByRole('button', { name: /^Fight/ })).toBeVisible();
  await page.waitForTimeout(300);
  await dock.getByRole('button', { name: /^Fight/ }).tap();
  await waitForContext(page, 'direction');
  await expect(pad).toBeVisible();
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');
});

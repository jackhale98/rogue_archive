import { expect, test } from '@playwright/test';
import { rogueContext, screenText, startRogue, waitForContext } from './rogue-helpers.ts';

test.describe.configure({ timeout: 180_000 });

test('Rogue phone: status band, thumb pad, dock, inventory sheet and direction prompt', async ({ page }) => {
  await startRogue(page, 'Thumbs');
  await expect(page.locator('.rogue-band')).toContainText('Hp:');
  const dock = page.getByRole('group', { name: 'Actions' });
  for (const name of [/^Search/, /^Fight/, /^Pack/, /^Stairs/, /^Look/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // The pad moves the hero. (A monster can interrupt with --More--, which
  // replaces the pad with Continue until acknowledged.)
  const pad = page.getByRole('group', { name: 'Movement' });
  const settle = async () => {
    for (let i = 0; i < 10 && (await rogueContext(page)) !== 'map'; i++) {
      if ((await rogueContext(page)) === 'more') await dock.getByRole('button', { name: /Continue/ }).tap();
      await page.waitForTimeout(200);
    }
  };
  for (const name of [/Move left/, /Move right/, /Move up \(/, /Move down \(/]) {
    await settle();
    await pad.getByRole('button', { name }).tap();
  }
  await settle();
  await expect.poll(() => screenText(page)).toContain('Level: 1');

  // Pack: the inventory as a sheet, closed from the dock.
  await settle();
  await dock.getByRole('button', { name: /^Pack/ }).tap();
  await waitForContext(page, 'menu');
  await expect(dock.getByRole('button', { name: /Some food/ })).toBeVisible();
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await waitForContext(page, 'map');

  // Fight asks for a direction: the pad answers it, Cancel backs out.
  await settle();
  await expect(dock.getByRole('button', { name: /^Fight/ })).toBeVisible();
  await page.waitForTimeout(300);
  await dock.getByRole('button', { name: /^Fight/ }).tap();
  await waitForContext(page, 'direction');
  await expect(pad).toBeVisible();
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // Display (Menu): the map is drawn with each tile style, and back to text.
  await settle();
  const tileStyle = () =>
    page.evaluate(
      () =>
        (window as unknown as { __rogueArchive: { adapter: { debug: { tileStyle: string | null } } } })
          .__rogueArchive.adapter.debug.tileStyle,
    );
  for (const style of ['tiles', 'one-bit', 'text']) {
    await page.getByRole('button', { name: 'Menu' }).tap();
    await page.getByLabel('Display').selectOption(style);
    await page.keyboard.press('Escape');
    await expect.poll(tileStyle).toBe(style === 'text' ? null : style);
  }
});

import { expect, test } from '@playwright/test';
import { drl, openDrl, screenText, waitForContext, waitForText } from './drl-helpers.ts';

test.describe.configure({ timeout: 240_000 });
// A tap that cannot happen fails at that step instead of at the test timeout.
test.use({ actionTimeout: 15_000 });

test('DRL phone: a game started by taps, status band, pad, dock, sheets, Save & Quit by taps', async ({ page }) => {
  await openDrl(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  const pad = page.getByRole('group', { name: 'Movement' });
  const tap = (name: RegExp) => dock.getByRole('button', { name }).first().tap();
  const select = () => tap(/^(Select|Continue)/);

  // DRL's own screens before a game: the welcome, its credits, the main menu,
  // the game type, difficulty, class and trait (DRL's defaults), by taps.
  for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
    await waitForContext(page, 'title');
    await select();
    await page.waitForTimeout(500);
  }
  await waitForText(page, /New game/);
  await expect(dock.getByRole('button', { name: /^↓ Next/ })).toBeVisible();
  for (const next of [/Regular game/, /Too Young To Die/, /Marine/, /Select trait/, /Type a name/]) {
    await select();
    await waitForText(page, next);
  }
  // The name, as typed with the device keyboard (the dock offers it).
  await waitForContext(page, 'text');
  await expect(dock.getByRole('button', { name: /^Keyboard/ })).toBeVisible();
  await page.keyboard.type('Thumbs');
  await tap(/^Done/);
  // The intro: Back (Escape) skips each page.
  for (let i = 0; i < 10 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(700);
    if ((await drl(page))?.context !== 'map') await tap(/^Back/);
  }
  await waitForContext(page, 'map');

  // The status band from DRL's HUD; the map zoomed around the player.
  const band = page.locator('.drl-band');
  await expect(band).toContainText('100%');
  await expect(band).toContainText('pistol');
  expect((await drl(page))?.views).toEqual(['map']);
  for (const name of [/^Fire/, /^Action/, /^Reload/, /^Inventory/, /^Look/, /^Menu/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // The pad moves the player (walls permitting: four directions, back to the map each time).
  for (const name of [/Move right/, /Move down/, /Move left/, /Move up/]) {
    await pad.getByRole('button', { name }).first().tap();
    await page.waitForTimeout(250);
  }
  await waitForContext(page, 'map');

  // The inventory: a full screen, closed from the dock.
  await tap(/^Inventory/);
  await waitForText(page, /Inventory/);
  await waitForContext(page, 'menu');
  expect((await drl(page))?.views).toEqual(['screen']);
  await tap(/^Back/);
  await waitForContext(page, 'map');

  // DRL's game menu over the map: a sheet. Save & Quit (its last entry) by taps.
  await tap(/^Menu/);
  await waitForText(page, /Save & Quit/);
  await waitForContext(page, 'menu');
  expect((await drl(page))?.views).toEqual(['map', 'sheet']);
  await tap(/^↑ Previous/);
  await page.waitForTimeout(300);
  await select();
  await waitForText(page, /Continue game/, 30_000);
  await expect.poll(async () => (await drl(page))?.hasSave, { timeout: 15_000 }).toBe(true);
  await expect(band).toHaveCount(0);

  // Continue game, by a tap.
  await select();
  for (let i = 0; i < 6 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(700);
    if ((await drl(page))?.context !== 'map') await tap(/^(Back|Continue)/);
  }
  await waitForContext(page, 'map');
  expect((await drl(page))?.state?.name).toBe('Thumbs');
});

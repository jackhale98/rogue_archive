import { expect, test } from '@playwright/test';
import { openSil, screenText, silContext, waitForContext } from './sil-q-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('Sil-Q phone: title buttons, creation by tap, item prompt dock, continue a saved character', async ({
  page,
}) => {
  await openSil(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  // The title menu's choices are large buttons.
  for (const name of [/Tutorial/, /New character/, /Open saved character/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  await dock.getByRole('button', { name: /New character/ }).tap();
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.waitForTimeout(400);
    if ((await silContext(page)) === 'map') break;
    await dock.getByRole('button', { name: /^OK/ }).tap();
  }
  await waitForContext(page, 'map');

  // The status band and the map dock.
  await expect(page.locator('.sil-band')).toContainText('health');
  for (const name of [/^Rest/, /^Fire/, /^Pack/, /^Doors/, /^Look/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // An item prompt: the letters, then the items by name once the list is shown.
  await page.evaluate(() =>
    (
      window as unknown as { __rogueArchive: { adapter: { sendInput(input: unknown): void } } }
    ).__rogueArchive.adapter.sendInput({ type: 'command', commandId: 'drop' }),
  );
  await waitForContext(page, 'item');
  await dock.getByRole('button', { name: /Show items/ }).tap();
  await expect(dock.getByRole('button', { name: /Wooden Torch/ })).toBeVisible();
  await dock.getByRole('button', { name: /Cancel/ }).tap();
  await waitForContext(page, 'map');

  // Save and quit from the command palette, then continue from the title menu.
  // (The dock is rebuilt as the context settles; wait for the map dock before tapping.)
  await expect(dock.getByRole('button', { name: 'Doors (o)' })).toBeVisible();
  await page.waitForTimeout(500);
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  const menu = page.getByRole('dialog');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /Save and quit/ }).tap();
  for (let i = 0; i < 8 && !(await screenText(page)).includes('b) New character'); i++) {
    await page.waitForTimeout(500);
    const ok = dock.getByRole('button', { name: /^OK|^Continue \(/ }).first();
    if (await ok.isVisible()) await ok.tap();
  }
  await dock.getByRole('button', { name: 'Continue nameless' }).tap();
  await waitForContext(page, 'map', 30_000);
  await expect.poll(() => screenText(page)).toContain('nameless');
});

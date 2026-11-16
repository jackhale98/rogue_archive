import { expect, test } from '@playwright/test';
import { cddaDebug, openCataclysm } from './cataclysm-dda-helpers.ts';

test.describe.configure({ timeout: 900_000 });

// The map's phone controls are still a placeholder (the design is pending,
// games/cataclysm-dda/UI-INVENTORY.md); the start screens and menus have
// enough to start and play a game by touch alone.
test('Cataclysm: DDA phone: Play Now! by touch, questions as buttons, the map dock', async ({ page }) => {
  await openCataclysm(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  // The main menu: Play Now! leads, New game and Load beside it, the pad moves along the menu.
  for (const name of [/^New game/, /^Load/, /^Random start/, /^Play Now!/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Movement' })).toBeVisible();
  await dock.getByRole('button', { name: /^Play Now!/ }).tap();

  // The world is made; any question or message on the way is answered from the dock.
  await expect
    .poll(
      async () => {
        const d = await cddaDebug(page);
        if (d?.context === 'map') return 'map';
        if (d?.waiting && d.context === 'menu') {
          const answer = dock.getByRole('button', { name: /^(Yes|OK|Back)\b/ }).first();
          if (await answer.isVisible().catch(() => false)) await answer.tap();
        }
        return d?.inputContext ?? null;
      },
      { timeout: 600_000, intervals: [2_000], message: 'waiting for the map after Play Now! by touch' },
    )
    .toBe('map');

  for (const name of [/^Inventory/, /^Look/, /^Actions/, /^More/, /^Keyboard/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  const pad = page.getByRole('group', { name: 'Movement' });
  await expect(pad.getByRole('button', { name: /^Pause/ })).toBeVisible();

  // Save and quit by touch: More, Save, then the yes/no question's Yes (a capital Y).
  await dock.getByRole('button', { name: /^More/ }).tap();
  await expect(page.getByRole('dialog')).toContainText('Craft items');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Save and quit/ })
    .tap();
  await expect(dock.getByRole('button', { name: /^Yes/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /^No/ })).toBeVisible();
  await dock.getByRole('button', { name: /^Yes/ }).tap();
  await expect.poll(async () => (await cddaDebug(page))?.context, { timeout: 120_000 }).toBe('title');
});

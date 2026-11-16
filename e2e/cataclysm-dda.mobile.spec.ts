import { expect, test } from '@playwright/test';
import { openCataclysm, playNow } from './cataclysm-dda-helpers.ts';

test.describe.configure({ timeout: 900_000 });

// Phase 1: the phone controls are a placeholder (the design is pending,
// games/cataclysm-dda/UI-INVENTORY.md). This checks that the game loads on a
// phone and the shell's dock and pad appear with the placeholder actions.
test('Cataclysm: DDA phone: loads; placeholder dock and the thumb pad', async ({ page }) => {
  await openCataclysm(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  for (const name of [/^OK/, /^Back/, /^More/, /^Keyboard/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  await playNow(page);
  for (const name of [/^Inventory/, /^Look/, /^Actions/, /^More/, /^Keyboard/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  const pad = page.getByRole('group', { name: 'Movement' });
  await expect(pad).toBeVisible();
  await expect(pad.getByRole('button', { name: /^Pause/ })).toBeVisible();

  // More opens the command palette with the game's commands.
  await dock.getByRole('button', { name: /^More/ }).tap();
  await expect(page.getByRole('dialog')).toContainText('Craft items');
});

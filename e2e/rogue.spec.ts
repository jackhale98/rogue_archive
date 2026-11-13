import { expect, test } from '@playwright/test';
import { screenText, settle, startRogue, waitForContext } from './rogue-helpers.ts';

test.describe.configure({ timeout: 180_000 });

test('Rogue: new character, moves, inventory, message log, save and continue after reload', async ({
  page,
}) => {
  await startRogue(page, 'Tester');
  await expect.poll(() => screenText(page)).toContain('Level: 1');
  await page.locator('canvas').first().click();

  // Arrow keys move (as hjkl); walking into walls and searching leaves messages.
  for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await settle(page);
    await page.keyboard.press(key);
  }

  // The inventory is a list; Space closes it.
  await settle(page);
  await page.keyboard.press('i');
  await waitForContext(page, 'menu');
  await expect.poll(() => screenText(page)).toContain('Some food');
  await page.keyboard.press(' ');
  await waitForContext(page, 'map');

  // An item prompt, cancelled.
  await settle(page);
  await page.keyboard.press('q');
  await waitForContext(page, 'item');
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // Rogue repeats its last message with Ctrl+P; the shell's log keeps them all.
  await settle(page);
  await page.keyboard.press('v');
  await expect.poll(() => screenText(page)).toContain('ersion 5.4.4');
  await page.getByRole('button', { name: 'Message log' }).click();
  const log = page.getByRole('dialog', { name: 'Messages' });
  await expect(log).toContainText('ersion 5.4.4');
  await log.getByRole('button', { name: 'Back to game' }).click();

  // Save (S, y): the game ends and the start screen offers to continue it.
  await page.locator('canvas').first().click();
  await settle(page);
  await page.keyboard.press('Shift+S');
  await waitForContext(page, 'yesno');
  await page.keyboard.press('y');
  const start = page.locator('.ra-start');
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(start).toContainText('Game saved');

  // Saves are in IndexedDB: still there after a reload.
  await page.reload();
  await expect(start).toBeVisible({ timeout: 120_000 });
  await start.getByRole('button', { name: /Continue Tester/ }).click();
  await waitForContext(page, 'map', 30_000);
  await expect.poll(() => screenText(page)).toContain('Level: 1');
});

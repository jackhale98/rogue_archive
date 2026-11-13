import { expect, test } from '@playwright/test';
import { clientText, dcssContext, dcssPlayer, startCharacter, waitForContext } from './dcss-helpers.ts';

test.describe.configure({ timeout: 300_000 });

test('DCSS: new character, auto-explore, menus, save and continue after reload', async ({ page }) => {
  await startCharacter(page, 'Tester');
  // Character creation is upstream's own interface: species, background, weapon.
  const frame = page.frameLocator('iframe.dcss-client');
  await expect(frame.locator('.ui-popup .newgame-choice')).toContainText('Please select your species');
  for (let i = 0; i < 3 && (await dcssContext(page)) === 'start'; i++) {
    await page.keyboard.press('a');
    await page.waitForTimeout(800);
  }
  await waitForContext(page, 'map');
  expect(Number((await dcssPlayer(page)).hp)).toBeGreaterThan(0);
  await expect.poll(() => clientText(page)).toContain('Welcome, Tester');

  // Auto-explore runs and reports what it finds; the shell's log has the messages.
  const before = await clientText(page);
  await page.keyboard.press('o');
  await expect.poll(() => clientText(page), { timeout: 30_000 }).not.toBe(before);
  await waitForContext(page, 'map', 60_000);
  await page.getByRole('button', { name: 'Message log' }).click();
  const log = page.getByRole('dialog', { name: 'Messages' });
  await expect(log).toContainText('Welcome, Tester');
  await log.getByRole('button', { name: 'Back to game' }).click();

  // The inventory is a menu: the dock offers menu actions while it is open.
  await page.locator('iframe.dcss-client').focus();
  await page.keyboard.press('i');
  await waitForContext(page, 'menu');
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // Save and exit: back at the start screen, the character can be continued.
  // DCSS asks "Save game and exit?"; the dock shows Yes and No for it.
  await page.keyboard.press('S');
  await waitForContext(page, 'yesno', 20_000);
  await page.keyboard.press('y');
  const launcher = page.locator('.dcss-launcher');
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await expect(launcher).toContainText('Game saved');
  await expect(launcher.getByRole('button', { name: /Continue Tester/ })).toBeVisible();

  // Saves are in IndexedDB: still there after a reload.
  await page.reload();
  await expect(launcher).toBeVisible({ timeout: 120_000 });
  const listed = launcher.getByRole('button', { name: /Continue Tester/ });
  await listed.waitFor({ timeout: 30_000 }).catch(async () => {
    // Diagnose a missing save: what IndexedDB holds for DCSS's save directory.
    const stored = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const open = indexedDB.open('/saves');
          open.onerror = () => resolve([`open failed: ${String(open.error)}`]);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('FILE_DATA')) return resolve(['(no FILE_DATA store)']);
            const keys = db.transaction('FILE_DATA').objectStore('FILE_DATA').getAllKeys();
            keys.onsuccess = () =>
              resolve(keys.result.map(String).filter((key) => !/\/(des|db)\//.test(key)));
          };
        }),
    );
    throw new Error(`No saved character after reload. IndexedDB /saves holds: ${stored.join(', ')}`);
  });
  await listed.click();
  await waitForContext(page, 'map', 180_000);
  await expect.poll(() => clientText(page)).toContain('Welcome back, Tester');
});

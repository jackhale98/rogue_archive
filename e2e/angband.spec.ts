import { expect, test } from '@playwright/test';
import {
  angband,
  angbandContext,
  cellToClient,
  newCharacter,
  openAngband,
  playerCell,
  screenText,
  tileAt,
  waitForContext,
} from './angband-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('Angband: new character, town, inventory, message log, save and continue after reload', async ({
  page,
}) => {
  await newCharacter(page, 'Tester');
  expect(await screenText(page)).toContain('Town');

  // An item prompt, with Angband's list of the pack.
  await page.keyboard.press('d');
  await waitForContext(page, 'item');
  await expect.poll(() => screenText(page)).toMatch(/Rations? of Food/);
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // The inventory.
  await page.keyboard.press('i');
  await expect.poll(() => screenText(page)).toMatch(/Rations? of Food/);
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // A click on a map cell walks there (Angband's mouse support).
  const start = await playerCell(page);
  const below = await cellToClient(page, start.x, start.y + 1);
  await page.mouse.click(below.x, below.y);
  await expect.poll(() => playerCell(page)).not.toEqual(start);

  // The message log has the game's messages.
  await page.keyboard.press('Control+f');
  await page.getByRole('button', { name: 'Message log' }).click();
  const log = page.getByRole('dialog', { name: 'Messages' });
  await expect(log).toContainText(/./);
  await log.getByRole('button', { name: 'Back to game' }).click();

  // Save and quit (Ctrl+X): Angband starts again at its savefile menu.
  await page.locator('canvas').first().focus();
  for (let i = 0; i < 5 && (await angbandContext(page)) !== 'map'; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Control+x');
  for (let i = 0; i < 20 && (await angbandContext(page)) !== 'select'; i++) {
    // The scores ("Press ESC to exit"), then Angband's splash screen.
    if ((await angbandContext(page)) === 'more')
      await page.keyboard.press(/Press ESC to exit/.test(await screenText(page)) ? 'Escape' : 'Enter');
    await page.waitForTimeout(400);
  }
  await waitForContext(page, 'select');
  await expect.poll(() => screenText(page)).toContain('Use Tester');

  // Saves are in IndexedDB: still there after a reload, and the character continues.
  await page.reload();
  await openAngband(page);
  await expect.poll(() => screenText(page)).toContain('Use Tester');
  await page.locator('canvas').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForContext(page, 'map', 30_000);
  // The character sheet names the character loaded.
  await page.keyboard.press('C');
  await expect.poll(() => screenText(page)).toContain('Tester');
  await page.keyboard.press('Escape');
});

test('Angband: tiles through the Display setting (Adam Bolt), back to text', async ({ page }) => {
  await newCharacter(page, 'Tiler');
  expect((await angband(page))?.tiled).toBe(false);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByLabel('Display').selectOption('tiles');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await angband(page))?.tiled, { timeout: 30_000 }).toBe(true);
  // The player is drawn as a tile, and the map in square cells.
  const player = await playerCell(page);
  expect(await tileAt(page, player.x, player.y)).toBeGreaterThan(0x8000);
  expect((await angband(page))?.views).toEqual(['top', 'side', 'map', 'status']);
  await page.screenshot({ path: 'test-results/angband-tiles.png' });

  // A menu over the map: the whole screen as text until it closes.
  await page.locator('canvas').first().focus();
  await page.keyboard.press('i');
  await expect.poll(async () => (await angband(page))?.views).toEqual(['screen']);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await angband(page))?.views).toEqual(['top', 'side', 'map', 'status']);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByLabel('Display').selectOption('text');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await angband(page))?.state?.graphics, { timeout: 30_000 }).toBe(0);
  expect(await tileAt(page, player.x, player.y)).toBe(0);
});

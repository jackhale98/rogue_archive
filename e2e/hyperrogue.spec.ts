import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { hyperContext, hyperDebug, openHyperRogue, turns, waitForContext } from './hyperrogue-helpers.ts';

test.describe.configure({ timeout: 300_000 });

const FIXTURE = fileURLToPath(new URL('../games/hyperrogue/tests/fixtures/hyperrogue.log', import.meta.url));

test('HyperRogue: starts in the Icy Land, moves, quest screen, message log', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openHyperRogue(page);
  const start = await hyperDebug(page);
  expect(start?.land).toBe('Icy Land');
  expect(start?.messages).toContain('Welcome to HyperRogue!');

  // vi keys move in a screen direction; some directions are blocked by ice walls.
  await page
    .locator('canvas.hr-canvas')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => undefined);
  const before = await turns(page);
  for (const key of ['l', 'h', 'k', 'j', 'y', 'u', 'b', 'n']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    if ((await turns(page)) > before) break;
  }
  expect(await turns(page)).toBeGreaterThan(before);

  // Esc opens the quest screen (a dialog); Esc again returns to the map.
  await page.keyboard.press('Escape');
  await waitForContext(page, 'dialog');
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // The shell's message log reads the game's own log.
  await page.getByRole('button', { name: 'Message log' }).click();
  const log = page.getByRole('dialog', { name: 'Messages' });
  await expect(log).toContainText('Welcome to HyperRogue!');
  await log.getByRole('button', { name: 'Back to game' }).click();
  expect(errors).toEqual([]);
});

test('HyperRogue: a desktop score file imports and is kept across reloads', async ({ page }) => {
  await openHyperRogue(page);

  // A score file recorded by this port (a game with two Ice Diamonds; the
  // same format as desktop HyperRogue's hyperrogue.log).
  await page.getByRole('button', { name: 'Menu' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Save files for desktop…' }).click();
  await dialog.locator('input[type=file]').setInputFiles(FIXTURE);
  await expect(dialog.getByText(/Import the save file/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByText(/Imported 1 file/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to game' }).click();

  // A fresh page reads it from IndexedDB; HyperRogue reads it at start-up
  // (its records, achievements and, with an Orb of Safety, a saved game) and
  // leaves it intact.
  await page.reload();
  await openHyperRogue(page);
  const log = await page.evaluate(async () => {
    const adapter = (
      window as unknown as {
        __rogueArchive: { adapter: { exportSaves(): Promise<{ path: string; bytes: Uint8Array }[]> } };
      }
    ).__rogueArchive.adapter;
    const file = (await adapter.exportSaves()).find((f) => f.path === 'hyperrogue.log');
    return file ? new TextDecoder().decode(file.bytes) : '';
  });
  expect(log).toContain('2x Ice Diamond');
  expect(log).toContain('HyperRogue: game statistics (version 13.1p)');
  expect(await hyperContext(page)).toBe('map');
});

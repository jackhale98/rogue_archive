import { expect, test } from '@playwright/test';
import {
  cellCenter,
  findCell,
  openBrogue,
  player,
  screenText,
  waitForScreenText,
  waitInGame,
} from './helpers.ts';

test.describe('Brogue CE', () => {
  test('starts a real game and moves the player with original keys', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    await waitForScreenText(page, 'Depth: 1');
    await waitForScreenText(page, 'Amulet of Yendor');

    // Try each direction until one moves (walls vary by seed); a move must change position.
    const start = await player(page);
    let moved = false;
    for (const key of ['l', 'h', 'k', 'j', 'y', 'u', 'b', 'n']) {
      await page.keyboard.press(key);
      await expect
        .poll(async () => (await player(page)).x !== start.x || (await player(page)).y !== start.y, {
          timeout: 1500,
        })
        .toBe(true)
        .then(() => (moved = true))
        .catch(() => undefined);
      if (moved) break;
    }
    expect(moved).toBe(true);

    // Graphics mode switch is handled by the game itself.
    await page.keyboard.press('Shift+G');
    await waitForScreenText(page, 'Switched to graphical tiles');
    expect(errors).toEqual([]);
  });

  test('the message log shows the game message history, newest last', async ({ page }) => {
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    // Walk into walls a few times to generate more messages.
    for (const key of ['h', 'h', 'h', 'k', 'k', 'k']) await page.keyboard.press(key);
    await page.getByRole('button', { name: 'Message log' }).click();
    const log = page.getByRole('dialog', { name: 'Messages' });
    await expect(log).toBeVisible();
    await expect(log.getByRole('listitem').first()).toContainText('Hello and welcome, adventurer');
    await expect(log).toContainText('Turn 0');
    await log.getByRole('button', { name: 'Back to game' }).click();
    await expect(log).toBeHidden();
    await expect(page.locator('canvas.brogue-canvas')).toBeFocused();
  });

  test('saves with S, survives a page reload, and loads', async ({ page }) => {
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    const before = await player(page);

    await page.keyboard.press('Shift+S');
    await waitForScreenText(page, 'Save this game');
    await page.keyboard.press('Enter');
    await waitForScreenText(page, 'Save game as');
    await expect(page.getByRole('button', { name: 'Open keyboard' })).toHaveAttribute(
      'data-attention',
      'true',
    );
    await page.keyboard.press('Enter');
    await waitForScreenText(page, 'Saved.');
    await page.keyboard.press(' ');
    await waitForScreenText(page, 'New Game');

    await page.reload();
    await waitForScreenText(page, 'New Game');
    await page.keyboard.press('p');
    await page.keyboard.press('l');
    await waitForScreenText(page, 'Open saved game:');
    expect(await screenText(page)).toContain('Saved CE 1.15.1');
    await page.keyboard.press('a');
    await waitInGame(page);
    await expect.poll(() => player(page)).toMatchObject({ x: before.x, y: before.y });
  });

  test('leaving mid-game keeps progress as LastGame', async ({ page }) => {
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    // Leaving asks first; leaving without a named save keeps the game as LastGame.
    await page.getByRole('link', { name: 'Library' }).click();
    const leave = page.getByRole('dialog', { name: 'Leave Brogue?' });
    await expect(leave).toContainText('LastGame');
    await leave.getByRole('button', { name: 'Leave (kept as LastGame)' }).click();
    await expect(page).toHaveURL(/#\/games\/brogue-ce$/);

    await page.getByRole('link', { name: 'Play Brogue' }).click();
    await waitForScreenText(page, 'New Game');
    await page.keyboard.press('p');
    await page.keyboard.press('l');
    await waitForScreenText(page, 'LastGame');
  });

  test('exports and re-imports saves through the shell menu', async ({ page }, testInfo) => {
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export saves' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^brogue-ce-saves-\d{4}-\d{2}-\d{2}\.roguearchive$/);
    const path = testInfo.outputPath('saves.roguearchive');
    await download.saveAs(path);
    await expect(dialog.getByText(/Exported \d+ file/)).toBeVisible();

    await dialog.locator('input[type=file]').setInputFiles(path);
    await expect(dialog.getByText(/^Import \d+ file/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByText(/Imported \d+ file/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Back to game' }).click();
    await expect(dialog).toBeHidden();
  });

  test('downloads a plain .broguesave for desktop Brogue and imports one back', async ({
    page,
  }, testInfo) => {
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    await page.keyboard.press('Shift+S');
    await waitForScreenText(page, 'Save this game');
    await page.keyboard.press('Enter');
    await waitForScreenText(page, 'Save game as');
    await page.keyboard.press('Enter');
    await waitForScreenText(page, 'Saved.');
    await page.keyboard.press(' ');
    await waitForScreenText(page, 'New Game');

    await page.getByRole('button', { name: 'Menu' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save files for desktop…' }).click();
    const files = dialog.getByRole('list', { name: 'Save files' });
    await expect(files).toContainText('.broguesave');
    const downloadPromise = page.waitForEvent('download');
    await files.getByRole('button', { name: 'Download' }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.broguesave$/);
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);

    // The same raw file imports back (as a desktop save would), without overwriting the original.
    await dialog.locator('input[type=file]').setInputFiles(path);
    await expect(dialog.getByText(/Import the save file/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByText(/Imported 1 file/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Back to game' }).click();
    // Closing the menu hands keyboard focus back to the game.
    await expect(page.locator('canvas.brogue-canvas')).toBeFocused();
    await page.keyboard.press('p');
    await page.keyboard.press('l');
    // Brogue truncates long names in its list: "... at depth 1 (imp".
    await waitForScreenText(page, '(imp');
  });

  test('shows an actionable error when the runtime is missing', async ({ page }) => {
    await page.route('**/runtime/brogue-ce/runtime-manifest.json', (route) =>
      route.fulfill({ status: 404, body: '' }),
    );
    await page.goto('#/play/brogue-ce');
    await expect(page.getByRole('alert')).toContainText('has not been built for this deployment');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('Brogue CE runtime integrity', () => {
  // Route interception does not see requests answered by the service worker.
  test.use({ serviceWorkers: 'block' });

  test('rejects tampered runtime files', async ({ page }) => {
    await page.route(/\/runtime\/brogue-ce\/[0-9a-f]{16}\/brogue\.wasm$/, async (route) => {
      const response = await route.fetch();
      const body = Buffer.from(await response.body());
      body[body.length - 1] = body[body.length - 1]! ^ 0xff;
      await route.fulfill({ response, body });
    });
    await page.goto('#/play/brogue-ce');
    await expect(page.getByRole('alert')).toContainText('integrity');
  });
});

test.describe('Brogue CE on a small non-touch window', () => {
  test.use({ viewport: { width: 900, height: 420 } });

  test('zoom never cuts off text Brogue shows over the map', async ({ page }) => {
    await openBrogue(page);
    await page.keyboard.press('n');
    await waitInGame(page);
    const zoom = page.getByRole('button', { name: 'Change zoom' });
    await zoom.click();
    await zoom.click();
    await expect(page.locator('.brogue-messages')).toBeVisible();
    await expect(page.locator('.brogue-messages')).toContainText('Dungeons of Doom');
    await page.keyboard.press('i');
    await waitForScreenText(page, 'more items');
    const canvas = (await page.locator('canvas.brogue-canvas').boundingBox())!;
    const line = (await findCell(page, 'more items'))!;
    for (const x of [line.x - 25, line.x + 'more items.'.length]) {
      const point = await cellCenter(page, { x, y: line.y });
      expect(point.x).toBeGreaterThanOrEqual(canvas.x);
      expect(point.x).toBeLessThanOrEqual(canvas.x + canvas.width);
    }
  });
});

import { expect, test } from '@playwright/test';
import { lineAt, nethack, startNetHack, toMap, waitForContext } from './nethack-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('NetHack phone: creation by taps, the status band, menus as sheets, the dock, travel by tap, tiles', async ({
  page,
}) => {
  await startNetHack(page, 'Thumbs');
  await waitForContext(page, 'yn');
  const dock = page.getByRole('group', { name: 'Actions' });
  // The question's answers are buttons.
  for (const name of ['Yes', 'No', 'Quit']) await expect(dock.getByRole('button', { name })).toBeVisible();
  await dock.getByRole('button', { name: 'No' }).tap();
  await waitForContext(page, 'menu');
  // Menus are a large sheet whose lines can be tapped.
  expect((await nethack(page))?.views).toEqual(['sheet']);
  const tapLine = async (pattern: RegExp) => {
    await expect.poll(() => lineAt(page, pattern).then((at) => at !== null)).toBe(true);
    const at = (await lineAt(page, pattern))!;
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(300);
  };
  await tapLine(/a Valkyrie/);
  await tapLine(/dwarf/);
  await tapLine(/Yes; start game/);
  await toMap(
    page,
    () => page.touchscreen.tap(200, 400),
    () => tapLine(/No, just start play/),
  );

  // The status band shows NetHack's status lines; the map follows the hero.
  await expect(page.locator('.nethack-band')).toContainText(/Dlvl:1 .*HP:\d+\(\d+\)/);
  await expect(page.locator('.nethack-band')).toContainText('Thumbs the Stripling');
  expect((await nethack(page))?.views).toEqual(['map']);
  for (const name of [/^Search/, /^Pick up/, /^Pack/, /^Fight/, /^Look/, /^More/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // Pack opens the inventory as a sheet over the map.
  await dock.getByRole('button', { name: /^Pack/ }).tap();
  await waitForContext(page, 'menu');
  expect((await nethack(page))?.views).toEqual(['map', 'sheet']);
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // A tap on the map travels there (two cells to the right).
  const before = (await nethack(page))!.state!;
  const target = await page.evaluate(
    (s) =>
      (
        window as unknown as {
          __rogueArchive: {
            adapter: { debug: { cellToClient(x: number, y: number): { x: number; y: number } } };
          };
        }
      ).__rogueArchive.adapter.debug.cellToClient(s.x - 1 + 2, s.y + 1),
    before,
  );
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(async () => (await nethack(page))?.state?.moves).toBeGreaterThan(before.moves);

  // Tiles on a phone.
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByLabel('Display').selectOption('tiles');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nethack(page))?.tiled, { timeout: 30_000 }).toBe(true);
});

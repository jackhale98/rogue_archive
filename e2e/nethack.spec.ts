import { expect, test } from '@playwright/test';
import { context, nethack, startNetHack, toMap, waitForContext } from './nethack-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('NetHack: character creation, the map and status, menus, tiles, save and continue after reload', async ({
  page,
}) => {
  await startNetHack(page, 'Tester');
  // NetHack's own character creation: its question, then its menus.
  await waitForContext(page, 'yn');
  expect((await nethack(page))?.prompt).toMatch(/Shall I pick character's race, role, gender and alignment/);
  await page.keyboard.press('n');
  await waitForContext(page, 'menu');
  expect((await nethack(page))?.menu?.title).toMatch(/Pick a role/);
  await page.keyboard.press('v');
  await expect.poll(async () => (await nethack(page))?.menu?.title).toMatch(/Pick a race/);
  await page.keyboard.press('d');
  await expect.poll(async () => (await nethack(page))?.menu?.title).toMatch(/Is this ok/);
  await page.keyboard.press('y');
  // The introduction, the starting inventory and NetHack 5.0's tutorial question.
  await toMap(
    page,
    () => page.keyboard.press(' '),
    () => page.keyboard.press('n'),
  );

  const game = (await nethack(page))!;
  const rows = game.text.split('\n');
  expect(rows[0]).toMatch(/welcome to NetHack! +You are a lawful dwarven Valkyrie/);
  expect(rows[22]).toMatch(/^Tester the Stripling +St:/);
  expect(rows[23]).toMatch(/^Dlvl:1 .*HP:\d+\(\d+\)/);
  expect(game.state).toMatchObject({ inGame: true, depth: 1 });

  // The inventory is a menu drawn over the map, as on a terminal.
  await page.keyboard.press('i');
  await waitForContext(page, 'menu');
  expect((await nethack(page))?.menu?.items.some((item) => /dwarvish spear/.test(item.text))).toBe(true);
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // A turn passes (search), and the game's messages reach the log.
  // (m: search even when a monster is next to you, as NetHack 5.0 asks.)
  await page.keyboard.press('m');
  await page.keyboard.press('s');
  await expect.poll(async () => (await nethack(page))?.state?.moves).toBeGreaterThan(1);

  // Tiles, from the game menu: the map is drawn with NetHack's tiles.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByLabel('Display').selectOption('tiles');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nethack(page))?.tiled, { timeout: 30_000 }).toBe(true);

  // Save (S, y): the session ends; the start screen offers to continue.
  const before = (await nethack(page))!.state!;
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+S');
  await waitForContext(page, 'yn');
  expect((await nethack(page))?.prompt).toMatch(/Really save\?/);
  await page.keyboard.press('y');
  const start = page.locator('.ra-start');
  for (let i = 0; i < 10 && !(await start.isVisible()); i++) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
  }
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(start).toContainText('Game saved');

  // The save is in IndexedDB: still there after a reload, and it continues.
  await page.reload();
  await expect(start).toBeVisible({ timeout: 120_000 });
  await start.getByRole('button', { name: /Continue Tester/ }).click();
  for (let i = 0; i < 10 && (await context(page)) !== 'map'; i++) {
    await page.waitForTimeout(400);
    const c = await context(page);
    if (c === 'text' || c === 'more' || c === 'menu') await page.keyboard.press(' ');
  }
  await waitForContext(page, 'map');
  expect((await nethack(page))?.state).toMatchObject({ x: before.x, y: before.y, moves: before.moves });
});

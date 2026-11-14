import { expect, test } from '@playwright/test';
import {
  angband,
  angbandContext,
  cellToClient,
  createByTaps,
  playerCell,
  screenText,
  sendCommand,
  tileAt,
  waitForContext,
} from './angband-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('Angband phone: creation by taps, status band, dock, item prompt, travel and look by touch, tiles, continue', async ({
  page,
}) => {
  const dock = await createByTaps(page, 'Thumbs');

  // The status band replaces the sidebar; the map follows the player.
  const band = page.locator('.angband-band');
  await expect(band).toContainText(/\d+\/\d+ HP · Level 1 · Town/);
  await expect(band).toContainText('Fed');
  expect((await angband(page))?.views).toEqual(['map']);
  for (const name of [/^Pack/, /^More/]) await expect(dock.getByRole('button', { name })).toBeVisible();
  // Standing on the down staircase: the stairs lead.
  await expect(dock.getByRole('button', { name: /^Down >/ })).toBeVisible();

  // An item prompt: the items by name, as buttons; the list as a sheet over the map.
  await sendCommand(page, 'drop');
  await waitForContext(page, 'item');
  await expect(dock.getByRole('button', { name: /Rations? of Food/ })).toBeVisible();
  expect((await angband(page))?.views).toEqual(['map', 'sheet']);
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // A tap on the map travels there (Angband's pathfinding): three cells down.
  const start = await playerCell(page);
  const target = await cellToClient(page, start.x, start.y + 3);
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(() => playerCell(page)).not.toEqual(start);
  await waitForContext(page, 'map');

  // Long-press looks at a cell: Angband's look mode, its cursor on the cell pressed.
  const here = await playerCell(page);
  const look = await cellToClient(page, here.x, here.y + 2);
  const cdp = await page.context().newCDPSession(page);
  const touch = { x: Math.round(look.x), y: Math.round(look.y) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitForContext(page, 'targeting');
  const cursor = await page.evaluate(() =>
    (
      window as unknown as {
        __rogueArchive: { adapter: { debug: { cursor(): { x: number; y: number } | null } } };
      }
    ).__rogueArchive.adapter.debug.cursor(),
  );
  expect(cursor).toEqual({ x: here.x, y: here.y + 2 });
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await waitForContext(page, 'map');

  // Tiles on a phone: the map in square cells, drawn from Adam Bolt's tiles.
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByLabel('Display').selectOption('tiles');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await angband(page))?.tiled, { timeout: 30_000 }).toBe(true);
  const player = await playerCell(page);
  expect(await tileAt(page, player.x, player.y)).toBeGreaterThan(0x8000);
  await page.screenshot({ path: 'test-results/angband-phone-tiles.png' });

  // Save and quit from the command list; Angband starts again at its savefile menu.
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  const menu = page.getByRole('dialog');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /Save and quit/ }).tap();
  for (let i = 0; i < 20 && (await angbandContext(page)) !== 'select'; i++) {
    await page.waitForTimeout(400);
    if ((await angbandContext(page)) !== 'more') continue;
    const next = dock.getByRole('button', { name: /^Done|^Continue/ }).first();
    if (await next.isVisible()) await next.tap().catch(() => undefined);
  }
  await waitForContext(page, 'select');
  await dock.getByRole('button', { name: /^Continue Thumbs/ }).tap();
  await waitForContext(page, 'map', 30_000);
  await expect.poll(async () => (await angband(page))?.state?.hp).toBeGreaterThan(0);
});

test('Angband phone: one tap attacks an adjacent monster', async ({ page }) => {
  const dock = await createByTaps(page, 'Fighter');
  // Walk towards the nearest townsperson by tapping it (travel stops when disturbed)
  // until the dock offers Attack, then attack with one tap.
  let attacked = false;
  for (let i = 0; i < 80 && !attacked; i++) {
    const info = await angband(page);
    if (!info?.state) break;
    if (info.context !== 'map') {
      if (info.context === 'more') await dock.getByRole('button', { name: /^Continue/ }).tap();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      continue;
    }
    const attack = dock.getByRole('button', { name: /^Attack/ });
    if (await attack.isVisible()) {
      await attack.tap();
      attacked = true;
      break;
    }
    // The nearest monster letter on the map (townspeople are lower-case letters).
    const rows = info.text.split('\n');
    const me = await playerCell(page);
    let best: { x: number; y: number } | null = null;
    for (let y = 1; y < rows.length - 1; y++)
      for (let x = 13; x < (rows[y] ?? '').length; x++)
        if (/[a-z]/.test(rows[y]![x]!) && !/[a-z]{2}/.test(rows[y]!.slice(Math.max(0, x - 1), x + 2))) {
          const d = Math.max(Math.abs(x - me.x), Math.abs(y - me.y));
          if (!best || d < Math.max(Math.abs(best.x - me.x), Math.abs(best.y - me.y))) best = { x, y };
        }
    if (!best) {
      // Nobody in sight: rest until someone comes along (resting stops when a monster appears).
      await page.keyboard.press('R');
      await waitForContext(page, 'text');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('500');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    } else {
      // Travel to the cell next to it (a path cannot end on a monster), or step into it.
      const near = Math.max(Math.abs(best.x - me.x), Math.abs(best.y - me.y)) <= 2;
      const cell = near
        ? { x: me.x + Math.sign(best.x - me.x), y: me.y + Math.sign(best.y - me.y) }
        : { x: best.x - Math.sign(best.x - me.x), y: best.y - Math.sign(best.y - me.y) };
      const point = await cellToClient(page, cell.x, cell.y);
      await page.touchscreen.tap(point.x, point.y);
    }
    await page.waitForTimeout(500);
  }
  expect(attacked, `the dock offered Attack next to a monster:\n${await screenText(page)}`).toBe(true);
  await page.getByRole('button', { name: 'Message log' }).tap();
  await expect(page.getByRole('dialog', { name: 'Messages' })).toContainText(
    /You (hit|miss|have slain)|dies|flees/,
  );
});

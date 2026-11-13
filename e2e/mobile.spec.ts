import { expect, test } from '@playwright/test';
import { cellCenter, findCell, openBrogue, player, waitForScreenText, waitInGame } from './helpers.ts';

/** Screen position of the dungeon map (upstream STAT_BAR_WIDTH + 1, MESSAGE_LINES). */
const MAP_X = 21;
const MAP_Y = 3;

test('touch: tap the title menu, use the pad, and preview-then-travel on the map', async ({ page }) => {
  await openBrogue(page);
  const pad = page.getByRole('group', { name: 'Movement' });
  await expect(pad).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible();

  // Title screen buttons respond to a single tap.
  const newGame = await findCell(page, 'New Game');
  expect(newGame).not.toBeNull();
  const title = await cellCenter(page, { x: newGame!.x + 2, y: newGame!.y });
  await page.touchscreen.tap(title.x, title.y);
  await waitInGame(page);
  await waitForScreenText(page, 'Depth: 1');

  // The pad sends the original movement keys.
  const moves: [string, number, number][] = [
    ['Move right (l)', 1, 0],
    ['Move left (h)', -1, 0],
    ['Move up (k)', 0, -1],
    ['Move down (j)', 0, 1],
  ];
  let delta: [number, number] | null = null;
  for (const [name, dx, dy] of moves) {
    const before = await player(page);
    await pad.getByRole('button', { name }).tap();
    try {
      await expect
        .poll(
          async () => (await player(page)).x === before.x + dx && (await player(page)).y === before.y + dy,
          { timeout: 1500 },
        )
        .toBe(true);
      delta = [dx, dy];
      break;
    } catch {
      // Blocked by a wall in this direction; try the next one.
    }
  }
  expect(delta).not.toBeNull();

  // Tapping the map previews first; tapping the same cell again travels there.
  const here = await player(page);
  const target = { x: MAP_X + here.x - delta![0], y: MAP_Y + here.y - delta![1] };
  const point = await cellCenter(page, target);
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(800);
  expect(await player(page)).toMatchObject({ x: here.x, y: here.y });
  const again = await cellCenter(page, target);
  await page.touchscreen.tap(again.x, again.y);
  await expect
    .poll(() => player(page), { timeout: 5000 })
    .toMatchObject({ x: here.x - delta![0], y: here.y - delta![1] });

  // Action buttons reach game commands (inventory opens Brogue's own menu).
  await page.getByRole('button', { name: 'Inventory (i)' }).tap();
  await waitForScreenText(page, 'more items');
  await page.getByRole('button', { name: 'Cancel / back (Esc)' }).tap();
});

test('touch: the on-screen keyboard reaches text prompts', async ({ page }) => {
  await openBrogue(page);
  await page.keyboard.press('n');
  await waitInGame(page);
  await page.keyboard.press('Shift+S');
  await waitForScreenText(page, 'Save this game');
  await page.keyboard.press('Enter');
  await waitForScreenText(page, 'Save game as');
  await page.getByRole('button', { name: 'Open keyboard' }).first().tap();
  const field = page.getByRole('textbox', { name: 'Type to the game' });
  await expect(field).toBeFocused();
  for (let i = 0; i < 60; i++) await field.press('Backspace');
  await field.pressSequentially('mobile');
  await waitForScreenText(page, 'mobile');
  await field.press('Enter');
  await waitForScreenText(page, 'Saved.');
});

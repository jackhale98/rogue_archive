import { expect, test } from '@playwright/test';
import { canvasCentre, hyperContext, openHyperRogue, turns, waitForContext } from './hyperrogue-helpers.ts';

test.describe.configure({ timeout: 300_000 });

test('HyperRogue phone: dock, tap to move, long-press for help, thumb pad', async ({ page }) => {
  await openHyperRogue(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  for (const name of [/^Centre/, /^Wait/, /^Target/, /^Quest/, /^Menu/, /^More/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // Tap a cell next to the player: the game moves towards it (as its mobile
  // version). Some directions are blocked by ice walls, so try several.
  const centre = await canvasCentre(page);
  const step = centre.radius * 0.36;
  let before = await turns(page);
  for (let i = 0; i < 8 && (await turns(page)) === before; i++) {
    const angle = (i / 8) * Math.PI * 2;
    await page.touchscreen.tap(centre.x + Math.cos(angle) * step, centre.y + Math.sin(angle) * step);
    await expect
      .poll(() => turns(page), { timeout: 4_000 })
      .toBeGreaterThan(before)
      .catch(() => undefined);
  }
  expect(await turns(page)).toBeGreaterThan(before);

  // Long-press asks the game for help about what is there (its right-click).
  const cdp = await page.context().newCDPSession(page);
  const point = { x: Math.round(centre.x), y: Math.round(centre.y) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitForContext(page, 'dialog');
  await dock.getByRole('button', { name: /^Back/ }).tap();
  await waitForContext(page, 'map');

  // The thumb pad's centre waits a turn.
  before = await turns(page);
  const pad = page.getByRole('group', { name: 'Movement' });
  await pad.getByRole('button', { name: /^Wait/ }).tap();
  await expect.poll(() => turns(page), { timeout: 10_000 }).toBeGreaterThan(before);
  expect(await hyperContext(page)).toBe('map');
});

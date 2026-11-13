import { expect, test, type Page } from '@playwright/test';
import {
  canvasCentre,
  hyperContext,
  hyperDebug,
  openHyperRogue,
  turns,
  waitForContext,
} from './hyperrogue-helpers.ts';

test.describe.configure({ timeout: 300_000 });

async function touchMode(page: Page): Promise<number> {
  return (await hyperDebug(page))?.state?.touchMode ?? -1;
}

test('HyperRogue phone: dock, tap to move, long-press for help, thumb pad', async ({ page }) => {
  await openHyperRogue(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  for (const name of [/^Centre/, /^Overview/, /^Quest/, /^More/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  // Waiting is the pad's centre; `t` (target the view's centre) only with strong wind.
  await expect(dock.getByRole('button', { name: /^Wait/ })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: /^Target/ })).toHaveCount(0);

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

test('HyperRogue phone: Inspect makes taps tell about a cell without moving', async ({ page }) => {
  await openHyperRogue(page);
  const dock = page.getByRole('group', { name: 'Actions' });

  // Overview's fan (long-press) offers Inspect: upstream's "touch for info" mode.
  const overview = dock.getByRole('button', { name: 'Overview (o)' });
  const box = (await overview.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const selector = '.dock-button[aria-label="Overview (o)"]';
  await page.dispatchEvent(selector, 'pointerdown', {
    pointerId: 3,
    pointerType: 'touch',
    isPrimary: true,
    clientX: at.x,
    clientY: at.y,
    button: 0,
    buttons: 1,
  });
  const fan = page.getByRole('menu', { name: 'Overview options' });
  await expect(fan).toBeVisible();
  // Released on the button: the fan stays open for a tap.
  await page.dispatchEvent(selector, 'pointerup', {
    pointerId: 3,
    pointerType: 'touch',
    clientX: at.x,
    clientY: at.y,
    button: 0,
  });
  await fan.getByRole('menuitem', { name: /^Inspect/ }).click();
  await expect.poll(() => touchMode(page)).toBe(1);
  const inspect = dock.getByRole('button', { name: /^Inspect/ });
  await expect(inspect).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hr-hint')).toContainText('Inspect: tap a cell to read about it');

  // A tap next to the player opens the game's help about that cell; no turn passes.
  const centre = await canvasCentre(page);
  const before = await turns(page);
  await page.touchscreen.tap(centre.x + centre.radius * 0.36, centre.y);
  await waitForContext(page, 'dialog');
  expect(await turns(page)).toBe(before);
  await dock.getByRole('button', { name: /^Back/ }).tap();
  await waitForContext(page, 'map');

  // Still inspecting until switched off; then taps move again.
  await expect(inspect).toHaveAttribute('aria-pressed', 'true');
  await inspect.tap();
  await expect.poll(() => touchMode(page)).toBe(0);
  await expect(dock.getByRole('button', { name: /^Inspect/ })).toHaveCount(0);
  await expect(page.locator('.hr-hint')).toBeHidden();
});

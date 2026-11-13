import { expect, test } from '@playwright/test';
import { dcssContext, startCharacter, waitForContext } from './dcss-helpers.ts';

test.describe.configure({ timeout: 300_000 });

test('DCSS phone: tap through character creation, status band, contextual dock and fans', async ({
  page,
}) => {
  await startCharacter(page, 'Thumbs');
  // Upstream's character creation buttons are tappable.
  const frame = page.frameLocator('iframe.dcss-client');
  for (let i = 0; i < 3 && (await dcssContext(page)) === 'start'; i++) {
    await frame.locator('.newgame-choice .button').first().tap();
    await page.waitForTimeout(1000);
  }
  await waitForContext(page, 'map');

  // The status band replaces the stats column; tapping it opens the full panel.
  const status = page.locator('.dcss-hud__status');
  await expect(status).toContainText('Dungeon:1');
  await status.tap();
  await expect(frame.locator('#stats')).toBeVisible();
  await status.tap();
  await expect(frame.locator('#stats')).toBeHidden();

  // Map dock: the main actions, each with related actions on a long press.
  const dock = page.getByRole('group', { name: 'Actions' });
  for (const name of ['Explore (o)', 'Fight (Tab)', 'Cast (z)', 'Pack (i)', 'Look (x)'])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  await dock.getByRole('button', { name: 'Pack (i)' }).tap();
  await waitForContext(page, 'menu');
  await expect(dock.getByRole('button', { name: /Close/ })).toBeVisible();
  await dock.getByRole('button', { name: /Close/ }).tap();
  await waitForContext(page, 'map');

  // Long-press fans out related actions; sliding onto one and releasing runs it.
  const selector = '.dock-button[aria-label="Pack (i)"]';
  const box = (await dock.getByRole('button', { name: 'Pack (i)' }).boundingBox())!;
  const pointer = (x: number, y: number, extra: Record<string, unknown>) => ({
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
    ...extra,
  });
  await page.dispatchEvent(
    selector,
    'pointerdown',
    pointer(box.x + box.width / 2, box.y + box.height / 2, { button: 0, buttons: 1 }),
  );
  const fan = page.getByRole('menu', { name: 'Pack options' });
  await expect(fan).toBeVisible();
  const quaff = (await fan.getByRole('menuitem', { name: /Quaff/ }).boundingBox())!;
  const target = { x: quaff.x + quaff.width / 2, y: quaff.y + quaff.height / 2 };
  await page.dispatchEvent(selector, 'pointermove', pointer(target.x, target.y, { buttons: 1 }));
  await page.dispatchEvent(selector, 'pointerup', pointer(target.x, target.y, { button: 0 }));
  await expect(fan).toBeHidden();
  // Quaffing asks which potion: a prompt or a menu of potions.
  await expect.poll(() => dcssContext(page), { timeout: 15_000 }).toMatch(/prompt|menu|popup/);
  await dock
    .getByRole('button', { name: /Cancel|Close/ })
    .first()
    .tap();
  await waitForContext(page, 'map');
});

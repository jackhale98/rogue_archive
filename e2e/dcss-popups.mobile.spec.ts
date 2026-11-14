import { expect, test, type Frame, type Page } from '@playwright/test';
import { dcssContext, startCharacter, waitForContext } from './dcss-helpers.ts';

test.describe.configure({ timeout: 300_000 });

/** Sizes of the top popup's outer box and its scroll areas. */
function popupBoxes(frame: Frame) {
  return frame.evaluate(() => {
    const popup = [...document.querySelectorAll('.ui-popup')].pop();
    const outer = popup?.querySelector('.ui-popup-outer') as HTMLElement | null;
    const scroller = popup?.querySelector('.simplebar-scroll-content') as HTMLElement | null;
    return {
      outer: outer
        ? {
            width: outer.clientWidth,
            scrollWidth: outer.scrollWidth,
            overflowX: getComputedStyle(outer).overflowX,
          }
        : null,
      scroller: scroller
        ? { height: scroller.clientHeight, scrollHeight: scroller.scrollHeight, top: scroller.scrollTop }
        : null,
    };
  });
}

function clientFrame(page: Page): Frame {
  return page.frames().find((frame) => frame.url().includes('/client/'))!;
}

test('DCSS phone: descriptions fit the width, Page down scrolls a screen, item menus offer their modes', async ({
  page,
}) => {
  await startCharacter(page, 'Reader');
  const frame = page.frameLocator('iframe.dcss-client');
  // A Berserker, who starts with a god (Trog) and so has a god screen.
  await frame.locator('.ui-popup .newgame-choice .button').first().tap();
  await expect
    .poll(() => frame.locator('.ui-popup .newgame-choice .button', { hasText: 'Berserker' }).count())
    .toBeGreaterThan(0);
  await frame.locator('.ui-popup .newgame-choice .button', { hasText: 'Berserker' }).first().tap();
  for (let i = 0; i < 3 && (await dcssContext(page)) === 'start'; i++) {
    await page.waitForTimeout(1000);
    if ((await dcssContext(page)) === 'start')
      await frame.locator('.ui-popup .newgame-choice .button').first().tap();
  }
  await waitForContext(page, 'map');
  const client = clientFrame(page);

  // The god screen (80 characters wide upstream) wraps to the phone's width.
  await page.keyboard.press('^');
  await expect(frame.locator('.ui-popup .describe-god')).toBeVisible();
  const god = await popupBoxes(client);
  // (Upstream's scroller is a few pixels wider to hide its scroll bar; the
  // popup doesn't pan sideways. Before: 801 pixels in a 396-pixel frame.)
  expect(god.outer!.scrollWidth).toBeLessThanOrEqual(god.outer!.width + 20);
  expect(god.outer!.overflowX).toBe('hidden');
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // An item description longer than the screen: Page down moves its own
  // scroller by about a screen (not straight to the end), Page up back.
  await page.keyboard.press('i');
  await waitForContext(page, 'menu');
  await page.keyboard.press('a');
  await expect(frame.locator('.ui-popup .describe-item')).toBeVisible();
  const before = (await popupBoxes(client)).scroller!;
  expect(before.scrollHeight).toBeGreaterThan(before.height);
  expect(before.top).toBe(0);
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await popupBoxes(client)).scroller!.top).toBeGreaterThan(0);
  const after = (await popupBoxes(client)).scroller!;
  expect(after.top).toBeLessThanOrEqual(before.height);
  await page.keyboard.press('PageUp');
  await expect.poll(async () => (await popupBoxes(client)).scroller!.top).toBe(0);
  const item = await popupBoxes(client);
  expect(item.outer!.scrollWidth).toBeLessThanOrEqual(item.outer!.width + 20);
  expect(item.outer!.overflowX).toBe('hidden');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // The equip menu (an item menu) gets Describe and its modes, labelled with
  // the mode each switches to; switching follows the game's key help.
  await page.keyboard.press('e');
  await waitForContext(page, 'menu');
  const dock = page.getByRole('group', { name: 'Actions' });
  await expect(dock.getByRole('button', { name: /^Describe/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /^→ Wield/ })).toBeVisible();
  await dock.getByRole('button', { name: /^→ Unequip/ }).tap();
  await expect(frame.locator('.ui-popup').last()).toContainText('Unequip which item');
  await expect(dock.getByRole('button', { name: /^→ Equip/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /^→ Take off/ })).toBeVisible();
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await waitForContext(page, 'map');
});

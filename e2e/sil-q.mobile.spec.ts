import { expect, test } from '@playwright/test';
import {
  cellToClient,
  openSil,
  playerCell,
  screenText,
  sendCommand,
  silContext,
  waitForContext,
} from './sil-q-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('Sil-Q phone: title buttons, creation by tap, item prompt dock, continue a saved character', async ({
  page,
}) => {
  await openSil(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  // The title menu's choices are large buttons.
  for (const name of [/Tutorial/, /New character/, /Open saved character/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  await dock.getByRole('button', { name: /New character/ }).tap();
  // Creation menus take arrow keys (stats and skills: left/right lowers/raises): the pad is shown.
  await expect(page.getByRole('group', { name: 'Movement' })).toBeVisible();
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.waitForTimeout(400);
    if ((await silContext(page)) === 'map') break;
    await dock.getByRole('button', { name: /^OK/ }).tap();
  }
  await waitForContext(page, 'map');

  // The status band and the map dock.
  await expect(page.locator('.sil-band')).toContainText('health');
  // (The rest of the map dock depends on the situation: monsters in view, what is underfoot.)
  for (const name of [/^Pack/, /^More/]) await expect(dock.getByRole('button', { name })).toBeVisible();

  // An item prompt: the letters, then the items by name once the list is shown.
  await page.evaluate(() =>
    (
      window as unknown as { __rogueArchive: { adapter: { sendInput(input: unknown): void } } }
    ).__rogueArchive.adapter.sendInput({ type: 'command', commandId: 'drop' }),
  );
  await waitForContext(page, 'item');
  await dock.getByRole('button', { name: /Show items/ }).tap();
  await expect(dock.getByRole('button', { name: /Wooden Torch/ })).toBeVisible();
  await dock.getByRole('button', { name: /Cancel/ }).tap();
  await waitForContext(page, 'map');

  // Save and quit from the command palette, then continue from the title menu.
  // (The dock is rebuilt as the context settles; wait for the map dock before tapping.)
  await expect(dock.getByRole('button', { name: 'Pack (i)' })).toBeVisible();
  await page.waitForTimeout(500);
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  const menu = page.getByRole('dialog');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /Save and quit/ }).tap();
  // Acknowledge -more- and the scores' "press any key" only while one is on screen: the title
  // menu can appear between a check and a tap, and OK there would choose its first item (the tutorial).
  for (let i = 0; i < 16 && !(await screenText(page)).includes('b) New character'); i++) {
    await page.waitForTimeout(500);
    if (!/-more-|press any key/.test(await screenText(page))) continue;
    const ok = dock.getByRole('button', { name: /^OK|^Continue \(/ }).first();
    if (await ok.isVisible()) await ok.tap();
  }
  await dock.getByRole('button', { name: 'Continue nameless' }).tap();
  await waitForContext(page, 'map', 30_000);
  await expect.poll(() => screenText(page)).toContain('nameless');
});

test('Sil-Q phone: context leads, song buttons, status band, long-press to look (tutorial)', async ({
  page,
}) => {
  await openSil(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  const band = page.locator('.sil-band');
  await dock.getByRole('button', { name: /Tutorial/ }).tap();
  await expect.poll(() => screenText(page)).toContain('Laurilfea');
  // The tutorial opens on a note: close it (and any -more-) until the map waits for a command.
  // (The screen can change between a check and a tap, so a tap that finds no button is skipped.)
  const tapIfShown = (name: RegExp) =>
    dock
      .getByRole('button', { name })
      .tap({ timeout: 3_000 })
      .catch(() => undefined);
  // A further Escape on the map would open Sil's main menu: "Return to game" closes it.
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.waitForTimeout(400);
    const context = await silContext(page);
    if (context === 'more') await tapIfShown(/^Continue/);
    else if ((await screenText(page)).includes('Return to game')) await tapIfShown(/Return to game/);
    else if (context === 'menu') await tapIfShown(/^Close/);
    // Let the tap take effect before looking again.
    await expect
      .poll(() => silContext(page), { timeout: 3_000 })
      .not.toBe(context)
      .catch(() => undefined);
  }
  await waitForContext(page, 'map');

  // Standing on the note (an object): Pick up leads the dock.
  await expect(dock.getByRole('button', { name: /^Pick up/ }).first()).toBeVisible();
  // Off the note, the tutorial character's unspent experience buys an ability: Abilities leads.
  await sendCommand(page, 'move-s');
  await expect(dock.getByRole('button', { name: /^Abilities/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /^Pick up/ })).toHaveCount(0);
  for (const name of [/^Stealth/, /^Rest/, /^Pack/, /^Look/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // The song prompt: the songs by name, not a typing dock.
  await sendCommand(page, 'sing');
  await waitForContext(page, 'song');
  for (const name of ['Staunching', 'the Trees', 'Stop singing'])
    await expect(dock.getByRole('button', { name, exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'Staunching', exact: true }).tap();
  for (let i = 0; i < 6 && (await silContext(page)) !== 'map'; i++) {
    await page.waitForTimeout(300);
    if ((await silContext(page)) === 'more') await tapIfShown(/^Continue/);
  }
  await waitForContext(page, 'map');
  // The status band shows the song (Sil's sidebar is hidden on phones).
  await expect(band).toContainText('♪ Staunching');

  // A plain direction prompt (tunnel) takes a direction only: no "Nearest".
  await sendCommand(page, 'tunnel');
  await waitForContext(page, 'direction');
  await expect(dock.getByRole('button', { name: /^Nearest/ })).toHaveCount(0);
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // Long-press on a map cell looks at that cell: the nearest '~' (an object) on screen.
  const player = await playerCell(page);
  const rows = (await screenText(page)).split('\n');
  let target: { x: number; y: number } | null = null;
  for (let y = 1; y < rows.length - 1; y++)
    for (let x = 13; x < (rows[y] ?? '').length; x++)
      if (rows[y]![x] === '~') {
        const distance = Math.max(Math.abs(x - player.x), Math.abs(y - player.y));
        if (!target || distance < Math.max(Math.abs(target.x - player.x), Math.abs(target.y - player.y)))
          target = { x, y };
      }
  expect(target, 'an object on screen').not.toBeNull();
  const point = await cellToClient(page, target!.x, target!.y);
  const cdp = await page.context().newCDPSession(page);
  const touch = { x: Math.round(point.x), y: Math.round(point.y) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitForContext(page, 'targeting');
  await expect.poll(async () => (await screenText(page)).split('\n')[0]).toMatch(/^You see an? /);
  // The look cursor is on the pressed cell.
  const cursor = await page.evaluate(() =>
    (
      window as unknown as {
        __rogueArchive: { adapter: { debug: { cursor(): { x: number; y: number } | null } } };
      }
    ).__rogueArchive.adapter.debug.cursor(),
  );
  expect(cursor).toEqual(target);
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');
});

test('Sil-Q phone: tiles by MicroChasm, the map in square cells', async ({ page }) => {
  await page.goto('?debug=1#/games/sil-q');
  await page.getByLabel('Display').selectOption('tiles');
  await openSil(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  await dock.getByRole('button', { name: /Tutorial/ }).tap();
  await expect.poll(() => screenText(page)).toContain('Laurilfea');
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if ((await screenText(page)).includes('Return to game')) await page.keyboard.press('Escape');
  }
  await waitForContext(page, 'map');
  const map = await page.evaluate(() => {
    const adapter = (
      window as unknown as {
        __rogueArchive: { adapter: { debug: { state: { graphics: boolean }; views(): string[] } } };
      }
    ).__rogueArchive.adapter;
    return { graphics: adapter.debug.state.graphics, views: adapter.debug.views() };
  });
  expect(map).toEqual({ graphics: true, views: ['map'] });
  await page.screenshot({ path: test.info().outputPath('sil-tiles-phone.png') });
});

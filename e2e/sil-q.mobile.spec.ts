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
  const labels = () => dock.locator('.dock-button').allInnerTexts();
  const tapLead = async (name: RegExp, then: RegExp) => {
    await dock.getByRole('button', { name }).tap();
    await expect.poll(() => screenText(page)).toMatch(then);
  };
  // Race: the races in order, a random choice, then OK nearest the thumb (last).
  await expect.poll(() => screenText(page)).toMatch(/a\) Noldor/);
  await expect
    .poll(async () => (await labels()).map((label) => label.split('\n')[0]))
    .toEqual(['a) Noldor', 'b) Sindar', 'c) Naugrim', 'd) Edain', 'Random', 'Start over', 'OK']);
  await tapLead(/^OK \(/, /House of/);
  // House: only the houses (the races stay on screen beside them).
  await expect(dock.getByRole('button', { name: /House of Feanor/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /Noldor/ })).toHaveCount(0);
  await tapLead(/^OK \(/, /allocate points to stats/);
  // Stats: More raises the line's value (the points left go down).
  const pointsLeft = async () => Number(/Points Left:\s*(\d+)/.exec(await screenText(page))?.[1]);
  const before = await pointsLeft();
  await dock.getByRole('button', { name: /\+ More/ }).tap();
  await expect.poll(pointsLeft).toBeLessThan(before);
  await tapLead(/^Accept \(/, /allocate points to skills/);
  await tapLead(/^Accept \(/, /accept history/);
  await expect(dock.getByRole('button', { name: /^Reroll/ })).toBeVisible();
  await tapLead(/^Accept \(/, /accept age/);
  await tapLead(/^Accept \(/, /accept name/);
  await dock.getByRole('button', { name: /^Random name/ }).tap();
  await expect.poll(() => screenText(page)).not.toMatch(/Name\s+nameless/);
  const name = /Name\s+(\S+)/.exec(await screenText(page))![1]!;
  for (let i = 0; i < 6 && (await silContext(page)) !== 'map'; i++) {
    const lead = dock.getByRole('button', { name: /^(Accept|Continue) \(/ });
    if (await lead.isVisible()) await lead.tap();
    await page.waitForTimeout(500);
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
  await dock.getByRole('button', { name: `Continue ${name}` }).tap();
  await waitForContext(page, 'map', 30_000);
  await expect.poll(() => screenText(page)).toContain(name);
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

test('Sil-Q phone: kill the character by touch, the tombstone and its menu, back to the title', async ({
  page,
}) => {
  await openSil(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  await dock.getByRole('button', { name: /New character/ }).tap();
  // Each creation step's lead (OK, Accept…), then the intro's pages.
  for (let i = 0; i < 14 && (await silContext(page)) !== 'map'; i++) {
    await page.waitForTimeout(400);
    if ((await silContext(page)) === 'map') break;
    const lead = dock.locator('.dock-button--primary').first();
    if (await lead.isVisible()) await lead.tap();
  }
  await waitForContext(page, 'map');
  await expect(dock.getByRole('button', { name: 'Pack (i)' })).toBeVisible();
  await page.waitForTimeout(500);

  // Kill character (Q) from the command list: Sil's question, then its '@', as buttons.
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Kill character/ })
    .tap();
  await waitForContext(page, 'yesno');
  await dock.getByRole('button', { name: /^Yes/ }).tap();
  await waitForContext(page, 'verify');
  await dock.getByRole('button', { name: /^Kill character/ }).tap();

  // The tombstone and the menu after death: back to the title leads.
  await waitForContext(page, 'death');
  await expect.poll(() => screenText(page)).toContain('You have been slain');
  for (const name of [/^Scores/, /^Inventory/, /^Dungeon/, /^Messages/, /^Character/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  await dock.getByRole('button', { name: /^Messages/ }).tap();
  await expect.poll(() => silContext(page)).not.toBe('death');
  await dock.getByRole('button', { name: /^Back/ }).tap();
  await waitForContext(page, 'death');
  await dock.getByRole('button', { name: /^Back to title/ }).tap();
  await waitForContext(page, 'title');
  await expect.poll(() => screenText(page)).toContain('b) New character');
  // The dead character's savefile starts a new character: it says so.
  await expect(dock.getByRole('button', { name: 'New from nameless (dead)' })).toBeVisible();
});

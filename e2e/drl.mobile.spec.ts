import { expect, test } from '@playwright/test';
import { chooseDisplay, drl, openDrl, screenText, waitForContext, waitForText } from './drl-helpers.ts';

test.describe.configure({ timeout: 240_000 });
// A tap that cannot happen fails at that step instead of at the test timeout.
test.use({ actionTimeout: 15_000 });

test('DRL phone: a game started by taps, status band, pad, dock, sheets, Save & Quit by taps', async ({
  page,
}) => {
  await openDrl(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  const pad = page.getByRole('group', { name: 'Movement' });
  const tap = (name: RegExp) => dock.getByRole('button', { name }).first().tap();
  const select = () => tap(/^(Select|Continue)/);

  // DRL's own screens before a game: the welcome, its credits, the main menu,
  // the game type, difficulty, class and trait (DRL's defaults), by taps.
  for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
    await waitForContext(page, 'title');
    await select();
    await page.waitForTimeout(500);
  }
  await waitForText(page, /New game/);
  // The pad moves through the choices: down to Exit and back up, Select in its centre.
  await expect(pad).toBeVisible();
  await pad
    .getByRole('button', { name: /^Move down \(/ })
    .first()
    .tap();
  await pad
    .getByRole('button', { name: /^Move up \(/ })
    .first()
    .tap();
  await expect(pad.getByRole('button', { name: /^OK/ })).toBeVisible();
  for (const next of [/Regular game/, /Too Young To Die/, /Marine/, /Select trait/, /Type a name/]) {
    await select();
    await waitForText(page, next);
  }
  // The name, as typed with the device keyboard (the dock offers it).
  await waitForContext(page, 'text');
  await expect(dock.getByRole('button', { name: /^Keyboard/ })).toBeVisible();
  await page.keyboard.type('Thumbs');
  await tap(/^Done/);
  // The intro: Back (Escape) skips each page.
  for (let i = 0; i < 10 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(700);
    if ((await drl(page))?.context !== 'map') await tap(/^Back/);
  }
  await waitForContext(page, 'map');

  // The status band from DRL's HUD; the map zoomed around the player.
  const band = page.locator('.drl-band');
  await expect(band).toContainText('100%');
  await expect(band).toContainText('pistol');
  expect((await drl(page))?.views).toEqual(['map']);
  for (const name of [/^Fire/, /^Action/, /^Reload/, /^Inventory/, /^Look/, /^Menu/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // The pad moves the player (walls permitting: four directions, back to the map each time).
  for (const name of [/^Move right \(/, /^Move down \(/, /^Move left \(/, /^Move up \(/]) {
    await pad.getByRole('button', { name }).first().tap();
    await page.waitForTimeout(250);
  }
  await waitForContext(page, 'map');

  // The inventory: a full screen, closed from the dock.
  await tap(/^Inventory/);
  await waitForText(page, /Inventory/);
  await waitForContext(page, 'menu');
  expect((await drl(page))?.views).toEqual(['screen']);
  await tap(/^Back/);
  await waitForContext(page, 'map');

  // DRL's game menu over the map: a sheet. Save & Quit (its last entry) by taps.
  await tap(/^Menu/);
  await waitForText(page, /Save & Quit/);
  await waitForContext(page, 'menu');
  expect((await drl(page))?.views).toEqual(['map', 'sheet']);
  await pad
    .getByRole('button', { name: /^Move up \(/ })
    .first()
    .tap();
  await page.waitForTimeout(300);
  await select();
  await waitForText(page, /Continue game/, 30_000);
  await expect.poll(async () => (await drl(page))?.hasSave, { timeout: 15_000 }).toBe(true);
  await expect(band).toHaveCount(0);

  // Continue game, by a tap.
  await select();
  for (let i = 0; i < 6 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(700);
    if ((await drl(page))?.context !== 'map') await tap(/^(Back|Continue)/);
  }
  await waitForContext(page, 'map');
  expect((await drl(page))?.state?.name).toBe('Thumbs');
});

test('DRL phone, Tiles display: taps on its menus, a game by taps, band, pad, dock, Save & Quit, back to Text', async ({
  page,
}) => {
  test.setTimeout(360_000);
  await openDrl(page);
  await chooseDisplay(page, 'tiles', true);
  const dock = page.getByRole('group', { name: 'Actions' });
  const pad = page.getByRole('group', { name: 'Movement' });
  const tap = (name: RegExp) => dock.getByRole('button', { name }).first().tap();
  const select = () => tap(/^(Select|Continue)/);
  /** Where DRL draws a text on the page (its GL console's cell), or null. */
  const textAt = (text: string) =>
    page.evaluate((text) => {
      const d = (
        window as unknown as {
          __rogueArchive: {
            adapter: {
              debug: {
                screenText(): string;
                cellToClient(x: number, y: number): { x: number; y: number } | null;
              };
            };
          };
        }
      ).__rogueArchive.adapter.debug;
      const rows = d.screenText().split('\n');
      const y = rows.findIndex((row) => row.includes(text));
      return y < 0 ? null : d.cellToClient(rows[y]!.indexOf(text) + 2, y);
    }, text);

  for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
    await waitForContext(page, 'title');
    await select();
    await page.waitForTimeout(800);
  }
  await waitForText(page, /New game/);
  await select();
  await waitForText(page, /Regular game/);
  // DRL's menus take its mouse: a tap on an entry chooses it (the challenge games), Back returns.
  const challenge = await textAt('Challenge game');
  expect(challenge).not.toBeNull();
  await page.touchscreen.tap(challenge!.x, challenge!.y);
  await waitForText(page, /Angel Game/);
  await tap(/^Back/);
  await waitForText(page, /New game/);
  await select();
  await waitForText(page, /- Regular game -/);
  // A tap on Regular game chooses it too.
  const regular = await textAt('Regular game');
  await page.touchscreen.tap(regular!.x, regular!.y);
  await waitForText(page, /Too Young To Die/);
  for (const next of [/Marine/, /Select trait/, /Type a name/]) {
    await select();
    await waitForText(page, next);
  }
  await waitForContext(page, 'text');
  await page.keyboard.type('Pixels');
  await tap(/^Done/);
  for (let i = 0; i < 10 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(1000);
    if ((await drl(page))?.context !== 'map') await tap(/^Back/);
  }
  await waitForContext(page, 'map');

  // DRL's own picture fills the screen; the status band reads its HUD.
  expect((await drl(page))?.views).toEqual(['tiles']);
  const band = page.locator('.drl-band');
  await expect(band).toContainText('100%');
  await expect(band).toContainText('pistol');
  for (const name of [/^Fire/, /^Inventory/, /^Menu/])
    await expect(dock.getByRole('button', { name })).toBeVisible();
  for (const name of [/^Move right \(/, /^Move down \(/, /^Move left \(/, /^Move up \(/]) {
    await pad.getByRole('button', { name }).first().tap();
    await page.waitForTimeout(400);
  }
  await waitForContext(page, 'map');
  await tap(/^Inventory/);
  await waitForText(page, /Inventory/);
  await waitForContext(page, 'menu');
  await tap(/^Back/);
  await waitForContext(page, 'map');

  // Save & Quit, from DRL's game menu, by taps.
  await tap(/^Menu/);
  await waitForText(page, /Save & Quit/);
  await waitForContext(page, 'menu');
  const selected = () =>
    page.evaluate(() =>
      (
        window as unknown as { __rogueArchive: { adapter: { debug: { selectedEntry(): string | null } } } }
      ).__rogueArchive.adapter.debug.selectedEntry(),
    );
  // The menu opens on Continue (DRL ignores keys while it fades in): Up wraps to Save & Quit.
  await expect.poll(selected).toBe('Continue');
  await expect
    .poll(
      async () => {
        if ((await selected()) !== 'Save & Quit')
          await pad
            .getByRole('button', { name: /^Move up \(/ })
            .first()
            .tap();
        return selected();
      },
      { intervals: [1000] },
    )
    .toBe('Save & Quit');
  await select();
  await waitForText(page, /Continue game/, 60_000);
  await expect.poll(async () => (await drl(page))?.hasSave, { timeout: 15_000 }).toBe(true);

  // Continue game, by a tap.
  await select();
  for (let i = 0; i < 8 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(1000);
    if ((await drl(page))?.context !== 'map') await tap(/^(Back|Continue)/);
  }
  await waitForContext(page, 'map');
  expect((await drl(page))?.state?.name).toBe('Pixels');

  // Back to Text.
  await chooseDisplay(page, 'text', true);
  expect((await drl(page))?.views).not.toEqual(['tiles']);
});

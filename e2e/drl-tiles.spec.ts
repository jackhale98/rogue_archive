import { expect, test } from '@playwright/test';
import {
  chooseDisplay,
  drl,
  newGame,
  openDrl,
  screenText,
  settle,
  waitForContext,
  waitForText,
} from './drl-helpers.ts';

// DRL's graphical mode (the Tiles display): WebGL 2 on the page. Headless
// Chromium draws it in software, slowly; the checks read DRL's text (its GL
// console's cells), not the picture.
test.describe('DRL, Tiles display', () => {
  test('choose Tiles, a new game, the inventory, Save & Quit, reload and continue, back to Text', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await openDrl(page);
    await chooseDisplay(page, 'tiles');
    const canvas = page.locator('canvas.drl-canvas');
    await canvas.focus();
    const press = (key: string) => page.keyboard.press(key);
    await newGame(page, 'Sprites', press);

    const state = await drl(page);
    expect(state?.inGame).toBe(true);
    expect(state?.state?.name).toBe('Sprites');
    expect(state?.state?.health).toBe(100);
    expect(state?.views).toEqual(['tiles']);
    // DRL's window is the game's area, in canvas pixels; the canvas has a picture.
    const size = await page.evaluate(() =>
      (
        window as unknown as {
          __rogueArchive: { adapter: { debug: { tilesWindow(): { width: number; height: number } } } };
        }
      ).__rogueArchive.adapter.debug.tilesWindow(),
    );
    expect(size.width).toBeGreaterThanOrEqual(800);
    expect((await canvas.screenshot()).length).toBeGreaterThan(5000);

    // Walk (some directions are walls), DRL's inventory, back to the map.
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await press(key);
      await page.waitForTimeout(300);
    }
    await settle(page, press);
    await press('i');
    await waitForText(page, /Inventory/);
    await waitForContext(page, 'menu');
    await press('Escape');
    await settle(page, press);

    // DRL's game menu: Save & Quit (its last entry) ends at the main menu.
    await press('Escape');
    await waitForText(page, /Save & Quit/);
    // The menu fades in, ignoring keys meanwhile: Up until Save & Quit is highlighted.
    const selected = () =>
      page.evaluate(() =>
        (
          window as unknown as { __rogueArchive: { adapter: { debug: { selectedEntry(): string | null } } } }
        ).__rogueArchive.adapter.debug.selectedEntry(),
      );
    await expect
      .poll(
        async () => {
          if ((await selected()) !== 'Save & Quit') await press('ArrowUp');
          return selected();
        },
        { intervals: [1000] },
      )
      .toBe('Save & Quit');
    await press('Enter');
    await waitForText(page, /Continue game/, 60_000);
    await expect.poll(async () => (await drl(page))?.hasSave, { timeout: 15_000 }).toBe(true);

    // The save survives a reload, and DRL continues it in Tiles.
    await page.reload();
    await waitForText(page, /Press <Enter> to continue|Continue game/, 120_000);
    await page.locator('canvas.drl-canvas').focus();
    for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
      await press('Enter');
      await page.waitForTimeout(800);
    }
    await waitForText(page, /Continue game/);
    await press('Enter');
    for (let i = 0; i < 8 && (await drl(page))?.context !== 'map'; i++) {
      await page.waitForTimeout(1000);
      if ((await drl(page))?.context !== 'map') await press('Escape');
    }
    await waitForContext(page, 'map');
    expect((await drl(page))?.state?.name).toBe('Sprites');

    // Back to Text: the console screen again, with the same DRL folder.
    await chooseDisplay(page, 'text');
    expect((await drl(page))?.views).not.toEqual(['tiles']);
  });
});

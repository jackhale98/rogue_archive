import { expect, test } from '@playwright/test';
import { drl, newGame, openDrl, screenText, settle, waitForContext, waitForText } from './drl-helpers.ts';

test.describe('DRL', () => {
  test('a new game, the map and screens, Save & Quit, reload and continue, export', async ({ page }) => {
    test.setTimeout(240_000);
    await openDrl(page);
    const canvas = page.locator('canvas.drl-canvas');
    await canvas.focus();
    const press = (key: string) => page.keyboard.press(key);
    await newGame(page, 'Tester', press);

    const state = await drl(page);
    expect(state?.inGame).toBe(true);
    expect(state?.state?.name).toBe('Tester');
    expect(state?.state?.health).toBe(100);
    expect(state?.text).toMatch(/Health:/);
    expect(state?.text).toContain('@');
    // The canvas has the screen on it (not blank).
    const shot = await canvas.screenshot();
    expect(shot.length).toBeGreaterThan(5000);

    // Walk a little (some directions are walls), then DRL's screens.
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await press(key);
      await page.waitForTimeout(150);
    }
    await settle(page, press);
    await press('i');
    await waitForText(page, /Inventory/);
    await waitForContext(page, 'menu');
    await press('Escape');
    await settle(page, press);
    await press('l');
    await waitForText(page, /LOOK MODE/);
    await waitForContext(page, 'look');
    await press('Escape');
    await settle(page, press);

    // DRL's game menu: Save & Quit (its last entry) ends at the main menu.
    await press('Escape');
    await waitForText(page, /Save & Quit/);
    await press('ArrowUp');
    await press('Enter');
    await waitForText(page, /Continue game/, 30_000);
    await expect.poll(async () => (await drl(page))?.hasSave, { timeout: 15_000 }).toBe(true);

    // The save survives a reload (IndexedDB), and DRL continues it.
    await page.reload();
    await waitForText(page, /Press <Enter> to continue|Continue game/, 120_000);
    await page.locator('canvas.drl-canvas').focus();
    // DRL's first-run welcome is not shown again (drl.prc was kept), but its credits are.
    expect(await screenText(page)).not.toMatch(/running DRL for the first time/);
    for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
      await press('Enter');
      await page.waitForTimeout(500);
    }
    await waitForText(page, /Continue game/);
    await press('Enter');
    for (let i = 0; i < 6 && (await drl(page))?.context !== 'map'; i++) {
      await page.waitForTimeout(700);
      if ((await drl(page))?.context !== 'map') await press('Escape');
    }
    await waitForContext(page, 'map');
    expect((await drl(page))?.state?.name).toBe('Tester');

    // The DRL folder for desktop DRL: the first-run marker and settings; the save is
    // removed when continued, as in DRL.
    const files = await page.evaluate(async () => {
      const adapter = (
        window as unknown as {
          __rogueArchive: { adapter: { exportSaves(): Promise<{ path: string; bytes: Uint8Array }[]> } };
        }
      ).__rogueArchive.adapter;
      return (await adapter.exportSaves()).map((file) => file.path);
    });
    expect(files).toContain('drl.prc');
    expect(files).not.toContain('runtime.log');
  });
});

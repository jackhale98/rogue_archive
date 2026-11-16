import { expect, test } from '@playwright/test';
import {
  cddaDebug,
  openCataclysm,
  playNow,
  press,
  waitForContext,
  waitForInputContext,
} from './cataclysm-dda-helpers.ts';

// Loading the game data and generating a world take minutes in headless Chromium.
test.describe.configure({ timeout: 900_000 });

test('Cataclysm: DDA: new character, move, inventory, save, reload and continue', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openCataclysm(page);
  expect((await cddaDebug(page))?.screen).toContain('New Game');

  // New Game → Play Now! (default scenario): a world and a character without questions.
  await playNow(page);
  const start = (await cddaDebug(page))!.player!;
  expect(start.name.length).toBeGreaterThan(0);

  // Walk: try each direction until one is free.
  for (const key of ['h', 'l', 'k', 'j', 'y', 'u', 'b', 'n']) {
    await press(page, key, 600);
    // Walking into someone or something can ask first ("Really…?"): decline.
    for (let i = 0; i < 3 && (await cddaDebug(page))?.context !== 'map'; i++)
      await press(page, 'Escape', 600);
    await waitForContext(page, 'map');
    const now = (await cddaDebug(page))!.player!;
    if (now.absX !== start.absX || now.absY !== start.absY) break;
  }
  const moved = (await cddaDebug(page))!.player!;
  expect(moved.absX !== start.absX || moved.absY !== start.absY).toBe(true);

  // The inventory, and back.
  await press(page, 'i');
  await waitForInputContext(page, 'INVENTORY');
  await press(page, 'Escape');
  await waitForContext(page, 'map');

  // The shell's message log reads the game's messages.
  const messages = await page.evaluate(() =>
    (
      window as unknown as { __rogueArchive: { adapter: { debug: { messages(): string[] } } } }
    ).__rogueArchive.adapter.debug.messages(),
  );
  expect(messages.length).toBeGreaterThan(0);

  // Save and quit (S, then yes): back to the main menu.
  await press(page, 'S');
  await waitForInputContext(page, 'YESNO');
  // The game's FORCE_CAPITAL_YN (on by default): only a capital Y answers yes.
  await press(page, 'Y');
  await waitForContext(page, 'title', 180_000);

  // A fresh page reads the world from IndexedDB: Load → the world → the character.
  await page.reload();
  await openCataclysm(page);
  await press(page, 'a');
  await expect
    .poll(
      async () => {
        const d = await cddaDebug(page);
        if (d?.context === 'map') return 'map';
        // The world, then the character: each a list choice.
        if (d?.waiting) await page.keyboard.press('Enter');
        return d?.inputContext ?? null;
      },
      { timeout: 300_000, intervals: [3_000], message: 'waiting for the saved game' },
    )
    .toBe('map');
  const resumed = (await cddaDebug(page))!.player!;
  expect(resumed.name).toBe(moved.name);
  expect([resumed.absX, resumed.absY, resumed.absZ]).toEqual([moved.absX, moved.absY, moved.absZ]);
  expect(errors).toEqual([]);
});

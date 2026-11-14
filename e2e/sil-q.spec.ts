import { expect, test } from '@playwright/test';
import { openSil, screenText, silContext, waitForContext } from './sil-q-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('Sil-Q: new character, prompts, message log, save and continue after reload', async ({ page }) => {
  await openSil(page);
  await page.locator('canvas').first().click();
  // New character: accept Sil's defaults at each step of creation.
  await page.keyboard.press('b');
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  await waitForContext(page, 'map');
  await expect.poll(() => screenText(page)).toContain('50 ft');

  // An item prompt, and its list.
  await page.keyboard.press('d');
  await waitForContext(page, 'item');
  await page.keyboard.press('*');
  await expect.poll(() => screenText(page)).toContain('Wooden Torch');
  await page.keyboard.press('Escape');
  await waitForContext(page, 'map');

  // Walking into walls leaves messages in the shell's log.
  for (const key of [
    'ArrowUp',
    'ArrowUp',
    'ArrowUp',
    'ArrowUp',
    'ArrowUp',
    'ArrowUp',
    'ArrowUp',
    'ArrowUp',
  ]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    if ((await silContext(page)) !== 'map') await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Message log' }).click();
  const log = page.getByRole('dialog', { name: 'Messages' });
  // Walking into the dungeon's edges: a wall, a secret door found, or a locked door.
  await expect(log).toContainText(/wall in the way|You have found|the lock|door/);
  await log.getByRole('button', { name: 'Back to game' }).click();

  // Save and quit (Ctrl+X): back at Sil's title menu after the scores.
  await page.locator('canvas').first().click();
  await page.keyboard.press('Control+x');
  // Acknowledge "-more-" and the scores ("press any key") only while they show:
  // at the title menu, Space would choose the highlighted Tutorial.
  for (let i = 0; i < 20; i++) {
    const text = await screenText(page);
    if (text.includes('b) New character')) break;
    if (/-more-|press any key/.test(text)) await page.keyboard.press(' ');
    await page.waitForTimeout(400);
  }
  await expect.poll(() => screenText(page)).toContain('c) Open saved character');

  // Saves are in IndexedDB: still there after a reload.
  await page.reload();
  await openSil(page);
  await page.locator('canvas').first().click();
  await page.keyboard.press('c');
  await waitForContext(page, 'load');
  await page.keyboard.type('nameless');
  await page.keyboard.press('Enter');
  await waitForContext(page, 'map', 30_000);
  await expect.poll(() => screenText(page)).toContain('nameless');
});

test('Sil-Q: tiles by MicroChasm, chosen before the game starts', async ({ page }) => {
  await page.goto('?debug=1#/games/sil-q');
  await page.getByLabel('Display').selectOption('tiles');
  await openSil(page);
  await page.locator('canvas').first().click();
  await page.keyboard.press('b');
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  await waitForContext(page, 'map');
  // The game draws with tiles; the map is in square cells between the text sidebar and lines.
  const shown = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __rogueArchive: { adapter: { debug: { state: { graphics: boolean }; views(): string[] } } };
      }
    ).__rogueArchive.adapter.debug;
    return { graphics: d.state.graphics, views: d.views() };
  });
  console.log(
    'DBG',
    await page.evaluate(() => {
      const d = (
        window as unknown as { __rogueArchive: { adapter: { debug: { rowText(y: number): string } } } }
      ).__rogueArchive.adapter.debug;
      return [5, 10, 12].map((y) => [...d.rowText(y)].map((c) => c.charCodeAt(0).toString(16)).join(' '));
    }),
  );
  await page.screenshot({ path: test.info().outputPath('sil-tiles.png') });
  expect(shown).toEqual({ graphics: true, views: ['top', 'side', 'map', 'bottom'] });
  await expect.poll(() => screenText(page)).toContain('50 ft');
  await page.screenshot({ path: test.info().outputPath('sil-tiles.png') });
});

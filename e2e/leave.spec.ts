import { expect, test, type Page } from '@playwright/test';
import { startCharacter as startDcss, waitForContext as waitDcss, dcssContext } from './dcss-helpers.ts';
import { gameContext, openBrogue, screenText, waitForScreenText, waitInGame } from './helpers.ts';
import { openHyperRogue, waitForContext as waitHyper } from './hyperrogue-helpers.ts';
import { startRogue } from './rogue-helpers.ts';
import { nethack, startNetHack, toMap, waitForContext as waitNetHack } from './nethack-helpers.ts';
import { openSil, screenText as silScreen, silContext, waitForContext as waitSil } from './sil-q-helpers.ts';

test.describe.configure({ timeout: 300_000 });

/** A new NetHack character (NetHack picks it), as far as the map. */
async function startNetHackGame(page: Page, name: string) {
  await startNetHack(page, name);
  await waitNetHack(page, 'yn');
  await page.keyboard.press('y');
  // NetHack shows its pick and asks "Is this ok?".
  await expect.poll(async () => (await nethack(page))?.menu?.title ?? '').toMatch(/Is this ok/);
  await page.keyboard.press('y');
  await toMap(
    page,
    () => page.keyboard.press(' '),
    () => page.keyboard.press('n'),
  );
}

/** Back to the library: with a game in progress, the shell asks how to leave first. */
async function leaveDialog(page: Page) {
  await page.getByRole('link', { name: 'Back to library' }).click();
  const dialog = page.getByRole('dialog', { name: /^Leave / });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Leaving asks first: Keep playing stays, Save and leave saves (Rogue)', async ({ page }) => {
  await startRogue(page, 'Leaver');
  const dialog = await leaveDialog(page);
  await expect(dialog).toContainText('keeps no save while you play');
  await expect(dialog.getByRole('button', { name: 'Leave without saving' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep playing' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/play\/rogue/);

  await (await leaveDialog(page)).getByRole('button', { name: 'Save and leave' }).click();
  await expect(page).toHaveURL(/#\/games\/rogue$/, { timeout: 30_000 });
  await page.goto('#/play/rogue');
  await expect(page.locator('.ra-start').getByRole('button', { name: /Continue Leaver/ })).toBeVisible({
    timeout: 60_000,
  });
  // At the start screen nothing is in progress: leaving needs no question.
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page).toHaveURL(/#\/games\/rogue$/);
});

test('Save and leave (Brogue): a named save on the title screen', async ({ page }) => {
  await openBrogue(page);
  await page.keyboard.press('n');
  await waitInGame(page);
  await expect.poll(() => gameContext(page)).toBe('map');
  const dialog = await leaveDialog(page);
  await expect(dialog.getByRole('button', { name: 'Leave (kept as LastGame)' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save and leave' }).click();
  await expect(page).toHaveURL(/#\/games\/brogue-ce$/, { timeout: 30_000 });
  // The named save is listed on the title screen.
  // (Reloaded, as the save test does: the title menu then takes keys at once.)
  await openBrogue(page);
  await page.reload();
  await waitForScreenText(page, 'New Game');
  await page.keyboard.press('p');
  await page.keyboard.press('l');
  await waitForScreenText(page, 'Open saved game:');
  expect(await screenText(page)).toContain('Saved CE 1.15.1');
});

test('Save and leave (DCSS): the character continues from the start screen', async ({ page }) => {
  await startDcss(page, 'Leaver');
  const frame = page.frameLocator('iframe.dcss-client');
  for (let i = 0; i < 4 && (await dcssContext(page)) === 'start'; i++) {
    await frame.locator('.ui-popup .newgame-choice .button').first().click();
    await page.waitForTimeout(1000);
  }
  await waitDcss(page, 'map');
  await (await leaveDialog(page)).getByRole('button', { name: 'Save and leave' }).click();
  await expect(page).toHaveURL(/#\/games\/dcss$/, { timeout: 60_000 });
  await page.goto('?debug=1#/play/dcss');
  await expect(page.locator('.dcss-launcher').getByRole('button', { name: /Continue Leaver/ })).toBeVisible({
    timeout: 120_000,
  });
});

test('Save and leave (Sil-Q): "Saving game... done." before leaving', async ({ page }) => {
  await openSil(page);
  await page.locator('canvas').first().click();
  await page.keyboard.press('b');
  for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  await waitSil(page, 'map');
  const dialog = await leaveDialog(page);
  await expect(dialog).toContainText('saves when you take the stairs');
  await dialog.getByRole('button', { name: 'Save and leave' }).click();
  await expect(page).toHaveURL(/#\/games\/sil-q$/, { timeout: 30_000 });
  // The saved character opens from Sil's title menu.
  await openSil(page);
  await expect.poll(() => silScreen(page)).toContain('c) Open saved character');
});

test('Leaving HyperRogue says the game ends (no Orb of Safety)', async ({ page }) => {
  await openHyperRogue(page);
  await waitHyper(page, 'map');
  const dialog = await leaveDialog(page);
  await expect(dialog).toContainText('leaving ends this game');
  await dialog.getByRole('button', { name: 'End this game and leave' }).click();
  await expect(page).toHaveURL(/#\/games\/hyperrogue$/, { timeout: 30_000 });
});

test('Save and leave (NetHack): S, y, then the character continues', async ({ page }) => {
  await startNetHackGame(page, 'Leaver');
  const dialog = await leaveDialog(page);
  await expect(dialog).toContainText('keeps no save while you play');
  await dialog.getByRole('button', { name: 'Save and leave' }).click();
  await expect(page).toHaveURL(/#\/games\/nethack$/, { timeout: 30_000 });
  await page.goto('?debug=1#/play/nethack');
  await expect(page.locator('.ra-start').getByRole('button', { name: /Continue Leaver/ })).toBeVisible({
    timeout: 120_000,
  });
});

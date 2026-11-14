import { expect, test, type Page } from '@playwright/test';
import {
  rogueContext,
  screenText,
  settle as settleMap,
  skipIfKilled,
  startRogue,
  waitForContext,
} from './rogue-helpers.ts';

test.describe.configure({ timeout: 180_000 });
// A tap that cannot happen fails at that step instead of at the test timeout.
test.use({ actionTimeout: 15_000 });

test('Rogue phone: status band, thumb pad, dock, inventory sheet and direction prompt', async ({ page }) => {
  await startRogue(page, 'Thumbs');
  await expect(page.locator('.rogue-band')).toContainText('Hp:');
  const dock = page.getByRole('group', { name: 'Actions' });
  // The hero can start on the stairs or an item: then the dock leads with them.
  for (const name of [/^(Search|Pick up)/, /^(Fight|Throw)/, /^Pack/, /^(Stairs|Down >)/, /^Look/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // The pad moves the hero. The dungeon is random: a monster can interrupt
  // with --More-- (Continue), and a trap or item can leave a question or a
  // list on screen; settle() gets back to the map before each step.
  const pad = page.getByRole('group', { name: 'Movement' });
  const settle = async () => {
    // The map must be seen twice in a row: the context lags a tap by a moment.
    let maps = 0;
    for (let i = 0; i < 40 && maps < 2; i++) {
      await page.waitForTimeout(150);
      const context = await rogueContext(page);
      if (context === 'map') {
        maps++;
        continue;
      }
      maps = 0;
      await skipIfKilled(page, context);
      if (context === 'more') await dock.getByRole('button', { name: /Continue/ }).tap();
      else if (context !== 'busy') await page.keyboard.press('Escape');
    }
    await waitForContext(page, 'map', 5_000);
  };
  for (const name of [/Move left/, /Move right/, /Move up \(/, /Move down \(/]) {
    await settle();
    await pad.getByRole('button', { name }).tap();
  }
  await settle();
  await expect.poll(() => screenText(page)).toContain('Level: 1');

  // Pack: the inventory as a sheet (read only: Rogue's lists take no letters), closed from the dock.
  await settle();
  await dock.getByRole('button', { name: /^Pack/ }).tap();
  await waitForContext(page, 'menu');
  await expect.poll(() => screenText(page)).toContain('food');
  await expect(dock.getByRole('button', { name: /food/ })).toHaveCount(0);
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await waitForContext(page, 'map');

  // An item prompt answered by taps alone: Eat, Show items, then the food.
  await settle();
  await page.keyboard.press('e');
  await waitForContext(page, 'item');
  await dock.getByRole('button', { name: /^Show items/ }).tap();
  await dock.getByRole('button', { name: /food/ }).first().tap();
  await expect.poll(() => screenText(page)).not.toContain('(* for list)');
  await settle();

  // Fight asks for a direction: the pad answers it, Cancel backs out. (With a
  // monster next to the hero the button fights it at once, "Fight ↖K"; plain
  // Fight is then in its fan.)
  await settle();
  const fight = dock.getByRole('button', { name: /^(Fight|Throw)/ });
  await expect(fight).toBeVisible();
  await page.waitForTimeout(300);
  const fightLabel = (await fight.getAttribute('aria-label'))!;
  if (fightLabel === 'Fight (f)') await fight.tap();
  else await fanChoose(page, fightLabel, /^Fight\s*f$/);
  await waitForContext(page, 'direction');
  await expect(pad).toBeVisible();
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // Display (Menu): the map is drawn with each tile style, and back to text.
  await settle();
  const tileStyle = () =>
    page.evaluate(
      () =>
        (window as unknown as { __rogueArchive: { adapter: { debug: { tileStyle: string | null } } } })
          .__rogueArchive.adapter.debug.tileStyle,
    );
  // --More-- continues by itself unless the original wait is chosen.
  await page.getByRole('button', { name: 'Menu' }).tap();
  await expect(page.getByLabel('--More-- prompts')).toHaveValue('auto');
  await page.keyboard.press('Escape');
  for (const style of ['tiles', 'one-bit', 'text']) {
    await page.getByRole('button', { name: 'Menu' }).tap();
    await page.getByLabel('Display').selectOption(style);
    await page.keyboard.press('Escape');
    await expect.poll(tileStyle).toBe(style === 'text' ? null : style);
  }
});

/** Long-presses a dock button, slides onto a fan option and releases there. */
async function fanChoose(page: Page, button: string, option: RegExp): Promise<void> {
  const selector = `.dock-button[aria-label="${button}"]`;
  const box = (await page.locator(selector).boundingBox())!;
  const pointer = { pointerId: 9, pointerType: 'touch', isPrimary: true };
  await page.dispatchEvent(selector, 'pointerdown', {
    ...pointer,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    button: 0,
    buttons: 1,
  });
  const item = page.getByRole('menuitem', { name: option });
  await expect(item).toBeVisible();
  const target = (await item.boundingBox())!;
  const at = { clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 };
  await page.dispatchEvent(selector, 'pointermove', { ...pointer, ...at, buttons: 1 });
  await page.dispatchEvent(selector, 'pointerup', { ...pointer, ...at, button: 0 });
  await expect(item).toBeHidden();
}

interface LeadsDebug {
  run: string | false;
  leads: { adjacent: { key: string }[] } | null;
  rowText(y: number): string;
}

test('Rogue phone: counts and the careful run in the Search fan, one-gesture fight, item lists at once', async ({
  page,
}) => {
  await startRogue(page, 'Leads');
  const dock = page.getByRole('group', { name: 'Actions' });
  const pad = page.getByRole('group', { name: 'Movement' });
  const settle = () => settleMap(page);
  const read = () =>
    page.evaluate(() => {
      const d = (window as unknown as { __rogueArchive: { adapter: { debug: LeadsDebug } } }).__rogueArchive
        .adapter.debug;
      return { run: d.run, adjacent: d.leads?.adjacent.map((foe) => foe.key) ?? [], top: d.rowText(0) };
    });

  // The first button is Search, or Pick up when the hero stands on an item
  // (the hero can start on one); both fan out the same actions.
  const first = async () => (await dock.locator('.dock-button').first().getAttribute('aria-label'))!;

  // Search ×10 (10s) from the fan: Rogue takes the count.
  await settle();
  await fanChoose(page, await first(), /Search 10 turns/);
  await settle();
  expect((await read()).top).not.toMatch(/illegal command/);

  // The careful run (Ctrl+direction) latches; any other action lets go of it.
  await fanChoose(page, await first(), /Run, stopping beside anything/);
  await expect(dock.getByRole('button', { name: /^Run ⌃/ })).toHaveAttribute('aria-pressed', 'true');
  expect((await read()).run).toBe('run-ctrl');
  await dock.getByRole('button', { name: /^Pack/ }).tap();
  await waitForContext(page, 'menu');
  expect((await read()).run).toBe(false);
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await settle();
  await expect(dock.getByRole('button', { name: /^(Search|Pick up)/ })).toBeVisible();
  // Latched, a move runs (a control code, which Rogue reads as a run) and lets go.
  await fanChoose(page, await first(), /Run, stopping beside anything/);
  await expect(dock.getByRole('button', { name: /^Run ⌃/ })).toBeVisible();
  await pad.getByRole('button', { name: /Move left/ }).tap();
  await expect.poll(async () => (await read()).run).toBe(false);
  await settle();
  expect((await read()).top).not.toMatch(/illegal command/);

  // Fight at a direction in one gesture (f + direction, as "Fight ↖B" sends):
  // where no monster stands Rogue answers at once, with no direction prompt.
  await settle();
  const { adjacent } = await read();
  const empty = [...'hjklyubn'].find((key) => !adjacent.includes(key))!;
  await page.evaluate((key) => {
    const adapter = (
      window as unknown as {
        __rogueArchive: { adapter: { sendInput(input: { type: 'command'; commandId: string }): void } };
      }
    ).__rogueArchive.adapter;
    adapter.sendInput({ type: 'command', commandId: `fight-at:${key}` });
  }, empty);
  await expect.poll(async () => (await read()).top).toMatch(/no monster there/);

  // An item command from the dock shows the list at once; a tap on an item answers.
  await settle();
  await page.waitForTimeout(300);
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: /^Eat/ }).tap();
  await expect(dock.getByRole('button', { name: /food/ }).first()).toBeVisible();
  expect(await rogueContext(page)).toBe('menu');
  await dock.getByRole('button', { name: /food/ }).first().tap();
  await expect.poll(() => screenText(page)).not.toContain('(* for list)');
  await settle();

  // Throw asks for a direction first (the pad), then shows its list at once.
  await page.waitForTimeout(300);
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: /^Throw/ }).tap();
  await waitForContext(page, 'direction');
  await pad.getByRole('button', { name: /Move left/ }).tap();
  await expect(dock.getByRole('button', { name: /arrows/ })).toBeVisible();
  // Closing the list goes back to the question (no second list), and Cancel leaves it.
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await waitForContext(page, 'item');
  await expect(dock.getByRole('button', { name: /^Show items/ })).toBeVisible();
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');
});

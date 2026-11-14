import { expect, test, type Page } from '@playwright/test';
import { settle, startRogue, waitForContext } from './rogue-helpers.ts';

test.describe.configure({ timeout: 120_000 });

interface ItemsDebug {
  rowText(y: number): string;
  cellToClient(x: number, y: number): { x: number; y: number } | null;
  picked: { letter: string; text: string } | null;
}

/** Where on screen an inventory line ("a) Some food") is, and its letter. */
async function findLine(page: Page, pattern: string) {
  return page.evaluate((source) => {
    const d = (window as unknown as { __rogueArchive: { adapter: { debug: ItemsDebug } } }).__rogueArchive
      .adapter.debug;
    for (let y = 0; y < 24; y++) {
      const row = d.rowText(y);
      const match = new RegExp(`([a-z])\\) [^)]*${source}`).exec(row);
      if (match) return { letter: match[1]!, at: d.cellToClient(match.index + 1, y)!, row };
    }
    return null;
  }, pattern);
}

async function openPackAndTap(page: Page, pattern: string) {
  const dock = page.getByRole('group', { name: 'Actions' });
  await dock.getByRole('button', { name: /^Pack/ }).tap();
  await waitForContext(page, 'menu');
  await expect.poll(() => findLine(page, pattern).then((line) => line !== null)).toBe(true);
  const line = (await findLine(page, pattern))!;
  await page.touchscreen.tap(line.at.x, line.at.y);
  return line;
}

test("Rogue phone: a tapped inventory item offers its actions, which answer the game's item prompt", async ({
  page,
}) => {
  await startRogue(page, 'Pockets');
  const dock = page.getByRole('group', { name: 'Actions' });
  const pad = page.getByRole('group', { name: 'Movement' });
  await settle(page);

  // Arrows: Wield, Throw, Drop. Throw asks for a direction, then the item
  // prompt is answered with the arrows' letter (never shown).
  const arrows = await openPackAndTap(page, 'arrows');
  const count = Number(/(\d+) \+/.exec(arrows.row)?.[1] ?? 0);
  expect(count).toBeGreaterThan(1);
  await expect(dock.getByRole('button', { name: `Wield ${arrows.letter})` })).toBeVisible();
  await dock.getByRole('button', { name: `Throw ${arrows.letter})` }).tap();
  await waitForContext(page, 'direction');
  await pad
    .getByRole('button', { name: /Move up/ })
    .first()
    .tap();
  // (Rogue leaves an answered prompt on the message line: the pack tells.)
  await settle(page);
  await openPackAndTap(page, 'arrows');
  await expect.poll(async () => (await findLine(page, 'arrows'))?.row ?? '').toContain(`${count - 1} +`);
  // Close leaves the list.
  await dock.getByRole('button', { name: /^Close/ }).tap();
  await settle(page);

  // Food: Eat leads, and eating needs no further taps.
  const food = await openPackAndTap(page, 'food');
  const eat = dock.getByRole('button', { name: `Eat ${food.letter})` });
  await expect(eat).toBeVisible();
  await expect(eat).toHaveClass(/dock-button--primary/);
  await eat.tap();
  // (A monster's message can replace Rogue's comment on the food: the food
  // is gone from the pack either way.)
  await settle(page);
  await openPackAndTap(page, '');
  await expect.poll(async () => (await findLine(page, 'food'))?.letter ?? null).toBeNull();
});

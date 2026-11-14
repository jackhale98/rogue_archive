import { expect, test } from '@playwright/test';
import { lineAt, nethack, startNetHack, toMap, waitForContext } from './nethack-helpers.ts';

test.describe.configure({ timeout: 240_000 });

test('NetHack phone: creation by taps, the status band, menus as sheets, the dock, travel by tap, tiles', async ({
  page,
}) => {
  await startNetHack(page, 'Thumbs');
  await waitForContext(page, 'yn');
  const dock = page.getByRole('group', { name: 'Actions' });
  // The question's answers are buttons.
  for (const name of ['Yes', 'No', 'Quit']) await expect(dock.getByRole('button', { name })).toBeVisible();
  await dock.getByRole('button', { name: 'No' }).tap();
  await waitForContext(page, 'menu');
  // Menus are a large sheet whose lines can be tapped.
  expect((await nethack(page))?.views).toEqual(['sheet']);
  const tapLine = async (pattern: RegExp) => {
    await expect.poll(() => lineAt(page, pattern).then((at) => at !== null)).toBe(true);
    const at = (await lineAt(page, pattern))!;
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(300);
  };
  await tapLine(/a Valkyrie/);
  await tapLine(/dwarf/);
  await tapLine(/Yes; start game/);
  await toMap(
    page,
    () => page.touchscreen.tap(200, 400),
    () => tapLine(/No, just start play/),
  );

  // The status band shows NetHack's status lines; the map follows the hero.
  await expect(page.locator('.nethack-band')).toContainText(/Dlvl:1 .*HP:\d+\(\d+\)/);
  await expect(page.locator('.nethack-band')).toContainText('Thumbs the Stripling');
  expect((await nethack(page))?.views).toEqual(['map']);
  // The dock: exploring, or fighting when a hostile monster is next to the hero or lined up.
  const start = (await nethack(page))!.state!;
  const calm = start.adjacent.length === 0 && !start.target;
  for (const name of calm
    ? [/^Search/, /^Travel/, /^Pack/, /^Look/, /^More/]
    : [/^Quaff/, /^Elbereth/, /^More/])
    await expect(dock.getByRole('button', { name })).toBeVisible();

  // Pack opens the inventory as a sheet over the map.
  if (calm) await dock.getByRole('button', { name: /^Pack/ }).tap();
  else await page.keyboard.press('i');
  await waitForContext(page, 'menu');
  expect((await nethack(page))?.views).toEqual(['map', 'sheet']);
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // A tap on the map travels there (two cells to the right).
  const before = (await nethack(page))!.state!;
  const target = await page.evaluate(
    (s) =>
      (
        window as unknown as {
          __rogueArchive: {
            adapter: { debug: { cellToClient(x: number, y: number): { x: number; y: number } } };
          };
        }
      ).__rogueArchive.adapter.debug.cellToClient(s.x - 1 + 2, s.y + 1),
    before,
  );
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(async () => (await nethack(page))?.state?.moves).toBeGreaterThan(before.moves);

  // Tiles on a phone.
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByLabel('Display').selectOption('tiles');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await nethack(page))?.tiled, { timeout: 30_000 }).toBe(true);
});

test('NetHack phone: the game’s own context menus, item lists at once, travel by position, Elbereth', async ({
  page,
}) => {
  await startNetHack(page, 'Context');
  await waitForContext(page, 'yn');
  const dock = page.getByRole('group', { name: 'Actions' });
  await dock.getByRole('button', { name: 'No' }).tap();
  const tapLine = async (pattern: RegExp) => {
    await expect.poll(() => lineAt(page, pattern).then((at) => at !== null)).toBe(true);
    const at = (await lineAt(page, pattern))!;
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(300);
  };
  await tapLine(/a Valkyrie/);
  await tapLine(/dwarf/);
  await tapLine(/Yes; start game/);
  await toMap(
    page,
    () => page.touchscreen.tap(200, 400),
    () => tapLine(/No, just start play/),
  );
  const cellOf = (dx: number, dy: number) =>
    page.evaluate(
      ([x, y]) => {
        const d = (
          window as unknown as {
            __rogueArchive: {
              adapter: {
                debug: {
                  state: { x: number; y: number };
                  cellToClient(x: number, y: number): { x: number; y: number };
                };
              };
            };
          }
        ).__rogueArchive.adapter.debug;
        return d.cellToClient(d.state.x - 1 + x!, d.state.y + 1 + y!);
      },
      [dx, dy],
    );

  // The hero starts on the up staircase: the dock leads with it.
  // (A hostile monster in view turns the dock to fighting; the command list has the rest.)
  const start = (await nethack(page))!.state!;
  if (start.adjacent.length === 0 && !start.target)
    await expect(dock.getByRole('button', { name: /^Up </ })).toBeVisible();
  const travel = async () => {
    const button = dock.getByRole('button', { name: /^Travel/ });
    if (await button.isVisible()) await button.tap();
    else {
      await page.getByRole('button', { name: 'More', exact: true }).tap();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Travel to a place/ })
        .tap();
    }
  };

  // Tapping the hero: NetHack's own menu of what can be done here.
  const hero = await cellOf(0, 0);
  await page.touchscreen.tap(hero.x, hero.y);
  await waitForContext(page, 'menu');
  expect((await nethack(page))?.menu?.title).toMatch(/What do you want to do/);
  expect((await nethack(page))?.menu?.items.some((item) => /Go up the stairs/.test(item.text))).toBe(true);
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  /** A floor square ('.') two to five squares from the hero, in client coordinates. */
  const floorAway = () =>
    page.evaluate(() => {
      const d = (
        window as unknown as {
          __rogueArchive: {
            adapter: {
              debug: {
                state: { x: number; y: number };
                rowText(y: number): string;
                cellToClient(x: number, y: number): { x: number; y: number };
              };
            };
          };
        }
      ).__rogueArchive.adapter.debug;
      const hx = d.state.x - 1;
      const hy = d.state.y + 1;
      for (let r = 2; r < 6; r++)
        for (let y = hy - r; y <= hy + r; y++)
          for (let x = hx - r; x <= hx + r; x++)
            if (
              Math.max(Math.abs(x - hx), Math.abs(y - hy)) === r &&
              y > 0 &&
              y < 22 &&
              d.rowText(y)[x] === '.'
            )
              return d.cellToClient(x, y);
      return null;
    });

  const cdp = await page.context().newCDPSession(page);
  const longPress = async (point: { x: number; y: number }) => {
    const touch = { x: Math.round(point.x), y: Math.round(point.y) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** NetHack 5.0's tip, shown the first time a place is chosen (its `tips` option): closed. */
  const closeTip = async () => {
    const now = await nethack(page);
    if (now?.context === 'menu' && /Tip:/.test(now.menu?.items[0]?.text ?? ''))
      await dock.getByRole('button', { name: /^Close/ }).tap();
  };

  // A long press next to the hero: NetHack's own menu of what can be done there (#therecmdmenu),
  // here on a wall ("Search for secret doors").
  const wall = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __rogueArchive: {
          adapter: {
            debug: {
              state: { x: number; y: number };
              rowText(y: number): string;
              cellToClient(x: number, y: number): { x: number; y: number };
            };
          };
        };
      }
    ).__rogueArchive.adapter.debug;
    const hx = d.state.x - 1;
    const hy = d.state.y + 1;
    for (let y = hy - 1; y <= hy + 1; y++)
      for (let x = hx - 1; x <= hx + 1; x++)
        if (/[|-]/.test(d.rowText(y)[x] ?? '')) return d.cellToClient(x, y);
    return null;
  });
  if (wall) {
    await longPress(wall);
    await waitForContext(page, 'menu');
    expect((await nethack(page))?.menu?.title).toMatch(/What do you want to do/);
    expect((await nethack(page))?.menu?.items.some((item) => /Search for secret doors/.test(item.text))).toBe(
      true,
    );
    await dock.getByRole('button', { name: /^Cancel/ }).tap();
    await waitForContext(page, 'map');
  }

  // A long press farther away: what is there (NetHack's farlook), without a turn passing.
  const there = (await floorAway())!;
  expect(there).not.toBeNull();
  const unmoved = (await nethack(page))!.state!.moves;
  await longPress(there);
  await expect.poll(async () => (await nethack(page))?.context).toMatch(/^(menu|position|map)$/);
  await closeTip();
  await expect(page.locator('.nethack-band')).toContainText(/floor of a room|doorway|corridor/, {
    timeout: 15_000,
  });
  await waitForContext(page, 'map');
  expect((await nethack(page))?.state?.moves).toBe(unmoved);

  // A command that asks for an item shows the suitable items at once.
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await page.getByRole('dialog').getByRole('button', { name: /^Eat/ }).tap();
  // A Valkyrie has one food ration: the game names it on the message line, and it is a button.
  await waitForContext(page, 'item');
  await expect(dock.getByRole('button', { name: /food ration/ })).toBeVisible();
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');

  // Travel: choosing the place by tapping it.
  const before = (await nethack(page))!.state!;
  await travel();
  await expect.poll(async () => (await nethack(page))?.context).toMatch(/^(menu|position)$/);
  await closeTip();
  await waitForContext(page, 'position');
  await expect(dock.getByRole('button', { name: /^Select/ })).toBeVisible();
  // Cancel leaves the map as it was …
  await dock.getByRole('button', { name: /^Cancel/ }).tap();
  await waitForContext(page, 'map');
  expect((await nethack(page))?.state?.moves).toBe(before.moves);
  // … and a tap on a floor square chooses it: the hero travels there.
  await travel();
  await waitForContext(page, 'position');
  const floor = await floorAway();
  expect(floor).not.toBeNull();
  await page.touchscreen.tap(floor!.x, floor!.y);
  await expect.poll(async () => (await nethack(page))?.state?.moves).toBeGreaterThan(before.moves);
  await waitForContext(page, 'map');

  // Elbereth, from the command list: the game's prompts answered, the engraving made.
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Engrave Elbereth/ })
    .tap();
  await expect
    .poll(async () => (await nethack(page))?.state?.moves, { timeout: 15_000 })
    .toBeGreaterThan(before.moves);
  await waitForContext(page, 'map');
  await page.keyboard.press(':');
  // What is written here, as the game reads it (the message log keeps it).
  await page.getByRole('button', { name: 'Message log' }).tap();
  await expect(page.getByRole('dialog')).toContainText(/You read: "Elbereth"/);
});

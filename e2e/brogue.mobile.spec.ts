import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  cellCenter,
  findCell,
  gameContext,
  gameViews,
  openBrogue,
  player,
  waitForScreenText,
  waitInGame,
} from './helpers.ts';

/** Screen position of the dungeon map (upstream STAT_BAR_WIDTH + 1, MESSAGE_LINES). */
const MAP_X = 21;
const MAP_Y = 3;

async function newGame(page: import('@playwright/test').Page) {
  await openBrogue(page);
  // Phones show Brogue's title menu as large buttons.
  await page.locator('.brogue-title').getByRole('button', { name: 'New game' }).tap();
  await waitInGame(page);
  await expect.poll(() => gameContext(page)).toBe('map');
}

test('phone layout: full-bleed map, status bar, thumb pad and preview-then-travel', async ({ page }) => {
  await newGame(page);
  // The phone layout draws the map on its own, with health and depth in a status bar.
  expect(await gameViews(page)).toEqual(['map']);
  await expect(page.locator('.brogue-hud')).toContainText('Depth 1');
  await expect(page.locator('.brogue-hud')).toContainText('Dungeons of Doom');
  // Nothing is being described, so no "Read" chip is offered.
  await expect(page.locator('.brogue-chip')).toBeHidden();
  const pad = page.getByRole('group', { name: 'Movement' });
  const dock = page.getByRole('group', { name: 'Actions' });
  await expect(dock.getByRole('button', { name: 'Explore (x)' })).toBeVisible();

  const moves: [string, number, number][] = [
    ['Move right (l)', 1, 0],
    ['Move left (h)', -1, 0],
    ['Move up (k)', 0, -1],
    ['Move down (j)', 0, 1],
  ];
  let delta: [number, number] | null = null;
  for (const [name, dx, dy] of moves) {
    const before = await player(page);
    await pad.getByRole('button', { name }).tap();
    try {
      await expect
        .poll(
          async () => {
            const now = await player(page);
            return now.x === before.x + dx && now.y === before.y + dy;
          },
          { timeout: 1500 },
        )
        .toBe(true);
      delta = [dx, dy];
      break;
    } catch {
      // Blocked by a wall in this direction; try the next one. A step Brogue
      // asks about first (deep water, a known trap) is declined.
      if ((await gameContext(page)) === 'yesno') {
        await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^No/ }).tap();
        await expect.poll(() => gameContext(page)).toBe('map');
      }
    }
  }
  expect(delta).not.toBeNull();

  // Tapping the map previews first; tapping the same cell again travels there.
  const here = await player(page);
  const target = { x: MAP_X + here.x - delta![0], y: MAP_Y + here.y - delta![1] };
  const point = await cellCenter(page, target);
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(600);
  expect(await player(page)).toMatchObject({ x: here.x, y: here.y });
  const again = await cellCenter(page, target);
  await page.touchscreen.tap(again.x, again.y);
  await expect
    .poll(() => player(page), { timeout: 5000 })
    .toMatchObject({
      x: here.x - delta![0],
      y: here.y - delta![1],
    });
});

test('context-aware dock: a yes/no dialog shows Yes and No, then exploring returns', async ({ page }) => {
  await newGame(page);
  await page.keyboard.press('Shift+S');
  await expect.poll(() => gameContext(page)).toBe('yesno');
  const dock = page.getByRole('group', { name: 'Actions' });
  await expect(dock.getByRole('button', { name: /^Yes/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /^No/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Movement' })).toHaveCount(0);
  await dock.getByRole('button', { name: /^No/ }).tap();
  await expect.poll(() => gameContext(page)).toBe('map');
  await expect(dock.getByRole('button', { name: 'Explore (x)' })).toBeVisible();
});

test('long-press fans out related actions; slide and release to choose', async ({ page }) => {
  await newGame(page);
  const pack = page.getByRole('button', { name: 'Pack (i)' });
  const box = (await pack.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Touch press, hold, slide onto "Apply / use", release.
  await page.dispatchEvent('.dock-button[aria-label="Pack (i)"]', 'pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: start.x,
    clientY: start.y,
    button: 0,
    buttons: 1,
  });
  const fan = page.getByRole('menu', { name: 'Pack options' });
  await expect(fan).toBeVisible();
  const apply = (await fan.getByRole('menuitem', { name: /Apply/ }).boundingBox())!;
  const target = { x: apply.x + apply.width / 2, y: apply.y + apply.height / 2 };
  await page.dispatchEvent('.dock-button[aria-label="Pack (i)"]', 'pointermove', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: target.x,
    clientY: target.y,
    buttons: 1,
  });
  await expect(fan.getByRole('menuitem', { name: /Apply/ })).toHaveClass(/fan-option--hot/);
  await page.dispatchEvent('.dock-button[aria-label="Pack (i)"]', 'pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: target.x,
    clientY: target.y,
    button: 0,
  });
  await expect(fan).toBeHidden();
  // Brogue asks what to apply, with its inventory: shown as a readable sheet.
  await expect.poll(() => gameContext(page)).toBe('menu');
  await expect.poll(() => gameViews(page)).toEqual(['map', 'sheet']);
});

test('menus open as a large sheet; tapping outside dismisses', async ({ page }) => {
  await newGame(page);
  await page.getByRole('button', { name: 'Pack (i)' }).tap();
  await waitForScreenText(page, 'more items');
  await expect.poll(() => gameViews(page)).toEqual(['map', 'sheet']);
  const canvas = (await page.locator('canvas.brogue-canvas').boundingBox())!;
  const line = (await findCell(page, 'more items'))!;
  const start = await cellCenter(page, { x: line.x, y: line.y });
  const end = await cellCenter(page, { x: line.x + 'more items.'.length, y: line.y });
  for (const point of [start, end]) {
    expect(point.x).toBeGreaterThanOrEqual(canvas.x);
    expect(point.x).toBeLessThanOrEqual(canvas.x + canvas.width);
  }
  // Text is drawn much larger than the full-screen layout would allow.
  const cellWidth = (end.x - start.x) / 'more items.'.length;
  expect(cellWidth).toBeGreaterThan(canvas.width / 100);

  // Tap the dimmed map just below the status bar (outside the sheet) to close it (sends Escape).
  const hud = (await page.locator('.brogue-hud').boundingBox())!;
  await page.touchscreen.tap(canvas.x + canvas.width / 2, hud.y + hud.height + 12);
  await expect.poll(() => gameContext(page)).toBe('map');
  await expect.poll(() => gameViews(page)).toEqual(['map']);
});

test('tapping the status bar opens the sidebar drawer', async ({ page }) => {
  await newGame(page);
  await page.locator('.brogue-hud__status').tap();
  await expect.poll(() => gameViews(page)).toEqual(['map', 'drawer']);
  const canvas = (await page.locator('canvas.brogue-canvas').boundingBox())!;
  await page.touchscreen.tap(canvas.x + canvas.width - 20, canvas.y + canvas.height / 2);
  await expect.poll(() => gameViews(page)).toEqual(['map']);
});

test('the on-screen keyboard reaches text prompts', async ({ page }) => {
  await newGame(page);
  await page.keyboard.press('Shift+S');
  await expect.poll(() => gameContext(page)).toBe('yesno');
  await page.keyboard.press('Enter');
  await waitForScreenText(page, 'Save game as');
  await page.getByRole('button', { name: 'Open keyboard' }).tap();
  const field = page.getByRole('textbox', { name: 'Type to the game' });
  await expect(field).toBeFocused();
  for (let i = 0; i < 60; i++) await field.press('Backspace');
  await field.pressSequentially('mobile');
  await waitForScreenText(page, 'mobile');
  await field.press('Enter');
  await waitForScreenText(page, 'Saved.');
});

test('tapping the messages opens the scrollable message log', async ({ page }) => {
  await newGame(page);
  await page.locator('.brogue-hud__messages').tap();
  const log = page.getByRole('dialog', { name: 'Messages' });
  await expect(log).toBeVisible();
  await expect(log).toContainText('Dungeons of Doom');
  await log.getByRole('button', { name: 'Back to game' }).tap();
  await expect(log).toBeHidden();
});

test('Shift latches for one action: Shift + tap in a menu shows item details instead of using it', async ({
  page,
}) => {
  await newGame(page);
  await page.keyboard.press('a');
  await expect.poll(() => gameContext(page)).toBe('menu');
  await waitForScreenText(page, 'shift for more info');
  const shift = page.getByRole('button', { name: /^Shift ⓘ/ });
  await shift.tap();
  await expect(shift).toHaveAttribute('aria-pressed', 'true');

  // Every new game starts with food in slot a; without Shift, tapping it would eat it.
  const food = (await findCell(page, 'Some food'))!;
  const point = await cellCenter(page, { x: food.x + 2, y: food.y });
  await page.touchscreen.tap(point.x, point.y);
  await waitForScreenText(page, 'A ration of food');
  // The food's details are shown, with its actions in the dock (Shift has released).
  await expect.poll(() => gameContext(page)).toBe('item');
  await expect(page.getByRole('button', { name: 'Apply / use (a)' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Shift ⓘ/ })).toHaveCount(0);
});

test('title screen: large buttons start, save and load a game', async ({ page }) => {
  await newGame(page);
  await expect(page.locator('.brogue-title')).toBeHidden();
  const before = await player(page);
  // Save with S: confirm, keep the suggested name, acknowledge.
  await page.keyboard.press('Shift+S');
  await waitForScreenText(page, 'Save this game');
  await page.keyboard.press('Enter');
  await waitForScreenText(page, 'Save game as');
  await page.keyboard.press('Enter');
  await waitForScreenText(page, 'Saved.');
  await page.keyboard.press(' ');

  // Back at the title, the saved games are a list of large buttons.
  const panel = page.locator('.brogue-title');
  await expect(panel.getByRole('button', { name: 'Load saved game' })).toBeVisible();
  await expect.poll(() => gameContext(page)).toBe('title');
  await panel.getByRole('button', { name: 'Load saved game' }).tap();
  await expect(panel.getByRole('heading', { name: 'Saved games' })).toBeVisible();
  const save = panel.getByRole('button', { name: /Saved CE 1\.15\.1/ });
  await expect(save).toHaveCount(1);
  const box = (await save.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await save.tap();
  await waitInGame(page);
  await expect.poll(() => player(page)).toMatchObject({ x: before.x, y: before.y });
});

test("inventory: an item's details fill the sheet and the dock offers its actions", async ({ page }) => {
  await newGame(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  await dock.getByRole('button', { name: 'Pack (i)' }).tap();
  await expect.poll(() => gameContext(page)).toBe('menu');
  // (Wait until the list is drawn: a key pressed while it opens is lost.)
  await waitForScreenText(page, 'dagger');
  // The starting dagger (b) is wielded: Remove is the likely action.
  await page.keyboard.press('b');
  await expect.poll(() => gameContext(page)).toBe('item');
  await expect(dock.getByRole('button', { name: 'Remove (r)' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Throw (t)' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Drop (d)' })).toBeVisible();
  await expect.poll(() => gameViews(page)).toEqual(['map', 'sheet']);
  // Only the details panel is shown (40 columns), not the inventory beside it.
  const sheet = await page.evaluate(() =>
    (
      window as unknown as { __rogueArchive: { adapter: { debug: { sheet(): { width: number } | null } } } }
    ).__rogueArchive.adapter.debug.sheet(),
  );
  expect(sheet?.width).toBeLessThanOrEqual(44);
  // Stepping to the next item keeps the details view; Back returns to the list.
  await dock.getByRole('button', { name: /▼ Item/ }).tap();
  await expect.poll(() => gameContext(page)).toBe('item');
  await dock.getByRole('button', { name: /Back/ }).tap();
  await expect.poll(() => gameContext(page)).not.toBe('item');
});

/** Long-press a dock button until its fan opens (released on the button, it stays open), then tap an option. */
async function chooseFromFan(page: import('@playwright/test').Page, button: string, option: RegExp) {
  const selector = `.dock-button[aria-label="${button}"]`;
  const box = (await page.locator(selector).boundingBox())!;
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await page.dispatchEvent(selector, 'pointerdown', {
    pointerId: 9,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    ...at,
  });
  const fan = page.getByRole('menu', { name: /options$/ });
  await expect(fan).toBeVisible();
  await page.dispatchEvent(selector, 'pointerup', { pointerId: 9, pointerType: 'touch', button: 0, ...at });
  await fan.getByRole('menuitem', { name: option }).click();
  await expect(fan).toBeHidden();
}

test('stairs: once the route is shown, one tap on "Go ↑" travels there', async ({ page }) => {
  await newGame(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  // `<` shows the route to the up stairs (the dungeon exit on depth 1).
  await page.keyboard.press('<');
  const go = dock.getByRole('button', { name: 'Go ↑ (<)' });
  await expect(go).toBeVisible();
  await expect(go).toHaveClass(/dock-button--primary/);
  await go.tap();
  // Travelled to the stairs and tried them (only the Amulet's bearer may leave).
  await waitForScreenText(page, 'The dungeon exit is magically sealed!');
});

test('search: progress towards the fifth search, and the five-turn search (Ctrl+S) by touch', async ({
  page,
}) => {
  await newGame(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  // The level is random: with a monster in view from the start, the danger
  // dock (Fight, Throw...) replaces Search.
  const search = dock.getByRole('button', { name: 'Search (s)' });
  const quiet = await search.waitFor({ timeout: 5000 }).then(
    () => true,
    () => false,
  );
  test.skip(!quiet, 'A monster is in view at the start, so the dock is the danger dock.');
  await search.tap();
  await expect(dock.getByRole('button', { name: 'Search 1/5 (s)' })).toBeVisible();
  await dock.getByRole('button', { name: 'Search 1/5 (s)' }).tap();
  await expect(dock.getByRole('button', { name: 'Search 2/5 (s)' })).toBeVisible();
  // The long search finishes the five searches with Brogue's stronger one.
  await chooseFromFan(page, 'Search 2/5 (s)', /Search five turns/);
  await waitForScreenText(page, 'finish your detailed search of the area.');
  // The count starts again (a monster may have come into view meanwhile, bringing the danger dock).
  await expect(dock.getByRole('button', { name: /^Search \d\/5/ })).toHaveCount(0);
});

test('Eat (from the Pack fan) applies the food by its letter', async ({ page }) => {
  await newGame(page);
  await chooseFromFan(page, 'Pack (i)', /^Eat/);
  // A new character is far from hungry, so Brogue asks first; the food was chosen without a menu.
  await expect.poll(() => gameContext(page)).toBe('yesno');
  await waitForScreenText(page, 'not hungry enough');
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^No/ }).tap();
  await expect.poll(() => gameContext(page)).toBe('map');
});

test('targeting: the confirm button says what it does', async ({ page }) => {
  await newGame(page);
  await page.keyboard.press('t');
  await waitForScreenText(page, 'darts');
  const row = (await findCell(page, 'darts'))!;
  const text = await page.evaluate(
    (y) =>
      (
        window as unknown as { __rogueArchive: { adapter: { debug: { rowText(y: number): string } } } }
      ).__rogueArchive.adapter.debug.rowText(y),
    row.y,
  );
  const letter = /([a-z])\)[^)]*darts/.exec(text)![1]!;
  await page.keyboard.press(letter);
  await expect.poll(() => gameContext(page)).toBe('targeting');
  const dock = page.getByRole('group', { name: 'Actions' });
  await expect(dock.getByRole('button', { name: 'Throw (Enter)' })).toBeVisible();
  await dock.getByRole('button', { name: 'Cancel (Esc)' }).tap();
  await expect.poll(() => gameContext(page)).toBe('map');
});

test('recording playback has its own dock: pause, speed, seek and omniscience', async ({ page }) => {
  await openBrogue(page);
  // A saved game is also a recording: view it like one.
  const bytes = [...readFileSync('games/brogue-ce/tests/recordings/browser-explore-115-turns.broguesave')];
  await page.evaluate(async (data) => {
    const adapter = (
      window as unknown as {
        __rogueArchive: {
          adapter: {
            importSaves(files: { path: string; bytes: Uint8Array; modifiedAt: number }[]): Promise<void>;
          };
        };
      }
    ).__rogueArchive.adapter;
    await adapter.importSaves([
      { path: 'Playback.broguerec', bytes: new Uint8Array(data), modifiedAt: Date.now() },
    ]);
  }, bytes);
  const panel = page.locator('.brogue-title');
  await panel.getByRole('button', { name: 'View recording' }).tap();
  await panel.getByRole('button', { name: /Playback/ }).tap();
  await expect.poll(() => gameContext(page), { timeout: 45_000 }).toBe('playback');
  const dock = page.getByRole('group', { name: 'Actions' });
  await expect(page.getByRole('group', { name: 'Movement' })).toHaveCount(0);
  const omniscience = dock.getByRole('button', { name: /^Omniscience/ });
  await expect(omniscience).toHaveAttribute('aria-pressed', 'false');
  await omniscience.tap();
  await expect(omniscience).toHaveAttribute('aria-pressed', 'true');
  // Brogue opens a recording paused.
  await waitForScreenText(page, 'Recording paused');
  await dock.getByRole('button', { name: 'Play (Space)' }).tap();
  await expect(dock.getByRole('button', { name: 'Pause (Space)' })).toBeVisible();
  await dock.getByRole('button', { name: 'Pause (Space)' }).tap();
  await expect(dock.getByRole('button', { name: 'Play (Space)' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Turn → (l)' })).toBeVisible();
});

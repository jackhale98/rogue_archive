import { expect, test, type Page } from '@playwright/test';
import {
  dcssContext,
  dcssLatch,
  dcssMap,
  dcssMenus,
  startCharacter,
  waitForContext,
  type DcssMapContext,
  createByTaps,
} from './dcss-helpers.ts';

test.describe.configure({ timeout: 300_000 });

/** Long-presses a dock button, slides onto one of its fan's options and releases. */
async function chooseFromFan(page: Page, button: string, option: RegExp): Promise<void> {
  const dock = page.getByRole('group', { name: 'Actions' });
  const selector = `.dock-button[aria-label="${button}"]`;
  const box = (await dock.getByRole('button', { name: button, exact: true }).boundingBox())!;
  const pointer = (x: number, y: number, extra: Record<string, unknown>) => ({
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
    ...extra,
  });
  await page.dispatchEvent(
    selector,
    'pointerdown',
    pointer(box.x + box.width / 2, box.y + box.height / 2, { button: 0, buttons: 1 }),
  );
  const fan = page.getByRole('menu', { name: `${button.replace(/ \([^)]*\)$/, '')} options` });
  await expect(fan).toBeVisible();
  const choice = (await fan.getByRole('menuitem', { name: option }).boundingBox())!;
  // Near the option's start: a wide fan can reach under the thumb pad, which is drawn above it.
  const target = { x: choice.x + Math.min(24, choice.width / 4), y: choice.y + choice.height / 2 };
  await page.dispatchEvent(selector, 'pointermove', pointer(target.x, target.y, { buttons: 1 }));
  await page.dispatchEvent(selector, 'pointerup', pointer(target.x, target.y, { button: 0 }));
  await expect(fan).toBeHidden();
}

/** The stairs button's name for what the client host found underfoot (adapter/input.ts stairsAction). */
const STAIRS: Record<string, string> = {
  down: 'Down > (>)',
  branch: 'Down > (>)',
  up: 'Up < (<)',
  portal: 'Enter > (>)',
  exit: 'Exit < (<)',
  altar: 'Pray (>)',
  shop: 'Shop (>)',
};

test('DCSS phone: tap through character creation, status band, contextual dock and fans', async ({
  page,
}) => {
  await startCharacter(page, 'Thumbs');
  // Upstream's character creation buttons are tappable (a first tap shows the option, a second chooses).
  const frame = page.frameLocator('iframe.dcss-client');
  await createByTaps(page);

  // The status band replaces the stats column; tapping it opens the full panel.
  const status = page.locator('.dcss-hud__status');
  await expect(status).toContainText('Dungeon:1');
  await status.tap();
  await expect(frame.locator('#stats')).toBeVisible();
  await status.tap();
  await expect(frame.locator('#stats')).toBeHidden();

  // Map dock: the main actions, each with related actions on a long press.
  // The client host reads the client's map: nothing hostile in view at the
  // start, so the dock explores; the stairs button says what is underfoot.
  const dock = page.getByRole('group', { name: 'Actions' });
  await expect.poll(() => dcssMap(page)).toMatchObject({ hostiles: 0 });
  const map = (await dcssMap(page)) as DcssMapContext;
  const stairs = (map.underfoot && STAIRS[map.underfoot]) || 'Travel (G)';
  for (const name of ['Explore (o)', stairs, 'Cast (z)', 'Pack (i)', 'Look (x)'])
    await expect(dock.getByRole('button', { name, exact: true })).toBeVisible();

  await dock.getByRole('button', { name: 'Pack (i)' }).tap();
  await waitForContext(page, 'menu');
  await expect(dock.getByRole('button', { name: /Close/ })).toBeVisible();
  await dock.getByRole('button', { name: /Close/ }).tap();
  await waitForContext(page, 'map');

  // Long-press fans out related actions; sliding onto one and releasing runs it.
  await chooseFromFan(page, 'Pack (i)', /Quaff/);
  // Quaffing asks which potion: a prompt or a menu of potions.
  await expect.poll(() => dcssContext(page), { timeout: 15_000 }).toMatch(/prompt|menu|popup/);
  await dock
    .getByRole('button', { name: /Cancel|Close/ })
    .first()
    .tap();
  await waitForContext(page, 'map');

  // Looking around has its own dock (not the firing one).
  await dock.getByRole('button', { name: 'Look (x)' }).tap();
  await waitForContext(page, 'look');
  for (const name of ['Select (Enter)', 'Info (v)', 'Cancel (Esc)'])
    await expect(dock.getByRole('button', { name, exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'Cancel (Esc)' }).tap();
  await waitForContext(page, 'map');

  // The Attack latch (Ctrl + direction) shows as pressed in the lead slot until tapped again.
  await chooseFromFan(page, 'Explore (o)', /Attack without moving/);
  await expect.poll(() => dcssLatch(page)).toBe('attack');
  const latched = dock.getByRole('button', { name: 'Attack ⌃ (Ctrl+direction)' });
  await expect(latched).toHaveAttribute('aria-pressed', 'true');
  await latched.tap();
  await expect.poll(() => dcssLatch(page)).toBeNull();
  await expect(dock.getByRole('button', { name: 'Explore (o)' })).toBeVisible();

  // The starting Fighter knows no spells: once DCSS says so, Ability leads.
  await dock.getByRole('button', { name: 'Cast (z)' }).tap();
  await expect(dock.getByRole('button', { name: 'Ability (a)', exact: true })).toBeVisible();
  await waitForContext(page, 'map');

  // Interlevel travel (G) offers its own keys.
  if (stairs === 'Travel (G)') await dock.getByRole('button', { name: stairs }).tap();
  else await chooseFromFan(page, stairs, /Travel to a level/);
  await expect.poll(() => dcssMenus(page)).toContain('travel');
  for (const name of ['Down > (>)', 'Up < (<)', 'Repeat (Tab)', 'Altars (_)'])
    await expect(dock.getByRole('button', { name, exact: true })).toBeVisible();
  await dock.getByRole('button', { name: /Close/ }).tap();
  await waitForContext(page, 'map');

  // Explore until a monster comes into view (dungeons are random, so this may
  // not happen within the tries): the dock then turns into the combat dock.
  for (let i = 0; i < 12 && ((await dcssMap(page))?.hostiles ?? 0) === 0; i++) {
    const explore = dock.getByRole('button', { name: /^(Explore \(o\)|Rest \(5\))$/ });
    if (!(await explore.isVisible())) break;
    await explore.tap();
    await page.waitForTimeout(600);
    await expect
      .poll(() => dcssContext(page), { timeout: 60_000 })
      .toMatch(/map|more|yesno|prompt|menu|popup/);
    const context = await dcssContext(page);
    if (context === 'more') await dock.getByRole('button', { name: /Continue/ }).tap();
    else if (context !== 'map')
      await dock
        .getByRole('button', { name: /Cancel|Close|No/ })
        .first()
        .tap();
    await expect.poll(() => dcssContext(page), { timeout: 30_000 }).toMatch(/map|more/);
  }
  const fighting = (await dcssMap(page))?.hostiles ?? 0;
  const checked = fighting > 0 && (await dcssContext(page)) === 'map';
  if (checked) {
    await expect(dock.getByRole('button', { name: 'Fight (Tab)', exact: true })).toBeVisible();
    await expect(dock.getByRole('button', { name: /\(p\)$/ })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Quaff (q)', exact: true })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Explore (o)' })).toHaveCount(0);
  }
  test.info().annotations.push({
    type: 'dcss-combat-dock',
    description: checked
      ? `checked with ${fighting} hostile(s) in view`
      : 'not checked: no monster came into view',
  });
});

test('DCSS phone: in character creation a tap shows an option, a second chooses it; questions are buttons', async ({
  page,
}) => {
  await startCharacter(page, 'Chooser');
  const frame = page.frameLocator('iframe.dcss-client');
  const dock = page.getByRole('group', { name: 'Actions' });
  // The step's own extra keys are buttons.
  await expect(dock.getByRole('button', { name: /^Random species/ })).toBeVisible();
  const minotaur = frame.locator('.ui-popup .newgame-choice .main-items .button', { hasText: 'Minotaur' });
  await minotaur.tap();
  // Still choosing a species, with the Minotaur's description in view.
  await expect(frame.locator('.ui-popup .newgame-choice .descriptions')).toContainText('Minotaurs');
  await expect(dock.getByRole('button', { name: /^Random species/ })).toBeVisible();
  await minotaur.tap();
  await expect(dock.getByRole('button', { name: /^Random background/ })).toBeVisible();
  // "! - Random character" asks "Do you want to play this combination? [Y/n/q]": its answers are buttons.
  await page.keyboard.press('!');
  await waitForContext(page, 'yesno');
  await dock.getByRole('button', { name: /^Yes/ }).tap();
  // (Some combinations still ask for a weapon.)
  await page.waitForTimeout(1500);
  await createByTaps(page);
});

test('DCSS phone: a new character and its end by touch alone', async ({ page }) => {
  await page.goto('?debug=1#/play/dcss');
  const launcher = page.locator('.dcss-launcher');
  await expect(launcher).toBeVisible({ timeout: 120_000 });
  // A name is ready (no keyboard needed); Random name picks another.
  const name = launcher.getByLabel('New character');
  await expect(name).toHaveValue(/^[A-Z][a-z]+$/);
  await launcher.getByRole('button', { name: 'Random name' }).tap();
  await expect(name).toHaveValue(/^[A-Z][a-z]+$/);
  await launcher.getByRole('button', { name: 'Start' }).tap();
  await waitForContext(page, 'start', 180_000);
  await createByTaps(page);

  // Quit from the command list: DCSS asks for "quit" to be typed; one button types it.
  const dock = page.getByRole('group', { name: 'Actions' });
  await page.waitForTimeout(500);
  await dock.getByRole('button', { name: 'More', exact: true }).tap();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Quit \(abandon/ })
    .tap();
  await waitForContext(page, 'text');
  await dock.getByRole('button', { name: /^Abandon character/ }).tap();
  // --more--, the inventory, "Goodbye" with the scores: Continue each time.
  for (let i = 0; i < 8 && !(await launcher.isVisible()); i++) {
    const context = await dcssContext(page);
    if (context === 'more' || context === 'game-over') {
      await dock.getByRole('button', { name: /^Continue/ }).tap();
      if (context === 'game-over') await page.waitForTimeout(300);
    }
    await page.waitForTimeout(700);
  }
  await expect(launcher).toBeVisible();
  await expect(launcher.getByRole('status')).toContainText('abandoned');
});

test('DCSS phone: pinch zooms the map (drawn at the new size), a drag looks around, a move recentres', async ({
  page,
}) => {
  await startCharacter(page, 'Zoomer');
  await createByTaps(page);
  const frame = page.frameLocator('iframe.dcss-client');
  /** The client's own view of the map: cell size, the view's centre, the player. */
  const view = () =>
    frame.locator('body').evaluate(() => {
      const req = (window as unknown as { require: (name: string) => Record<string, unknown> }).require;
      const renderer = req('game/dungeon_renderer') as {
        cell_width: number;
        view_center: { x: number; y: number };
      };
      const player = req('game/player') as { pos: { x: number; y: number } };
      return {
        cell: renderer.cell_width,
        center: { ...renderer.view_center },
        player: { ...player.pos },
      };
    });
  await expect.poll(async () => (await view()).cell).toBeGreaterThan(0);
  const before = await view();
  const canvas = (await frame.locator('#dungeon').boundingBox())!;
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((point, id) => ({ ...point, id })),
    });

  // Two fingers apart from 60 to 150 px: the cells grow about 2.5 times, redrawn by the client.
  await touch('touchStart', [
    { x: cx - 30, y: cy },
    { x: cx + 30, y: cy },
  ]);
  for (let gap = 40; gap <= 75; gap += 5)
    await touch('touchMove', [
      { x: cx - gap, y: cy },
      { x: cx + gap, y: cy },
    ]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await view()).cell).toBeGreaterThan(before.cell * 2);
  const zoomed = await view();
  expect(zoomed.center).toEqual(before.center);

  // One finger drags the map four cells to the right: the view looks four cells to the left.
  await touch('touchStart', [{ x: cx, y: cy }]);
  for (let step = 1; step <= 8; step++)
    await touch('touchMove', [{ x: cx + (step * 4 * zoomed.cell) / 8 + 0.5, y: cy }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await view()).center.x).toBe(zoomed.center.x - 4);
  expect((await view()).center.y).toBe(zoomed.center.y);

  // The player moves (whichever way is open): the view is on the player again.
  for (const key of ['h', 'l', 'j', 'k', 'y', 'u', 'b', 'n']) {
    const at = (await view()).player;
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    const now = await view();
    if (now.player.x !== at.x || now.player.y !== at.y) break;
  }
  await expect
    .poll(async () => {
      const now = await view();
      return now.center.x === now.player.x && now.center.y === now.player.y;
    })
    .toBe(true);
  // The zoom stays.
  expect((await view()).cell).toBe(zoomed.cell);
});

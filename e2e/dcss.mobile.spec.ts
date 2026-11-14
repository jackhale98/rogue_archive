import { expect, test, type Page } from '@playwright/test';
import {
  dcssContext,
  dcssLatch,
  dcssMap,
  dcssMenus,
  startCharacter,
  waitForContext,
  type DcssMapContext,
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
  // Upstream's character creation buttons are tappable.
  const frame = page.frameLocator('iframe.dcss-client');
  for (let i = 0; i < 3 && (await dcssContext(page)) === 'start'; i++) {
    await frame.locator('.ui-popup .newgame-choice .button').first().tap();
    await page.waitForTimeout(1000);
  }
  await waitForContext(page, 'map');

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

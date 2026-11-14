import { expect, test, type Page } from '@playwright/test';
import { openBrogue, waitInGame } from './helpers.ts';
import { dcssContext, startCharacter, waitForContext as dcssWait } from './dcss-helpers.ts';
import { openHyperRogue } from './hyperrogue-helpers.ts';
import { lineAt, startNetHack, toMap, waitForContext as netHackWait } from './nethack-helpers.ts';
import { startRogue } from './rogue-helpers.ts';
import { openSil, silContext, waitForContext as silWait } from './sil-q-helpers.ts';

// Phones held sideways: the dock and the thumb pad (under the shell's tools)
// sit in rails beside the game, so nothing the game draws is under them.
test.describe.configure({ timeout: 240_000 });

/** From each game's start to its map, as the game's own phone tests get there. */
const toGame: Record<string, (page: Page) => Promise<void>> = {
  'brogue-ce': async (page) => {
    await openBrogue(page);
    await page.locator('.brogue-title').getByRole('button', { name: 'New game' }).tap();
    await waitInGame(page);
  },
  dcss: async (page) => {
    await startCharacter(page, 'Thumbs');
    const frame = page.frameLocator('iframe.dcss-client');
    for (let i = 0; i < 3 && (await dcssContext(page)) === 'start'; i++) {
      await frame.locator('.ui-popup .newgame-choice .button').first().tap();
      await page.waitForTimeout(1000);
    }
    await dcssWait(page, 'map');
  },
  'sil-q': async (page) => {
    await openSil(page);
    const dock = page.getByRole('group', { name: 'Actions' });
    await dock.getByRole('button', { name: /New character/ }).tap();
    for (let i = 0; i < 12 && (await silContext(page)) !== 'map'; i++) {
      await page.waitForTimeout(400);
      if ((await silContext(page)) === 'map') break;
      await dock.getByRole('button', { name: /^OK/ }).tap();
    }
    await silWait(page, 'map');
  },
  rogue: (page) => startRogue(page, 'Thumbs'),
  hyperrogue: openHyperRogue,
  nethack: async (page) => {
    await startNetHack(page, 'Thumbs');
    await netHackWait(page, 'yn');
    await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'No' }).tap();
    await netHackWait(page, 'menu');
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
      () => page.touchscreen.tap(320, 200),
      () => tapLine(/No, just start play/),
    );
  },
};

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The game's area (and what it draws: canvases, the DCSS frame), and every control the shell shows. */
function boxes(page: Page): Promise<{ game: Box[]; controls: Box[]; viewport: Box }> {
  return page.evaluate(() => {
    const box = (name: string, element: Element): Box => {
      const r = element.getBoundingClientRect();
      return { name, x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const all = (selector: string) =>
      [...document.querySelectorAll(selector)]
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element, i) => box(`${selector} #${i}`, element));
    return {
      game: [...all('.play__screen'), ...all('.play__screen canvas'), ...all('.play__screen iframe')],
      controls: [...all('.dock-button'), ...all('.thumb-pad'), ...all('.tool-button'), ...all('.play__back')],
      viewport: { name: 'viewport', x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function overlap(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0.5 && height > 0.5 ? width * height : 0;
}

async function expectNoOverlap(page: Page): Promise<void> {
  const { game, controls, viewport } = await boxes(page);
  expect(game.length).toBeGreaterThan(0);
  expect(controls.length).toBeGreaterThan(0);
  // The pad, the dock and the tools are all there.
  for (const pattern of [/^\.dock-button/, /^\.thumb-pad/, /^\.tool-button/])
    expect(controls.some((c) => pattern.test(c.name))).toBe(true);
  const clashes: string[] = [];
  // A canvas or frame can reach past the game's area (a map larger than the
  // screen): the area clips it, so only the visible part counts.
  const area = game[0]!;
  for (const g of game) {
    const visible = {
      ...g,
      x: Math.max(g.x, area.x),
      y: Math.max(g.y, area.y),
      width: Math.min(g.x + g.width, area.x + area.width) - Math.max(g.x, area.x),
      height: Math.min(g.y + g.height, area.y + area.height) - Math.max(g.y, area.y),
    };
    for (const c of controls) if (overlap(visible, c) > 0) clashes.push(`${g.name} under ${c.name}`);
  }
  // Every control fits on the screen (a long dock does not run off the top).
  for (const c of controls)
    if (
      c.x < -0.5 ||
      c.y < -0.5 ||
      c.x + c.width > viewport.width + 0.5 ||
      c.y + c.height > viewport.height + 0.5
    )
      clashes.push(`${c.name} off screen`);
  expect(clashes).toEqual([]);
  // The game still has most of the width.
  expect(area.width).toBeGreaterThan(viewport.width * 0.5);
}

for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
]) {
  test.describe(`landscape ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });
    for (const [id, start] of Object.entries(toGame))
      test(`${id}: the game and the controls do not overlap`, async ({ page }) => {
        await start(page);
        await expectNoOverlap(page);
      });
  });
}

test.describe('landscape, left hand', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  test('the rails swap sides and still leave the game clear', async ({ page }) => {
    await page.goto('#/settings');
    await page.getByLabel(/Direction pad side/).selectOption('left');
    // Settings are stored in IndexedDB: let the write land before the game page loads.
    await page.waitForTimeout(500);
    await toGame.rogue!(page);
    await expect(page.locator('.play')).toHaveAttribute('data-hand', 'left');
    await expectNoOverlap(page);
    const pad = (await page.getByRole('group', { name: 'Movement' }).boundingBox())!;
    const dock = (await page.getByRole('group', { name: 'Actions' }).boundingBox())!;
    expect(pad.x).toBeLessThan(dock.x);
  });
});

test.describe('portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the controls float over the bottom of the game and the adapter is told so', async ({ page }) => {
    await toGame.hyperrogue!(page);
    // HyperRogue fits its canvas into the space the controls leave.
    const canvas = (await page.locator('canvas.hr-canvas').boundingBox())!;
    for (const control of [
      page.getByRole('group', { name: 'Movement' }),
      page.getByRole('group', { name: 'Actions' }),
      page.getByRole('button', { name: 'Menu' }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(overlap({ name: 'canvas', ...canvas }, { name: 'control', ...box })).toBe(0);
    }
  });
});

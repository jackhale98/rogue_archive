import { expect, type Page } from '@playwright/test';

interface AngbandDebug {
  context: string | null;
  inGame: boolean;
  tiled: boolean;
  saves: string[];
  state: {
    playerX: number;
    playerY: number;
    offsetX: number;
    offsetY: number;
    colMap: number;
    rowMap: number;
    depth: number;
    graphics: number;
    hp: number;
  } | null;
  screenText(): string;
  rowText(y: number): string;
  views(): string[];
  cellToClient(x: number, y: number): { x: number; y: number } | null;
  cursor(): { x: number; y: number } | null;
  tileAt(x: number, y: number): number;
}

type DebugWindow = { __rogueArchive?: { adapter: { debug: AngbandDebug; sendInput(input: unknown): void } } };

export function angband(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as DebugWindow).__rogueArchive?.adapter.debug;
    return d
      ? {
          context: d.context,
          inGame: d.inGame,
          tiled: d.tiled,
          saves: d.saves,
          state: d.state,
          text: d.screenText(),
          views: d.views(),
        }
      : null;
  });
}

export async function angbandContext(page: Page): Promise<string | null> {
  return (await angband(page))?.context ?? null;
}

export async function screenText(page: Page): Promise<string> {
  return (await angband(page))?.text ?? '';
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => angbandContext(page), { timeout, message: `waiting for the ${context} context` })
    .toBe(context);
}

/** Opens Angband and gets past its splash screen to its savefile menu. */
export async function openAngband(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/angband');
  await expect
    .poll(() => screenText(page), { timeout: 120_000 })
    .toMatch(/Press any key to continue|Select the save/);
  if (/Press any key to continue/.test(await screenText(page))) {
    await page.locator('canvas').first().focus();
    await page.keyboard.press(' ');
  }
  await waitForContext(page, 'select');
}

/** Sends a command as the touch controls do. */
export async function sendCommand(page: Page, commandId: string): Promise<void> {
  await page.evaluate((id) => {
    (window as unknown as DebugWindow).__rogueArchive!.adapter.sendInput({ type: 'command', commandId: id });
  }, commandId);
}

/**
 * A new character by keyboard, Angband's defaults at each step (Human
 * Warrior, point-based stats) and the given name, as far as the town.
 */
export async function newCharacter(page: Page, name: string): Promise<void> {
  await openAngband(page);
  await page.locator('canvas').first().focus();
  // "New game" is the first row of the savefile menu.
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect.poll(() => screenText(page)).toContain('Please select your character traits');
  // Race, class, how to roll stats, the point-based stats: each step waits for the next screen.
  for (const next of [
    'Class affects',
    'how to generate',
    'left/right to modify',
    'Enter a name for your character',
  ]) {
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page)).toContain(next);
  }
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect.poll(() => screenText(page)).toContain('Accept character history? [y/n]');
  await page.keyboard.press('y');
  await expect.poll(() => screenText(page)).toContain('any other key to continue');
  await page.keyboard.press('Enter');
  await waitForContext(page, 'map');
}

/** The player's cell on Angband's screen. */
export async function playerCell(page: Page): Promise<{ x: number; y: number }> {
  const state = (await angband(page))?.state;
  if (!state) throw new Error('no game state');
  return { x: state.playerX - state.offsetX + state.colMap, y: state.playerY - state.offsetY + state.rowMap };
}

/** Where a screen cell is drawn, in client coordinates. */
export async function cellToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ([cx, cy]) => (window as unknown as DebugWindow).__rogueArchive!.adapter.debug.cellToClient(cx!, cy!),
    [x, y],
  );
  if (!point) throw new Error(`cell ${x},${y} is not drawn`);
  return point;
}

export async function tileAt(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([cx, cy]) => (window as unknown as DebugWindow).__rogueArchive!.adapter.debug.tileAt(cx!, cy!),
    [x, y],
  );
}

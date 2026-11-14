import { expect, type Page } from '@playwright/test';

interface SilDebug {
  context: string | null;
  inDungeon: boolean;
  state: { playerX: number; playerY: number; panelX: number; panelY: number } | null;
  screenText(): string;
  cellToClient(x: number, y: number): { x: number; y: number } | null;
}

function debug(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __rogueArchive?: { adapter: { debug: SilDebug } } }).__rogueArchive
      ?.adapter.debug;
    return d ? { context: d.context, inDungeon: d.inDungeon, text: d.screenText() } : null;
  });
}

export async function silContext(page: Page): Promise<string | null> {
  return (await debug(page))?.context ?? null;
}

export async function screenText(page: Page): Promise<string> {
  return (await debug(page))?.text ?? '';
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => silContext(page), { timeout, message: `waiting for the ${context} context` })
    .toBe(context);
}

export async function openSil(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/sil-q');
  await waitForContext(page, 'title', 120_000);
  await expect.poll(() => screenText(page)).toContain('b) New character');
}

/** Sends a command as the touch controls do. */
export async function sendCommand(page: Page, commandId: string): Promise<void> {
  await page.evaluate((id) => {
    (
      window as unknown as { __rogueArchive: { adapter: { sendInput(input: unknown): void } } }
    ).__rogueArchive.adapter.sendInput({ type: 'command', commandId: id });
  }, commandId);
}

/** The player's cell on Sil's screen (map column 13, row 1 onwards). */
export async function playerCell(page: Page): Promise<{ x: number; y: number }> {
  const state = await page.evaluate(
    () =>
      (window as unknown as { __rogueArchive: { adapter: { debug: SilDebug } } }).__rogueArchive.adapter.debug
        .state,
  );
  if (!state) throw new Error('no game state');
  return { x: state.playerX - state.panelX + 13, y: state.playerY - state.panelY + 1 };
}

/** Where a screen cell is drawn, in client coordinates. */
export async function cellToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ([cx, cy]) =>
      (
        window as unknown as { __rogueArchive: { adapter: { debug: SilDebug } } }
      ).__rogueArchive.adapter.debug.cellToClient(cx!, cy!),
    [x, y],
  );
  if (!point) throw new Error(`cell ${x},${y} is not drawn`);
  return point;
}

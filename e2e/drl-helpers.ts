import { expect, type Page } from '@playwright/test';

interface DrlDebug {
  context: string | null;
  inGame: boolean;
  hasSave: boolean;
  state: { name: string; health: number; level: string } | null;
  screenText(): string;
  views(): string[];
}

export interface DrlSnapshot {
  context: string | null;
  inGame: boolean;
  hasSave: boolean;
  state: DrlDebug['state'];
  text: string;
  views: string[];
}

export function drl(page: Page): Promise<DrlSnapshot | null> {
  return page.evaluate(() => {
    const d = (window as unknown as { __rogueArchive?: { adapter: { debug: DrlDebug } } }).__rogueArchive
      ?.adapter.debug;
    return d
      ? {
          context: d.context,
          inGame: d.inGame,
          hasSave: d.hasSave,
          state: d.state,
          text: d.screenText(),
          views: d.views(),
        }
      : null;
  });
}

export async function screenText(page: Page): Promise<string> {
  return (await drl(page))?.text ?? '';
}

export async function waitForText(page: Page, text: RegExp, timeout = 60_000): Promise<void> {
  await expect.poll(() => screenText(page), { timeout, message: `waiting for ${text}` }).toMatch(text);
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(async () => (await drl(page))?.context ?? null, {
      timeout,
      message: `waiting for the ${context} context`,
    })
    .toBe(context);
}

/** Opens DRL and waits for its first screen (the welcome text on a first run, or its main menu). */
export async function openDrl(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/drl');
  await waitForText(page, /Press <Enter> to continue|New game|Continue game/, 120_000);
}

/** From DRL's main menu (or its first-run welcome): a new regular game, the first choices, a name; on the map. */
export async function newGame(
  page: Page,
  name: string,
  press: (key: string) => Promise<void>,
): Promise<void> {
  // A first run shows DRL's welcome and its credits, each until Enter.
  for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
    await press('Enter');
    await page.waitForTimeout(500);
  }
  await waitForText(page, /New game/);
  // New game, Regular game, the difficulty, the class, the trait: DRL's defaults.
  await press('Enter');
  await waitForText(page, /Regular game/);
  await press('Enter');
  await waitForText(page, /Too Young To Die/);
  await press('Enter');
  await waitForText(page, /Marine/);
  await press('Enter');
  await waitForText(page, /Select trait/);
  await press('Enter');
  await waitForText(page, /Type a name/);
  await waitForContext(page, 'text');
  for (const char of name) await press(char);
  await press('Enter');
  // The intro: Escape skips each page.
  for (let i = 0; i < 10 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(700);
    if ((await drl(page))?.context !== 'map') await press('Escape');
  }
  await waitForContext(page, 'map');
}

/** Back to the map: close DRL's screens, menus and prompts. */
export async function settle(page: Page, press: (key: string) => Promise<void>): Promise<void> {
  let maps = 0;
  for (let i = 0; i < 30 && maps < 2; i++) {
    await page.waitForTimeout(200);
    const context = (await drl(page))?.context;
    if (context === 'map') {
      maps++;
      continue;
    }
    maps = 0;
    await press(context === 'pager' ? 'Enter' : 'Escape');
  }
  await waitForContext(page, 'map', 5_000);
}

/** Opens DRL and starts a new game by taps alone (DRL's defaults); on the map. */
export async function newGameByTaps(page: Page, name: string): Promise<void> {
  await openDrl(page);
  const dock = page.getByRole('group', { name: 'Actions' });
  const tap = (label: RegExp) => dock.getByRole('button', { name: label }).first().tap();
  const select = () => tap(/^(Select|Continue)/);
  // DRL's own screens before a game: the welcome, its credits, the main menu,
  // the game type, difficulty, class and trait (DRL's defaults), by taps.
  for (let i = 0; i < 4 && /Press <Enter> to continue/.test(await screenText(page)); i++) {
    await waitForContext(page, 'title');
    await select();
    await page.waitForTimeout(500);
  }
  await waitForText(page, /New game/);
  for (const next of [/Regular game/, /Too Young To Die/, /Marine/, /Select trait/, /Type a name/]) {
    await select();
    await waitForText(page, next);
  }
  // The name, as typed with the device keyboard (the dock offers it).
  await waitForContext(page, 'text');
  await page.keyboard.type(name);
  await tap(/^Done/);
  // The intro: Back (Escape) skips each page.
  for (let i = 0; i < 10 && (await drl(page))?.context !== 'map'; i++) {
    await page.waitForTimeout(700);
    if ((await drl(page))?.context !== 'map') await tap(/^Back/);
  }
  await waitForContext(page, 'map');
}

import { expect, type Page } from '@playwright/test';

export interface CddaDebug {
  context: string | null;
  inputContext: string;
  inGame: boolean;
  mainMenu: boolean;
  waiting: boolean;
  player: { x: number; y: number; z: number; absX: number; absY: number; absZ: number; name: string } | null;
  imgui: string[];
  screen: string;
}

export function cddaDebug(page: Page): Promise<CddaDebug | null> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __rogueArchive?: {
          adapter: {
            debug: {
              context: string | null;
              inputContext: string;
              inGame: boolean;
              mainMenu: boolean;
              waiting: boolean;
              player: CddaDebug['player'];
              state: { imgui: string[] } | null;
              screenText(): string;
            };
          };
        };
      }
    ).__rogueArchive?.adapter.debug;
    return d
      ? {
          context: d.context,
          inputContext: d.inputContext,
          inGame: d.inGame,
          mainMenu: d.mainMenu,
          waiting: d.waiting,
          player: d.player,
          imgui: d.state?.imgui ?? [],
          screen: d.screenText(),
        }
      : null;
  });
}

/** Waits until the game waits for input in this keybinding context (keybindings.json category). */
export async function waitForInputContext(page: Page, inputContext: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const d = await cddaDebug(page);
        return d?.waiting ? d.inputContext : null;
      },
      { timeout, message: `waiting for the ${inputContext} context` },
    )
    .toBe(inputContext);
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  try {
    await expect
      .poll(async () => (await cddaDebug(page))?.context ?? null, {
        timeout,
        message: `waiting for the ${context} context`,
      })
      .toBe(context);
  } catch (error) {
    // Say what the game shows instead.
    const d = await cddaDebug(page);
    const screen = (d?.screen ?? '')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .join('\n');
    throw new Error(`${(error as Error).message}\ninput context: ${d?.inputContext}\nscreen:\n${screen}`, {
      cause: error,
    });
  }
}

/** Answers whatever the game asks (Escape, then Space for message boxes) until it is back on the map. */
export async function backToMap(page: Page): Promise<void> {
  for (let i = 0; i < 6 && (await cddaDebug(page))?.context !== 'map'; i++)
    await press(page, i % 2 ? 'Space' : 'Escape', 800);
  await waitForContext(page, 'map');
}

/** Opens the game and waits for its main menu (the data takes a while to load). */
export async function openCataclysm(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/cataclysm-dda');
  await waitForContext(page, 'title', 240_000);
  // Keys go to the game when its canvas has focus (a click would reach the game).
  await page.locator('canvas.cdda-canvas').focus();
}

/** Presses a key and waits for the game to ask for input again. */
export async function press(page: Page, key: string, delay = 400): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(delay);
}

/**
 * From the main menu: New Game, Play Now! (default scenario), then past the
 * start-of-game messages to the map.
 */
export async function playNow(page: Page): Promise<void> {
  await press(page, 'n');
  await press(page, 'd');
  // World and character are created without questions; the game then shows
  // its introduction (a popup) before the map.
  await expect
    .poll(
      async () => {
        const d = await cddaDebug(page);
        if (d?.context === 'map') return 'map';
        if (d?.waiting && d.inGame) await page.keyboard.press('Escape');
        return d?.inputContext ?? null;
      },
      { timeout: 300_000, intervals: [2_000], message: 'waiting for the map after Play Now' },
    )
    .toBe('map');
}

/**
 * How many pixels of the game's canvas, as shown on the page, are not black.
 * Read from a screenshot: the game draws with WebGL (its renderer option),
 * whose drawing buffer reads back blank once it has been presented.
 */
export async function litPixels(page: Page): Promise<number> {
  const canvas = page.locator('canvas.cdda-canvas');
  if (!(await canvas.count())) return 0;
  const png = await canvas.screenshot();
  return page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const copy = document.createElement('canvas');
    copy.width = image.width;
    copy.height = image.height;
    const context = copy.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 30) lit++;
    return lit;
  }, Array.from(png));
}

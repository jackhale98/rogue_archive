import { expect, type Page } from '@playwright/test';

export interface HyperDebug {
  context: string | null;
  state: {
    inMap: boolean;
    treasure: number;
    kills: number;
    turns: number;
    canMove: boolean;
    land: number;
  } | null;
  land: string;
  messages: string[];
}

export function hyperDebug(page: Page): Promise<HyperDebug | null> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __rogueArchive?: {
          adapter: {
            debug: {
              context: string | null;
              state: HyperDebug['state'];
              land: string;
              messages(): string[];
            };
          };
        };
      }
    ).__rogueArchive?.adapter.debug;
    return d ? { context: d.context, state: d.state, land: d.land, messages: d.messages() } : null;
  });
}

export async function hyperContext(page: Page): Promise<string | null> {
  return (await hyperDebug(page))?.context ?? null;
}

export async function turns(page: Page): Promise<number> {
  return (await hyperDebug(page))?.state?.turns ?? -1;
}

export async function waitForContext(page: Page, context: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => hyperContext(page), { timeout, message: `waiting for the ${context} context` })
    .toBe(context);
}

/** Opens HyperRogue and waits for the game's map. */
export async function openHyperRogue(page: Page): Promise<void> {
  await page.goto('?debug=1#/play/hyperrogue');
  await waitForContext(page, 'map', 120_000);
}

/** The game canvas's centre (where the player is drawn) and a scan radius. */
export async function canvasCentre(page: Page): Promise<{ x: number; y: number; radius: number }> {
  const box = (await page.locator('canvas.hr-canvas').boundingBox())!;
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    radius: Math.min(box.width, box.height) * 0.4,
  };
}

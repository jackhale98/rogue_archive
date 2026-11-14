import { expect, test } from '@playwright/test';

// Reading pages scroll up and down only: nothing makes them wider than the screen.
test('library and game pages never scroll sideways on a phone', async ({ page }) => {
  for (const path of [
    './',
    './#/games/nethack',
    './#/games/dcss',
    './#/games/angband',
    './#/settings',
    './#/about',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { width, scroll } = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(scroll, path).toBeLessThanOrEqual(width);
  }
});

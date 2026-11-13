import { expect, test } from '@playwright/test';

test('landing page lists games without downloading any game runtime', async ({ page }) => {
  const runtimeRequests: string[] = [];
  page.on('request', (request) => {
    if (/\.wasm$|\/runtime\/|adapter-/.test(request.url())) runtimeRequests.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Classic roguelikes');
  await expect(page.getByRole('link', { name: 'Play Brogue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dungeon Crawl Stone Soup', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coming next' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(runtimeRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('cards play directly; the full roadmap and watchlist fold away', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('link', { name: 'Play Rogue' })).toHaveAttribute('href', /#\/play\/rogue$/);
  await expect(page.getByRole('link', { name: 'Details about Rogue' })).toHaveAttribute(
    'href',
    /#\/games\/rogue$/,
  );
  // The next three roadmap games are listed; the rest and the watchlist are folded.
  await expect(page.getByRole('link', { name: /NetHack/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeHidden();
  await page.getByText(/The full roadmap/).click();
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Infra Arcana/ })).toBeVisible();
});

test('recently played games can be continued from the library', async ({ page }) => {
  await page.goto('#/play/rogue');
  await expect(page.locator('.ra-start')).toBeVisible({ timeout: 120_000 });
  await page.goto('');
  const resume = page.getByRole('link', { name: /Rogue Played/ });
  await expect(resume).toBeVisible();
  await expect(resume).toHaveAttribute('href', /#\/play\/rogue$/);
});

test('game detail shows provenance, controls and limitations', async ({ page }) => {
  await page.goto('#/games/brogue-ce');
  await expect(page.getByRole('heading', { name: 'Brogue', level: 1 })).toBeVisible();
  await expect(page.getByText('AGPL-3.0-or-later')).toBeVisible();
  await expect(page.getByText('1ba4240b7a', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Known limitations' })).toBeVisible();
  await expect(page.getByText(/MB download/)).toBeVisible();
});

test('roadmap games are not launchable', async ({ page }) => {
  await page.goto('#/games/nethack');
  await expect(page.getByText('This game is on the roadmap and is not playable yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Play / })).toHaveCount(0);
  await page.goto('#/play/nethack');
  await expect(page.getByRole('heading', { name: 'Nothing down here' })).toBeVisible();
});

test('deep links survive a reload', async ({ page }) => {
  await page.goto('#/settings');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('settings explain how long saves are kept', async ({ page }) => {
  await page.goto('#/settings');
  await expect(page.getByRole('heading', { name: 'Keeping your saves' })).toBeVisible();
  // Chromium answers persisted() either way; the page states which.
  await expect(page.getByText(/agreed to keep this site's data|may clear this site's data/)).toBeVisible();
});

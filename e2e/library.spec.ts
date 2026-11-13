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
  await expect(page.getByRole('heading', { name: 'On the roadmap' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(runtimeRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('search and filters narrow the archive', async ({ page }) => {
  await page.goto('');
  const search = page.getByRole('searchbox', { name: 'Search games' });
  await search.fill('nethack');
  await expect(page.getByText('1 game matches')).toBeVisible();
  await expect(page.getByRole('link', { name: /NetHack/ })).toBeVisible();
  await expect(page.getByText('No playable games match these filters.')).toBeVisible();
  await search.fill('');
  await page.getByRole('checkbox', { name: 'Touch controls' }).check();
  await expect(page.getByRole('heading', { name: 'Brogue', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On the roadmap' })).toHaveCount(0);
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
  await page.goto('#/games/sil-q');
  await expect(page.getByText('This game is on the roadmap and is not playable yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Play / })).toHaveCount(0);
  await page.goto('#/play/sil-q');
  await expect(page.getByRole('heading', { name: 'Nothing down here' })).toBeVisible();
});

test('deep links survive a reload', async ({ page }) => {
  await page.goto('#/settings');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

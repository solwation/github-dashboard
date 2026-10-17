import { expect, test, type Page } from '@playwright/test';

// Background statistics collection (#135, #137): the collector starts 30 s after sign-in, runs one
// repository per idle portion and pauses in hidden tabs and offline. The fake clock drives the timers;
// requestIdleCallback still fires on its own timeout or when the browser is idle.

const now = Date.parse('2026-10-16T15:00:00Z');
const repo = { id: 1, name: 'background-stats', full_name: 'sample/background-stats', private: true, description: null, html_url: 'https://github.com/sample/background-stats', owner: { login: 'sample' } };
const issue = { id: 1, number: 1, title: 'Background statistics fixture', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-16T12:00:00Z', labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: `${repo.html_url}/issues/1` };
const commit = { sha: 'background-sha', parents: [{ sha: 'parent' }], author: { login: 'sample' }, commit: { author: { name: 'Fixture author', date: '2026-10-15T01:00:00Z' }, committer: { date: '2026-10-15T01:00:00Z' } } };

async function hasStatistics(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('issueflow-vault', 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<boolean>(resolve => { const request = db.transaction('credentials').objectStore('credentials').get('statistics'); request.onsuccess = () => resolve(!!request.result); }); }
    finally { db.close(); }
  });
}

/** Signs in on a fake clock and records statistics-only requests; `block` leaves them pending. */
async function signIn(page: Page, token: string) {
  await page.clock.install({ time: new Date(now) });
  const state = { stats: [] as string[], block: false };
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    // The board's incremental sync also lists state=all issues, but since a recent minute; the
    // statistics window always starts at a UTC midnight.
    const statisticsIssues = url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'all' && /T00:00:00Z$/.test(url.searchParams.get('since') ?? '');
    const isStats = url.pathname.endsWith('/issues/events') || statisticsIssues || ((url.pathname.includes('/commits') || url.pathname.endsWith('/pulls')) && url.searchParams.get('per_page') !== '1');
    if (isStats) { state.stats.push(url.pathname); if (state.block) return; }
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: `account-${token}`, avatar_url: '' };
    else if (url.pathname === '/user/repos') data = [repo];
    else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    else if (url.pathname.endsWith('/commits')) data = [commit];
    else if (url.pathname.includes('/commits/')) data = { stats: { additions: 1, deletions: 1 }, files: [{ filename: 'fixture.ts' }] };
    await route.fulfill({ json: data, headers: { 'x-ratelimit-remaining': '4900', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': String(Math.floor((now + 3600_000) / 1000)) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill(token);
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.getByText('Background statistics fixture').first()).toBeVisible();
  return state;
}

/** Lets the idle collector run to completion in steps so idle callbacks and IndexedDB can settle. */
async function runUntilCached(page: Page) {
  await expect.poll(async () => { await page.clock.runFor(5000); return hasStatistics(page); }, { timeout: 30000 }).toBe(true);
}

/**
 * The collector reads navigator.onLine. Overriding it (instead of context.setOffline) keeps the mocked
 * network reachable, so a request that ignored the offline pause would be recorded instead of failing
 * silently at the network layer together with the lazily loaded collector chunk.
 */
async function setOnline(page: Page, online: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  }, online);
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('background collection fills the cache so Statistics opens immediately without loading', async ({ page }) => {
  const state = await signIn(page, 'fixture-background-direct');
  await page.clock.runFor(10000);
  expect(state.stats).toHaveLength(0);
  expect(await hasStatistics(page)).toBe(false);
  await page.clock.runFor(40000);
  await runUntilCached(page);
  expect(state.stats.length).toBeGreaterThan(0);

  // Any foreground statistics request now hangs: the view must render from the background cache.
  state.block = true;
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  const total = page.locator('.statistics-total').filter({ has: page.getByText('Commits', { exact: true }) });
  await expect(total.locator('strong')).toHaveText('1');
  await expect(page.locator('.statistics-loading-splash')).toHaveCount(0);
});

test('continuous wheel scrolling on desktop does not starve background collection (#148)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await signIn(page, 'fixture-background-wheel');
  await page.mouse.move(700, 500);
  await expect.poll(async () => {
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 40); await page.clock.runFor(1000); }
    return hasStatistics(page);
  }, { timeout: 60000 }).toBe(true);
  expect(state.stats.length).toBeGreaterThan(0);
});

test('background collection waits while the tab is hidden', async ({ page }) => {
  const state = await signIn(page, 'fixture-background-hidden');
  await setHidden(page, true);
  await page.clock.runFor(120000);
  expect(state.stats).toHaveLength(0);
  expect(await hasStatistics(page)).toBe(false);

  await setHidden(page, false);
  await runUntilCached(page);
  expect(state.stats.length).toBeGreaterThan(0);
});

test('background collection waits while offline', async ({ page }) => {
  const state = await signIn(page, 'fixture-background-offline');
  await setOnline(page, false);
  await page.clock.runFor(120000);
  expect(state.stats).toHaveLength(0);
  expect(await hasStatistics(page)).toBe(false);

  await setOnline(page, true);
  await runUntilCached(page);
  expect(state.stats.length).toBeGreaterThan(0);
});

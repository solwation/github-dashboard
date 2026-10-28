import { expect, test, type Page } from '@playwright/test';
import { readSettings } from './support/settings';
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(page: Page, emptyThird = false) {
  const repos = ['one', 'two', 'three'].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: true, description: null, html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' } }));
  const state = { login: 'lazy-first', blockTwo: true, second: gate(), requests: [] as URL[] };
  const date = new Date().toISOString();
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const statistics = url.pathname.endsWith('/issues/events') || (url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'all' && /T00:00:00Z$/.test(url.searchParams.get('since') ?? '')) || ((url.pathname.includes('/commits') || url.pathname.endsWith('/pulls')) && url.searchParams.get('per_page') !== '1');
    if (statistics) state.requests.push(url);
    let data: unknown = [], headers = {};
    const issue = { id: 1, number: 1, title: 'Lazy fixture', created_at: date, updated_at: date, labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: 'https://github.com/sample/one/issues/1' };
    if (url.pathname === '/user') data = { login: state.login, avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repos;
    else if (emptyThird && url.pathname.startsWith('/repos/sample/three/')) data = [];
    else if (url.pathname.endsWith('/issues/events')) {
      if (url.pathname.includes('/two/') && state.blockTwo) {
        if (url.searchParams.get('page') === '2') { await state.second.promise; headers = { 'Access-Control-Expose-Headers': 'Link', Link: `<https://api.github.com${url.pathname}?per_page=100&page=3>; rel="next"` }; }
        else headers = { 'Access-Control-Expose-Headers': 'Link', Link: `<https://api.github.com${url.pathname}?per_page=100&page=2>; rel="next"` };
      }
      data = [{ id: Number(url.searchParams.get('page') || 1), event: 'closed', created_at: date, issue }];
    } else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    else if (url.pathname.endsWith('/commits')) data = [{ sha: 'lazy-commit', parents: [{ sha: 'parent' }], commit: { committer: { date } } }];
    else if (url.pathname.includes('/commits/')) data = { stats: { additions: 1, deletions: 1 }, files: [{ filename: 'fixture.ts' }] };
    await route.fulfill({ json: data, headers });
  });
  async function signIn(select = true) {
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill('fictional-lazy-token');
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    if (select) { for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check(); await page.getByRole('button', { name: 'Visa översikt', exact: true }).click(); }
    await expect(page.getByRole('heading', { name: 'Projektöversikt.' })).toBeVisible();
  }
  async function stats() { await page.getByRole('link', { name: 'Statistik', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Statistik', exact: true })).toBeVisible(); }
  return { repos, state, signIn, stats };
}

test('statistics defaults to first only, cancels collapse work, lazily expands and restores account-bound choices', async ({ page }) => {
  const { state, signIn, stats } = await fixture(page);
  await page.goto('/'); await signIn(); await stats();
  const sections = page.locator('.statistics-repository');
  const toggles = sections.locator('.statistics-repository-toggle');
  await expect(toggles).toHaveCount(3);
  await expect(page.locator('#statistics-repo-1 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#statistics-repo-2 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#statistics-repo-3 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  const refresh = page.getByRole('button', { name: 'Uppdatera statistik', exact: true });
  await expect(refresh).toBeEnabled();
  expect(state.requests.every(url => url.pathname.includes('/one/'))).toBe(true);
  const firstCount = state.requests.filter(url => url.pathname.includes('/one/')).length;
  await page.locator('#statistics-repo-2 .statistics-repository-toggle').click();
  await expect.poll(() => state.requests.some(url => url.pathname.includes('/two/') && url.searchParams.get('page') === '2')).toBe(true);
  await page.locator('#statistics-repo-2 .statistics-repository-toggle').click();
  state.second.resolve();
  await expect(page.locator('#statistics-repo-2 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  state.blockTwo = false;
  await page.locator('#statistics-repo-2 .statistics-repository-toggle').click();
  await expect(page.locator('#statistics-repo-2').locator('[data-metric="closed"] strong')).toHaveText('1');
  await expect(refresh).toBeEnabled();
  expect(state.requests.filter(url => url.pathname.includes('/one/'))).toHaveLength(firstCount);
  expect(state.requests.some(url => url.searchParams.get('page') === '3')).toBe(false);
  await refresh.click(); await expect(refresh).toBeEnabled();
  expect(state.requests.filter(url => url.pathname.includes('/one/')).length).toBeGreaterThan(firstCount);
  expect(state.requests.some(url => url.pathname.includes('/three/'))).toBe(false);
  await page.locator('#statistics-repo-1 .statistics-repository-toggle').click(); await page.locator('#statistics-repo-2 .statistics-repository-toggle').click();
  await expect(refresh).toBeDisabled();
  await expect(page.locator('.statistics-loading-splash, .statistics-load-progress:visible')).toHaveCount(0);
  await expect.poll(async () => Object.values((await readSettings(page, 'lazy-first'))?.preferences?.statistics ?? {}).map((value: any) => value.collapsed)).toEqual([true, true, true]);
  await page.getByRole('link', { name: 'Översikt', exact: true }).click(); await stats();
  await expect(page.locator('#statistics-repo-1 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  const beforeReload = state.requests.length;
  await page.reload();
  await expect(page.locator('#statistics-repo-1 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#statistics-repo-2 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(refresh).toBeDisabled();
  expect(state.requests).toHaveLength(beforeReload);
  await page.locator('.sidebar-repository-row[data-repository="sample/three"] .sidebar-repository').click();
  await expect(page.locator('#statistics-repo-3 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#statistics-repo-3').locator('[data-metric="closed"] strong')).toHaveText('1');
  await expect(refresh).toBeEnabled();
  await page.locator('#statistics-repo-3 .statistics-repository-toggle').click();
  await expect.poll(async () => (await readSettings(page, 'lazy-first'))?.preferences?.statistics?.['sample/three']?.collapsed).toBe(true);
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await page.getByRole('button', { name: 'Logga ut och ta bort token', exact: true }).click();
  state.login = 'lazy-other'; state.requests.length = 0;
  await signIn(); await stats();
  await expect(page.locator('#statistics-repo-1 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#statistics-repo-2 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(refresh).toBeEnabled();
  expect(state.requests.every(url => url.pathname.includes('/one/'))).toBe(true);
});

test('background prefetch follows the same default and saved collapsed repositories', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T15:00:00Z') });
  const { state, signIn, stats } = await fixture(page);
  await page.goto('/'); await signIn();
  await expect.poll(async () => { await page.clock.runFor(5000); return state.requests.length; }).toBeGreaterThan(0);
  expect(state.requests.every(url => url.pathname.includes('/one/'))).toBe(true);
  await stats();
  const toggle = page.locator('.statistics-repository-toggle').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect.poll(async () => { await page.clock.runFor(500); return (await readSettings(page, 'lazy-first'))?.preferences?.statistics?.['sample/one']?.collapsed; }).toBe(true);
  await page.getByRole('link', { name: 'Översikt', exact: true }).click();
  const count = state.requests.length;
  await page.clock.fastForward(3_600_000);
  await page.clock.runFor(1000);
  expect(state.requests).toHaveLength(count);
});

test('combined mode collects split-collapsed selected repositories and restores lazy split collection', async ({ page }) => {
  const { state, signIn, stats } = await fixture(page);
  state.blockTwo = false;
  await page.goto('/'); await signIn(); await stats();
  const refresh = page.getByRole('button', { name: 'Uppdatera statistik', exact: true });
  await expect(refresh).toBeEnabled();
  expect(state.requests.every(url => url.pathname.includes('/one/'))).toBe(true);
  const split = page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true });
  await split.uncheck();
  await expect(page.locator('.statistics-combined-chart [data-metric="closed"] strong')).toHaveText('3');
  expect(state.requests.some(url => url.pathname.includes('/two/'))).toBe(true);
  expect(state.requests.some(url => url.pathname.includes('/three/'))).toBe(true);
  await expect(page.locator('.statistics-chart')).toHaveCount(1);
  await split.check();
  await expect(page.locator('#statistics-repo-2 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#statistics-repo-3 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
  const before = state.requests.filter(url => !url.pathname.includes('/one/')).length;
  await expect(refresh).toBeEnabled();
  await refresh.click(); await expect(refresh).toBeEnabled();
  expect(state.requests.filter(url => !url.pathname.includes('/one/'))).toHaveLength(before);
});

for (const scenario of [
  { name: 'wide', width: 1600, height: 1000, mobile: false },
  { name: 'rail', width: 950, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
]) test(`combined statistics hides empty project sections: ${scenario.name}`, async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: scenario.mobile, hasTouch: scenario.mobile, locale: 'sv-SE', reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    const { state, signIn, stats } = await fixture(page, true);
    state.blockTwo = false;
    await page.goto('/'); await signIn(); await stats();
    const split = page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true });
    await expect(page.locator('#statistics-repo-3 .statistics-repository-toggle')).toBeVisible();
    await split.uncheck();
    const combined = page.locator('.statistics-combined-chart');
    await expect(combined.locator('[data-metric="closed"] strong')).toHaveText('2');
    await expect(page.getByRole('button', { name: 'Uppdatera statistik', exact: true })).toBeEnabled();
    await expect(page.locator('#statistics-repo-3')).toHaveCount(0);
    await expect(page.locator('.statistics-repository')).toHaveCount(3);
    await expect(page.locator('.statistics-chart')).toHaveCount(1);
    const contributor = page.locator('#statistics-repo-1').getByRole('combobox', { name: 'Bidragsgivare', exact: true });
    await contributor.selectOption('sample');
    await expect(contributor).toHaveValue('sample');
    await expect(combined.locator('[data-metric="closed"] strong')).toHaveText('1');
    const edges = await page.locator('.statistics-repo-filters').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().left));
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('.statistics-repositories').screenshot({ path: info.outputPath(`empty-project-${scenario.name}-${theme}.png`) });
    }
    await split.check();
    await expect(page.locator('#statistics-repo-3 .statistics-repository-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(contributor).toHaveValue('sample');
    await split.uncheck();
    await expect(page.locator('#statistics-repo-3')).toHaveCount(0);
    await expect(page.locator('.statistics-chart')).toHaveCount(1);
  } finally { await context.close(); }
});

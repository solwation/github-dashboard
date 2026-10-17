import { expect, test, type Page } from '@playwright/test';

// 12 repositories × 70 issues: the board must keep ticking labels without re-rendering the App root (#120).
const minute = 60000;
const repos = Array.from({ length: 12 }, (_, index) => {
  const name = `perf-${String(index + 1).padStart(2, '0')}`;
  return { id: index + 1, name, full_name: `sample/${name}`, private: true, description: '', html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' } };
});
function fixture(page: Page, base: number) {
  // Every in-progress issue started within the hour, so all of them show ticking seconds.
  const startedAt = (number: number) => new Date(base - (number - 20) * minute).toISOString();
  const issue = (repo: typeof repos[number], number: number) => {
    const closed = number > 45;
    const labels = number <= 25 ? [{ name: `priority: ${['high', 'medium', 'low'][number % 3]}`, color: '000000' }] : closed ? [] : [{ name: 'in-progress', color: '000000' }];
    return { id: repo.id * 1000 + number, number, title: `${repo.name} issue ${number}`, body: '', comments: 0, state: closed ? 'closed' : 'open', labels, assignees: [],
      created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-02T00:00:00Z', html_url: `${repo.html_url}/issues/${number}`,
      closed_at: closed ? new Date(base - (number === 46 ? 20000 : (number - 45) * 86400000)).toISOString() : null };
  };
  return page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    const events = url.pathname.match(/\/issues\/(\d+)\/events$/);
    const state = url.searchParams.get('state');
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'perf-account', avatar_url: '' }
      : url.pathname === '/user/repos' ? repos
      : repo && events ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: startedAt(Number(events[1])) }]
      : repo && url.pathname.endsWith('/issues') && (state === 'open' || state === 'closed')
        ? Array.from({ length: 70 }, (_, index) => issue(repo, index + 1)).filter(item => item.state === state) : [] });
  });
}
/** Counts App root renders through the dev build's root instance; measurement only, never shipped. */
const countAppRenders = (page: Page) => page.evaluate(() => {
  const app = (document.querySelector('#app') as unknown as { __vue_app__: { _instance: { render: (...args: unknown[]) => unknown } } }).__vue_app__;
  const instance = app._instance, render = instance.render;
  const state = window as unknown as { appRenders: number };
  state.appRenders = 0;
  instance.render = function (this: unknown, ...args: unknown[]) { state.appRenders++; return render.apply(this, args); };
});
const appRenders = (page: Page) => page.evaluate(() => (window as unknown as { appRenders: number }).appRenders);
/** Changes inside issue cards and summary tiles, i.e. any re-rendered time label; sync status text is data, not ticking. */
const watchBoard = (page: Page) => page.evaluate(() => {
  const state = window as unknown as { boardMutations: number };
  state.boardMutations = 0;
  const element = (node: Node) => node instanceof Element ? node : node.parentElement;
  new MutationObserver(records => { state.boardMutations += records.filter(record => element(record.target)?.closest('.issue-card, .stats')).length; })
    .observe(document.querySelector('.board-column')!.closest('main > div')!, { subtree: true, characterData: true, childList: true });
});
const boardMutations = (page: Page) => page.evaluate(() => (window as unknown as { boardMutations: number }).boardMutations);

test('per-second labels tick without re-rendering the App root, and pause when hidden or on Statistics', async ({ page, context }) => {
  test.setTimeout(120000);
  await fixture(page, Date.now());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-perf-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('.issue-card')).toHaveCount(12 * 3 * 6);
  const recent = page.locator('.issue-card').filter({ has: page.getByText('perf-01 issue 45', { exact: true }) }).locator('.timer');
  const closed = page.locator('.issue-card').filter({ has: page.getByText('perf-01 issue 46', { exact: true }) }).locator('.closed-date');
  await expect(recent).toHaveText(/^\d+m \d+s$/);
  await expect(closed).toHaveText(/sekunder sedan/);
  // Background sync would legitimately re-render on new data; keep the measured window idle,
  // with the lazily loaded Statistics module fetched beforehand.
  await page.evaluate(path => import(/* @vite-ignore */ path), '/src/components/StatisticsView.vue');
  await context.setOffline(true);
  await page.waitForTimeout(2000);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const busy = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'TaskDuration')!.value;
  await countAppRenders(page);
  const before = await recent.textContent();
  const [startBusy, start] = [await busy(), Date.now()];
  await page.waitForTimeout(5000);
  const cpu = (await busy() - startBusy) / ((Date.now() - start) / 1000);
  console.log(`idle main-thread busy ${(cpu * 100).toFixed(1)}% (≈${(cpu * 1000).toFixed(1)} ms per one-second tick), App renders ${await appRenders(page)}`);
  await expect(recent).not.toHaveText(before!);
  expect(await appRenders(page)).toBe(0);
  expect(cpu).toBeLessThan(0.05);

  // A hidden tab does no per-second rendering and refreshes immediately when shown again.
  await watchBoard(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => { (window as unknown as { boardMutations: number }).boardMutations = 0; });
  await page.waitForTimeout(3000);
  expect(await boardMutations(page)).toBe(0);
  const hiddenText = await recent.textContent();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(recent).not.toHaveText(hiddenText!);

  // The overview stays mounted under v-show while Statistics is shown, but stops ticking.
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => { (window as unknown as { boardMutations: number }).boardMutations = 0; });
  await page.waitForTimeout(3000);
  expect(await boardMutations(page)).toBe(0);
  await page.getByRole('link', { name: 'Översikt', exact: true }).click();
  await expect(recent).toBeVisible();
  const shownText = await recent.textContent();
  await expect(recent).not.toHaveText(shownText!);
  // Only the two view switches re-render the App root.
  console.log(`App renders across two view switches: ${await appRenders(page)}`);
  expect(await appRenders(page)).toBeLessThan(6);
});

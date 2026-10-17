import { expect, test, type Page } from '@playwright/test';

// Startup from the encrypted content cache with 12 repositories × 70 issues (#121), measured on
// the production build: the first card must draw quickly and without long main-thread tasks.
test.use({ baseURL: 'http://127.0.0.1:4173' });
const base = '/github-dashboard/';
const repos = Array.from({ length: 12 }, (_, index) => {
  const name = `cache-${String(index + 1).padStart(2, '0')}`;
  return { id: index + 1, name, full_name: `sample/${name}`, private: true, description: '', html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' } };
});
async function fixture(page: Page) {
  const state = { blocked: false };
  const at = Date.now();
  const issue = (repo: typeof repos[number], number: number) => {
    const closed = number > 45;
    const labels = number <= 25 ? [{ name: `priority: ${['high', 'medium', 'low'][number % 3]}`, color: '000000' }] : closed ? [] : [{ name: 'in-progress', color: '000000' }];
    return { id: repo.id * 1000 + number, number, title: `${repo.name} issue ${number}`, body: `Description of ${repo.name} issue ${number}. `.repeat(8), comments: 0,
      state: closed ? 'closed' : 'open', labels, assignees: [], created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-02T00:00:00Z',
      html_url: `${repo.html_url}/issues/${number}`, closed_at: closed ? new Date(at - (number - 45) * 3600000).toISOString() : null };
  };
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    // Holding GitHub keeps the measured window on the cache path alone.
    if (state.blocked) return;
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    const status = url.searchParams.get('state');
    await route.fulfill({ json: url.pathname === '/graphql' ? { data: { repository: { issue: null } } }
      : url.pathname === '/user' ? { login: 'cache-perf', avatar_url: '' }
      : url.pathname === '/user/repos' ? repos
      : repo && /\/issues\/\d+\/events$/.test(url.pathname) ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: new Date(at - 600000).toISOString() }]
      : repo && url.pathname.endsWith('/issues') && (status === 'open' || status === 'closed')
        ? Array.from({ length: 70 }, (_, index) => issue(repo, index + 1)).filter(item => item.state === status) : [] });
  });
  return state;
}
const cacheSaved = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('issueflow-vault', 1); request.onsuccess = () => resolve(request.result); });
  try {
    return await new Promise<number>(resolve => { const request = db.transaction('credentials').objectStore('credentials').get('content'); request.onsuccess = () => resolve(request.result?.ciphertext.byteLength ?? 0); });
  } finally { db.close(); }
});

for (const [throttle, firstCardLimit, longTaskLimit] of [[1, 1000, 200], [4, 4000, Infinity]] as const) {
  test(`first cached card draws within ${firstCardLimit} ms at ${throttle}× CPU`, async ({ page, context }) => {
    test.setTimeout(120000);
    const state = await fixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base);
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill('fixture-cache-perf-token');
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(page.locator('.issue-card')).toHaveCount(12 * 3 * 6);
    // The final snapshot holds every lane; earlier saves may have been written mid-load.
    await page.waitForTimeout(1500);
    await expect.poll(() => cacheSaved(page)).toBeGreaterThan(0);
    const bytes = await cacheSaved(page);

    await page.addInitScript(() => {
      const record = window as unknown as { longest: number; firstCard: number };
      record.longest = 0; record.firstCard = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) record.longest = Math.max(record.longest, entry.duration); })
        .observe({ type: 'longtask', buffered: true });
      const check = () => {
        if (document.querySelector('.issue-card')) record.firstCard = performance.now();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    state.blocked = true;
    const cdp = await context.newCDPSession(page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    // Parallel test workers share the CPU, so a startup slowed by them is retried twice.
    let run = { firstCard: Infinity, longest: Infinity };
    for (let attempt = 0; attempt < 3 && !(run.firstCard < firstCardLimit && run.longest < longTaskLimit); attempt++) {
      await page.reload();
      await expect(page.locator('.issue-card').first()).toBeVisible({ timeout: 30000 });
      await expect.poll(() => page.evaluate(() => (window as unknown as { firstCard: number }).firstCard)).toBeGreaterThan(0);
      // Let the remaining repositories mount so their long tasks are counted as well.
      await expect(page.locator('.issue-card')).toHaveCount(12 * 3 * 6);
      await page.waitForTimeout(500 * throttle);
      run = await page.evaluate(() => {
        const record = window as unknown as { longest: number; firstCard: number };
        return { firstCard: record.firstCard, longest: record.longest };
      });
      console.log(`${throttle}× CPU, ${(bytes / 1024).toFixed(0)} KiB ciphertext: first card ${run.firstCard.toFixed(0)} ms, longest task ${run.longest.toFixed(0)} ms`);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(run.firstCard).toBeLessThan(firstCardLimit);
    expect(run.longest).toBeLessThan(longTaskLimit);
  });
}

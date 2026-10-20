import { expect, test } from '@playwright/test';
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('statistics displays batched real pages and diffs, preserves refresh data and drops late signed-out work', async ({ page }) => {
  const repo = { id: 1, name: 'progress', full_name: 'sample/progress', private: true, description: null, html_url: 'https://github.com/sample/progress', owner: { login: 'sample' } };
  const date = new Date().toISOString();
  const issue = { id: 1, number: 1, title: 'Synthetic progress fixture', created_at: date, updated_at: date, labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: `${repo.html_url}/issues/1` };
  const event = (id: number) => ({ id, event: 'closed', created_at: date, issue, actor: { login: 'sample' } });
  let eventPage = gate(), detailPage = gate(), refreshed = false;
  let details = 0;
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [], headers = {};
    if (url.pathname === '/user') data = { login: 'progress-fixture', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = [repo];
    else if (url.pathname.endsWith('/issues/events')) {
      if (url.searchParams.get('page') === '2') { await eventPage.promise; data = refreshed ? [event(2), event(3)] : [event(2)]; }
      else { data = [event(1)]; headers = { 'Access-Control-Expose-Headers': 'Link', Link: `<https://api.github.com${url.pathname}?per_page=100&page=2>; rel="next"` }; }
    } else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    else if (url.pathname.endsWith('/commits')) data = [1, 2, 3].map(id => ({ sha: `progress-${id}`, parents: [{ sha: 'parent' }], author: { login: 'sample' }, commit: { committer: { date } } }));
    else if (url.pathname.includes('/commits/')) {
      details++;
      if (!url.pathname.endsWith('/progress-1')) await detailPage.promise;
      data = { stats: { additions: 10, deletions: 4 }, files: [{ filename: 'fixture.ts' }] };
    } else if (url.pathname.endsWith('/pulls')) return route.fulfill({ status: 403, json: { message: 'Resource not accessible by personal access token' } });
    await route.fulfill({ json: data, headers });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-progress-fixture-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  const closed = page.locator('[data-metric="closed"]');
  const additions = page.locator('[data-metric="additions"]');
  const refresh = page.getByRole('button', { name: 'Uppdatera statistik', exact: true });
  await expect(closed.locator('strong')).toHaveText('1');
  await expect(closed.locator('.statistics-partial')).toBeVisible();
  await expect(page.locator('[data-metric="created"] strong')).toHaveText('1');
  await expect(page.locator('[data-metric="commits"] strong')).toHaveText('3');
  await expect(page.locator('[data-metric="prsOpened"], [data-metric="additions"]')).toHaveCount(0);
  await expect(page.locator('.statistics-refreshing')).toContainText('Värden och diagram uppdateras löpande.');
  await expect(refresh).toBeDisabled();
  await expect(page.locator('.statistics-chart')).toBeVisible();
  const hasSavedStatistics = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('issueflow-vault', 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<boolean>(resolve => { const request = db.transaction('credentials').objectStore('credentials').get('statistics'); request.onsuccess = () => resolve(!!request.result); }); }
    finally { db.close(); }
  });
  expect(await hasSavedStatistics()).toBe(false);
  eventPage.resolve();
  await expect(closed.locator('strong')).toHaveText('2');
  await expect(additions.locator('strong')).toHaveText('10');
  await expect(additions.locator('.statistics-partial')).toBeVisible();
  await expect(refresh).toBeDisabled();
  await additions.click(); await closed.click();
  await expect(additions).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: test.info().outputPath('partial-diffs.png'), fullPage: true });
  expect(await hasSavedStatistics()).toBe(false);
  detailPage.resolve();
  await expect(additions.locator('strong')).toHaveText('30');
  await expect(additions.locator('.statistics-partial')).toHaveCount(0);
  await expect(refresh).toBeEnabled();
  expect(await hasSavedStatistics()).toBe(true);
  expect(details).toBe(3);
  eventPage = gate(); refreshed = true;
  await refresh.click();
  await expect(closed.locator('.statistics-partial')).toBeVisible();
  await expect(closed.locator('strong')).toHaveText('2');
  await expect(additions.locator('strong')).toHaveText('30');
  await expect(additions).toHaveAttribute('aria-pressed', 'true');
  eventPage.resolve();
  await expect(closed.locator('strong')).toHaveText('3');
  await expect(refresh).toBeEnabled();
  expect(details).toBe(3);
  eventPage = gate();
  await refresh.click();
  await expect(closed.locator('.statistics-partial')).toBeVisible();
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await page.getByRole('button', { name: 'Logga ut och ta bort token', exact: true }).click();
  eventPage.resolve();
  await expect(page.getByRole('button', { name: 'Anslut GitHub', exact: true })).toBeVisible();
  await expect(page.locator('.statistics-repository')).toHaveCount(0);
  expect(await hasSavedStatistics()).toBe(false);
  // Account settings survive logout, while the statistics cache does not. A
  // selected code metric must survive the next issues-only partial snapshot.
  eventPage = gate(); detailPage = gate(); refreshed = false;
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-progress-fixture-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projektöversikt.' })).toBeVisible();
  // Logout currently retains the old hash; navigate through Overview so this
  // preference regression does not depend on that separate navigation defect.
  await page.getByRole('link', { name: 'Översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Statistik', exact: true })).toBeVisible();
  await expect(closed.locator('strong')).toHaveText('1');
  await expect(additions).toHaveCount(0);
  eventPage.resolve();
  await expect(additions.locator('strong')).toHaveText('10');
  await expect(additions).toHaveAttribute('aria-pressed', 'true');
  await expect(closed).toHaveAttribute('aria-pressed', 'false');
  detailPage.resolve();
  await expect(additions.locator('strong')).toHaveText('30');
  await expect(refresh).toBeEnabled();
});

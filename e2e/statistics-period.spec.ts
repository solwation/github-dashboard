import { expect, test } from '@playwright/test';
test.use({ timezoneId: 'UTC' });

test('three-day statistics include older pages and diffs after changing period, refresh and encrypted restore', async ({ page }) => {
  const now = Date.parse('2026-10-16T15:00:00Z');
  await page.clock.install({ time: new Date(now) });
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const repo = { id: 1, name: 'period', full_name: 'sample/period', private: true, description: null, html_url: 'https://github.com/sample/period', owner: { login: 'sample' } };
  const issue = { id: 1, number: 1, title: 'Synthetic period fixture', created_at: at(60), updated_at: at(1), labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: `${repo.html_url}/issues/1` };
  const events = Array.from({ length: 602 }, (_, id) => ({ id, event: 'closed', created_at: at(id < 600 ? 12 : id === 600 ? 36 : 60), issue, actor: { login: 'sample' } }));
  const commits = Array.from({ length: 63 }, (_, id) => ({ sha: `period-${id}`, parents: [{ sha: 'parent' }], author: { login: 'sample' }, commit: { committer: { date: at(id < 61 ? 12 : id === 61 ? 36 : 60) } } }));
  let details = 0;
  let capped = false;
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [], headers = {};
    if (url.pathname === '/user') data = { login: 'period-fixture', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = [repo];
    else if (url.pathname.endsWith('/issues/events')) {
      const index = Number(url.searchParams.get('page') || 1);
      data = capped ? [{ ...events[0], id: index }] : events.slice((index - 1) * 100, index * 100);
      if (capped || index < 7) headers = { "Access-Control-Expose-Headers": "Link", link: `<https://api.github.com${url.pathname}?per_page=100&page=${index + 1}>; rel="next"` };
    } else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    else if (url.pathname.endsWith('/commits')) data = commits;
    else if (url.pathname.includes('/commits/')) { details++; data = { stats: { additions: 10, deletions: 4 }, files: [{ filename: 'fixture.ts' }] }; }
    await route.fulfill({ json: data, headers });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-period-fixture-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  const range = page.getByRole('combobox', { name: 'Tidsintervall', exact: true });
  const closed = page.locator('[data-metric="closed"]');
  const additions = page.locator('[data-metric="additions"]');
  const refresh = page.getByRole('button', { name: 'Uppdatera statistik', exact: true });
  await expect(closed.locator('strong')).toHaveText('602');
  await expect(additions.locator('strong')).toHaveText('630');
  const points = page.locator('.statistics-chart circle title');
  await expect(points).toHaveText([/Stängda issues.*: 1$/, /Stängda issues.*: 1$/, /Stängda issues.*: 600$/]);
  await range.selectOption('24h');
  await expect(closed.locator('strong')).toHaveText('600');
  await expect(additions.locator('strong')).toHaveText('610');
  await range.selectOption('3d');
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(closed.locator('strong')).toHaveText('602');
  expect(details).toBe(63);
  await page.reload();
  await expect(closed.locator('strong')).toHaveText('602');
  await expect(additions.locator('strong')).toHaveText('630');
  await expect(refresh).toBeEnabled();
  expect(details).toBe(63);
  await page.screenshot({ path: test.info().outputPath('three-days.png'), fullPage: true });
  // A safety ceiling still produces explicit per-chart coverage, rather than
  // suggesting that absent older records are a fully measured zero.
  capped = true;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('.statistics-panel .statistics-message')).toHaveText('Delvis underlag för Stängda issues. Aktivitet i den valda perioden kan saknas.');
  await expect(closed.locator('.statistics-partial')).toBeVisible();
  await additions.click();
  await closed.click();
  await expect(page.locator('.statistics-panel .statistics-message')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('loading status separates sparse history from coverage and estimates discovered diff work', async ({ page }) => {
  const until = Date.parse('2026-10-20T12:00:00Z');
  const old = '2026-09-30T12:00:00Z';
  const repo = { id: 1, name: 'load-status', full_name: 'sample/load-status', private: true, description: null, html_url: 'https://github.com/sample/load-status', owner: { login: 'sample' } };
  const issue = { id: 1, number: 1, title: 'Synthetic loading status', created_at: old, updated_at: new Date(until - 1000).toISOString(), labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: `${repo.html_url}/issues/1` };
  const lists = gate(), remaining = gate();
  await page.clock.install({ time: new Date(until) });
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: 'load-status-account', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = [repo];
    else if (url.pathname.endsWith('/issues/events')) { await lists.promise; data = [{ id: 1, event: 'closed', created_at: old, issue }]; }
    else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    else if (url.pathname.endsWith('/commits')) data = Array.from({ length: 6 }, (_, id) => ({ sha: `status-${id}`, parents: [{ sha: 'parent' }], commit: { committer: { date: old } } }));
    else if (url.pathname.includes('/commits/')) {
      const id = Number(url.pathname.split('-').at(-1));
      if (id < 3) await new Promise(resolve => setTimeout(resolve, 2200)); else await remaining.promise;
      data = { stats: { additions: 1, deletions: 1 }, files: [{ filename: 'fixture.ts' }] };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-load-status-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  const status = page.getByRole('region', { name: 'Statistikhämtning', exact: true });
  const refresh = page.getByRole('button', { name: 'Uppdatera statistik', exact: true });
  await expect.poll(async () => { await page.clock.runFor(500); return status.textContent(); }).toContain('Kontrollerar underlag: 3 av 4 källor.');
  await expect(status).toContainText('Fullt hämtade underlag: 3 av 4.');
  await expect(status).toContainText('cirka 20 dagar bakåt');
  await expect(status).toContainText('Insamlingsperiod:');
  await expect(status).toContainText('Visad period:');
  const spinner = status.locator('.statistics-load-spinner');
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveCSS('animation-name', /^statistics-load-spin/);
  await expect(status.locator('.statistics-load-activity')).toHaveAttribute('aria-hidden', 'true');
  await expect(status.getByRole('progressbar')).toHaveCount(0);
  await expect(status).not.toContainText('Ungefär');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(spinner).toHaveCSS('animation-name', 'none');
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await status.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('load-status-sources-mobile.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  lists.resolve();
  await expect.poll(async () => { await page.clock.runFor(500); return status.textContent(); }).toContain('Kodändringar: 0 av 6 commits (0 %).');
  // Let three actual HTTP detail results finish; elapsed browser time supplies
  // a measured sample, while the next three requests remain blocked.
  await expect.poll(async () => { await page.clock.runFor(500); return status.textContent(); }, { timeout: 10000 }).toContain('Kodändringar: 3 av 6 commits (50 %).');
  await expect(status).toContainText('Ungefär');
  await expect(spinner).toBeVisible();
  await expect(status.getByRole('progressbar')).toHaveAttribute('value', '50');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await status.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('load-status-mobile.png'), fullPage: true });
  remaining.resolve();
  await expect(refresh).toBeEnabled();
  await expect(status).toHaveCount(0);
});

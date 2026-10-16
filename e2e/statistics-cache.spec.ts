import { expect, test, type Page } from '@playwright/test';
const token = 'fixture-statistics-cache-token';
async function hasStatistics(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('issueflow-vault', 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<boolean>(resolve => { const request = db.transaction('credentials').objectStore('credentials').get('statistics'); request.onsuccess = () => resolve(!!request.result); }); }
    finally { db.close(); }
  });
}
test('encrypted statistics restore before revalidation, extend two days with overlap and clear on logout', async ({ page }) => {
  const firstNow = Date.parse('2026-10-16T15:00:00Z');
  await page.clock.install({ time: new Date(firstNow) });
  const repo = { id: 1, name: 'private-stats', full_name: 'sample/private-stats', private: true, description: null, html_url: 'https://github.com/sample/private-stats', owner: { login: 'sample' } };
  let shifted = false, blocked = false, offline = false;
  const gates: (() => void)[] = [];
  const requests: URL[] = [];
  const issue = { id: 1, number: 1, title: 'Private statistics fixture', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-16T12:00:00Z', labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: `${repo.html_url}/issues/1` };
  const commit = (sha: string, date: string) => ({ sha, parents: [{ sha: 'parent' }], author: { login: 'sample' }, commit: { author: { name: 'Fixture author', date }, committer: { date } } });
  const all = [commit('private-historical-sha', '2026-10-10T01:00:00Z'), commit('private-overlap-sha', '2026-10-16T01:00:00Z'), commit('private-new-sha', '2026-10-18T01:00:00Z')];
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const stats = url.pathname.endsWith('/issues/events') || (url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'all') || ((url.pathname.includes('/commits') || url.pathname.endsWith('/pulls')) && url.searchParams.get('per_page') !== '1');
    if (stats) {
      requests.push(url);
      if (blocked) await new Promise<void>(resolve => { gates.push(resolve); });
      if (offline) { await route.abort('failed'); return; }
    }
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: 'statistics-cache-account', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = [repo];
    else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    else if (url.pathname.endsWith('/issues/events')) data = [{ id: 1, event: 'closed', created_at: '2026-10-11T01:00:00Z', issue, actor: { login: 'sample' } }];
    else if (url.pathname.endsWith('/commits')) data = all.slice(0, shifted ? 3 : 2).filter(commit => !url.searchParams.has('since') || commit.commit.committer.date >= url.searchParams.get('since')!);
    else if (url.pathname.includes('/commits/')) data = { stats: { additions: 10, deletions: 4 }, files: [{ filename: 'fixture.ts' }] };
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill(token);
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  const total = page.locator('.statistics-total').filter({ has: page.getByText('Commits', { exact: true }) });
  await expect(total.locator('strong')).toHaveText('2');
  await expect.poll(() => hasStatistics(page)).toBe(true);
  const encrypted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('issueflow-vault', 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<{ fields: string[]; text: string }>(resolve => { const request = db.transaction('credentials').objectStore('credentials').get('statistics'); request.onsuccess = () => resolve({ fields: Object.keys(request.result).sort(), text: new TextDecoder().decode(request.result.ciphertext) }); }); }
    finally { db.close(); }
  });
  expect(encrypted.fields).toEqual(['ciphertext', 'iv']);
  expect(encrypted.text).not.toContain('private-historical-sha');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('private-historical-sha');
  const detailCount = requests.filter(url => url.pathname.includes('/commits/')).length;
  blocked = true; shifted = true; requests.length = 0;
  await page.clock.setSystemTime(new Date(firstNow + 2 * 86400000));
  await page.reload();
  await expect(total.locator('strong')).toHaveText('2');
  await expect(page.locator('.statistics-loading-splash')).toHaveCount(0);
  await expect(page.locator('.statistics-refreshing')).toBeVisible();
  await expect(total.getByText('Delvis data', { exact: true })).toBeVisible();
  blocked = false; gates.splice(0).forEach(resolve => resolve());
  await expect(total.locator('strong')).toHaveText('3');
  await expect(page.locator('.statistics-refreshing')).toHaveCount(0);
  expect(requests.find(url => url.pathname.endsWith('/commits'))?.searchParams.get('since')).toBe('2026-10-16T00:00:00Z');
  expect(detailCount).toBe(2);
  expect(requests.filter(url => url.pathname.includes('/commits/')).map(url => url.pathname)).toEqual(['/repos/sample/private-stats/commits/private-new-sha']);
  offline = true;
  await page.reload();
  await expect(total.locator('strong')).toHaveText('3');
  await expect(page.locator('.statistics-repository .notice')).toContainText('Statistiken kunde inte uppdateras helt');
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await page.getByRole('button', { name: 'Logga ut och ta bort token', exact: true }).click();
  expect(await hasStatistics(page)).toBe(false);
});

test('statistics encryption has a separate purpose and cannot survive changed credentials or pending logout writes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/lib/vault.ts';
    const vault = await import(/* @vite-ignore */ path);
    await vault.saveToken('stats-account-a');
    await vault.saveContent('stats-account-a', { board: 'board fixture' });
    await vault.saveStatistics('stats-account-a', { statistics: 'statistics fixture' });
    const right = await vault.loadStatistics('stats-account-a');
    const wrong = await vault.loadStatistics('stats-account-b');
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('issueflow-vault', 1); request.onsuccess = () => resolve(request.result); });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('credentials', 'readwrite'), store = tx.objectStore('credentials');
        const board = store.get('content'), stats = store.get('statistics');
        let ready = 0;
        const swap = () => { if (++ready === 2) { store.put(board.result, 'statistics'); store.put(stats.result, 'content'); } };
        board.onsuccess = swap; stats.onsuccess = swap;
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    const swapped = await vault.loadStatistics('stats-account-a');
    await vault.saveToken('stats-account-b');
    await vault.saveStatistics('stats-account-a', { stale: 'must not publish' });
    const afterSwitch = await vault.loadStatistics('stats-account-b');
    await Promise.all([vault.saveStatistics('stats-account-b', { pending: 'must be cleared' }), vault.clearToken()]);
    return { right, wrong, swapped, afterSwitch, token: await vault.loadToken() };
  });
  expect(result).toEqual({ right: { statistics: 'statistics fixture' }, wrong: null, swapped: null, afterSwitch: null, token: null });
  expect(await hasStatistics(page)).toBe(false);
});

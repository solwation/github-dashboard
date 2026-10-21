import { expect, test, type Page } from '@playwright/test';
import { readSettings } from './support/settings';

test('public workspaces add validated repositories, save encrypted choices, restore and stay separate from sign-in', async ({ page }) => {
  const repo = { id: 501, name: 'public-board', full_name: 'sample/public-board', private: false, html_url: 'https://github.com/sample/public-board', description: 'Public fixture', owner: { login: 'sample' } };
  const requests: { path: string; authorized: boolean }[] = [];
  const date = new Date(Date.now() - 3600000).toISOString();
  const issue = { id: 1, number: 1, title: 'Real public workflow fixture', state: 'open', labels: [], assignees: [], comments: 0, created_at: date, updated_at: date, closed_at: null, html_url: `${repo.html_url}/issues/1` };
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, authorized: 'authorization' in route.request().headers() });
    if (url.pathname === '/repos/sample/public-board') return route.fulfill({ json: repo });
    if (url.pathname === '/repos/sample/private') return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    if (url.pathname === '/user') return route.fulfill({ json: { login: 'signed-account', avatar_url: '' } });
    if (url.pathname === '/user/repos') return route.fulfill({ json: [repo] });
    return route.fulfill({ json: url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed' ? [issue] : [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Följ publika repositories', exact: true }).click();
  const input = page.getByLabel('Publikt repository', { exact: true });
  await input.fill('sample/private');
  await page.getByRole('button', { name: 'Lägg till repository', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('404');
  await input.fill(repo.html_url);
  await page.getByRole('button', { name: 'Lägg till repository', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: repo.full_name })).toBeChecked();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('.issue-card')).toContainText(issue.title);
  await page.getByRole('group', { name: 'Visningsläge för boarden', exact: true }).getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.locator('.issue-row')).toContainText(issue.title);
  const calls = requests.length;
  await page.waitForTimeout(16000);
  expect(requests).toHaveLength(calls); // No anonymous polling or GraphQL fan-out.
  expect(requests.every(request => !request.authorized && !/^\/(user|graphql)(\/|$)/.test(request.path))).toBe(true);
  await page.reload();
  await expect(page.locator('.issue-row')).toContainText(issue.title);
  expect(requests).toHaveLength(calls); // Encrypted public content restores without API requests.
  expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.includes('sample/') || value.includes('sample/') || value.includes('Real public')))).toBe(false);
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await expect(page.locator('#statistics-repo-501 [data-metric="created"] strong')).toHaveText('1');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Lämna publik vy', exact: true }).click();
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-public-mode-switch');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: repo.full_name })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Lämna publik vy', exact: true })).toHaveCount(0);
  const authenticatedCalls = requests.length;
  await page.evaluate(() => localStorage.setItem('issueflow:public-mode', 'true'));
  await page.reload();
  await expect(page.locator('.issue-row')).toContainText(issue.title);
  expect(requests.slice(authenticatedCalls).every(request => !request.authorized && !/^\/(user|graphql)(\/|$)/.test(request.path))).toBe(true);
  // Leaving public mode preserves the encrypted sign-in, which can restore on reload.
  await page.getByRole('button', { name: 'Lämna publik vy', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: repo.full_name })).not.toBeChecked();

});

async function publicCacheFixture(page: Page) {
  const repos = ['alpha', 'beta'].map((name, i) => ({ id: i + 1, name, full_name: `sample/${name}`, private: false, html_url: `https://github.com/sample/${name}`, description: 'Public cache fixture', owner: { login: 'sample' } }));
  const requests: string[] = [];
  let failure: 'quota' | 'network' | null = null;
  let revision = 1;
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname);
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}`));
    if (repo && url.pathname === `/repos/${repo.full_name}`) return route.fulfill({ json: repo });
    if (url.pathname.startsWith('/repos/sample/alpha/') && failure) {
      if (failure === 'network') return route.abort();
      return route.fulfill({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) }, json: { message: 'Rate limit exceeded' } });
    }
    const time = new Date(Date.now() - 3600000).toISOString();
    return route.fulfill({ json: repo && url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open' ? [{ id: repo.id, number: 1, title: `${repo.name} revision ${revision}`, state: 'open', labels: [], assignees: [], created_at: time, updated_at: time, closed_at: null, html_url: `${repo.html_url}/issues/1` }] : [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Följ publika repositories', exact: true }).click();
  async function add(name: string) {
    await page.getByLabel('Publikt repository', { exact: true }).fill(`sample/${name}`);
    await page.getByRole('button', { name: 'Lägg till repository', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: `sample/${name}` })).toBeChecked();
  }
  await add('alpha');
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('#repo-1 .issue-card')).toContainText('alpha revision 1');
  await expect.poll(() => readSettings(page, ':public-content:').then(value => value?.entries.length)).toBe(1);
  return { requests, add, fail(value: typeof failure) { failure = value; }, revise() { revision++; } };
}

test('public cache preserves successful lanes and sync times across failures, selection changes and manual refreshes', async ({ page }) => {
  const api = await publicCacheFixture(page);
  const originalSync = (await readSettings(page, ':public-content:')).entries[0].syncedAt;
  for (const failure of ['network', 'quota'] as const) {
    api.fail(failure);
    await page.keyboard.press('Control+r');
    await expect(page.locator('#repo-1 [role=alert]')).toBeVisible();
    await expect(page.locator('.board-toolbar')).toHaveAttribute('data-busy', 'false');
    await expect(page.locator('#repo-1 .issue-card')).toContainText('alpha revision 1');
    expect((await readSettings(page, ':public-content:')).entries[0].syncedAt).toBe(originalSync);
  }
  // Adding another repository never re-fetches the retained one, even while its quota is exhausted.
  await page.locator('.sidebar-add').click();
  await api.add('beta');
  const beforeSelection = api.requests.length;
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('#repo-2 .issue-card')).toContainText('beta revision 1');
  await expect.poll(() => readSettings(page, ':public-content:').then(value => value?.entries.length)).toBe(2);
  expect(api.requests.slice(beforeSelection).every(path => path.startsWith('/repos/sample/beta/'))).toBe(true);
  const beforeReload = api.requests.length;
  await page.reload();
  await expect(page.locator('.issue-card')).toHaveCount(2);
  expect(api.requests).toHaveLength(beforeReload);
  const saved = await readSettings(page, ':public-content:');
  expect(saved.entries.find((entry: any) => entry.lane.repo.id === 1).syncedAt).toBe(originalSync);
  expect(saved.entries.every((entry: any) => !entry.lane.error && !entry.lane.loading)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('sample/'))).toBe(false);
  // Removing and reselecting a cached repository also makes no API requests.
  for (const selected of [false, true]) {
    await page.locator('.sidebar-add').click();
    await page.getByRole('checkbox', { name: 'sample/alpha' }).setChecked(selected);
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(page.locator('.issue-card')).toHaveCount(selected ? 2 : 1);
    expect(api.requests).toHaveLength(beforeReload);
  }
  api.fail(null); api.revise();
  await page.keyboard.press('Control+r');
  await expect(page.locator('#repo-1 .issue-card')).toContainText('alpha revision 2');
  await expect(page.locator('#repo-2 .issue-card')).toContainText('beta revision 2');
  await expect.poll(() => readSettings(page, ':public-content:').then(value => value?.entries.every((entry: any) => entry.lane.issues[0].title.includes('revision 2')))).toBe(true);
  expect(api.requests.length).toBeGreaterThan(beforeReload);
  const beforeTargeted = api.requests.length;
  api.revise();
  await page.locator('#repo-2 .lane-sync').click();
  await expect(page.locator('#repo-2 .issue-card')).toContainText('beta revision 3');
  await expect(page.locator('#repo-1 .issue-card')).toContainText('alpha revision 2');
  await expect.poll(() => readSettings(page, ':public-content:').then(value => value?.entries.find((entry: any) => entry.lane.repo.id === 2)?.lane.issues[0].title)).toBe('beta revision 3');
  expect(api.requests.slice(beforeTargeted).every(path => path.startsWith('/repos/sample/beta/'))).toBe(true);
  const beforeFinalReload = api.requests.length;
  const betaSync = (await readSettings(page, ':public-content:')).entries.find((entry: any) => entry.lane.repo.id === 2).syncedAt;
  await page.reload();
  await expect(page.locator('#repo-2 .issue-card')).toContainText('beta revision 3');
  await expect(page.locator('#repo-2 .lane-sync time')).toHaveAttribute('datetime', new Date(betaSync).toISOString());
  expect(api.requests).toHaveLength(beforeFinalReload);
});

for (const state of ['expired', 'damaged'] as const) test(`public ${state} content falls back to fetching a complete repository`, async ({ page }) => {
  const api = await publicCacheFixture(page);
  if (state === 'expired') await page.clock.setFixedTime(Date.now() + 25 * 3600000);
  else await page.evaluate(async () => {
    const aad = new TextEncoder().encode('issueflow-settings:v1::public-content:');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', aad));
    const id = 'account:' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('issueflow-settings', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ iv: new Uint8Array(12), ciphertext: new Uint8Array([1, 2, 3]).buffer }, id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
    finally { db.close(); }
  });
  const before = api.requests.length;
  api.revise();
  await page.reload();
  await expect(page.locator('#repo-1 .issue-card')).toContainText('alpha revision 2');
  expect(api.requests.length).toBeGreaterThan(before);
  expect(api.requests.slice(before).every(path => path.startsWith('/repos/sample/alpha/'))).toBe(true);
});

import { expect, test } from '@playwright/test';

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

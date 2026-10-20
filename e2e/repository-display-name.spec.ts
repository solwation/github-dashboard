import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const at = Date.now();
  await page.clock.install({ time: at - 60_000 });
  await page.clock.pauseAt(at);
  const repos = ['shared/first', 'SHARED/second', 'another/empty'].map((full_name, index) => ({ id: index + 1, name: full_name.split('/')[1], full_name, private: true, description: 'Display label fixture', html_url: `https://github.com/${full_name}`, owner: { login: full_name.split('/')[0] } }));
  const calls: string[] = [];
  const created = new Date().toISOString();
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: 'display-label-fixture', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repos;
    else if (url.pathname.endsWith('/issues') && ['open', 'all'].includes(url.searchParams.get('state') ?? '') && !url.pathname.includes('/empty/')) {
      const repo = repos.find(repo => url.pathname.includes(`/${repo.full_name}/`))!;
      data = [{ id: repo.id, number: 1, title: `Unique ${repo.name} issue`, state: 'open', created_at: created, updated_at: created, closed_at: null, labels: [], assignees: [], comments: 0, html_url: `${repo.html_url}/issues/1` }];
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-display-label-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  return { repos, calls };
}

for (const mode of ['Kort', 'Lista'] as const) {
  test(`combined ${mode} labels use all selected owners and keep canonical identity`, async ({ page }) => {
    const { repos, calls } = await fixture(page);
    await page.getByRole('button', { name: mode, exact: true }).click();
    const split = page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true });
    await split.uncheck();
    const board = page.locator('.combined-board');
    const chips = board.locator(mode === 'Kort' ? '.card-repository' : '.row-repository');
    const label = (name: string) => chips.filter({ has: page.locator(`.sr-only`, { hasText: name }) });
    const visibleName = (name: string) => label(name).locator(mode === 'Kort' ? '.card-repository-name' : '.row-repository-name');
    await expect(chips).toHaveCount(2);
    // The third owner has no issues at all, but is selected: both labels stay full.
    await expect(visibleName('shared/first')).toHaveText('shared/first');
    await expect(visibleName('SHARED/second')).toHaveText('SHARED/second');
    await expect(label('shared/first')).toHaveAttribute('title', 'shared/first');
    const color = await label('shared/first').locator('i').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.getByRole('textbox', { name: 'Sök issues', exact: true }).fill('Unique first');
    await expect(chips).toHaveCount(1);
    await expect(visibleName('shared/first')).toHaveText('shared/first');
    await page.getByRole('button', { name: 'Välj repositories', exact: true }).first().click();
    await page.getByRole('checkbox', { name: 'another/empty' }).uncheck();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(visibleName('shared/first')).toHaveText('first');
    await expect(label('shared/first').locator('.sr-only')).toHaveText('shared/first');
    await expect(visibleName('shared/first')).toHaveAttribute('aria-hidden', 'true');
    expect(await label('shared/first').locator('i').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(color);
    await expect(board.locator(mode === 'Kort' ? '.issue-title' : '.row-number')).toHaveAttribute('href', 'https://github.com/shared/first/issues/1');
    await page.getByRole('textbox', { name: 'Sök issues', exact: true }).clear();
    await expect(visibleName('SHARED/second')).toHaveText('second');
    await expect(page.locator('.board-toolbar')).toHaveAttribute('data-busy', 'false');
    const beforeDisplayToggle = calls.filter(path => path.includes('/issues?')).length;
    const beforeRequests = calls.length;
    await split.check();
    await expect(page.locator('.repo-lane')).toHaveCount(2);
    await split.uncheck();
    await expect(visibleName('shared/first')).toHaveText('first');
    expect(calls.filter(path => path.includes('/issues?')).length, calls.slice(beforeRequests).join('\n')).toBe(beforeDisplayToggle);
    // A single selected repository still uses its compact label.
    await page.getByRole('button', { name: 'Välj repositories', exact: true }).first().click();
    await page.getByRole('checkbox', { name: repos[1]!.full_name }).uncheck();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(chips).toHaveCount(1);
    await expect(visibleName('shared/first')).toHaveText('first');
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

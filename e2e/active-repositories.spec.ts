import { expect, test } from '@playwright/test';
import { openSettings } from "./support/phone-menu";

test('repository summary counts active projects independently of text search and follows visibility and project selection', async ({ page }) => {
  const repositories = ['empty', 'backlog', 'progress', 'recent', 'old', 'mixed', 'coordination'].map((name, index) => ({
    id: index + 1, name, full_name: `sample/${name}`, private: false, description: 'Fixture', html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' },
  }));
  const recent = new Date(Date.now() - 86400000).toISOString();
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  function issue(number: number, labels: string[] = [], closed: string | null = null) {
    return { id: number, number, title: 'Active fixture task', state: closed ? 'closed' : 'open', closed_at: closed, created_at: old, updated_at: recent,
      html_url: 'https://github.com/sample/backlog/issues/1', labels: labels.map(name => ({ name, color: 'ffffff' })), assignees: [] };
  }
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: 'active-projects', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repositories;
    else if (url.pathname === '/graphql') data = { data: { repository: { issue: null } } };
    else if (url.pathname.endsWith('/issues')) {
      const name = url.pathname.split('/')[3];
      const candidates = name === 'backlog' ? [issue(1)] : name === 'progress' ? [issue(2, ['in-progress'])]
        : name === 'recent' ? [issue(3, [], recent)] : name === 'old' ? [issue(4, [], old)]
        : name === 'mixed' ? [issue(5), issue(6, ['in-progress']), issue(7, [], recent)]
        : name === 'coordination' ? [issue(8, ['orkester'])] : [];
      data = candidates.filter(item => url.searchParams.get('state') === 'all' || item.state === url.searchParams.get('state'));
    }
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-active-projects-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name) }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  const card = page.locator('.repository-stat');
  const active = card.locator('.repository-active');
  await expect(card.locator('strong')).toContainText('7');
  await expect(active).toHaveText('3 aktiva');
  await expect(active).toBeVisible();
  const activeRows = page.locator('.sidebar-projects > .sidebar-repository-row');
  await expect(activeRows).toHaveCount(3);
  await page.locator('.sidebar-inactive-toggle').click();
  await expect(page.locator('.sidebar-inactive-group .sidebar-repository-row')).toHaveCount(4);
  await expect(activeRows).toHaveCount(3);
  await expect(active).toHaveText('3 aktiva');
  await expect(active).toHaveAttribute('title', /Backlog.*In progress.*laddas.*enbart stängda.*Fritextfilter/);
  await expect(active).toHaveAttribute('aria-label', /^3 aktiva projekt\./);
  await page.getByRole('textbox', { name: 'Sök issues', exact: true }).fill('no matching issue');
  await expect(page.locator('.issue-card')).toHaveCount(0);
  await expect(active).toHaveText('3 aktiva');
  await page.getByRole('checkbox', { name: 'Dölj koordinationsärenden' }).uncheck();
  await expect(active).toHaveText('4 aktiva');
  await expect(activeRows).toHaveCount(4);
  await active.focus();
  await page.keyboard.press('Tab');
  const chooser = card.getByRole('button', { name: 'Välj repositories', exact: true });
  await expect(chooser).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: /sample\/backlog/ }).uncheck();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(card.locator('strong')).toContainText('6');
  await expect(active).toHaveText('3 aktiva');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openSettings(page);
  await page.getByLabel('Språk', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(active).toHaveText('3 active');
  await expect(active).toHaveAttribute('title', /still loading.*only closed issues are inactive/);
});

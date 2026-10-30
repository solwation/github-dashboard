import { expect, test } from '@playwright/test';
import { revealPhoneMenu } from './support/phone-menu';

const repositories = [
  { id: 1, name: 'active-backlog', full_name: 'Sample/active-backlog', private: false },
  { id: 2, name: 'active-progress', full_name: 'Sample/active-progress', private: false },
  { id: 3, name: 'inactive-closed', full_name: 'Sample/inactive-closed', private: false },
  { id: 4, name: 'inactive-empty', full_name: 'Sample/inactive-empty', private: false },
].map(repo => ({ ...repo, description: 'Fixture', html_url: `https://github.com/${repo.full_name}`, owner: { login: 'Sample' } }));

test.describe('sidebar inactive repositories', () => {
  test('lists inactive repositories, hides them from the board on request while keeping them greyed in the menu, persists the setting, and updates reactively', async ({ page }) => {
    const created = new Date(Date.now() - 86_400_000).toISOString();
    let movedIssueToProgress = false;

    await page.route('https://api.github.com/**', async route => {
      const url = new URL(route.request().url());
      let data: unknown = [];
      const issuesMatch = url.pathname.match(/^\/repos\/(.+)\/issues$/);
      if (url.pathname === '/user') {
        data = { login: 'inactive-toggle-user', avatar_url: '' };
      } else if (url.pathname === '/user/repos') {
        data = repositories;
      } else if (issuesMatch) {
        const repoName = issuesMatch[1];
        if (repoName === 'Sample/active-backlog' && url.searchParams.get('state') !== 'closed') {
          data = [{ id: 101, number: 1, title: 'Backlog issue', state: 'open', closed_at: null, labels: [], assignees: [], html_url: `https://github.com/${repoName}/issues/1`, created_at: created, updated_at: created }];
        } else if (repoName === 'Sample/active-progress' && url.searchParams.get('state') !== 'closed') {
          data = [{ id: 102, number: 2, title: 'In progress issue', state: 'open', closed_at: null, labels: [{ name: 'in-progress', color: 'fff' }], assignees: [], html_url: `https://github.com/${repoName}/issues/2`, created_at: created, updated_at: created }];
        } else if (repoName === 'Sample/inactive-closed' && url.searchParams.get('state') === 'closed') {
          data = [{ id: 103, number: 3, title: 'Closed issue', state: 'closed', closed_at: created, labels: [], assignees: [], html_url: `https://github.com/${repoName}/issues/3`, created_at: created, updated_at: created }];
        } else if (repoName === 'Sample/inactive-empty') {
          if (movedIssueToProgress && url.searchParams.get('state') !== 'closed') {
            data = [{ id: 104, number: 4, title: 'Newly active issue', state: 'open', closed_at: null, labels: [{ name: 'in-progress', color: 'fff' }], assignees: [], html_url: `https://github.com/${repoName}/issues/4`, created_at: created, updated_at: created }];
          } else {
            data = [];
          }
        }
      }
      await route.fulfill({ json: data });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill('fixture-inactive-toggle-token');
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name.replace(/[.]/g, '\\.')) }).check();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();

    const activeBacklog = page.locator('.sidebar-repository-row[data-repository="Sample/active-backlog"]');
    const activeProgress = page.locator('.sidebar-repository-row[data-repository="Sample/active-progress"]');
    const inactiveClosed = page.locator('.sidebar-repository-row[data-repository="Sample/inactive-closed"]');
    const inactiveEmpty = page.locator('.sidebar-repository-row[data-repository="Sample/inactive-empty"]');

    const active = page.locator('.repository-active');
    await expect(active).toHaveText('2 aktiva');

    // Active repositories are visible directly in the main list
    await expect(activeBacklog).toBeVisible();
    await expect(activeProgress).toBeVisible();

    // Inactive repositories are listed below "Hide inactive repositories", which is off by default (#367).
    const toggle = page.getByRole('checkbox', { name: 'Dölj inaktiva repositories' });
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('.sidebar-inactive-toggle .nav-count')).toHaveText('2');
    for (const row of [inactiveClosed, inactiveEmpty]) {
      await expect(row).toBeVisible();
      await expect(row).not.toHaveClass(/repository-hidden/);
    }
    await expect(page.locator('#repo-3')).toBeVisible();
    await expect(page.locator('#repo-4')).toBeVisible();
    await expect(active).toHaveText('2 aktiva');

    // Inactive repositories are selectable
    await inactiveClosed.locator('.sidebar-repository').click();
    await expect(page).toHaveURL(/#repo-3$/);

    // Turning it on keeps them greyed in the menu and off the board, without changing the active count.
    await toggle.check();
    await expect(inactiveClosed).toHaveClass(/repository-hidden/);
    await expect(inactiveEmpty).toHaveClass(/repository-hidden/);
    await expect(activeBacklog).not.toHaveClass(/repository-hidden/);
    await expect(page.locator('#repo-1')).toBeVisible();
    await expect(page.locator('#repo-3, #repo-4')).toHaveCount(0);
    await expect(active).toHaveText('2 aktiva');

    // Reload the page: the setting is saved per account in encrypted IndexedDB
    await page.reload();
    await expect(toggle).toBeChecked();
    await expect(inactiveEmpty).toHaveClass(/repository-hidden/);
    await expect(page.locator('#repo-3, #repo-4')).toHaveCount(0);

    // Off again survives a reload too
    await toggle.uncheck();
    await expect(page.locator('#repo-3')).toBeVisible();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#repo-3')).toBeVisible();
    await toggle.check();
    await expect(page.locator('#repo-3, #repo-4')).toHaveCount(0);

    // Reactive update: inactive-empty gets an in-progress issue
    movedIssueToProgress = true;
    await page.keyboard.press('Control+R'); // Trigger reload/refresh
    await expect(inactiveEmpty).not.toHaveClass(/repository-hidden/); // Now active!
    await expect(page.locator('#repo-4')).toBeVisible();
    await expect(active).toHaveText(/3 aktiva/);
    await expect(page.locator('.sidebar-inactive-toggle .nav-count')).toHaveText('1'); // Only 1 inactive remains
  });

  test('does not show inactive toggle when all repositories have active issues', async ({ page }) => {
    const created = new Date(Date.now() - 86_400_000).toISOString();
    const allActive = [
      { id: 1, name: 'repo-one', full_name: 'Sample/repo-one', private: false },
      { id: 2, name: 'repo-two', full_name: 'Sample/repo-two', private: false },
    ].map(repo => ({ ...repo, description: 'Fixture', html_url: `https://github.com/${repo.full_name}`, owner: { login: 'Sample' } }));

    await page.route('https://api.github.com/**', async route => {
      const url = new URL(route.request().url());
      let data: unknown = [];
      if (url.pathname === '/user') data = { login: 'all-active-user', avatar_url: '' };
      else if (url.pathname === '/user/repos') data = allActive;
      else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') {
        data = [{ id: 201, number: 1, title: 'Open task', state: 'open', closed_at: null, labels: [], assignees: [], html_url: 'https://github.com/Sample/repo-one/issues/1', created_at: created, updated_at: created }];
      }
      await route.fulfill({ json: data });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill('fixture-all-active-token');
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    for (const repo of allActive) await page.getByRole('checkbox', { name: new RegExp(repo.full_name.replace(/[.]/g, '\\.')) }).check();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();

    await expect(page.locator('.sidebar-repository-row')).toHaveCount(2);
    await expect(page.locator('.sidebar-inactive-toggle')).toBeHidden();
  });

  test('supports keyboard navigation and handles narrow desktop and mobile viewports', async ({ page }) => {
    const created = new Date(Date.now() - 86_400_000).toISOString();
    await page.route('https://api.github.com/**', async route => {
      const url = new URL(route.request().url());
      let data: unknown = [];
      if (url.pathname === '/user') data = { login: 'responsive-user', avatar_url: '' };
      else if (url.pathname === '/user/repos') data = repositories;
      else if (url.pathname === '/repos/Sample/active-backlog/issues' && url.searchParams.get('state') !== 'closed') {
        data = [{ id: 301, number: 1, title: 'Backlog task', state: 'open', closed_at: null, labels: [], assignees: [], html_url: 'https://github.com/Sample/active-backlog/issues/1', created_at: created, updated_at: created }];
      }
      await route.fulfill({ json: data });
    });

    // Narrow desktop (1000x900)
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill('fixture-responsive-token');
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name.replace(/[.]/g, '\\.')) }).check();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();

    const toggle = page.getByRole('checkbox', { name: 'Dölj inaktiva repositories' });
    await expect(toggle).toBeVisible();

    const active = page.locator('.repository-active');
    await expect(active).toHaveText('1 aktiva');
    await expect(page.locator('.sidebar-projects > .sidebar-repository-row')).toHaveCount(1);
    await expect(page.locator('.sidebar-inactive-group .sidebar-repository-row')).toHaveCount(3);
    await expect(page.locator('.sidebar-inactive-group .sidebar-repository-row.repository-hidden')).toHaveCount(0);
    await expect(active).toHaveText('1 aktiva');

    // Keyboard focus and activation
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(page.locator('.sidebar-inactive-group .sidebar-repository-row.repository-hidden')).toHaveCount(3);
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();

    // Phone viewport (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await revealPhoneMenu(page);
    await expect(page.locator('.sidebar-projects')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

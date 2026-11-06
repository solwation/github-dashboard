import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openSettings } from './support/phone-menu';
import { readSettings } from './support/settings';

// #430: a repository stays active for N minutes after its most recently closed issue. Synthetic data only.
const NOW = Date.parse('2026-11-06T12:00:00Z');
const MIN = 60_000;
const evidence = 'docs/verification/430';
const repositories = ['busy', 'just-closed', 'old-closed'].map((name, index) => ({
  id: index + 1, name, full_name: `Sample/${name}`, private: false, description: 'Fixture',
  html_url: `https://github.com/Sample/${name}`, owner: { login: 'Sample' },
}));
const issue = (id: number, repo: string, state: 'open' | 'closed', closedAt: number | null) => ({
  id, number: id, title: `Fixture ${id}`, state, closed_at: closedAt ? new Date(closedAt).toISOString() : null, labels: [], assignees: [],
  html_url: `https://github.com/Sample/${repo}/issues/${id}`, created_at: new Date(NOW - 5 * 86_400_000).toISOString(), updated_at: new Date(NOW - 5 * 86_400_000).toISOString(),
});

async function connect(page: Page, login: string) {
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/^\/repos\/Sample\/(.+)\/issues$/);
    const closed = url.searchParams.get('state') === 'closed';
    let data: unknown = [];
    if (url.pathname === '/user') data = { login, avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repositories;
    else if (match && match[1] === 'busy' && !closed) data = [issue(11, 'busy', 'open', null)];
    else if (match && match[1] === 'just-closed' && closed) data = [issue(21, 'just-closed', 'closed', NOW - 5 * MIN)];
    else if (match && match[1] === 'old-closed' && closed) data = [issue(31, 'old-closed', 'closed', NOW - 2 * 86_400_000)];
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-grace-token-' + login);
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name) }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
}

test('a just-closed repository stays active for the configured time, then turns inactive; the setting survives reload', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) });
  await connect(page, 'grace-user');
  const active = page.locator('.repository-active');
  const inactiveCount = page.locator('.sidebar-inactive-toggle .nav-count');
  const hide = page.getByRole('checkbox', { name: 'Dölj inaktiva repositories' });
  const justClosed = page.locator('.sidebar-repository-row[data-repository="Sample/just-closed"]');

  // Default 30 min: just-closed (5 min ago) and busy are active, old-closed is inactive.
  await expect(active).toHaveText('2 aktiva');
  await expect(inactiveCount).toHaveText('1');
  await hide.check();
  await expect(page.locator('#repo-2')).toBeVisible();
  await expect(page.locator('#repo-3')).toHaveCount(0);
  await expect(justClosed).not.toHaveClass(/repository-hidden/);

  // The grace (30 min after the close, 5 already passed) expires on the page clock alone: no reload, no click.
  await page.clock.fastForward(24 * MIN);
  await expect(active).toHaveText('2 aktiva');
  await expect(page.locator('#repo-2')).toBeVisible();
  await page.clock.fastForward(2 * MIN);
  await expect(active).toHaveText('1 aktiva');
  await expect(inactiveCount).toHaveText('2');
  await expect(justClosed).toHaveClass(/repository-hidden/);
  await expect(page.locator('#repo-2')).toHaveCount(0);

  // Raising the setting to 60 minutes makes it active again; it is saved encrypted and survives reload.
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Inställningar', exact: true });
  const field = dialog.getByLabel('Inaktivt efter (minuter sedan senaste stängning)');
  await expect(field).toHaveValue('30');
  await field.fill('60');
  await field.dispatchEvent('change');
  await expect.poll(async () => (await readSettings(page, 'grace-user'))?.inactiveGraceMinutes).toBe(60);
  await page.keyboard.press('Escape');
  await expect(active).toHaveText('2 aktiva');
  await expect(page.locator('#repo-2')).toBeVisible();
  await page.reload();
  await expect(page.locator('#repo-2')).toBeVisible();
  await openSettings(page);
  await expect(dialog.getByLabel('Inaktivt efter (minuter sedan senaste stängning)')).toHaveValue('60');
  await page.keyboard.press('Escape');

  // 0 means inactive at once, as before this setting.
  await openSettings(page);
  await field.fill('0');
  await field.dispatchEvent('change');
  await page.keyboard.press('Escape');
  await expect(active).toHaveText('1 aktiva');
  await expect(page.locator('#repo-2')).toHaveCount(0);

  // An invalid value is refused and not saved.
  await openSettings(page);
  await field.fill('5000');
  await field.dispatchEvent('change');
  expect(await field.evaluate((input: HTMLInputElement) => input.validity.customError)).toBe(true);
  expect((await readSettings(page, 'grace-user'))?.inactiveGraceMinutes).toBe(0);
});

for (const view of [{ name: 'desktop', size: { width: 1600, height: 1000 }, touch: false }, { name: 'mobile', size: { width: 390, height: 844 }, touch: true }])
  for (const scheme of ['light', 'dark'] as const)
    test(`settings and sidebar evidence ${view.name} ${scheme}`, async ({ browser }) => {
      await mkdir(evidence, { recursive: true });
      const context = await browser.newContext({ viewport: view.size, isMobile: view.touch, hasTouch: view.touch, colorScheme: scheme, locale: 'sv-SE' });
      const page = await context.newPage();
      await page.clock.install({ time: new Date(NOW) });
      await connect(page, `evidence-${view.name}-${scheme}`);
      await expect(page.locator('.repository-active')).toHaveText('2 aktiva');
      if (view.touch) await page.getByRole('button', { name: 'Öppna vänstermeny' }).tap();
      await new Promise(resolve => setTimeout(resolve, 800)); // Real time: the drawer slides in over CSS, not the fake clock.
      await page.screenshot({ path: `${evidence}/sidebar-${view.name}-${scheme}.png` });
      if (view.touch) await page.keyboard.press('Escape');
      await openSettings(page, 'Inställningar', view.touch);
      const dialog = page.getByRole('dialog', { name: 'Inställningar', exact: true });
      const field = dialog.getByLabel('Inaktivt efter (minuter sedan senaste stängning)');
      await field.scrollIntoViewIfNeeded();
      await expect(field).toBeVisible();
      const box = (await field.boundingBox())!;
      if (view.touch) expect(box.height).toBeGreaterThanOrEqual(44 - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/settings-${view.name}-${scheme}.png` });
      await context.close();
    });

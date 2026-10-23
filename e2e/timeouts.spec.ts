import { readSettings } from "./support/settings";
import { repositoryNotification } from "./support/repository-properties";
import { expect, test } from '@playwright/test';
import { openSettings } from "./support/phone-menu";

test('timeout uses actual work start, responds to Settings and stays marked on the card without a top list or ignore button', async ({ page }) => {
  let startedAt = new Date(Date.now() - 31 * 60000).toISOString();
  const repo = { id: 1, name: 'timeout-fixture', full_name: 'sample/timeout-fixture', private: true, description: '', html_url: 'https://github.com/sample/timeout-fixture', owner: { login: 'sample' } };
  await page.addInitScript(() => {
    const notices: unknown[] = [];
    class FixtureNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(...args: unknown[]) { notices.push(args); }
      close() {}
    }
    Object.assign(window, { Notification: FixtureNotification, timeoutNotices: notices });
  });
  const history = [101, 102, 103].map(number => ({ id: number, number, title: 'History work', state: 'closed', labels: [], assignees: [], created_at: new Date(Date.now() - 80 * 60000).toISOString(), updated_at: new Date(Date.now() - 60 * 60000).toISOString(), closed_at: new Date(Date.now() - 60 * 60000).toISOString(), workStartedAt: new Date(Date.now() - 80 * 60000).toISOString(), html_url: `${repo.html_url}/issues/${number}` }));
  let holdRefresh = false, releaseRefresh!: () => void;
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    if (holdRefresh && url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open') await refreshGate;
    const issues = [1, 2].map(number => ({ id: number, number, title: number === 1 ? 'Slow actual work' : 'Unknown start', comments: 0, state: 'open', labels: [{ name: 'in-progress', color: '000000' }], assignees: [], created_at: '2020-01-01T00:00:00Z', updated_at: startedAt, closed_at: null, html_url: `${repo.html_url}/issues/${number}` }));
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'timeout-account', avatar_url: '' }
      : url.pathname === '/user/repos' ? [repo]
      : url.pathname.endsWith('/issues/1/events') ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: startedAt }]
      : url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open' ? issues : url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'closed' ? history : [] });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/lib/settings-store.ts';
    const settings = await import(/* @vite-ignore */ path);
    await settings.saveSettings('timeout-account', { selected: [], timeoutMinutes: 900 });
  });
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-timeout-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  const slow = page.locator('.issue-card').filter({ has: page.getByText('Slow actual work', { exact: true }) });
  const unknown = page.locator('.issue-card').filter({ has: page.getByText('Unknown start', { exact: true }) });
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(slow.locator('.timeout-warning')).toContainText('över estimatet ≈ 20 min plus 25 %');
  await expect(unknown).not.toHaveClass(/issue-timeout/);
  await openSettings(page);
  const threshold = page.getByLabel('Tillåten överskridning (%)', { exact: true });
  await expect(threshold).toHaveValue('25');
  await threshold.fill('100');
  await threshold.press('Tab');
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await openSettings(page);
  await threshold.fill('25');
  await threshold.press('Tab');
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(slow.locator('.timeout-warning')).toBeVisible();
  holdRefresh = true;
  await page.keyboard.press('Control+r');
  await expect(page.locator('.board-toolbar')).toHaveAttribute('data-busy', 'true');
  await openSettings(page);
  const enabled = page.getByLabel('Varna när pågående arbete överskrider estimatet', { exact: true });
  await enabled.uncheck();
  await expect(threshold).toBeDisabled();
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await enabled.check();
  await threshold.fill('1001');
  await threshold.press('Tab');
  expect(await threshold.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  await threshold.fill('25');
  await threshold.press('Tab');
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  holdRefresh = false; releaseRefresh();
  await expect(page.locator('.board-toolbar')).toHaveAttribute('data-busy', 'false');
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect.poll(() => readSettings(page, 'timeout-account').then(saved => saved?.preferences?.timeoutOverrunPercent)).toBe(25);
  expect((await readSettings(page, 'timeout-account'))?.preferences?.timeoutMinutes).toBeUndefined();
  await expect(page.locator('.timeout-notices')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ignorera timeout/ })).toHaveCount(0);
  // Snapshots written before #115 may still carry acknowledgements; they must be ignored without errors.
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/vault.ts';
    const vault = await import(/* @vite-ignore */ path);
    const content = await vault.loadContent('fixture-timeout-token');
    if (!content) return false;
    await vault.saveContent('fixture-timeout-token', { ...content, timeoutAcknowledgements: [{ repo: 'sample/timeout-fixture', issueId: 1, startedAt: new Date(Date.now() - 31 * 60000).toISOString() }] });
    return true;
  })).toBe(true);
  await page.reload();
  await expect(slow).toBeVisible();
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(slow.locator('.timeout-warning')).toContainText('Pågående i');
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ignorera timeout/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices)).toEqual([]);
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/vault.ts';
    const vault = await import(/* @vite-ignore */ path);
    return 'timeoutAcknowledgements' in ((await vault.loadContent('fixture-timeout-token')) ?? { timeoutAcknowledgements: true });
  })).toBe(false);
  // A distinct, verified work period must become eligible again.
  startedAt = new Date(Date.now() - 30.5 * 60000).toISOString();
  await page.reload();
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(unknown).not.toHaveClass(/issue-timeout/);
  await page.clock.install();
  await repositoryNotification(page, 'timeout-fixture', toggle => toggle.click());
  startedAt = new Date().toISOString();
  await page.keyboard.press('Control+r');
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await page.clock.fastForward(26 * 60000);
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { timeoutNotices: [string, { body: string }][] }).timeoutNotices[0]?.[1].body)).toContain('över estimatet ≈ 20 min plus 25 %');
  await openSettings(page);
  await threshold.fill('100'); await threshold.press('Tab');
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await threshold.fill('25'); await threshold.press('Tab');
  await expect(slow).toHaveClass(/issue-timeout/);
  await enabled.uncheck();
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await enabled.check();
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  await expect(slow).toHaveClass(/issue-timeout/);
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices.length)).toBe(1);
  // The card stays red for the whole work period, and a reload never repeats the notification.
  await page.reload();
  await expect(slow).toHaveClass(/issue-timeout/);
  await page.clock.fastForward(60000);
  await expect(slow).toHaveClass(/issue-timeout/);
  expect(await page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices.length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('narrow phones show timeouts only as red cards', async ({ page }) => {
  const startedAt = new Date(Date.now() - 31 * 60000).toISOString();
  const repo = { id: 1, name: 'narrow-timeout', full_name: 'sample/narrow-timeout', private: true, description: '', html_url: 'https://github.com/sample/narrow-timeout', owner: { login: 'sample' } };
  const issues = [1, 2].map(number => ({ id: number, number, title: `Narrow work ${number}`, comments: 0, state: 'open', labels: [{ name: 'in-progress', color: '000000' }], assignees: [], created_at: startedAt, updated_at: startedAt, closed_at: null, html_url: `${repo.html_url}/issues/${number}` }));
  const history = [101, 102, 103].map(number => ({ id: number, number, title: 'History work', state: 'closed', labels: [], assignees: [], created_at: new Date(Date.now() - 80 * 60000).toISOString(), updated_at: new Date(Date.now() - 60 * 60000).toISOString(), closed_at: new Date(Date.now() - 60 * 60000).toISOString(), workStartedAt: new Date(Date.now() - 80 * 60000).toISOString(), html_url: `${repo.html_url}/issues/${number}` }));
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'narrow-timeout-account', avatar_url: '' }
      : url.pathname === '/user/repos' ? [repo]
      : /\/issues\/[12]\/events$/.test(url.pathname) ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: startedAt }]
      : url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open' ? issues : url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'closed' ? history : [] });
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-narrow-timeout-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  for (const number of [1, 2]) {
    const card = page.locator('.issue-card').filter({ has: page.getByText(`Narrow work ${number}`, { exact: true }) });
    await expect(card).toHaveClass(/issue-timeout/);
    await expect(card.locator('.timeout-warning')).toContainText('över estimatet ≈ 20 min plus 25 %');
  }
  await expect(page.locator('.timeout-notices')).toHaveCount(0);
  await expect(page.getByText(/Timeout för sample\/narrow-timeout/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ignorera timeout/ })).toHaveCount(0);
  await openSettings(page);
  const control = page.getByLabel('Varna när pågående arbete överskrider estimatet', { exact: true });
  await expect(control).toBeVisible();
  expect((await control.boundingBox())!.width).toBe(20);
  await page.screenshot({ path: test.info().outputPath('timeout-settings-mobile.png') });
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

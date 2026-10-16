import { expect, test } from '@playwright/test';

test('timeout uses actual work start, responds to Settings and keeps acknowledgement encrypted across reload', async ({ page }) => {
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
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const issues = [1, 2].map(number => ({ id: number, number, title: number === 1 ? 'Slow actual work' : 'Unknown start', comments: 0, state: 'open', labels: [{ name: 'in-progress', color: '000000' }], assignees: [], created_at: '2020-01-01T00:00:00Z', updated_at: startedAt, closed_at: null, html_url: `${repo.html_url}/issues/${number}` }));
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'timeout-account', avatar_url: '' }
      : url.pathname === '/user/repos' ? [repo]
      : url.pathname.endsWith('/issues/1/events') ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: startedAt }]
      : url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open' ? issues : [] });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-timeout-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  const slow = page.locator('.issue-card').filter({ has: page.getByText('Slow actual work', { exact: true }) });
  const unknown = page.locator('.issue-card').filter({ has: page.getByText('Unknown start', { exact: true }) });
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(slow.locator('.timeout-warning')).toContainText('över gränsen 30 min');
  await expect(unknown).not.toHaveClass(/issue-timeout/);
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  const threshold = page.getByLabel('Tidsgräns för pågående issues (minuter)', { exact: true });
  await expect(threshold).toHaveValue('30');
  await threshold.fill('60');
  await threshold.press('Tab');
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await threshold.fill('30');
  await threshold.press('Tab');
  await page.getByRole('button', { name: 'Klart', exact: true }).click();
  await expect(slow).toHaveClass(/issue-timeout/);
  await slow.getByRole('button', { name: 'Ignorera timeout för #1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/vault.ts';
    const vault = await import(/* @vite-ignore */ path);
    return (await vault.loadContent('fixture-timeout-token'))?.timeoutAcknowledgements?.length ?? 0;
  })).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('timeoutAcknowledgements');
  await page.reload();
  await expect(slow).toBeVisible();
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await expect(slow.getByRole('button', { name: 'Ignorera timeout för #1', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices)).toEqual([]);
  // A distinct, verified work period must become eligible again.
  startedAt = new Date(Date.now() - 30.5 * 60000).toISOString();
  await page.reload();
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(unknown).not.toHaveClass(/issue-timeout/);
  await page.clock.install();
  await page.getByRole('switch', { name: 'Notiser för timeout-fixture', exact: true }).click();
  startedAt = new Date().toISOString();
  await page.keyboard.press('Control+r');
  await expect(slow).not.toHaveClass(/issue-timeout/);
  await page.clock.fastForward(31 * 60000);
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices.length)).toBe(1);
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => (window as unknown as { timeoutNotices: unknown[] }).timeoutNotices.length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('touch timeout acknowledgement while GitHub is still refreshing', () => {
  test.use({ hasTouch: true });
  for (const width of [320, 390]) for (const surface of ['card', 'notice'] as const) {
    test(`${width}px ${surface} tap immediately clears only its issue during a pending refresh`, async ({ page }) => {
      const startedAt = new Date(Date.now() - 31 * 60000).toISOString();
      const repo = { id: 1, name: 'touch-timeout', full_name: 'sample/touch-timeout', private: true, description: '', html_url: 'https://github.com/sample/touch-timeout', owner: { login: 'sample' } };
      const issues = [1, 2].map(number => ({ id: number, number, title: `Touch work ${number}`, comments: 0, state: 'open', labels: [{ name: 'in-progress', color: '000000' }], assignees: [], created_at: startedAt, updated_at: startedAt, closed_at: null, html_url: `${repo.html_url}/issues/${number}` }));
      let holdRefresh = false;
      let release = () => {};
      const pending = new Promise<void>(resolve => { release = resolve; });
      let waiting = false;
      await page.route('https://api.github.com/**', async route => {
        const url = new URL(route.request().url());
        if (holdRefresh && url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open') {
          waiting = true;
          await pending;
        }
        await route.fulfill({ json: url.pathname === '/user' ? { login: 'touch-timeout-account', avatar_url: '' }
          : url.pathname === '/user/repos' ? [repo]
          : /\/issues\/[12]\/events$/.test(url.pathname) ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: startedAt }]
          : url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'open' ? issues : [] });
      });
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
      await page.getByLabel('GitHub personal access token').fill('fixture-touch-timeout-token');
      await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
      await page.getByRole('checkbox', { name: repo.full_name }).check();
      await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
      const first = page.locator('.issue-card').filter({ has: page.getByText('Touch work 1', { exact: true }) });
      const second = page.locator('.issue-card').filter({ has: page.getByText('Touch work 2', { exact: true }) });
      const notice = page.locator('.timeout-notices > div').filter({ hasText: 'Touch work 1' });
      await expect(first).toHaveClass(/issue-timeout/);
      await expect(second).toHaveClass(/issue-timeout/);
      if (surface === 'notice') await page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true }).uncheck();
      holdRefresh = true;
      await page.keyboard.press('Control+r');
      await expect.poll(() => waiting).toBe(true);
      await expect(page.locator('.updated')).toHaveAttribute('aria-busy', 'true');
      try {
        const button = surface === 'card' ? first.getByRole('button', { name: 'Ignorera timeout för #1', exact: true }) : notice.getByRole('button', { name: 'Ignorera timeout', exact: true });
        await button.scrollIntoViewIfNeeded();
        expect(await button.evaluate(element => {
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
        await button.tap();
        // This must update locally while the request is deliberately still unresolved.
        await expect(first).not.toHaveClass(/issue-timeout/);
        await expect(notice).toHaveCount(0);
        await expect(second).toHaveClass(/issue-timeout/);
        await expect(page.locator('.updated')).toHaveAttribute('aria-busy', 'true');
        await expect.poll(() => page.evaluate(async () => {
          const path = '/src/lib/vault.ts';
          const vault = await import(/* @vite-ignore */ path);
          return (await vault.loadContent('fixture-touch-timeout-token'))?.timeoutAcknowledgements?.length ?? 0;
        })).toBe(1);
      } finally {
        holdRefresh = false;
        release();
      }
      await expect(page.locator('.updated')).toHaveAttribute('aria-busy', 'false');
      await expect(first).not.toHaveClass(/issue-timeout/);
      await page.reload();
      await expect(first).toBeVisible();
      await expect(first).not.toHaveClass(/issue-timeout/);
      await expect(second).toHaveClass(/issue-timeout/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});

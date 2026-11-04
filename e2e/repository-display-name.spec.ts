import { expect, test, type Page } from '@playwright/test';
import { openSettings, closePhoneMenu } from './support/phone-menu';
import { readSettings } from './support/settings';

async function fixture(page: Page) {
  let login = 'display-label-fixture';
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
    if (url.pathname === '/user') data = { login, avatar_url: '' };
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
  return { repos, calls, setLogin: (value: string) => { login = value; } };
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
    const indicator = (name: string) => (mode === 'Kort' ? label(name).locator('..') : label(name)).locator('.project-icon-color');
    await expect(chips).toHaveCount(2);
    // The third owner has no issues at all, but is selected: both labels stay full.
    await expect(visibleName('shared/first')).toHaveText('shared/first');
    await expect(visibleName('SHARED/second')).toHaveText('SHARED/second');
    await expect(label('shared/first')).toHaveAttribute('title', 'shared/first');
    const color = await indicator('shared/first').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.getByRole('textbox', { name: 'Sök issues', exact: true }).fill('Unique first');
    await expect(chips).toHaveCount(1);
    await expect(visibleName('shared/first')).toHaveText('shared/first');
    await page.getByRole('button', { name: 'Välj repositories', exact: true }).first().click();
    await page.getByRole('checkbox', { name: 'another/empty' }).uncheck();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(visibleName('shared/first')).toHaveText('first');
    await expect(label('shared/first').locator('.sr-only')).toHaveText('shared/first');
    await expect(visibleName('shared/first')).toHaveAttribute('aria-hidden', 'true');
    expect(await indicator('shared/first').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(color);
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

// Run OWNER_DISPLAY_MATRIX=1 for the conductor's integrated responsive/theme review.
const ownerScenarios = process.env.OWNER_DISPLAY_MATRIX ? [
  { width: 1600, height: 1000, mobile: false }, { width: 1000, height: 900, mobile: false }, { width: 950, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true }, { width: 844, height: 390, mobile: true },
  { width: 320, height: 568, mobile: true },
] : [{ width: 1600, height: 1000, mobile: false }];
for (const scenario of ownerScenarios) for (const mode of ['Kort', 'Lista'] as const) {
  test(`owner choice ${mode} ${scenario.width}x${scenario.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: scenario, isMobile: scenario.mobile, hasTouch: scenario.mobile, locale: 'sv-SE' });
    const page = await context.newPage();
    await fixture(page);
    await page.getByRole('button', { name: mode, exact: true }).click();
    const split = page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true });
    const sidebar = page.locator('.repository-label[title="shared/first"]');
    await expect(sidebar).toHaveText('shared/first'); // mixed owners, legacy default
    const choose = async (value: string) => {
      await openSettings(page);
      const control = page.getByLabel('Visa GitHub-användarnamn i projekt', { exact: true });
      await control.selectOption(value);
      await expect(control).toHaveValue(value);
      if (scenario.mobile) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Klart', exact: true }).click();
      await closePhoneMenu(page);
    };
    for (const combined of [false, true]) {
      await split.setChecked(!combined);
      for (const value of ['yes', 'no', 'auto']) {
        await choose(value);
        const expected = value === 'no' ? 'first' : 'shared/first';
        await expect(sidebar).toHaveText(expected);
        const chip = page.locator(`${mode === 'Kort' ? '.card-repository' : '.row-repository'}[title="shared/first"]`).filter({ visible: true }).first();
        const labels = chip.locator(mode === 'Kort' ? '.card-repository-name' : '.row-repository-name');
        if (combined) {
          await expect(labels.first()).toHaveText(expected);
          await expect(chip).toHaveAttribute('title', 'shared/first');
          await expect(chip.locator('.sr-only')).toHaveText('shared/first');
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    // Same-owner Auto and explicit Yes differ; hidden issue searches must not change the policy.
    await page.getByRole('button', { name: 'Välj repositories', exact: true }).first().click();
    await page.getByRole('checkbox', { name: 'another/empty' }).uncheck();
    await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(sidebar).toHaveText('first');
    await choose('yes');
    await expect(sidebar).toHaveText('shared/first');
    await expect.poll(() => readSettings(page, 'display-label-fixture').then(saved => saved?.preferences?.repositoryOwnerDisplay)).toBe('yes');
    await page.reload();
    await expect(sidebar).toHaveText('shared/first');
    await openSettings(page);
    await expect(page.getByLabel('Visa GitHub-användarnamn i projekt', { exact: true })).toHaveValue('yes');
    if (process.env.OWNER_DISPLAY_MATRIX) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async theme => { const modulePath = '/src/lib/theme.ts'; const { setTheme } = await import(modulePath); setTheme(theme); }, theme);
        await page.clock.runFor(40);
        await page.screenshot({ path: testInfo.outputPath(`owner-settings-${mode}-${scenario.width}-${theme}.png`), fullPage: true });
      }
    }
    await page.getByRole('button', { name: 'Klart', exact: true }).click();
    await closePhoneMenu(page);
    expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => /shared\/first|repositoryOwnerDisplay/.test(key + value)))).toBe(false);
    if (process.env.OWNER_DISPLAY_MATRIX) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async theme => { const modulePath = '/src/lib/theme.ts'; const { setTheme } = await import(modulePath); setTheme(theme); }, theme);
        await page.clock.runFor(40);
        await page.screenshot({ path: testInfo.outputPath(`owner-${mode}-${scenario.width}-${theme}.png`), fullPage: true });
      }
    }
    await context.close();
  });
}

test('owner choice remains encrypted and isolated across confirmed logout and account sign-in', async ({ page }) => {
  const api = await fixture(page);
  // Logout awaits best-effort notification cleanup's short service-worker timeout.
  await page.clock.resume();
  const control = page.getByLabel('Visa GitHub-användarnamn i projekt', { exact: true });
  const inspect = async (expected: string, next?: string) => {
    await openSettings(page);
    await expect(control).toHaveValue(expected);
    if (next) await control.selectOption(next);
    await page.getByRole('button', { name: 'Klart', exact: true }).click();
  };
  const signOut = async () => {
    await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
    await page.getByRole('button', { name: 'Logga ut och ta bort token', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Anslut GitHub', exact: true })).toBeVisible();
    await openSettings(page);
    await expect(control).toHaveValue('auto');
    await expect(control).toBeDisabled();
    await page.getByRole('button', { name: 'Klart', exact: true }).click();
  };
  const signIn = async (login: string, firstVisit = false) => {
    api.setLogin(login);
    await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
    await page.getByLabel('GitHub personal access token').fill(`fictional-owner-${login}-token`);
    await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
    if (firstVisit) {
      for (const repo of api.repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
      await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    }
    await expect(page.locator('.repo-lane')).toHaveCount(3);
  };
  await inspect('auto', 'no');
  await expect.poll(() => readSettings(page, 'display-label-fixture').then(saved => saved?.preferences?.repositoryOwnerDisplay)).toBe('no');
  await signOut();
  await signIn('display-other-fixture', true);
  await inspect('auto', 'yes');
  await expect.poll(() => readSettings(page, 'display-other-fixture').then(saved => saved?.preferences?.repositoryOwnerDisplay)).toBe('yes');
  await page.reload();
  await inspect('yes');
  await signOut();
  await signIn('display-label-fixture');
  await inspect('no');
  await expect.poll(() => readSettings(page, 'display-other-fixture').then(saved => saved?.preferences?.repositoryOwnerDisplay)).toBe('yes');
  await signOut();
  await signIn('display-other-fixture');
  await inspect('yes');
  await expect.poll(() => readSettings(page, 'display-label-fixture').then(saved => saved?.preferences?.repositoryOwnerDisplay)).toBe('no');
  expect(await page.evaluate(() => [...Object.entries(localStorage), ...Object.entries(sessionStorage)]
    .some(([key, value]) => /repositoryOwnerDisplay|display-other-fixture|shared\/first|fictional-owner/.test(key + value)))).toBe(false);
});

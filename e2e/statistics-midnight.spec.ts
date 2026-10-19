import { expect, test, type Page } from '@playwright/test';

const moments = {
  'Europe/Stockholm': ['2026-10-19T21:00:00Z', '2026-10-20T01:00:00Z'],
  'America/Los_Angeles': ['2026-10-20T06:00:00Z', '2026-10-20T10:00:00Z'],
};
async function demo(page: Page, time: string) {
  await page.clock.install({ time: new Date(time) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Utforska en demo', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await expect(page.locator('.statistics-chart')).toHaveCount(3);
}
async function expectValid(page: Page) {
  await expect(page.locator('.statistics-period-label')).toBeVisible();
  await expect(page.getByText('Välj ett giltigt datumintervall inom de senaste 30 dagarna.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.statistics-chart')).toHaveCount(3);
}
for (const [zone, [before, after]] of Object.entries(moments)) {
  test(`preset and Custom refresh local calendar bounds after midnight in ${zone}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: zone, locale: 'sv-SE' });
    const page = await context.newPage();
    await demo(page, before!);
    await page.clock.setSystemTime(new Date(after!));
    const range = page.getByRole('combobox', { name: 'Tidsintervall', exact: true });
    await range.selectOption('30d');
    await expectValid(page);
    await expect(page.getByLabel('Till', { exact: true })).toHaveValue('2026-10-21T00:00');
    await expect(page.getByLabel('Från', { exact: true })).toHaveValue('2026-09-21T00:00');
    const resolution = page.getByRole('combobox', { name: 'Upplösning', exact: true });
    await expect(resolution.locator('option[value="1h"]')).toHaveJSProperty("disabled", true);
    await expect(resolution.locator('option[value="6h"]')).toHaveJSProperty("disabled", false);
    await range.selectOption('custom');
    await expect(page.getByLabel('Från', { exact: true })).toBeFocused();
    await expectValid(page);
    await context.close();
  });
  test(`valid custom instants survive a date edit and expired overlap clamps on resolution change in ${zone}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: zone, locale: 'sv-SE' });
    const page = await context.newPage();
    await demo(page, before!);
    const range = page.getByRole('combobox', { name: 'Tidsintervall', exact: true });
    const from = page.getByLabel('Från', { exact: true });
    const to = page.getByLabel('Till', { exact: true });
    await range.selectOption('custom');
    await from.fill('2026-10-18T10:00');
    await to.fill('2026-10-19T12:00');
    await page.clock.setSystemTime(new Date(after!));
    await to.fill('2026-10-20T12:00');
    await expect(from).toHaveValue('2026-10-18T10:00');
    await expect(to).toHaveValue('2026-10-20T12:00');
    await expectValid(page);
    // Start near the oldest allowed boundary, then advance another local day.
    await from.fill('2026-09-21T12:00');
    await page.clock.setSystemTime(new Date(Date.parse(after!) + 86_400_000));
    await page.getByRole('combobox', { name: 'Upplösning', exact: true }).selectOption('6h');
    await expect(range).toHaveValue('custom');
    await expect(from).toHaveValue('2026-09-22T00:00');
    await expect(to).toHaveValue('2026-10-20T12:00');
    await expectValid(page);
    await context.close();
  });
}

for (const addRepository of [false, true]) {
test(`rollover queues one revalidation behind a pending request within the UTC cache day${addRepository ? ' when repositories change' : ''}`, async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', locale: 'sv-SE' });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-20T06:59:00Z') });
  let events = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const repo = { id: 1, name: 'midnight', full_name: 'sample/midnight', private: true, html_url: 'https://github.com/sample/midnight', owner: { login: 'sample' } };
  const second = { ...repo, id: 2, name: 'second', full_name: 'sample/second' };
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/repos/sample/midnight/issues/events') {
      events++;
      if (events === 2) await held;
    }
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'midnight-fixture', avatar_url: '' } : url.pathname === '/user/repos' ? [repo, second] : [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-midnight-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await expect(page.locator('.statistics-chart')).toHaveCount(1);
  const refresh = page.getByRole('button', { name: 'Uppdatera statistik', exact: true });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect.poll(() => events).toBe(2);
  await page.clock.setSystemTime(new Date('2026-10-20T07:01:00Z'));
  const range = page.getByRole('combobox', { name: 'Tidsintervall', exact: true });
  await range.selectOption('30d');
  await range.selectOption('7d');
  await range.selectOption('30d');
  await expect(page.locator('.statistics-chart')).toHaveCount(1);
  await expect(page.locator('.statistics-period-label')).toBeVisible();
  expect(events).toBe(2);
  if (addRepository) {
    await page.getByRole('button', { name: 'Välj repositories', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Välj repositories', exact: true });
    await picker.getByRole('checkbox', { name: second.full_name }).check();
    await picker.getByRole('button', { name: 'Visa översikt', exact: true }).click();
    await expect(page.locator('.statistics-repository')).toHaveCount(2);
    expect(events).toBe(2);
  }
  release!();
  await expect.poll(() => events).toBe(3);
  await expect(refresh).toBeEnabled();
  expect(events).toBe(3);
  await expect(page.getByLabel('Till', { exact: true })).toHaveValue('2026-10-21T00:00');
  await context.close();
});
}

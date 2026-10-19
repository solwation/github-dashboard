import { expect, test, type Page } from '@playwright/test';
import { readSettings } from './support/settings';
const login = 'timezone-fixture';
const name = 'sample/timezone-fixture';
const now = '2026-10-19T01:00:00Z';
async function signIn(page: Page) {
  const repo = { id: 1, name: 'timezone-fixture', full_name: name, private: true, html_url: 'https://github.com/' + name, owner: { login: 'sample' } };
  const issue = { id: 1, number: 1, title: 'Timezone fixture', created_at: '2026-10-18T22:30:00Z', updated_at: '2026-10-18T22:30:00Z', labels: [], user: { login: 'sample' }, state: 'open', closed_at: null, assignees: [], html_url: repo.html_url + '/issues/1' };
  await page.clock.install({ time: new Date(now) });
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/user') data = { login, avatar_url: '' };
    else if (url.pathname === '/user/repos') data = [repo];
    else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [issue];
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-timezone-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await expect(page.locator('.statistics-repository')).toHaveCount(1);
}
for (const zone of ['Europe/Stockholm', 'America/Los_Angeles']) {
  test(`local calendar, picker persistence and chart agree in ${zone}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: zone, locale: 'sv-SE', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page);
    const from = page.getByLabel('Från (lokal tid)', { exact: true });
    const to = page.getByLabel('Till (lokal tid)', { exact: true });
    await expect(from).toHaveValue(zone === 'Europe/Stockholm' ? '2026-10-17T00:00' : '2026-10-16T00:00');
    await expect(to).toHaveValue(zone === 'Europe/Stockholm' ? '2026-10-20T00:00' : '2026-10-19T00:00');
    await expect(page.locator('.statistics-period-label')).toContainText(zone);
    // The same 22:30Z issue belongs to Oct19 in Stockholm and Oct18 in Los Angeles.
    const created = page.getByRole('group', { name: 'Mätvärden i diagrammet' }).getByRole('button', { name: /^Skapade issues/ });
    await created.click();
    const slider = page.getByRole('slider');
    await slider.focus(); await slider.press('End');
    await expect(page.getByRole('tooltip')).toContainText(zone === 'Europe/Stockholm' ? '19 okt.' : '18 okt.');
    await expect(page.getByRole('tooltip').locator('.chart-selection-value').filter({ hasText: 'Skapade issues' }).locator('b')).toHaveText('1');
    await expect(from).toBeHidden();
    await page.getByRole('button', { name: 'Anpassat', exact: true }).click();
    await expect(from).toBeVisible();
    await expect(from).toBeFocused();
    await from.fill('2026-10-18T10:00');
    await to.fill('2026-10-18T11:00');
    const expected = await page.evaluate(() => ({ from: new Date(2026, 9, 18, 10).toISOString().slice(0, 16), to: new Date(2026, 9, 18, 11).toISOString().slice(0, 16) }));
    await expect.poll(async () => (await readSettings(page, login))?.preferences?.statistics?.[name]?.from).toBe(expected.from);
    await expect.poll(async () => (await readSettings(page, login))?.preferences?.statistics?.[name]?.to).toBe(expected.to);
    await page.reload();
    await expect(from).toHaveValue('2026-10-18T10:00');
    await expect(from).toBeVisible();
    await expect(to).toHaveValue('2026-10-18T11:00');
    await expect(page.locator('.statistics-range-custom')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Import the saved absolute window on a device in the other zone: only display changes.
    const saved = await readSettings(page, login);
    const other = await browser.newContext({ timezoneId: zone === 'Europe/Stockholm' ? 'America/Los_Angeles' : 'Europe/Stockholm', locale: 'sv-SE' });
    const second = await other.newPage();
    await signIn(second);
    await second.evaluate(async ({ login, saved }) => {
      const path = '/src/lib/settings-store.ts';
      const { saveSettings } = await import(/* @vite-ignore */ path);
      await saveSettings(login, saved);
    }, { login, saved });
    await second.reload();
    const displayedFrom = await second.evaluate(value => {
      const date = new Date(value + ':00Z');
      const part = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
    }, expected.from);
    await expect(second.getByLabel('Från (lokal tid)', { exact: true })).toHaveValue(displayedFrom);
    expect((await readSettings(second, login)).preferences.statistics[name].from).toBe(expected.from);
    await other.close();
    await page.getByRole('button', { name: '7 dagar', exact: true }).click();
    await expect(from).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: '7 dagar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(from).toBeHidden();
    await expect(to).toBeHidden();
    await expect(page.locator('.statistics-period-label')).toBeVisible();
    await context.close();
  });
}

test('spring gap is rejected and repeated autumn hours have distinct offsets', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Europe/Stockholm', locale: 'sv-SE' });
  const page = await context.newPage();
  await signIn(page);
  await page.clock.setSystemTime(new Date('2026-03-30T12:00:00Z'));
  await page.getByRole('button', { name: 'Uppdatera statistik', exact: true }).click();
  const from = page.getByLabel('Från (lokal tid)', { exact: true });
  const before = await from.inputValue();
  await page.getByRole('button', { name: 'Anpassat', exact: true }).click();
  await from.fill('2026-03-29T02:30');
  expect(await from.evaluate((input: HTMLInputElement) => input.validity.customError)).toBe(true);
  await page.getByRole('button', { name: '3 dagar', exact: true }).click();
  await expect(from).toBeHidden();
  await page.getByRole('button', { name: 'Anpassat', exact: true }).click();
  await expect(from).toBeFocused();
  expect(await from.evaluate((input: HTMLInputElement) => input.validity.customError)).toBe(false);
  await page.reload();
  await expect(from).toHaveValue(before);
  await page.clock.setSystemTime(new Date('2026-10-25T04:00:00Z'));
  await page.getByRole('button', { name: 'Uppdatera statistik', exact: true }).click();
  await page.getByRole('button', { name: '8h', exact: true }).click();
  await page.getByRole('combobox', { name: 'Upplösning', exact: true }).selectOption('1h');
  const slider = page.getByRole('slider');
  const titles = await page.locator('.statistics-chart > svg circle title').allTextContents();
  expect(titles.some(title => /02:00 GMT\+2/.test(title))).toBe(true);
  expect(titles.some(title => /02:00 GMT\+1/.test(title))).toBe(true);
  await slider.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  // A saved later occurrence of 02:30 must survive reload and edits to the other bound.
  await expect.poll(async () => !!(await readSettings(page, login))?.preferences?.statistics?.[name]).toBe(true);
  const saved = await readSettings(page, login);
  const pref = saved.preferences.statistics[name];
  pref.from = '2026-10-25T01:30'; pref.to = '2026-10-25T03:00'; pref.resolution = '30m'; delete pref.range;
  await page.evaluate(async ({ login, saved }) => {
    const path = '/src/lib/settings-store.ts';
    const { saveSettings } = await import(/* @vite-ignore */ path);
    await saveSettings(login, saved);
  }, { login, saved });
  await page.reload();
  await expect(from).toHaveValue('2026-10-25T02:30');
  await expect(from).toBeVisible();
  await page.getByLabel('Till (lokal tid)', { exact: true }).fill('2026-10-25T04:30');
  await expect.poll(async () => (await readSettings(page, login))?.preferences?.statistics?.[name]?.from).toBe('2026-10-25T01:30');
  await context.close();
});

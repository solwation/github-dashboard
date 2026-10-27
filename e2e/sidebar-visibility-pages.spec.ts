import { expect, test } from '@playwright/test';
import { revealPhoneMenu } from './support/phone-menu';

const long = 'a-very-long-repository-name-that-must-keep-its-ellipsis-in-the-slim-sidebar';
const repositories = [
  { id: 1, name: 'site', full_name: 'Sample/site', private: false, has_pages: true },
  { id: 2, name: 'Sample.github.io', full_name: 'Sample/Sample.github.io', private: false, has_pages: true },
  { id: 3, name: long, full_name: `Sample/${long}`, private: true, has_pages: true },
  { id: 4, name: 'unknown', full_name: 'Sample/unknown' },
  { id: 5, name: 'notes', full_name: 'Sample/notes', private: true, has_pages: false },
].map(repo => ({ ...repo, description: 'Fixture', html_url: `https://github.com/${repo.full_name}`, owner: { login: 'Sample' } }));

// Repositories that receive a status move after the first load, so their unread marker shows.
const unread = new Set(['Sample/site', 'Sample/notes']);
const scenarios = [
  { name: 'desktop', viewport: { width: 1600, height: 1000 }, mobile: false, theme: 'light' as const },
  { name: 'narrow', viewport: { width: 1000, height: 900 }, mobile: false, theme: 'light' as const },
  { name: 'desktop-dark', viewport: { width: 1600, height: 1000 }, mobile: false, theme: 'dark' as const },
  { name: 'narrow-dark', viewport: { width: 1000, height: 900 }, mobile: false, theme: 'dark' as const },
  { name: 'phone', viewport: { width: 390, height: 844 }, mobile: true, theme: 'light' as const },
];
for (const scenario of scenarios) test.describe(scenario.name, () => {
  test.use({ viewport: scenario.viewport, isMobile: scenario.mobile, hasTouch: scenario.mobile, colorScheme: scenario.theme, ...(scenario.mobile ? {} : { deviceScaleFactor: 2 }) });
  test('sidebar shows visibility and a separate Pages link without activating the row', async ({ page }, testInfo) => {
  const created = new Date(Date.now() - 86_400_000).toISOString();
  let moved = false, updated = created;
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    const issues = url.pathname.match(/^\/repos\/(.+)\/issues$/);
    if (url.pathname === '/repos/Sample/Sample.github.io/issues' && url.searchParams.get('state') === 'closed' && url.searchParams.get('page') !== '2')
      data = Array.from({ length: 100 }, (_, index) => ({ id: 9000 + index, number: 100 + index, title: 'Closed', body: '', comments: 0, state: 'closed', closed_at: created, labels: [], assignees: [], html_url: `https://github.com/Sample/Sample.github.io/issues/${100 + index}`, created_at: created, updated_at: created }));
    else if (url.pathname === '/user') data = { login: 'sidebar-pages', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repositories;
    else if (issues && unread.has(issues[1]) && url.searchParams.get('state') !== 'closed') {
      const repo = repositories.find(item => item.full_name === issues[1])!;
      data = [{ id: repo.id * 10, number: 1, title: 'Fixture', body: '', comments: 0, state: 'open', closed_at: null, labels: moved ? [{ name: 'in-progress', color: 'fff' }] : [], assignees: [], html_url: `${repo.html_url}/issues/1`, created_at: created, updated_at: updated }];
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-sidebar-pages-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name.replace(/[.]/g, '\\.')) }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
  await revealPhoneMenu(page);
  if (scenario.mobile) { // The repository sidebar is not part of the phone layout (<=650px / <=950px).
    await expect(page.locator('.sidebar-projects')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('sidebar-pages-phone.png') });
    return;
  }
  const rows = page.locator('.sidebar-repository-row');
  const row = (name: string) => page.locator(`.sidebar-repository-row[data-repository="Sample/${name}"]`);
  await expect(rows).toHaveCount(5);
  // A status move after the first load marks two repositories as recently active.
  await expect(page.locator('.repo-lane')).toHaveCount(5);
  for (const name of ['site', 'notes']) await expect(row(name).locator('.backlog')).toContainText('1');
  const toggle = page.locator('.sidebar-inactive-toggle');
  if (await toggle.isVisible()) await toggle.click();
  moved = true; updated = new Date().toISOString();
  // A manual refresh may be ignored while the initial load settles; retry until the move is seen.
  await expect(async () => {
    await page.keyboard.press('Control+r');
    await expect(row('site').locator('.progress')).toContainText('1', { timeout: 2000 });
  }).toPass();
  await expect(page.locator('.recent-activity')).toHaveCount(2);
  await expect(row('site').locator('.recent-activity')).toHaveAttribute('aria-label', 'Oläst aktivitet');
  await expect(row('notes').locator('.recent-activity')).toHaveCount(1);
  await expect(row('site').locator('.repo-visibility')).toHaveAttribute('aria-label', 'Publikt repository');
  await expect(row(long).locator('.repo-visibility')).toHaveAttribute('aria-label', 'Privat repository');
  await expect(row('unknown').locator('.repo-visibility')).toHaveCount(0);
  await expect(row('unknown').locator('.repo-pages')).toHaveCount(0);
  await expect(row('site').locator('.repo-pages')).toHaveAttribute('href', 'https://sample.github.io/site/');
  await expect(row('Sample.github.io').locator('.repo-pages')).toHaveAttribute('href', 'https://sample.github.io/');
  await expect(row('site').locator('.repo-pages')).toHaveAttribute('target', '_blank');
  await expect(row('site').locator('a a')).toHaveCount(0);
  // Clicking the Pages link must not activate the row.
  const hash = await page.evaluate(() => location.hash);
  const [popup] = await Promise.all([page.waitForEvent('popup'), row('site').locator('.repo-pages').click()]);
  await popup.close();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  // Geometry: nothing overflows, name keeps ellipsis, counts stay on one line below the name.
  const box = await row(long).evaluate(row => {
    const label = row.querySelector('.repository-label') as HTMLElement, body = row.querySelector('.repo-body') as HTMLElement;
    return { clipped: label.scrollWidth > label.clientWidth, over: document.documentElement.scrollWidth > innerWidth, bodyOver: body.scrollWidth > body.clientWidth };
  });
  expect(box).toEqual({ clipped: true, over: false, bodyOver: false });
  // Grid (#295): each trailing icon type shares one x in every row, is centred on the name line,
  // the name spans the slots, and counts and optional icons share the line below it.
  const grid = await rows.evaluateAll(list => list.map(row => {
    const rect = (selector: string) => { const el = row.querySelector(selector); return el ? el.getBoundingClientRect() : null; };
    const label = rect('.repository-label')!, slots = rect('.repo-slots')!, counts = rect('.repository-counts'), dot = rect('.repo-dot')!;
    const icon = (selector: string) => { const r = rect(selector); return r && { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; };
    return {
      label: { left: label.left, right: label.right, y: label.top + label.height / 2 }, slotsLeft: slots.left, slotsY: slots.top + slots.height / 2, dotY: dot.top + dot.height / 2,
      counts: counts && { left: counts.left, height: counts.height },
      unread: icon('.recent-activity'), visibility: icon('.repo-visibility svg'), pages: icon('.repo-pages svg'),
    };
  }));
  for (const key of ['unread', 'visibility', 'pages'] as const) {
    const present = grid.map(item => item[key]).filter(Boolean) as { x: number; y: number; w: number }[];
    expect(present.length, key).toBeGreaterThanOrEqual(2);
    const xs = present.map(item => item.x);
    expect(Math.max(...xs) - Math.min(...xs), `${key} column`).toBeLessThanOrEqual(1);
  }
  const iconWidths = grid.flatMap(item => [item.visibility, item.pages]).filter(Boolean).map(item => Math.round(item!.w));
  expect(new Set(iconWidths).size, 'one icon size').toBe(1);
  // Slot order is unread, visibility, Pages; one shared right edge.
  const columns = (['unread', 'visibility', 'pages'] as const).map(key => grid.find(item => item[key])![key]!.x);
  expect(columns[0]).toBeLessThan(columns[1]);
  expect(columns[1]).toBeLessThan(columns[2]);
  for (const item of grid) {
    expect(item.label.right).toBeGreaterThan(item.slotsLeft);
    expect(Math.abs(item.dotY - item.label.y)).toBeLessThanOrEqual(1);
    for (const key of ['unread', 'visibility', 'pages'] as const) if (item[key]) expect(Math.abs(item[key]!.y - item.slotsY), `${key} centred`).toBeLessThanOrEqual(1);
    expect(item.counts).not.toBeNull();
    expect(Math.abs(item.counts!.left - item.label.left)).toBeLessThanOrEqual(1);
    expect(item.counts!.height).toBeLessThan(24);
  }
  await page.mouse.move(scenario.viewport.width - 20, scenario.viewport.height - 20);
  await page.locator('.sidebar-projects').screenshot({ path: testInfo.outputPath(`sidebar-${scenario.name}.png`) });
  await page.screenshot({ path: testInfo.outputPath(`sidebar-pages-${scenario.name}.png`) });
});
});

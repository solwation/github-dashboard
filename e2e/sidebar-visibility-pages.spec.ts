import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { revealPhoneMenu } from './support/phone-menu';
import { boardSplit } from "./support/board-grouping";

const long = 'a-very-long-repository-name-that-must-keep-its-ellipsis-in-the-slim-sidebar';
const repositories = [
  { id: 1, name: 'site', full_name: 'Sample/site', private: false, has_pages: true },
  { id: 2, name: 'Sample.github.io', full_name: 'Sample/Sample.github.io', private: false, has_pages: true },
  { id: 3, name: long, full_name: `Sample/${long}`, private: true, has_pages: true },
  { id: 4, name: 'unknown', full_name: 'Sample/unknown' },
  { id: 5, name: 'notes', full_name: 'Sample/notes', private: true, has_pages: false },
  { id: 6, name: 'pages-only', full_name: 'Sample/pages-only', has_pages: true },
  { id: 7, name: 'private-only', full_name: 'Sample/private-only', private: true, has_pages: false },
].map(repo => ({ ...repo, description: 'Fixture', html_url: `https://github.com/${repo.full_name}`, owner: { login: 'Sample' } }));

// Repositories that receive a status move after the first load, so their unread marker shows.
const unread = new Set(['Sample/site', 'Sample/notes']);
const scenarios = [
  { name: 'desktop', viewport: { width: 1600, height: 1000 }, mobile: false, theme: 'light' as const },
  { name: 'narrow', viewport: { width: 1000, height: 900 }, mobile: false, theme: 'light' as const },
  { name: 'desktop-dark', viewport: { width: 1600, height: 1000 }, mobile: false, theme: 'dark' as const },
  { name: 'narrow-dark', viewport: { width: 1000, height: 900 }, mobile: false, theme: 'dark' as const },
  { name: 'touch-tablet', viewport: { width: 1000, height: 1100 }, mobile: true, theme: 'light' as const },
  { name: 'touch-tablet-dark', viewport: { width: 1000, height: 1100 }, mobile: true, theme: 'dark' as const },
  { name: 'rail', viewport: { width: 950, height: 700 }, mobile: false, theme: 'light' as const },
  { name: 'rail-dark', viewport: { width: 950, height: 700 }, mobile: false, theme: 'dark' as const },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, mobile: true, theme: 'dark' as const },
  { name: 'phone', viewport: { width: 390, height: 844 }, mobile: true, theme: 'light' as const },
];
for (const scenario of scenarios) test.describe(scenario.name, () => {
  test.use({ viewport: scenario.viewport, isMobile: scenario.mobile, hasTouch: scenario.mobile, colorScheme: scenario.theme, reducedMotion: "reduce", ...(scenario.mobile ? {} : { deviceScaleFactor: 2 }) });
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
  await page.route('https://sample.github.io/**', route => route.fulfill({ body: '<title>Fixture Pages</title>' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-sidebar-pages-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name.replace(/[.]/g, '\\.')) }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
  await revealPhoneMenu(page);
  if (scenario.viewport.width <= 950) { // The repository sidebar is hidden at rail/phone widths.
    await expect(page.locator('.sidebar-projects')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('sidebar-pages-phone.png') });
    return;
  }
  const rows = page.locator('.sidebar-repository-row');
  const row = (name: string) => page.locator(`.sidebar-repository-row[data-repository="Sample/${name}"]`);
  await expect(rows).toHaveCount(7);
  // A status move after the first load marks two repositories as recently active.
  await expect(page.locator('.repo-lane')).toHaveCount(7);
  for (const name of ['site', 'notes']) await expect(row(name).locator('.backlog')).toContainText('1');
  moved = true; updated = new Date().toISOString();
  // A manual refresh may be ignored while the initial load settles; retry until the move is seen.
  await expect(async () => {
    await page.keyboard.press('Control+r');
    await expect(row('site').locator('.progress')).toContainText('1', { timeout: 2000 });
  }).toPass();
  await expect(page.locator('.recent-activity')).toHaveCount(2);
  await expect(row('site').locator('.recent-activity')).toHaveAttribute('aria-label', 'Oläst aktivitet');
  await expect(row('notes').locator('.recent-activity')).toHaveCount(1);
  // Globe = Pages link (only with Pages); lock only for private repositories without Pages; GitHub link on every row.
  await expect(row('site').locator('.repo-visibility')).toHaveCount(0);
  await expect(row(long).locator('.repo-visibility')).toHaveCount(0);
  await expect(row(long).locator('.repo-pages')).toHaveAttribute('aria-label', `Öppna GitHub Pages för Sample/${long}`);
  await expect(row('notes').locator('.repo-visibility')).toHaveAttribute('aria-label', 'Privat repository');
  await expect(row('notes').locator('.repo-pages')).toHaveCount(0);
  for (const repo of repositories) {
    await expect(row(repo.name).locator('.repo-github')).toHaveAttribute('href', `https://github.com/${repo.full_name}`);
    await expect(row(repo.name).locator('.repo-github')).toHaveAttribute('target', '_blank');
    await expect(row(repo.name).locator('.repo-github')).toHaveAttribute('aria-label', `Öppna ${repo.full_name} på GitHub`);
  }
  await expect(row('unknown').locator('.repo-pages')).toHaveCount(0);
  await expect(row('site').locator('.repo-pages')).toHaveAttribute('href', 'https://sample.github.io/site/');
  await expect(row('Sample.github.io').locator('.repo-pages')).toHaveAttribute('href', 'https://sample.github.io/');
  await expect(row('site').locator('.repo-pages')).toHaveAttribute('target', '_blank');
  await expect(row('site').locator('a a')).toHaveCount(0);
  // Clicking the Pages link must not activate the row.
  const hash = await page.evaluate(() => location.hash);
  await row('site').locator('.repository-actions-trigger').click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), row('site').locator('.repo-pages').click()]);
  await popup.close();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  // Geometry: nothing overflows, name keeps ellipsis, counts stay on one line below the name.
  const box = await row(long).evaluate(row => {
    const label = row.querySelector('.repository-label') as HTMLElement, body = row.querySelector('.repo-body') as HTMLElement;
    return { clipped: label.scrollWidth > label.clientWidth, over: document.documentElement.scrollWidth > innerWidth, bodyOver: body.scrollWidth > body.clientWidth };
  });
  expect(box).toEqual({ clipped: true, over: false, bodyOver: false });
  // Names use a dedicated complete text line; counts and unread sit below it.
  const grid = await rows.evaluateAll(list => list.map(row => {
    const box = row.getBoundingClientRect(), label = row.querySelector('.repository-label')!.getBoundingClientRect(), counts = row.querySelector('.repository-counts')!.getBoundingClientRect(), icon = row.querySelector('.project-icon')!.getBoundingClientRect(), trigger = row.querySelector('.repository-actions-trigger')!.getBoundingClientRect();
    return { name: row.getAttribute('data-repository'), rowRight: box.right, rowHeight: box.height, labelLeft: label.left, labelRight: label.right, labelBottom: label.bottom, countsLeft: counts.left, countsTop: counts.top, iconHeight: icon.height, triggerWidth: trigger.width, fullCounts: [...row.querySelectorAll('.status-count-value')].every(value => value.scrollWidth <= value.clientWidth) };
  }));
  for (const item of grid) {
    expect(Math.abs(item.labelLeft - grid[0]!.labelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(item.labelRight - item.rowRight + 4)).toBeLessThanOrEqual(1);
    expect(Math.abs(item.countsLeft - item.labelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(item.iconHeight - item.rowHeight)).toBeLessThanOrEqual(1);
    expect(item.countsTop).toBeGreaterThanOrEqual(item.labelBottom);
    expect(item.fullCounts).toBe(true);
    if (scenario.mobile) expect(item.triggerWidth).toBeGreaterThanOrEqual(44);
  }
  await expect(row('unknown').locator('[role=menuitem]')).toHaveCount(2);
  await expect(row('pages-only').locator('.repo-visibility')).toHaveCount(0);
  await expect(row('pages-only').locator('.repo-pages')).toHaveCount(1);
  await expect(row('private-only').locator('.repo-visibility')).toHaveCount(1);
  await expect(row(long).locator('.repository-label')).toHaveAttribute('title', `Sample/${long}`);
  // Pages is the next keyboard stop after project selection and opens independently.
  await row('site').locator('.sidebar-repository').focus();
  await page.keyboard.press('Tab');
  await expect(row('site').locator('.repository-actions-trigger')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row('site').getByRole('menu')).toBeVisible();
  await expect(row('site').locator('.repo-github')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row('site').locator('.repo-pages')).toBeFocused();
  const [keyboardPopup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await keyboardPopup.close();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await boardSplit(page).uncheck();
  // The icon opens context actions; the full text line navigates the project.
  await row('site').locator('.sidebar-repository').click({ position: { x: 90, y: 12 } });
  await expect(row('site').locator('.sidebar-repository')).toHaveClass(/repository-selected/);
  await expect(row('site').locator('.project-icon')).toBeVisible();
  writeFileSync(testInfo.outputPath('sidebar-geometry.json'), JSON.stringify(grid, null, 2));
  await page.mouse.move(scenario.viewport.width - 20, scenario.viewport.height - 20);
  await page.locator('.sidebar-projects').screenshot({ path: testInfo.outputPath(`sidebar-${scenario.name}.png`) });
  await page.screenshot({ path: testInfo.outputPath(`sidebar-pages-${scenario.name}.png`) });
});
});

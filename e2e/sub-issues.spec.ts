import { expect, test } from '@playwright/test';
const repo = { id: 301, name: 'parent', full_name: 'sample/parent', private: false, description: '', html_url: 'https://github.com/sample/parent', owner: { login: 'sample' } };
const other = { ...repo, id: 302, name: 'child', full_name: 'other/child', html_url: 'https://github.com/other/child', owner: { login: 'other' } };
function issue(id: number, title: string, repository = repo) { return { id, number: id, title, state: 'open', labels: [] as {name: string; color: string}[], assignees: [], body: 'A useful description.', comments: 0, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-21T08:00:00Z', closed_at: null as string | null, html_url: `${repository.html_url}/issues/${id}` }; }
for (const device of [
  { name: 'wide', viewport: { width: 1600, height: 1000 }, isMobile: false, hasTouch: false },
  { name: 'narrow', viewport: { width: 1000, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'portrait', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
]) test(`sub-issues are lazy, paginated, cached and classified in cards/list (${device.name})`, async ({ browser }, info) => {
  const context = await browser.newContext({ ...device, baseURL: info.project.use.baseURL, locale: 'sv-SE' });
  const page = await context.newPage();
  const parent = { ...issue(1, 'Roadmap parent'), sub_issues_summary: { total: 3, completed: 1 } };
  const first = issue(2, 'A long backlog child title with details that should wrap naturally without pushing status beyond its container '.repeat(2));
  const active = { ...issue(3, 'Cross repository active work', other), labels: [{ name: 'shipping', color: 'aaaaaa' }] };
  const closed = { ...issue(4, 'Completed child'), state: 'closed', closed_at: '2026-10-21T08:00:00Z' };
  let requests = 0;
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    if (/\/issues\/1\/sub_issues$/.test(url.pathname)) {
      requests++;
      return route.fulfill(url.searchParams.has('page') ? { json: [closed] } : { json: [first, { ...active, labels: [] }], headers: { 'access-control-expose-headers': 'link', link: '<https://api.github.com/repos/sample/parent/issues/1/sub_issues?per_page=100&page=2>; rel="next"' } });
    }
    if (url.pathname === '/repos/sample/parent') return route.fulfill({ json: repo });
    if (url.pathname === '/repos/other/child') return route.fulfill({ json: other });
    if (url.pathname.endsWith('/issues')) return route.fulfill({ json: url.searchParams.get('state') === 'closed' ? [] : url.pathname.includes('/other/child/') ? [active] : [parent] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Följ publika repositories', exact: true }).click();
  for (const name of [repo.full_name, other.full_name]) { await page.getByLabel('Publikt repository', { exact: true }).fill(name); await page.getByRole('button', { name: 'Lägg till repository', exact: true }).click(); await expect(page.getByRole('checkbox', { name })).toBeChecked(); }
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('.repository-loading')).toHaveCount(0);
  expect(requests).toBe(0);
  await expect(page.locator(".sub-issue-progress")).toHaveCount(0);
  await page.getByRole('button', { name: 'Repositoryegenskaper för child', exact: true }).click();
  await page.getByLabel('Pågående arbete', { exact: true }).fill('shipping');
  await page.getByRole('dialog').getByRole('button', { name: 'Stäng', exact: true }).click();
  const card = page.locator('.issue-card').filter({ has: page.getByRole('link', { name: parent.title, exact: true }) });
  await card.getByRole('button', { name: 'Läs mer', exact: true }).click();
  const section = card.getByRole('region', { name: 'Underärenden', exact: true });
  await expect(section.locator('li')).toHaveCount(3);
  await expect(section.getByRole('progressbar', { name: '1 av 3 underärenden stängda' })).toHaveCount(1);
  await expect(card.locator('.sub-issue-progress')).toHaveCount(1);
  await expect(card.locator('.issue-relations .sub-issue-progress')).toHaveCount(0);
  await expect(card.locator('.parent-task-badge')).toContainText('1/3');
  expect(await card.evaluate(el => Boolean(el.querySelector('.issue-markdown')!.compareDocumentPosition(el.querySelector('.issue-sub-issues')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(section.locator('li').nth(0)).toContainText('Backlog');
  await expect(section.locator('li').nth(1)).toContainText('In progress');
  // Sub-issues open inside the dashboard (parent navigation), so each entry is a button, prefixed with its repository when it differs.
  await expect(section.locator('li').nth(1).getByRole('button')).toHaveText(`${other.full_name}#${active.number} · ${active.title}`);
  await expect(section.locator('li').nth(2)).toContainText('Closed');
  expect(requests).toBe(2);
  await card.getByRole('button', { name: 'Visa mindre', exact: true }).click();
  await card.getByRole('button', { name: 'Läs mer', exact: true }).click();
  await expect(section.locator('li')).toHaveCount(3); expect(requests).toBe(2);
  await section.screenshot({ path: info.outputPath('cards-sub-issues.png') });
  await page.getByRole('group', { name: 'Visningsläge för boarden', exact: true }).getByRole('button', { name: 'Lista', exact: true }).click();
  await page.locator('.issue-row .row-title').filter({ hasText: parent.title }).click();
  const listPopup = page.locator('.row-popup');
  if (await listPopup.count()) {
    await expect(listPopup.locator('.issue-markdown')).toContainText('A useful description.');
    expect(await listPopup.evaluate(el => Boolean(el.querySelector('.issue-markdown')!.compareDocumentPosition(el.querySelector('.issue-sub-issues')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  }
  const listSection = page.getByRole('region', { name: 'Underärenden', exact: true });
  await expect(listSection.locator('li')).toHaveCount(3); expect(requests).toBe(2);
  await expect(listSection.locator('.sub-issue-progress')).toHaveCount(1);
  await expect(page.locator('.issue-relations .sub-issue-progress')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await listSection.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await listSection.screenshot({ path: info.outputPath('list-sub-issues.png') });
  await page.screenshot({ path: info.outputPath('grouped-details-viewport.png'), fullPage: false });
  await context.close();
});

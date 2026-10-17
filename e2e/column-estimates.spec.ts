import { expect, test, type Locator, type Page } from '@playwright/test';

// Column estimates (#140): median of closed issues' in-progress time, counted down by a local clock.
// Closed fixture issues carry `startedAt` directly, the form estimates.ts reads (#141 will fill it from timelines).
const minute = 60000, day = 86400000;
const base = Date.parse('2026-10-15T10:00:00Z');
const repos = ['estimate-fixture', 'sparse-fixture'].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: true, description: '', html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' } }));
const iso = (ms: number) => new Date(ms).toISOString();
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Visible, unclipped estimates in the Pågående and Backlog headers at desktop, tablet and phone widths (#148). */
async function estimatesFit(page: Page, scope: Locator, progressText: RegExp, backlogText: RegExp) {
  for (const [width, height] of [[1440, 900], [1280, 900], [768, 1024], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    for (const [column, text] of [['progress', progressText], ['backlog', backlogText]] as const) {
      const estimate = scope.locator(`.${column} .column-estimate`).first();
      await expect(estimate, `${column} at ${width}px`).toBeVisible();
      await expect(estimate).toHaveText(text);
      const fits = await estimate.evaluate(element => {
        const box = element.getBoundingClientRect(), column = element.closest('.board-column')!.getBoundingClientRect();
        return box.width > 0 && box.left >= column.left - 0.5 && box.right <= column.right + 0.5 && element.scrollWidth <= element.clientWidth + 1;
      });
      expect(fits, `${column} estimate fits its column at ${width}px`).toBe(true);
    }
    expect(await noPageScroll(page)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

function fixture(page: Page, state: { closedActive: boolean; closedAt: number }) {
  const issue = (repo: typeof repos[number], number: number, fields: Record<string, unknown>) => ({ id: repo.id * 100 + number, number, title: `${repo.name} ${number}`, body: '', comments: 0,
    state: 'open', labels: [], assignees: [], created_at: iso(base - 5 * day), updated_at: iso(base - day), closed_at: null, html_url: `${repo.html_url}/issues/${number}`, ...fields });
  const closed = (repo: typeof repos[number], number: number, daysAgo: number, minutes: number) =>
    issue(repo, number, { state: 'closed', startedAt: iso(base - daysAgo * day), closed_at: iso(base - daysAgo * day + minutes * minute) });
  const issues = (repo: typeof repos[number]) => repo.id === 1 ? [
    closed(repo, 1, 3, 20), closed(repo, 2, 2, 30), closed(repo, 3, 1, 40),
    issue(repo, 4, { labels: [{ name: 'priority: high', color: '000000' }] }),
    issue(repo, 5, { labels: [{ name: 'priority: low', color: '000000' }] }),
    state.closedActive
      ? issue(repo, 6, { state: 'closed', startedAt: iso(base - 10 * minute), closed_at: iso(state.closedAt), updated_at: iso(state.closedAt) })
      : issue(repo, 6, { labels: [{ name: 'in-progress', color: '000000' }] }),
  ] : [
    // Too little history: no estimate in this lane, and the combined board ignores it.
    issue(repo, 1, { state: 'closed', closed_at: iso(base - day) }),
    issue(repo, 2, { labels: [{ name: 'in-progress', color: '000000' }] }),
    issue(repo, 3, {}),
  ];
  return page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    const events = url.pathname.match(/\/issues\/(\d+)\/events$/);
    const wanted = url.searchParams.get('state');
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'estimate-account', avatar_url: '' }
      : url.pathname === '/user/repos' ? repos
      : repo && events ? [{ id: 1, event: 'labeled', label: { name: 'in-progress' }, created_at: iso(base - 10 * minute) }]
      : repo && url.pathname.endsWith('/issues') ? issues(repo).filter(item => wanted === 'all' || item.state === wanted) : [] });
  });
}

test('column estimates show the basis, count down, follow a sync and fit every board mode', async ({ page }) => {
  const state = { closedActive: false, closedAt: 0 };
  await fixture(page, state);
  await page.clock.install({ time: base });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-estimate-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();

  const lane = page.locator('#repo-1'), sparse = page.locator('#repo-2');
  const progress = lane.locator('.progress .column-estimate'), backlog = lane.locator('.backlog .column-estimate');
  await expect(lane.locator('.progress .issue-card')).toHaveCount(1);
  // Median 30 min, started 10 min ago: 20 min left; backlog 20 + 2 × 30 min at parallelism 1.
  await expect(progress).toHaveText(/·\s*≈ 20 min kvar/);
  await expect(backlog).toHaveText(/·\s*≈ 1 h 20 min/);
  await expect(progress).toHaveAttribute('title', 'Median 30 min för 3 stängda ärenden senaste 30 dagarna.');
  await expect(backlog).toHaveAttribute('title', /Backlog delas med 1\.0 samtidigt pågående i snitt\./);
  await expect(progress).not.toHaveAttribute('aria-live');
  await expect(page.locator('[aria-live] .column-estimate')).toHaveCount(0);
  await expect(lane.locator('.closed .column-estimate')).toHaveCount(0);
  await expect(sparse.locator('.column-estimate')).toHaveCount(0);

  await page.clock.fastForward(5 * minute);
  await expect(progress).toHaveText(/≈ 15 min kvar/);
  await expect(backlog).toHaveText(/≈ 1 h 15 min/);
  await estimatesFit(page, lane, /≈ 15 min kvar/, /≈ 1 h 15 min/);

  // List mode keeps the header estimate.
  await page.getByRole('group', { name: 'Visningsläge för boarden', exact: true }).getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(lane.locator('.issue-row').first()).toBeVisible();
  await expect(progress).toHaveText(/≈ 15 min kvar/);
  await estimatesFit(page, lane, /≈ 15 min kvar/, /≈ 1 h 15 min/);

  // Combined board: the slowest repository with an estimate decides; the sparse repository is skipped.
  await page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true }).uncheck();
  const board = page.locator('.combined-board');
  await expect(board.locator('.progress .column-estimate')).toHaveText(/≈ 15 min kvar/);
  await expect(board.locator('.backlog .column-estimate')).toHaveText(/≈ 1 h 15 min/);
  await expect(board.locator('.progress .column-estimate')).toHaveAttribute('title', /Median per repository från 3 stängda ärenden i 1 repositories/);
  await expect(board.locator('.issue-row').first()).toBeVisible();
  await expect(board.locator('.backlog .column-estimate')).toHaveText(/≈ 1 h 15 min/);
  await estimatesFit(page, board, /≈ 15 min kvar/, /≈ 1 h 15 min/);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await noPageScroll(page)).toBe(true);
    await expect(board.locator('.backlog .column-estimate')).toBeVisible();
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const [text, background] = await board.locator('.backlog .column-estimate').evaluate(element =>
    [getComputedStyle(element).color, getComputedStyle(element.closest('.board-column')!).backgroundColor]);
  expect(text).not.toBe(background);
  await page.getByRole('checkbox', { name: 'Dela upp per repository', exact: true }).check();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await noPageScroll(page)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // A sync where the in-progress issue closes after 15 min: median of 15/20/30/40 is 25 min.
  state.closedActive = true; state.closedAt = base + 5 * minute;
  await page.keyboard.press('Control+r');
  await expect(lane.locator('.progress .issue-row')).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await expect(backlog).toHaveText(/≈ 50 min/);
  await expect(backlog).toHaveAttribute('title', /Median 25 min för 4 stängda ärenden/);

  // English uses the same compact format.
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await page.getByLabel('Språk', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(backlog).toHaveAttribute('title', /^Median 25 min for 4 closed issues in the last 30 days\. Backlog is divided by 1\.0/);
  await expect(backlog).toHaveText(/≈ 50 min/);
});

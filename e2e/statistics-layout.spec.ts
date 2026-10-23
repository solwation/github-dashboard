import { expect, test } from '@playwright/test';

for (const mixed of [false, true]) test(`statistics aligns repository filters and uses ${mixed ? 'full mixed-owner' : 'short shared-owner'} headings`, async ({ page }) => {
  const repos = ['tiny', 'a-much-longer-repository-name'].map((name, index) => ({ id: index + 1, name, full_name: `${mixed && index ? 'another' : 'sample'}/${name}`, private: false, description: null, html_url: `https://github.com/sample/${name}`, owner: { login: mixed && index ? 'another' : 'sample' } }));
  const date = new Date().toISOString();
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    const second = url.pathname.includes(repos[1]!.name);
    const user = { login: second ? 'a-very-long-contributor-name' : 'one' };
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: 'statistics-layout', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repos;
    else if (url.pathname.endsWith('/issues') && url.searchParams.get('state') !== 'closed') data = [{ id: second ? 2 : 1, number: 1, title: 'Layout fixture', created_at: date, updated_at: date, state: 'open', closed_at: null, labels: [{ name: second ? 'a-very-long-label-name-for-layout' : 'ui', color: 'aabbcc' }], user, assignees: [] }];
    else if (url.pathname.endsWith('/commits')) data = [{ sha: 'layout', parents: [{ sha: 'parent' }], author: user, commit: { committer: { date }, author: { name: user.login } } }];
    else if (url.pathname.includes('/commits/')) data = { stats: { additions: 1, deletions: 0 }, files: [] };
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fictional-statistics-layout');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  const overviewStyle = await page.locator('.repo-lane').first().evaluate(section => {
    const style = getComputedStyle(section);
    const heading = getComputedStyle(section.querySelector('h2')!);
    return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopWidth, titleSize: heading.fontSize };
  });
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  await expect(page.locator('.statistics-repository-toggle')).toHaveCount(2);
  for (const toggle of await page.locator('.statistics-repository-toggle[aria-expanded="false"]').all()) await toggle.click();
  for (const section of await page.locator('.statistics-repository').all()) {
    const style = await section.evaluate(section => {
      const style = getComputedStyle(section);
      const heading = getComputedStyle(section.querySelector('h2')!);
      return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopWidth, titleSize: heading.fontSize };
    });
    expect(style).toEqual(overviewStyle);
    await expect(section.locator('.repo-avatar')).toBeVisible();
    await expect(section.locator('.repo-owner')).toBeVisible();
  }
  const fields = page.locator('.statistics-repo-filters select');
  await expect(fields).toHaveCount(4);
  for (let index = 0; index < repos.length; index++) {
    const link = page.locator(`#statistics-repository-${index + 1} a`);
    await expect(link).toHaveText(mixed ? repos[index]!.full_name : repos[index]!.name);
    await expect(link).toHaveAttribute('title', repos[index]!.full_name);
    await expect(link).toHaveAttribute('aria-label', repos[index]!.full_name);
  }
  for (const width of [1600, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const boxes = await Promise.all((await fields.all()).map(field => field.boundingBox()));
    for (const box of boxes) expect(box!.width).toBeCloseTo(boxes[0]!.width, 0);
    expect(boxes[0]!.x).toBeCloseTo(boxes[2]!.x, 0);
    expect(boxes[1]!.x).toBeCloseTo(boxes[3]!.x, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('#statistics-repo-2 .statistics-filter-select').first().selectOption('a-very-long-label-name-for-layout');
  expect((await fields.nth(2).boundingBox())!.width).toBeCloseTo((await fields.first().boundingBox())!.width, 0);
});

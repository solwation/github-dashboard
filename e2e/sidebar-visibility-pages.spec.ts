import { expect, test } from '@playwright/test';
import { revealPhoneMenu } from './support/phone-menu';

const long = 'a-very-long-repository-name-that-must-keep-its-ellipsis-in-the-slim-sidebar';
const repositories = [
  { id: 1, name: 'site', full_name: 'Sample/site', private: false, has_pages: true },
  { id: 2, name: 'Sample.github.io', full_name: 'Sample/Sample.github.io', private: false, has_pages: true },
  { id: 3, name: long, full_name: `Sample/${long}`, private: true, has_pages: true },
  { id: 4, name: 'unknown', full_name: 'Sample/unknown' },
].map(repo => ({ ...repo, description: 'Fixture', html_url: `https://github.com/${repo.full_name}`, owner: { login: 'Sample' } }));

const scenarios = [
  { name: 'desktop', viewport: { width: 1600, height: 1000 }, mobile: false },
  { name: 'narrow', viewport: { width: 1000, height: 900 }, mobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, mobile: true },
];
for (const scenario of scenarios) test.describe(scenario.name, () => {
  test.use({ viewport: scenario.viewport, isMobile: scenario.mobile, hasTouch: scenario.mobile });
  test('sidebar shows visibility and a separate Pages link without activating the row', async ({ page }, testInfo) => {
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/user') data = { login: 'sidebar-pages', avatar_url: '' };
    else if (url.pathname === '/user/repos') data = repositories;
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-sidebar-pages-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repositories) await page.getByRole('checkbox', { name: new RegExp(repo.full_name.replace(/[.]/g, '\\.')) }).check();
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await revealPhoneMenu(page);
  if (scenario.mobile) { // The repository sidebar is not part of the phone layout (<=650px / <=950px).
    await expect(page.locator('.sidebar-projects')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('sidebar-pages-phone.png') });
    return;
  }
  const rows = page.locator('.sidebar-repository-row');
  const row = (name: string) => page.locator(`.sidebar-repository-row[data-repository="Sample/${name}"]`);
  await expect(rows).toHaveCount(4);
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
  await page.screenshot({ path: testInfo.outputPath(`sidebar-pages-${scenario.name}.png`) });
});
});

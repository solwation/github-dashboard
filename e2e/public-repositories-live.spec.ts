import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('public repositories work without credentials against live GitHub data', async ({ page }, info) => {
  test.skip(process.env.PUBLIC_GITHUB_LIVE !== '1', 'Run explicitly to use the shared anonymous GitHub quota.');
  test.setTimeout(180000);
  const names = (process.env.PUBLIC_GITHUB_REPOSITORIES || 'solwation/lunden-3d-apartment,solwation/kvarteret-lunden,solwation/github-dashboard').split(',');
  const requests: { path: string; authorized: boolean }[] = [];
  const metadata = new Map<string, number>();
  let remaining: string | undefined;
  const failures: { path: string; status: number }[] = [];
  page.on('request', request => {
    if (request.url().startsWith('https://api.github.com/')) requests.push({ path: new URL(request.url()).pathname, authorized: 'authorization' in request.headers() });
  });
  page.on('response', async response => {
    if (!response.url().startsWith('https://api.github.com/')) return;
    remaining = response.headers()['x-ratelimit-remaining'] ?? remaining;
    if (response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() });
    for (const name of names) if (new URL(response.url()).pathname === `/repos/${name}` && response.ok()) metadata.set(name, (await response.json()).id);
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Följ publika repositories', exact: true }).click();
  for (const name of names) {
    await page.getByLabel('Publikt repository', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Lägg till repository', exact: true }).click();
    await expect(page.getByRole('checkbox', { name })).toBeChecked({ timeout: 30000 });
  }
  await page.getByRole('button', { name: 'Visa översikt', exact: true }).click();
  await expect(page.locator('.repository-loading')).toHaveCount(0, { timeout: 120000 });
  const report: unknown[] = [];
  for (const name of names) {
    const section = page.locator(`#repo-${metadata.get(name)}`);
    await expect(section).toBeVisible();
    report.push({ repository: name, issues: await section.locator('.repository-issue-count').innerText(), visibleCards: await section.locator('.issue-card').count(), estimates: await section.locator('.column-estimate').allTextContents(), actualDurations: await section.locator('.implementation-time').allTextContents() });
  }
  expect(failures).toEqual([]);
  expect(requests.every(request => !request.authorized && !/^\/(user|graphql)(\/|$)/.test(request.path))).toBe(true);
  await page.screenshot({ path: info.outputPath('public-repositories-desktop.png'), fullPage: true });
  await page.getByRole('group', { name: 'Visningsläge för boarden', exact: true }).getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.locator('.issue-row').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('public-repositories-phone.png'), fullPage: true });
  const reportPath = info.outputPath('public-data-review.json');
  await writeFile(reportPath, JSON.stringify({ repositories: report, requests: requests.length, remaining, failures }, null, 2));
  await info.attach('public-data-review', { path: reportPath, contentType: 'application/json' });
});

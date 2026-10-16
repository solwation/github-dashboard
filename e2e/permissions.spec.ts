import { expect, test, type Page } from '@playwright/test';
async function setup(page: Page, isPublic = false) {
  let healthy = false;
  const repos = ['first', 'second'].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: !isPublic,
    description: 'Fixture', html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' } }));
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/commits') && !healthy && !isPublic) {
      await route.fulfill({ status: 403, json: { message: 'Resource not accessible by personal access token' } }); return;
    }
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'permissions-test', avatar_url: '' }
      : url.pathname === '/user/repos' ? repos
      : repos.find(repo => `/repos/${repo.full_name}` === url.pathname) ?? [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-permissions-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  for (const repo of repos) await page.getByRole('checkbox', { name: repo.full_name }).check();
  await page.getByRole('button', { name: 'Visa översikt' }).click();
  await expect(page.locator('.repo-lane')).toHaveCount(2);
  return { recover() { healthy = true; } };
}
test('Settings counts unique missing permissions, explains repository differences and refreshes recovered access', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const state = await setup(page);
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GitHub permissions', exact: true });
  await expect(dialog.getByRole('heading', { name: 'GitHub permissions' })).toBeVisible();
  await expect(dialog.getByRole('table')).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveCount(5);
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(800);
  await page.screenshot({ path: '/tmp/issueflow-permissions-table.png' });
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.locator('.permissions-badge')).toHaveText('1');
  await expect(page.locator('.permissions-badge')).toHaveAccessibleName('1 saknade GitHub-rättigheter');
  const contents = dialog.locator('.permission-entry').filter({ has: page.getByRole('rowheader', { name: 'Contents: Läs', exact: true }) });
  await expect(contents.locator('.missing')).toHaveCount(2);
  await expect(contents).toContainText('sample/first');
  await expect(contents).toContainText('sample/second');
  await expect(contents).toContainText('tillagd eller borttagen kod');
  await expect(dialog.locator('.permission-status.granted')).toHaveCount(6);
  state.recover();
  await dialog.getByRole('button', { name: 'Uppdatera kontrollen', exact: true }).click();
  await expect(contents.locator('.granted')).toHaveCount(2);
  await expect(page.locator('.permissions-badge')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(dialog).not.toContainText('fixture-permissions-token');
  await expect(dialog.getByRole('button', { name: /Problemrapport/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'GitHub permissions', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Inställningar', exact: true })).toBeVisible();
});
test('public API readability stays neutral and produces no missing-permission badge', async ({ page }) => {
  await setup(page, true);
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GitHub permissions', exact: true });
  await expect(dialog.locator('.permission-status.unknown')).toHaveCount(8);
  await expect(dialog).toContainText('Publika data kan läsas utan denna tilldelade rättighet');
  await expect(page.locator('.permissions-badge')).toHaveCount(0);
  await expect(dialog.locator('.permission-status.granted')).toHaveCount(0);
});

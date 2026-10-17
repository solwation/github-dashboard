import { expect, test, type Page } from '@playwright/test';
import { readSettings } from "./support/settings";
async function setup(page: Page, isPublic = false) {
  let healthy = false, deniedPulls = false, login = 'permissions-test';
  const repos = ['first', 'second'].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: !isPublic,
    description: 'Fixture', html_url: `https://github.com/sample/${name}`, owner: { login: 'sample' } }));
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    if (((url.pathname.endsWith('/commits') && !healthy) || (url.pathname.endsWith('/pulls') && deniedPulls)) && !isPublic) {
      await route.fulfill({ status: 403, json: { message: 'Resource not accessible by personal access token' } }); return;
    }
    await route.fulfill({ json: url.pathname === '/user' ? { login, avatar_url: '' }
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
  return { recover() { healthy = true; }, revokeContents() { healthy = false; }, denyPulls() { deniedPulls = true; }, asAccount(name: string) { login = name; } };
}
test('Settings counts unique missing permissions, explains repository differences and refreshes recovered access', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const state = await setup(page);
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Inställningar', exact: true });
  await expect(settings.getByRole('button', { name: 'GitHub permissions', exact: true })).toHaveCount(1);
  await expect(settings).not.toContainText(/<{7}|={7}|>{7}/);

  // The Settings total and the submenu it comes from show the same round badge.
  const settingsButton = page.getByRole('button', { name: 'Inställningar', exact: true });
  const permissionsButton = settings.getByRole('button', { name: 'GitHub permissions', exact: true });
  await expect(page.locator('#settings-notices')).toHaveText('1');
  await expect(settings.locator('#permissions-notices')).toHaveText('1');
  await expect(settingsButton).toHaveAccessibleDescription('1 saknade GitHub-rättigheter');
  await expect(permissionsButton).toHaveAccessibleDescription('1 saknade GitHub-rättigheter');
  const [badge, button] = [await settings.locator('#permissions-notices').boundingBox(), await permissionsButton.boundingBox()];
  expect(badge!.width).toBeCloseTo(badge!.height, 0);
  expect(badge!.x + badge!.width).toBeLessThanOrEqual(button!.x + button!.width);
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await permissionsButton.click();
  const dialog = page.getByRole('dialog', { name: 'GitHub permissions', exact: true });
  await expect(dialog.getByRole('heading', { name: 'GitHub permissions' })).toBeVisible();
  await expect(dialog.getByRole('table')).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveCount(5);
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(800);
  await page.screenshot({ path: '/tmp/issueflow-permissions-table.png' });
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.locator('.notice-badge')).toHaveCount(0);
  const contents = dialog.locator('.permission-entry').filter({ has: page.getByRole('rowheader', { name: 'Contents: Läs', exact: true }) });
  await expect(contents.locator('.missing')).toHaveCount(2);
  await expect(contents).toContainText('sample/first');
  await expect(contents).toContainText('sample/second');
  await expect(contents).toContainText('tillagd eller borttagen kod');
  await expect(dialog.locator('.permission-status.granted')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.locator('.notice-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  await expect(contents.locator('.missing')).toHaveCount(2);
  await expect(page.locator('.notice-badge')).toHaveCount(0);
  state.recover();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  await expect(contents.locator('.granted')).toHaveCount(2);
  await expect(page.locator('.notice-badge')).toHaveCount(0);
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
  await expect(dialog.locator('.permission-status.public-read')).toHaveCount(8);
  await expect(dialog).toContainText('Publik läsåtkomst');
  await expect(dialog.getByRole('button', { name: 'Uppdatera kontrollen' })).toHaveCount(0);
  await expect(dialog).toContainText('Publika data kan läsas utan denna tilldelade rättighet');
  await expect(page.locator('.notice-badge')).toHaveCount(0);
  await expect(dialog.locator('.permission-status.granted')).toHaveCount(0);
});

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await page.getByRole('button', { name: 'Logga ut och ta bort token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Anslut GitHub', exact: true })).toBeVisible();
}
async function signInAgain(page: Page) {
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-permissions-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  const show = page.getByRole('button', { name: 'Visa översikt', exact: true });
  await expect.poll(async () => await show.isVisible() || await page.locator('.repo-lane').count() === 2).toBe(true);
  if (await show.isVisible()) {
    for (const name of ['sample/first', 'sample/second']) await page.getByRole('checkbox', { name }).check();
    await show.click();
  }
  await expect(page.locator('.repo-lane')).toHaveCount(2);
}
async function openSettingsWithMissing(page: Page) {
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await expect(page.locator('.permission-status.missing')).toHaveCount(2);
}

test('viewed permission notices survive reload and logout/login while another account keeps its own notices', async ({ page }) => {
  const state = await setup(page);
  await openSettingsWithMissing(page);
  await expect(page.locator('#settings-notices')).toHaveText('1');
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  await expect(page.locator('#settings-notices')).toHaveCount(0);
  await expect.poll(() => readSettings(page, 'permissions-test').then(saved => saved?.permissionAcknowledgements)).toEqual(['contents:sample/first', 'contents:sample/second']);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.reload(); await expect(page.locator('.repo-lane')).toHaveCount(2);
  await openSettingsWithMissing(page);
  await expect(page.locator('#settings-notices')).toHaveCount(0);
  await expect(page.locator('#permissions-notices')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await signOut(page); await signInAgain(page);
  await openSettingsWithMissing(page);
  await expect(page.locator('#settings-notices')).toHaveCount(0);
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'GitHub permissions', exact: true }).locator('.missing')).toHaveCount(2);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await signOut(page); state.asAccount('permissions-other'); await signInAgain(page);
  await openSettingsWithMissing(page);
  await expect(page.locator('#settings-notices')).toHaveText('1');
  await expect(page.locator('#permissions-notices')).toHaveText('1');
});

test('new denials and a denial after confirmed recovery can notify without reviving unchanged viewed problems', async ({ page }) => {
  const state = await setup(page);
  await openSettingsWithMissing(page);
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  await expect(page.locator('#settings-notices')).toHaveCount(0);
  await expect(page.locator('.permissions-content')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  state.recover(); state.denyPulls();
  await page.reload(); await expect(page.locator('.repo-lane')).toHaveCount(2);
  await openSettingsWithMissing(page);
  await expect(page.locator('#settings-notices')).toHaveText('1');
  await expect.poll(() => readSettings(page, 'permissions-test').then(saved => saved?.permissionAcknowledgements)).toEqual([]);
  await page.getByRole('button', { name: 'GitHub permissions', exact: true }).click();
  await expect(page.locator('#settings-notices')).toHaveCount(0);
  await expect(page.locator('.permissions-content')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  state.revokeContents();
  await page.reload(); await expect(page.locator('.repo-lane')).toHaveCount(2);
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await expect(page.locator('.permission-status.missing')).toHaveCount(4);
  await expect(page.locator('#settings-notices')).toHaveText('1');
});
